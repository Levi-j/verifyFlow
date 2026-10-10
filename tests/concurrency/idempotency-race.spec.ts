import type { APIResponse } from '@playwright/test';
import { InventoryApi } from '../../src/api/inventory-api';
import { OrdersApi } from '../../src/api/orders-api';
import { orderSchema, orderSummaryPageSchema } from '../../src/contracts/order';
import { parseResponse } from '../../src/contracts/parse-response';
import { newOrder, orderLine, uniqueIdempotencyKey } from '../../src/data/orders';
import { expect, test } from '../../src/fixtures/test';
import { describeResponse } from '../../src/support/api-diagnostics';
import { inventoryState } from '../../src/support/inventory-state';

test('concurrent uses of one idempotency key create only one order', async ({
  admin,
  customer,
  createProduct,
}, testInfo) => {
  const product = await createProduct({ stock: 10 });
  const inventory = new InventoryApi(admin);
  const orders = new OrdersApi(customer.api);
  const payload = newOrder(orderLine(product, 2));
  const key = uniqueIdempotencyKey();
  const before = await inventoryState(inventory, product.id);
  expect(before.quantityOnHand).toBe(10);
  expect(before.movements).toEqual([
    expect.objectContaining({ reason: 'RESTOCK', quantityChange: 10 }),
  ]);

  const outcomes = await Promise.allSettled(
    Array.from({ length: 5 }, () => orders.place(payload, key)),
  );

  const after = await inventoryState(inventory, product.id);
  const listing = await orderList(orders);
  await testInfo.attach('race-evidence.json', {
    body: JSON.stringify(
      {
        outcomes: await Promise.all(
          outcomes.map(async (outcome) =>
            outcome.status === 'fulfilled'
              ? {
                  response: await describeResponse(outcome.value),
                  replayed: outcome.value.headers()['idempotent-replayed'] === 'true',
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
        orderCount: listing.totalElements,
        orderIds: listing.content.map(({ id }) => id),
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
  const successes = responses.filter((response) => response.status() === 201);
  const conflicts = responses.filter((response) => response.status() === 409);
  expect(successes.length + conflicts.length).toBe(5);
  const originalResponse = originalCreation(successes);
  const original = await parseResponse(originalResponse, orderSchema);
  expect(original).toMatchObject({ customerId: customer.id, status: 'PENDING' });
  expect(original.items).toEqual([expect.objectContaining({ productId: product.id, quantity: 2 })]);
  for (const response of successes) {
    expect([undefined, 'true']).toContain(response.headers()['idempotent-replayed']);
    expect(await parseResponse(response, orderSchema)).toEqual(original);
    expect(response.headers().location).toBe(originalResponse.headers().location);
  }
  for (const response of conflicts) {
    await expect(response).toBeProblem(409, 'IDEMPOTENCY_KEY_IN_USE');
  }

  expect(listing.totalElements).toBe(1);
  expect(listing.content.map(({ id }) => id)).toEqual([original.id]);
  const current = await orders.get(original.id);
  expect(current.status()).toBe(200);
  expect(await parseResponse(current, orderSchema)).toEqual(original);
  expect(after.quantityOnHand).toBe(8);
  expect(after.movements).toHaveLength(before.movements.length + 1);
  expect(after.movements.slice(1)).toEqual(before.movements);
  expect(after.movements[0]).toMatchObject({
    productId: product.id,
    reason: 'ORDER_PLACED',
    quantityChange: -2,
    orderId: original.id,
    performedByUserId: customer.id,
    note: null,
  });

  const replay = await orders.place(payload, key);

  expect(replay.status()).toBe(201);
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  expect(replay.headers().location).toBe(originalResponse.headers().location);
  expect(await parseResponse(replay, orderSchema)).toEqual(original);
  expect(await orderList(orders)).toEqual(listing);
  expect(await inventoryState(inventory, product.id)).toEqual(after);
});

function originalCreation(responses: APIResponse[]): APIResponse {
  const originals = responses.filter(
    (response) => response.headers()['idempotent-replayed'] === undefined,
  );
  expect(originals).toHaveLength(1);
  const original = originals[0];
  if (original === undefined) {
    throw new Error('The race did not return an original order creation.');
  }
  return original;
}

async function orderList(orders: OrdersApi) {
  const response = await orders.list();
  expect(response.status()).toBe(200);
  return parseResponse(response, orderSummaryPageSchema);
}
