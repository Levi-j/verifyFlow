import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../../../src/api/api-client';
import { InventoryApi } from '../../../src/api/inventory-api';
import { IDEMPOTENCY_KEY_HEADER, ORDERS_PATH, OrdersApi } from '../../../src/api/orders-api';
import { ProductsApi } from '../../../src/api/products-api';
import type { InventoryMovement } from '../../../src/contracts/inventory';
import { orderSchema, type Order, type OrderItem } from '../../../src/contracts/order';
import { parseResponse } from '../../../src/contracts/parse-response';
import type { Product } from '../../../src/contracts/product';
import { restock } from '../../../src/data/inventory';
import { newOrder, orderLine, uniqueIdempotencyKey } from '../../../src/data/orders';
import { productUpdate } from '../../../src/data/products';
import type { ProductSetup } from '../../../src/fixtures/products';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState, type InventoryState } from '../../../src/support/inventory-state';
import { lineTotalCents, sumCents, toCents } from '../../../src/support/money';

const UNKNOWN_PRODUCT_ID = Number.MAX_SAFE_INTEGER;

type CreateProduct = (setup?: ProductSetup) => Promise<Product>;

test.describe('Order placement', () => {
  test(
    'places a single-item order with a server-calculated total',
    { tag: '@smoke' },
    async ({ admin, customer, createProduct }) => {
      const product = await createProduct({ price: 19.99, stock: 10 });

      const response = await new OrdersApi(customer.api).place(
        newOrder(orderLine(product, 3)),
        uniqueIdempotencyKey(),
      );

      const order = await placedOrder(response);
      expect(order).toMatchObject({ customerId: customer.id, status: 'PENDING' });
      expect(order.updatedAt).toBe(order.createdAt);
      expect(new URL(response.headers().location ?? '', response.url()).pathname).toBe(
        `${ORDERS_PATH}/${order.id}`,
      );
      expect(order.items).toEqual([snapshotOf(product, 3)]);
      expect(toCents(itemFor(order, product).lineTotal)).toBe(lineTotalCents(19.99, 3));
      expect(toCents(order.totalAmount)).toBe(5997);
      expect((await stateOf(admin, product)).quantityOnHand).toBe(7);
    },
  );

  test('places a multi-item order and prices every line', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const lines = [
      { product: await createProduct({ price: 0.1, stock: 10 }), price: 0.1, quantity: 3 },
      { product: await createProduct({ price: 19.99, stock: 10 }), price: 19.99, quantity: 2 },
      { product: await createProduct({ price: 1234.56, stock: 10 }), price: 1234.56, quantity: 7 },
    ];

    const order = await placedOrder(
      await new OrdersApi(customer.api).place(
        newOrder(...lines.map(({ product, quantity }) => orderLine(product, quantity))),
        uniqueIdempotencyKey(),
      ),
    );

    expect(order.items).toHaveLength(lines.length);
    for (const { product, price, quantity } of lines) {
      const item = itemFor(order, product);
      expect(item).toEqual(snapshotOf(product, quantity));
      expect(toCents(item.lineTotal), product.sku).toBe(lineTotalCents(price, quantity));
      expect((await stateOf(admin, product)).quantityOnHand, product.sku).toBe(10 - quantity);
    }
    const expectedTotal = sumCents(
      lines.map(({ price, quantity }) => lineTotalCents(price, quantity)),
    );
    expect(expectedTotal).toBe(30 + 3998 + 864_192);
    expect(toCents(order.totalAmount)).toBe(expectedTotal);
  });

  test('records an ORDER_PLACED movement for each ordered product', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const first = await createProduct({ stock: 10 });
    const second = await createProduct({ stock: 10 });
    const firstBefore = await stateOf(admin, first);
    const secondBefore = await stateOf(admin, second);

    const order = await placedOrder(
      await new OrdersApi(customer.api).place(
        newOrder(orderLine(first, 2), orderLine(second, 5)),
        uniqueIdempotencyKey(),
      ),
    );

    const orderPlaced: Partial<InventoryMovement> = {
      reason: 'ORDER_PLACED',
      orderId: order.id,
      performedByUserId: customer.id,
    };
    expectOneMovementAdded(firstBefore, await stateOf(admin, first), {
      ...orderPlaced,
      productId: first.id,
      quantityChange: -2,
      note: null,
    });
    expectOneMovementAdded(secondBefore, await stateOf(admin, second), {
      ...orderPlaced,
      productId: second.id,
      quantityChange: -5,
      note: null,
    });
  });

  test('uses server-side product data instead of client-supplied values', async ({
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ price: 25, stock: 5 });

    const response = await customer.api.post(ORDERS_PATH, {
      headers: { [IDEMPOTENCY_KEY_HEADER]: uniqueIdempotencyKey() },
      body: {
        totalAmount: 0.01,
        items: [
          {
            productId: product.id,
            quantity: 2,
            unitPrice: 0.01,
            lineTotal: 0.01,
            productName: 'Client-chosen name',
          },
        ],
      },
    });

    const order = await placedOrder(response);
    expect(order.items).toEqual([snapshotOf(product, 2)]);
    expect(toCents(order.totalAmount)).toBe(lineTotalCents(25, 2));
  });
});

