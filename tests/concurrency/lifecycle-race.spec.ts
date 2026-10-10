import type { APIResponse, TestInfo } from '@playwright/test';
import { AdminOrdersApi } from '../../src/api/admin-orders-api';
import type { ApiClient } from '../../src/api/api-client';
import { AuthApi } from '../../src/api/auth-api';
import { InventoryApi } from '../../src/api/inventory-api';
import { OrdersApi } from '../../src/api/orders-api';
import { userSchema } from '../../src/contracts/auth';
import { orderSchema, type Order } from '../../src/contracts/order';
import { parseResponse } from '../../src/contracts/parse-response';
import { orderLine } from '../../src/data/orders';
import { expect, test } from '../../src/fixtures/test';
import { describeResponse, safeProblemCode } from '../../src/support/api-diagnostics';
import { inventoryState, type InventoryState } from '../../src/support/inventory-state';

interface TransitionResponse {
  action: string;
  expectedStatus: string;
  actorId: number;
  response: APIResponse;
}

test('administrator confirmation and cancellation permit only one transition', async ({
  admin,
  customer,
  createProduct,
  placeOrder,
}, testInfo) => {
  const product = await createProduct({ stock: 5 });
  const placed = await placeOrder(customer, [orderLine(product, 2)]);
  const inventory = new InventoryApi(admin);
  const adminOrders = new AdminOrdersApi(admin);
  const actorId = await userIdOf(admin);
  const before = await inventoryState(inventory, product.id);
  expect(placed.status).toBe('PENDING');
  expectPlacementState(before, placed, product.id);

  const outcomes = await Promise.allSettled([
    adminOrders.confirm(placed.id).then((response) => ({
      action: 'confirm',
      expectedStatus: 'CONFIRMED',
      actorId,
      response,
    })),
    adminOrders.cancel(placed.id).then((response) => ({
      action: 'cancel',
      expectedStatus: 'CANCELLED',
      actorId,
      response,
    })),
  ]);

  const current = await orderFrom(await adminOrders.get(placed.id));
  const after = await inventoryState(inventory, product.id);
  await attachRaceEvidence(testInfo, outcomes, current, after);
  const winner = await expectOneTransition(outcomes);
  const cancelled = winner.action === 'cancel';
  expect(await orderFrom(winner.response)).toEqual(current);
  expect(current).toMatchObject({
    id: placed.id,
    customerId: customer.id,
    status: winner.expectedStatus,
    items: placed.items,
    totalAmount: placed.totalAmount,
  });
  expect(await orderFrom(await new OrdersApi(customer.api).get(placed.id))).toEqual(current);
  expect(after.quantityOnHand).toBe(cancelled ? 5 : 3);
  expect(after.movements.filter(({ reason }) => reason !== 'ORDER_CANCELLED')).toEqual(
    before.movements,
  );
  expect(after.movements.filter(({ reason }) => reason === 'ORDER_CANCELLED')).toEqual(
    cancelled
      ? [
          expect.objectContaining({
            productId: product.id,
            orderId: placed.id,
            quantityChange: 2,
            performedByUserId: actorId,
            note: null,
          }),
        ]
      : [],
  );
});

