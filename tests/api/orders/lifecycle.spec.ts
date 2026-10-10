import type { APIResponse } from '@playwright/test';
import { AdminOrdersApi } from '../../../src/api/admin-orders-api';
import type { ApiClient } from '../../../src/api/api-client';
import { InventoryApi } from '../../../src/api/inventory-api';
import { OrdersApi } from '../../../src/api/orders-api';
import { ProductsApi } from '../../../src/api/products-api';
import type { InventoryMovement } from '../../../src/contracts/inventory';
import {
  orderSchema,
  orderSummaryPageSchema,
  type Order,
  type OrderSummary,
} from '../../../src/contracts/order';
import { parseResponse } from '../../../src/contracts/parse-response';
import type { Product } from '../../../src/contracts/product';
import { newOrder, orderLine, uniqueIdempotencyKey } from '../../../src/data/orders';
import { productUpdate, type ProductUpdate } from '../../../src/data/products';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState, type InventoryState } from '../../../src/support/inventory-state';
import { lineTotalCents, toCents } from '../../../src/support/money';

test.describe('Customer order retrieval', () => {
  test('returns an owned order with its items and total', async ({
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ price: 4.25, stock: 10 });
    const placed = await placeOrder(customer, [orderLine(product, 3)]);

    const response = await new OrdersApi(customer.api).get(placed.id);

    const order = await orderFrom(response);
    expect(order).toEqual(placed);
    expect(order).toMatchObject({ customerId: customer.id, status: 'PENDING' });
    expect(toCents(order.totalAmount)).toBe(lineTotalCents(4.25, 3));
  });

  test('lists every order of the customer, newest first', async ({
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ stock: 10 });
    const placed = [
      await placeOrder(customer, [orderLine(product, 1)]),
      await placeOrder(customer, [orderLine(product, 2)]),
      await placeOrder(customer, [orderLine(product, 3)]),
    ];

    const page = await orderPage(new OrdersApi(customer.api).list());

    expect(page).toMatchObject({ page: 0, totalElements: 3, totalPages: 1 });
    expect(page.content).toEqual(placed.toReversed().map(summaryOf));
  });

  test('pages and sorts the customer order list', async ({
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ stock: 10 });
    const first = await placeOrder(customer, [orderLine(product, 1)]);
    const second = await placeOrder(customer, [orderLine(product, 1)]);
    const third = await placeOrder(customer, [orderLine(product, 1)]);
    const orders = new OrdersApi(customer.api);

    const firstPage = await orderPage(orders.list({ page: 0, size: 2 }));
    const secondPage = await orderPage(orders.list({ page: 1, size: 2 }));
    const oldestFirst = await orderPage(orders.list({ sort: 'createdAt,id,asc' }));

    expect(firstPage).toMatchObject({ page: 0, size: 2, totalElements: 3, totalPages: 2 });
    expect(firstPage.content.map(({ id }) => id)).toEqual([third.id, second.id]);
    expect(secondPage).toMatchObject({ page: 1, size: 2, totalElements: 3, totalPages: 2 });
    expect(secondPage.content.map(({ id }) => id)).toEqual([first.id]);
    expect(oldestFirst.content.map(({ id }) => id)).toEqual([first.id, second.id, third.id]);
  });
});

