import type { APIResponse } from '@playwright/test';
import { AdminOrdersApi, ADMIN_ORDERS_PATH } from '../../../src/api/admin-orders-api';
import type { ApiClient } from '../../../src/api/api-client';
import { AuthApi } from '../../../src/api/auth-api';
import { InventoryApi } from '../../../src/api/inventory-api';
import { OrdersApi } from '../../../src/api/orders-api';
import { userSchema } from '../../../src/contracts/auth';
import {
  adminOrderSummaryPageSchema,
  orderSchema,
  type AdminOrderSummary,
  type Order,
  type OrderStatus,
} from '../../../src/contracts/order';
import { parseResponse } from '../../../src/contracts/parse-response';
import type { Product } from '../../../src/contracts/product';
import { orderLine } from '../../../src/data/orders';
import type { Customer } from '../../../src/fixtures/identities';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState, type InventoryState } from '../../../src/support/inventory-state';

const UNKNOWN_ORDER_ID = Number.MAX_SAFE_INTEGER;
const PAGE_SIZE = 100;
const MAX_PAGES_TO_SCAN = 5;

interface Callers {
  admin: ApiClient;
  customer: Customer;
}

test.describe('Administrator order access', () => {
  test("retrieves any customer's order", async ({ admin, customer, createProduct, placeOrder }) => {
    const placed = await placeOrder(customer, [orderLine(await createProduct({ stock: 5 }), 2)]);

    const order = await orderFrom(await new AdminOrdersApi(admin).get(placed.id));

    expect(order).toEqual(placed);
  });

  test('lists a recently placed order with its customer', async ({
    admin,
    customer,
    createProduct,
    placeOrder,
  }) => {
    const placed = await placeOrder(customer, [orderLine(await createProduct({ stock: 5 }), 1)]);

    const listed = await findInAdminList(admin, placed);

    expect(listed).toEqual({
      id: placed.id,
      customerId: customer.id,
      status: 'PENDING',
      totalAmount: placed.totalAmount,
      createdAt: placed.createdAt,
      updatedAt: placed.updatedAt,
    });
  });

  test('returns 404 for an order that does not exist', async ({ admin }) => {
    const orders = new AdminOrdersApi(admin);

    for (const response of [
      await orders.get(UNKNOWN_ORDER_ID),
      await orders.confirm(UNKNOWN_ORDER_ID),
      await orders.cancel(UNKNOWN_ORDER_ID),
    ]) {
      await expect(response).toBeProblem(404, 'RESOURCE_NOT_FOUND');
    }
  });
});

test.describe('Administrator order transitions', () => {
  test(
    'confirms a pending order without deducting stock again',
    { tag: '@smoke' },
    async ({ admin, customer, createProduct, placeOrder }) => {
      const product = await createProduct({ stock: 10 });
      const placed = await placeOrder(customer, [orderLine(product, 3)]);
      const afterPlacement = await stateOf(admin, product);
      expect(afterPlacement.quantityOnHand).toBe(7);

      const confirmed = await orderFrom(await new AdminOrdersApi(admin).confirm(placed.id));

      expect(confirmed).toMatchObject({ id: placed.id, status: 'CONFIRMED', items: placed.items });
      expect(Date.parse(confirmed.updatedAt)).toBeGreaterThanOrEqual(Date.parse(placed.updatedAt));
      expect((await orderFrom(await new AdminOrdersApi(admin).get(placed.id))).status).toBe(
        'CONFIRMED',
      );
      expect((await orderFrom(await new OrdersApi(customer.api).get(placed.id))).status).toBe(
        'CONFIRMED',
      );
      expect(await stateOf(admin, product)).toEqual(afterPlacement);
    },
  );

  test('cancels a pending order and restores stock as the administrator', async ({
    admin,
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ stock: 10 });
    const placed = await placeOrder(customer, [orderLine(product, 4)]);
    const afterPlacement = await stateOf(admin, product);
    const adminUserId = await userIdOf(admin);

    const cancelled = await orderFrom(await new AdminOrdersApi(admin).cancel(placed.id));

    expect(cancelled.status).toBe('CANCELLED');
    expect((await orderFrom(await new OrdersApi(customer.api).get(placed.id))).status).toBe(
      'CANCELLED',
    );
    const afterCancellation = await stateOf(admin, product);
    expect(afterCancellation.quantityOnHand).toBe(10);
    expect(afterCancellation.movements).toHaveLength(afterPlacement.movements.length + 1);
    expect(afterCancellation.movements.slice(1)).toEqual(afterPlacement.movements);
    expect(afterCancellation.movements[0]).toMatchObject({
      productId: product.id,
      quantityChange: 4,
      reason: 'ORDER_CANCELLED',
      orderId: placed.id,
      performedByUserId: adminUserId,
    });
  });

  const confirm = ({ admin }: Callers, orderId: number) =>
    new AdminOrdersApi(admin).confirm(orderId);
  const adminCancel = ({ admin }: Callers, orderId: number) =>
    new AdminOrdersApi(admin).cancel(orderId);
  const customerCancel = ({ customer }: Callers, orderId: number) =>
    new OrdersApi(customer.api).cancel(orderId);

  const invalidTransitions = [
    { from: 'CONFIRMED', reach: confirm, action: 'confirmed again', attempt: confirm },
    {
      from: 'CONFIRMED',
      reach: confirm,
      action: 'cancelled by an administrator',
      attempt: adminCancel,
    },
    {
      from: 'CONFIRMED',
      reach: confirm,
      action: 'cancelled by its customer',
      attempt: customerCancel,
    },
    { from: 'CANCELLED', reach: adminCancel, action: 'confirmed', attempt: confirm },
    {
      from: 'CANCELLED',
      reach: adminCancel,
      action: 'cancelled by an administrator again',
      attempt: adminCancel,
    },
    {
      from: 'CANCELLED',
      reach: adminCancel,
      action: 'cancelled by its customer',
      attempt: customerCancel,
    },
  ];

  for (const { from, reach, action, attempt } of invalidTransitions) {
    test(`does not let a ${from} order be ${action}`, async ({
      admin,
      customer,
      createProduct,
      placeOrder,
    }) => {
      const product = await createProduct({ stock: 10 });
      const placed = await placeOrder(customer, [orderLine(product, 2)]);
      expect((await reach({ admin, customer }, placed.id)).status()).toBe(200);
      const orderBefore = await orderFrom(await new AdminOrdersApi(admin).get(placed.id));
      const stockBefore = await stateOf(admin, product);
      expect(orderBefore.status).toBe(from);

      const response = await attempt({ admin, customer }, placed.id);

      await expect(response).toBeProblem(409, 'INVALID_STATUS_TRANSITION');
      expect(await orderFrom(await new AdminOrdersApi(admin).get(placed.id))).toEqual(orderBefore);
      expect(await stateOf(admin, product)).toEqual(stockBefore);
    });
  }
});