test('customer and administrator cancellation restore stock only once', async ({
  admin,
  customer,
  createProduct,
  placeOrder,
}, testInfo) => {
  const product = await createProduct({ stock: 5 });
  const placed = await placeOrder(customer, [orderLine(product, 2)]);
  const inventory = new InventoryApi(admin);
  const adminOrders = new AdminOrdersApi(admin);
  const customerOrders = new OrdersApi(customer.api);
  const adminId = await userIdOf(admin);
  const before = await inventoryState(inventory, product.id);
  expect(placed.status).toBe('PENDING');
  expectPlacementState(before, placed, product.id);

  const outcomes = await Promise.allSettled([
    customerOrders.cancel(placed.id).then((response) => ({
      action: 'customer-cancel',
      expectedStatus: 'CANCELLED',
      actorId: customer.id,
      response,
    })),
    adminOrders.cancel(placed.id).then((response) => ({
      action: 'admin-cancel',
      expectedStatus: 'CANCELLED',
      actorId: adminId,
      response,
    })),
  ]);

  const current = await orderFrom(await customerOrders.get(placed.id));
  const after = await inventoryState(inventory, product.id);
  await attachRaceEvidence(testInfo, outcomes, current, after);
  const winner = await expectOneTransition(outcomes);
  expect(await orderFrom(winner.response)).toEqual(current);
  expect(current).toMatchObject({
    id: placed.id,
    customerId: customer.id,
    status: 'CANCELLED',
    items: placed.items,
    totalAmount: placed.totalAmount,
  });
  expect(await orderFrom(await adminOrders.get(placed.id))).toEqual(current);
  expect(after.quantityOnHand).toBe(5);
  expect(after.movements).toHaveLength(before.movements.length + 1);
  expect(after.movements.slice(1)).toEqual(before.movements);
  expect(after.movements.filter(({ reason }) => reason === 'ORDER_CANCELLED')).toEqual([
    expect.objectContaining({
      productId: product.id,
      orderId: placed.id,
      quantityChange: 2,
      performedByUserId: winner.actorId,
      note: null,
    }),
  ]);
});

function expectPlacementState(inventory: InventoryState, order: Order, productId: number): void {
  expect(inventory.quantityOnHand).toBe(3);
  expect(inventory.movements).toEqual([
    expect.objectContaining({
      productId,
      reason: 'ORDER_PLACED',
      quantityChange: -2,
      orderId: order.id,
      performedByUserId: order.customerId,
      note: null,
    }),
    expect.objectContaining({ productId, reason: 'RESTOCK', quantityChange: 5, orderId: null }),
  ]);
}

async function expectOneTransition(
  outcomes: PromiseSettledResult<TransitionResponse>[],
): Promise<TransitionResponse> {
  const responses = outcomes.map((outcome) => {
    if (outcome.status === 'rejected') {
      throw outcome.reason;
    }
    return outcome.value;
  });
  expect(responses.map(({ response }) => response.status()).sort()).toEqual([200, 409]);
  const winner = responses.find(({ response }) => response.status() === 200);
  const loser = responses.find(({ response }) => response.status() === 409);
  if (winner === undefined || loser === undefined) {
    throw new Error('Expected exactly one successful transition and one conflict.');
  }
  const code = await safeProblemCode(loser.response);
  if (code !== 'CONCURRENT_MODIFICATION' && code !== 'INVALID_STATUS_TRANSITION') {
    throw new Error(`Unexpected transition conflict: ${await describeResponse(loser.response)}`);
  }
  await expect(loser.response).toBeProblem(409, code);
  return winner;
}

async function orderFrom(response: APIResponse): Promise<Order> {
  expect(response.status()).toBe(200);
  return parseResponse(response, orderSchema);
}

async function userIdOf(client: ApiClient): Promise<number> {
  const response = await new AuthApi(client).currentUser();
  expect(response.status()).toBe(200);
  return (await parseResponse(response, userSchema)).id;
}

async function attachRaceEvidence(
  testInfo: TestInfo,
  outcomes: PromiseSettledResult<TransitionResponse>[],
  order: Order,
  inventory: InventoryState,
): Promise<void> {
  await testInfo.attach('race-evidence.json', {
    body: JSON.stringify(
      {
        outcomes: await Promise.all(
          outcomes.map(async (outcome) =>
            outcome.status === 'fulfilled'
              ? {
                  action: outcome.value.action,
                  actorId: outcome.value.actorId,
                  response: await describeResponse(outcome.value.response),
                }
              : { transportFailure: true },
          ),
        ),
        orderId: order.id,
        orderStatus: order.status,
        quantityOnHand: inventory.quantityOnHand,
        movements: inventory.movements.map(
          ({ id, orderId, reason, quantityChange, performedByUserId }) => ({
            id,
            orderId,
            reason,
            quantityChange,
            performedByUserId,
          }),
        ),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}
