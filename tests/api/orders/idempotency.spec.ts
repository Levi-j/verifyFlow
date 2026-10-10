import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../../../src/api/api-client';
import { InventoryApi } from '../../../src/api/inventory-api';
import { ORDERS_PATH, OrdersApi } from '../../../src/api/orders-api';
import { ProductsApi } from '../../../src/api/products-api';
import { orderSchema, type Order } from '../../../src/contracts/order';
import { parseResponse } from '../../../src/contracts/parse-response';
import type { Product } from '../../../src/contracts/product';
import { uniqueSuffix } from '../../../src/data/unique';
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  newOrder,
  orderLine,
  uniqueIdempotencyKey,
} from '../../../src/data/orders';
import { productUpdate } from '../../../src/data/products';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState, type InventoryState } from '../../../src/support/inventory-state';

const REPLAYED_HEADER = 'idempotent-replayed';

test.describe('Idempotency-Key validation', () => {
  test('requires an Idempotency-Key header', async ({ admin, customer, createProduct }) => {
    const product = await createProduct({ stock: 5 });
    const before = await stateOf(admin, product);

    const response = await customer.api.post(ORDERS_PATH, {
      body: newOrder(orderLine(product, 1)),
    });

    await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
    expect(await stateOf(admin, product)).toEqual(before);
  });

  const invalidKeys = [
    { description: 'an empty key', key: '' },
    {
      description: `a key longer than ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      key: uniqueIdempotencyKey().padEnd(MAX_IDEMPOTENCY_KEY_LENGTH + 1, 'k'),
    },
    { description: 'a key containing a space', key: `vf order ${uniqueSuffix()}` },
    { description: 'a key containing a period', key: `vf.order.${uniqueSuffix()}` },
    { description: 'a key containing a comma', key: `vf,order,${uniqueSuffix()}` },
    { description: 'a key containing a non-ASCII letter', key: `vf-commande-${uniqueSuffix()}-é` },
  ];

  for (const { description, key } of invalidKeys) {
    test(`rejects ${description}`, async ({ admin, customer, createProduct }) => {
      const product = await createProduct({ stock: 5 });
      const before = await stateOf(admin, product);

      const response = await new OrdersApi(customer.api).place(
        newOrder(orderLine(product, 1)),
        key,
      );

      await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
      expect(await stateOf(admin, product)).toEqual(before);
    });
  }

  const acceptedKeys = [
    { description: 'a single-character key', key: 'k' },
    {
      description: `a key of exactly ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      key: uniqueIdempotencyKey().padEnd(MAX_IDEMPOTENCY_KEY_LENGTH, 'k'),
    },
    {
      description: 'a key of letters, digits, hyphens, and underscores',
      key: `Key_09-${uniqueSuffix()}`,
    },
  ];

  for (const { description, key } of acceptedKeys) {
    test(`accepts ${description}`, async ({ customer, createProduct }) => {
      const product = await createProduct({ stock: 5 });

      const response = await new OrdersApi(customer.api).place(
        newOrder(orderLine(product, 1)),
        key,
      );

      await placedOrder(response);
      expect(response.headers()[REPLAYED_HEADER]).toBeUndefined();
    });
  }
});

test.describe('Idempotent replay', () => {
  test('returns the original order without placing it again', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const request = newOrder(orderLine(product, 3));
    const key = uniqueIdempotencyKey();

    const first = await orders.place(request, key);
    const original = await placedOrder(first);
    expect(first.headers()[REPLAYED_HEADER]).toBeUndefined();
    const afterFirst = await stateOf(admin, product);
    expect(afterFirst.quantityOnHand).toBe(7);

    const replay = await orders.place(request, key);

    expect(await placedOrder(replay)).toEqual(original);
    expect(replay.headers()[REPLAYED_HEADER]).toBe('true');
    expect(replay.headers().location).toBe(first.headers().location);
    expect(await stateOf(admin, product)).toEqual(afterFirst);
  });

  test('treats the same items listed in a different order as the same request', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const first = await createProduct({ stock: 10 });
    const second = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const key = uniqueIdempotencyKey();
    const original = await placedOrder(
      await orders.place(newOrder(orderLine(first, 2), orderLine(second, 1)), key),
    );
    const firstAfterOrder = await stateOf(admin, first);
    const secondAfterOrder = await stateOf(admin, second);

    const replay = await orders.place(newOrder(orderLine(second, 1), orderLine(first, 2)), key);

    expect(replay.headers()[REPLAYED_HEADER]).toBe('true');
    expect((await placedOrder(replay)).id).toBe(original.id);
    expect(await stateOf(admin, first)).toEqual(firstAfterOrder);
    expect(await stateOf(admin, second)).toEqual(secondAfterOrder);
  });

  test('replays an order after its product is deactivated', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const request = newOrder(orderLine(product, 2));
    const key = uniqueIdempotencyKey();
    const original = await placedOrder(await orders.place(request, key));
    await deactivate(admin, product);
    const afterDeactivation = await stateOf(admin, product);

    const replay = await orders.place(request, key);

    expect(replay.headers()[REPLAYED_HEADER]).toBe('true');
    expect(await placedOrder(replay)).toEqual(original);
    expect(await stateOf(admin, product)).toEqual(afterDeactivation);
    await expect(await orders.place(request, uniqueIdempotencyKey())).toBeProblem(
      409,
      'PRODUCT_NOT_AVAILABLE',
    );
  });
});