test.describe('Customer cancellation', () => {
  test(
    'cancels a pending order and restores its stock',
    { tag: '@smoke' },
    async ({ admin, customer, createProduct, placeOrder }) => {
      const product = await createProduct({ stock: 10 });
      const placed = await placeOrder(customer, [orderLine(product, 3)]);
      const afterPlacement = await stateOf(admin, product);
      expect(afterPlacement.quantityOnHand).toBe(7);

      const response = await new OrdersApi(customer.api).cancel(placed.id);

      expect((await orderFrom(response)).status).toBe('CANCELLED');
      expect((await currentOrder(customer.api, placed.id)).status).toBe('CANCELLED');
      const afterCancellation = await stateOf(admin, product);
      expect(afterCancellation.quantityOnHand).toBe(10);
      expectOneMovementAdded(afterPlacement, afterCancellation, {
        productId: product.id,
        quantityChange: 3,
        reason: 'ORDER_CANCELLED',
        orderId: placed.id,
        performedByUserId: customer.id,
        note: null,
      });
    },
  );

  test('restores stock for every item of a multi-item order', async ({
    admin,
    customer,
    createProduct,
    placeOrder,
  }) => {
    const first = await createProduct({ stock: 10 });
    const second = await createProduct({ stock: 5 });
    const placed = await placeOrder(customer, [orderLine(first, 3), orderLine(second, 2)]);
    const firstAfterPlacement = await stateOf(admin, first);
    const secondAfterPlacement = await stateOf(admin, second);

    await orderFrom(await new OrdersApi(customer.api).cancel(placed.id));

    const firstAfterCancellation = await stateOf(admin, first);
    const secondAfterCancellation = await stateOf(admin, second);
    expect(firstAfterCancellation.quantityOnHand).toBe(10);
    expect(secondAfterCancellation.quantityOnHand).toBe(5);
    expectOneMovementAdded(firstAfterPlacement, firstAfterCancellation, {
      quantityChange: 3,
      reason: 'ORDER_CANCELLED',
      orderId: placed.id,
    });
    expectOneMovementAdded(secondAfterPlacement, secondAfterCancellation, {
      quantityChange: 2,
      reason: 'ORDER_CANCELLED',
      orderId: placed.id,
    });
  });

  test('rejects a second cancellation without restoring stock again', async ({
    admin,
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ stock: 10 });
    const placed = await placeOrder(customer, [orderLine(product, 3)]);
    const orders = new OrdersApi(customer.api);
    await orderFrom(await orders.cancel(placed.id));
    const afterCancellation = await stateOf(admin, product);

    const response = await orders.cancel(placed.id);

    await expect(response).toBeProblem(409, 'INVALID_STATUS_TRANSITION');
    expect((await currentOrder(customer.api, placed.id)).status).toBe('CANCELLED');
    expect(await stateOf(admin, product)).toEqual(afterCancellation);
  });

  test('replays the original placement result after the order is cancelled', async ({
    admin,
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 10 });
    const orders = new OrdersApi(customer.api);
    const request = newOrder(orderLine(product, 3));
    const key = uniqueIdempotencyKey();
    const placed = await orderFrom(await orders.place(request, key), 201);
    await orderFrom(await orders.cancel(placed.id));
    const afterCancellation = await stateOf(admin, product);

    const replay = await orders.place(request, key);

    // A replay repeats the original placement response by design; current state comes from GET.
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(await orderFrom(replay, 201)).toEqual(placed);
    expect((await currentOrder(customer.api, placed.id)).status).toBe('CANCELLED');
    expect(await stateOf(admin, product)).toEqual(afterCancellation);
  });
});

test.describe('Order history', () => {
  test('keeps the purchased product details after the product changes', async ({
    admin,
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ name: 'Original name', price: 12.5, stock: 10 });
    const placed = await placeOrder(customer, [orderLine(product, 2)]);

    await updateProduct(admin, product, { name: 'Renamed product', price: 99.99, active: false });

    for (const order of [
      await currentOrder(customer.api, placed.id),
      await orderFrom(await new AdminOrdersApi(admin).get(placed.id)),
    ]) {
      expect(order.items).toEqual(placed.items);
      expect(order.items[0]).toMatchObject({ productName: 'Original name', unitPrice: 12.5 });
      expect(toCents(order.totalAmount)).toBe(lineTotalCents(12.5, 2));
    }
  });
});

async function orderFrom(response: APIResponse, status = 200): Promise<Order> {
  expect(response.status()).toBe(status);
  return parseResponse(response, orderSchema);
}

async function orderPage(request: Promise<APIResponse>) {
  const response = await request;
  expect(response.status()).toBe(200);
  return parseResponse(response, orderSummaryPageSchema);
}

async function currentOrder(customerApi: ApiClient, orderId: number): Promise<Order> {
  return orderFrom(await new OrdersApi(customerApi).get(orderId));
}

function summaryOf({ id, status, totalAmount, createdAt, updatedAt }: Order): OrderSummary {
  return { id, status, totalAmount, createdAt, updatedAt };
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

async function updateProduct(
  admin: ApiClient,
  product: Product,
  changes: Partial<ProductUpdate>,
): Promise<void> {
  const response = await new ProductsApi(admin).update(product.id, productUpdate(product, changes));
  expect(response.status()).toBe(200);
}