test.describe('Administrator order filtering', () => {
  test('lists each order only under its current status', async ({
    admin,
    customer,
    createProduct,
    placeOrder,
  }) => {
    const product = await createProduct({ stock: 10 });
    const adminOrders = new AdminOrdersApi(admin);
    const pending = await placeOrder(customer, [orderLine(product, 1)]);
    const confirmed = await placeOrder(customer, [orderLine(product, 1)]);
    const cancelled = await placeOrder(customer, [orderLine(product, 1)]);
    await orderFrom(await adminOrders.confirm(confirmed.id));
    await orderFrom(await adminOrders.cancel(cancelled.id));
    const ordersByStatus: { status: OrderStatus; order: Order }[] = [
      { status: 'PENDING', order: pending },
      { status: 'CONFIRMED', order: confirmed },
      { status: 'CANCELLED', order: cancelled },
    ];

    for (const { status: filter } of ordersByStatus) {
      for (const { status, order } of ordersByStatus) {
        const listed = await findInAdminList(admin, order, filter);

        expect(listed !== undefined, `${status} order listed under ${filter}`).toBe(
          status === filter,
        );
      }
    }
  });

  const invalidFilters = [
    { description: 'an unknown status', status: 'SHIPPED' },
    { description: 'a status in lowercase', status: 'pending' },
  ];

  for (const { description, status } of invalidFilters) {
    test(`rejects a filter by ${description}`, async ({ admin }) => {
      const response = await admin.get(ADMIN_ORDERS_PATH, { params: { status } });

      await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
    });
  }
});

async function orderFrom(response: APIResponse): Promise<Order> {
  expect(response.status()).toBe(200);
  return parseResponse(response, orderSchema);
}

function stateOf(admin: ApiClient, product: Product): Promise<InventoryState> {
  return inventoryState(new InventoryApi(admin), product.id);
}

async function userIdOf(client: ApiClient): Promise<number> {
  const response = await new AuthApi(client).currentUser();
  expect(response.status()).toBe(200);
  return (await parseResponse(response, userSchema)).id;
}

// Other workers keep placing and changing orders, so the shared list cannot be scanned for a
// complete answer. Sorted newest first, an order placed moments ago sits at the front: once a
// page ends, or its last order was created strictly before the target, the target's absence
// is conclusive. Every order returned for a status filter must also have that status.
async function findInAdminList(
  admin: ApiClient,
  order: Order,
  status?: OrderStatus,
): Promise<AdminOrderSummary | undefined> {
  const orderCreatedAt = Date.parse(order.createdAt);
  for (let page = 0; page < MAX_PAGES_TO_SCAN; page += 1) {
    const response = await new AdminOrdersApi(admin).list({
      page,
      size: PAGE_SIZE,
      sort: 'createdAt,id,desc',
      status,
    });
    expect(response.status()).toBe(200);
    const { content } = await parseResponse(response, adminOrderSummaryPageSchema);
    expect(content.filter((listed) => status !== undefined && listed.status !== status)).toEqual(
      [],
    );

    const match = content.find(({ id }) => id === order.id);
    if (match !== undefined) {
      return match;
    }
    const last = content.at(-1);
    if (
      last === undefined ||
      content.length < PAGE_SIZE ||
      Date.parse(last.createdAt) < orderCreatedAt
    ) {
      return undefined;
    }
  }
  throw new Error(
    `More than ${MAX_PAGES_TO_SCAN * PAGE_SIZE} orders were placed after order ${order.id}; ` +
      'its listing could not be checked conclusively.',
  );
}