test.describe('Orders for unavailable products', () => {
  test('rejects an order containing a product that does not exist', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const available = await createProduct({ stock: 10 });
    const before = await stateOf(admin, available);

    const response = await new OrdersApi(customer.api).place(
      newOrder(orderLine(available, 1), { productId: UNKNOWN_PRODUCT_ID, quantity: 1 }),
      uniqueIdempotencyKey(),
    );

    await expect(response).toBeProblem(409, 'PRODUCT_NOT_AVAILABLE');
    expect(await stateOf(admin, available)).toEqual(before);
  });

  test('rejects an order containing a deactivated product', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const available = await createProduct({ stock: 10 });
    const deactivated = await createProduct({ stock: 10 });
    await deactivate(admin, deactivated);
    const availableBefore = await stateOf(admin, available);
    const deactivatedBefore = await stateOf(admin, deactivated);

    const response = await new OrdersApi(customer.api).place(
      newOrder(orderLine(available, 1), orderLine(deactivated, 1)),
      uniqueIdempotencyKey(),
    );

    await expect(response).toBeProblem(409, 'PRODUCT_NOT_AVAILABLE');
    expect(await stateOf(admin, available)).toEqual(availableBefore);
    expect(await stateOf(admin, deactivated)).toEqual(deactivatedBefore);
  });
});

test.describe('Orders without enough stock', () => {
  const shortages = [
    { description: 'more units than are in stock', stock: 2, quantity: 3 },
    { description: 'a product that is out of stock', stock: 0, quantity: 1 },
  ];

  for (const { description, stock, quantity } of shortages) {
    test(`rejects an order for ${description}`, async ({ admin, customer, createProduct }) => {
      const product = await createProduct({ stock });
      const before = await stateOf(admin, product);

      const response = await new OrdersApi(customer.api).place(
        newOrder(orderLine(product, quantity)),
        uniqueIdempotencyKey(),
      );

      await expect(response).toBeProblem(409, 'INSUFFICIENT_STOCK');
      expect(await stateOf(admin, product)).toEqual(before);
    });
  }
});

test.describe('Failed multi-item orders', () => {
  // OrderFlow deducts stock in ascending product-ID order. Only a shortage found after another
  // item's stock was already deducted exercises the rollback, so both arrangements are tested
  // rather than relying on that internal ordering.
  const arrangements = [
    { description: 'after the other item was deducted', shortProductProcessedLast: true },
    { description: 'before the other item is deducted', shortProductProcessedLast: false },
  ];

  for (const { description, shortProductProcessedLast } of arrangements) {
    test(`rolls back every item when a shortage is found ${description}`, async ({
      admin,
      customer,
      createProduct,
    }) => {
      const { plenty, short } = await createPlentyAndShort(
        createProduct,
        shortProductProcessedLast,
      );
      expect(short.id > plenty.id).toBe(shortProductProcessedLast);
      const plentyBefore = await stateOf(admin, plenty);
      const shortBefore = await stateOf(admin, short);
      const order = newOrder(orderLine(plenty, 3), orderLine(short, 4));
      const key = uniqueIdempotencyKey();

      const response = await new OrdersApi(customer.api).place(order, key);

      await expect(response).toBeProblem(409, 'INSUFFICIENT_STOCK');
      expect(await stateOf(admin, plenty)).toEqual(plentyBefore);
      expect(await stateOf(admin, short)).toEqual(shortBefore);

      // Retrying with the same key would replay a stored order, so a new order proves the
      // failed attempt left nothing behind under this key.
      await addStock(admin, short, 2);
      const retry = await new OrdersApi(customer.api).place(order, key);
      await placedOrder(retry);
      expect(retry.headers()['idempotent-replayed']).toBeUndefined();
      expect((await stateOf(admin, plenty)).quantityOnHand).toBe(7);
      expect((await stateOf(admin, short)).quantityOnHand).toBe(0);
    });
  }
});

async function placedOrder(response: APIResponse): Promise<Order> {
  expect(response.status()).toBe(201);
  return parseResponse(response, orderSchema);
}

function itemFor(order: Order, product: Product): OrderItem {
  const item = order.items.find(({ productId }) => productId === product.id);
  if (item === undefined) {
    throw new Error(`Order ${order.id} has no item for product ${product.id}.`);
  }
  return item;
}

function snapshotOf(product: Product, quantity: number) {
  return expect.objectContaining({
    productId: product.id,
    productSku: product.sku,
    productName: product.name,
    unitPrice: product.price,
    quantity,
  });
}

function stateOf(admin: ApiClient, product: Product): Promise<InventoryState> {
  return inventoryState(new InventoryApi(admin), product.id);
}

function expectOneMovementAdded(
  before: InventoryState,
  after: InventoryState,
  movement: Partial<InventoryMovement>,
): void {
  expect(after.movements).toHaveLength(before.movements.length + 1);
  expect(after.movements.slice(1)).toEqual(before.movements);
  expect(after.movements[0]).toMatchObject(movement);
}

async function createPlentyAndShort(
  createProduct: CreateProduct,
  shortProductProcessedLast: boolean,
) {
  if (shortProductProcessedLast) {
    const plenty = await createProduct({ stock: 10 });
    const short = await createProduct({ stock: 2 });
    return { plenty, short };
  }
  const short = await createProduct({ stock: 2 });
  const plenty = await createProduct({ stock: 10 });
  return { plenty, short };
}

async function deactivate(admin: ApiClient, product: Product): Promise<void> {
  const response = await new ProductsApi(admin).update(
    product.id,
    productUpdate(product, { active: false }),
  );
  expect(response.status()).toBe(200);
}

async function addStock(admin: ApiClient, product: Product, quantity: number): Promise<void> {
  const response = await new InventoryApi(admin).adjust(product.id, restock(quantity));
  expect(response.status()).toBe(200);
}