test.describe('Idempotency key reuse', () => {
  test('rejects a reused key with a different quantity', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const key = uniqueIdempotencyKey();
    await placedOrder(await orders.place(newOrder(orderLine(product, 2)), key));
    const afterOrder = await stateOf(admin, product);

    const response = await orders.place(newOrder(orderLine(product, 3)), key);

    await expect(response).toBeProblem(409, 'IDEMPOTENCY_KEY_REUSED');
    expect(await stateOf(admin, product)).toEqual(afterOrder);
  });

  test('rejects a reused key with a different product', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const ordered = await createProduct({ stock: 10 });
    const other = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const key = uniqueIdempotencyKey();
    await placedOrder(await orders.place(newOrder(orderLine(ordered, 2)), key));
    const orderedAfterOrder = await stateOf(admin, ordered);
    const otherBefore = await stateOf(admin, other);

    const response = await orders.place(newOrder(orderLine(other, 2)), key);

    await expect(response).toBeProblem(409, 'IDEMPOTENCY_KEY_REUSED');
    expect(await stateOf(admin, ordered)).toEqual(orderedAfterOrder);
    expect(await stateOf(admin, other)).toEqual(otherBefore);
  });
});

test.describe('Idempotency key scope', () => {
  test('treats keys that differ only in letter case as different keys', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const request = newOrder(orderLine(product, 1));
    const suffix = uniqueSuffix();

    const upper = await orders.place(request, `CaseKey-${suffix.toUpperCase()}`);
    const lower = await orders.place(request, `casekey-${suffix.toLowerCase()}`);

    expect(lower.headers()[REPLAYED_HEADER]).toBeUndefined();
    expect((await placedOrder(lower)).id).not.toBe((await placedOrder(upper)).id);
    expect((await stateOf(admin, product)).quantityOnHand).toBe(8);
  });

  test('lets different customers use the same key independently', async ({
    admin,
    createCustomer,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 10 });
    const firstCustomer = await createCustomer();
    const secondCustomer = await createCustomer();
    const request = newOrder(orderLine(product, 1));
    const key = uniqueIdempotencyKey();

    const firstOrder = await placedOrder(
      await new OrdersApi(firstCustomer.api).place(request, key),
    );
    const second = await new OrdersApi(secondCustomer.api).place(request, key);

    expect(second.headers()[REPLAYED_HEADER]).toBeUndefined();
    const secondOrder = await placedOrder(second);
    expect(secondOrder.id).not.toBe(firstOrder.id);
    expect(firstOrder.customerId).toBe(firstCustomer.id);
    expect(secondOrder.customerId).toBe(secondCustomer.id);
    expect((await stateOf(admin, product)).quantityOnHand).toBe(8);
  });
});

async function placedOrder(response: APIResponse): Promise<Order> {
  expect(response.status()).toBe(201);
  return parseResponse(response, orderSchema);
}

function stateOf(admin: ApiClient, product: Product): Promise<InventoryState> {
  return inventoryState(new InventoryApi(admin), product.id);
}

async function deactivate(admin: ApiClient, product: Product): Promise<void> {
  const response = await new ProductsApi(admin).update(
    product.id,
    productUpdate(product, { active: false }),
  );
  expect(response.status()).toBe(200);
}
