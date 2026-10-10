import { InventoryApi } from '../../src/api/inventory-api';
import { OrdersApi } from '../../src/api/orders-api';
import { orderSchema, orderSummaryPageSchema, type Order } from '../../src/contracts/order';
import { parseResponse } from '../../src/contracts/parse-response';
import { newOrder, orderLine, uniqueIdempotencyKey } from '../../src/data/orders';
import { expect, test } from '../../src/fixtures/test';
import { describeResponse } from '../../src/support/api-diagnostics';
import { inventoryState } from '../../src/support/inventory-state';

test('ten customers compete for five units without overselling', async ({
  admin,
  createCustomer,
  createProduct,
}, testInfo) => {
  const product = await createProduct({ stock: 5 });
  const inventory = new InventoryApi(admin);
  const attempts = [];
  for (let index = 0; index < 10; index += 1) {
    const customer = await createCustomer();
    attempts.push({
      customerId: customer.id,
      orders: new OrdersApi(customer.api),
      payload: newOrder(orderLine(product, 1)),
      key: uniqueIdempotencyKey(),
    });
  }
  const before = await inventoryState(inventory, product.id);
  expect(before.quantityOnHand).toBe(5);
  expect(before.movements).toHaveLength(1);
  expect(before.movements[0]).toMatchObject({ reason: 'RESTOCK', quantityChange: 5 });

  const outcomes = await Promise.allSettled(
    attempts.map(async ({ customerId, orders, payload, key }) => ({
      customerId,
      orders,
      response: await orders.place(payload, key),
    })),
  );

  const after = await inventoryState(inventory, product.id);
  const listings = [];
  for (const { customerId, orders } of attempts) {
    const response = await orders.list();
    expect(response.status()).toBe(200);
    listings.push({ customerId, page: await parseResponse(response, orderSummaryPageSchema) });
  }
  await testInfo.attach('race-evidence.json', {
    body: JSON.stringify(
      {
        outcomes: await Promise.all(
          outcomes.map(async (outcome) =>
            outcome.status === 'fulfilled'
              ? {
                  customerId: outcome.value.customerId,
                  response: await describeResponse(outcome.value.response),
                }
              : { transportFailure: true },
          ),
        ),
        quantityOnHand: after.quantityOnHand,
        movements: after.movements.map(
          ({ id, orderId, reason, quantityChange, performedByUserId }) => ({
            id,
            orderId,
            reason,
            quantityChange,
            performedByUserId,
          }),
        ),
        customers: listings.map(({ customerId, page }) => ({
          customerId,
          orderCount: page.totalElements,
          orderIds: page.content.map(({ id }) => id),
        })),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  const responses = outcomes.map((outcome) => {
    if (outcome.status === 'rejected') {
      throw outcome.reason;
    }
    return outcome.value;
  });
  const successes = responses.filter(({ response }) => response.status() === 201);
  const conflicts = responses.filter(({ response }) => response.status() === 409);
  expect(successes).toHaveLength(5);
  expect(conflicts).toHaveLength(5);
  for (const { response } of conflicts) {
    await expect(response).toBeProblem(409, 'INSUFFICIENT_STOCK');
  }

  const ordersByCustomer = new Map<number, Order>();
  for (const { customerId, orders, response } of successes) {
    expect(response.headers()['idempotent-replayed']).toBeUndefined();
    const order = await parseResponse(response, orderSchema);
    expect(order).toMatchObject({ customerId, status: 'PENDING' });
    expect(order.items).toEqual([expect.objectContaining({ productId: product.id, quantity: 1 })]);
    ordersByCustomer.set(customerId, order);
    await expectCurrentOrder(orders, order);
  }
  expect(new Set([...ordersByCustomer.values()].map(({ id }) => id)).size).toBe(5);
  expect(after.quantityOnHand).toBe(0);
  expect(after.movements).toHaveLength(before.movements.length + 5);
  expect(after.movements.filter(({ reason }) => reason === 'RESTOCK')).toEqual(before.movements);
  const placements = after.movements.filter(({ reason }) => reason === 'ORDER_PLACED');
  expect(placements).toHaveLength(5);
  for (const [customerId, order] of ordersByCustomer) {
    expect(placements.filter(({ orderId }) => orderId === order.id)).toEqual([
      expect.objectContaining({
        productId: product.id,
        quantityChange: -1,
        performedByUserId: customerId,
        note: null,
      }),
    ]);
  }
  for (const { customerId, page } of listings) {
    const expectedIds = [...ordersByCustomer.values()]
      .filter((order) => order.customerId === customerId)
      .map(({ id }) => id);
    expect(page.totalElements).toBe(expectedIds.length);
    expect(page.content.map(({ id }) => id)).toEqual(expectedIds);
    expect(page.content.map(({ status }) => status)).toEqual(expectedIds.map(() => 'PENDING'));
  }
});

async function expectCurrentOrder(orders: OrdersApi, placed: Order): Promise<void> {
  const response = await orders.get(placed.id);
  expect(response.status()).toBe(200);
  expect(await parseResponse(response, orderSchema)).toEqual(placed);
}
