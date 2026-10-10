import { InventoryApi } from '../../../src/api/inventory-api';
import { IDEMPOTENCY_KEY_HEADER, ORDERS_PATH, OrdersApi } from '../../../src/api/orders-api';
import { orderSchema } from '../../../src/contracts/order';
import { parseResponse } from '../../../src/contracts/parse-response';
import type { ErrorCode } from '../../../src/contracts/problem';
import {
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  newOrder,
  orderLine,
  uniqueIdempotencyKey,
} from '../../../src/data/orders';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState } from '../../../src/support/inventory-state';
import { lineTotalCents, toCents } from '../../../src/support/money';

interface InvalidOrder {
  description: string;
  body: (productId: number) => unknown;
  code: ErrorCode;
  fields?: string[];
}

const invalidOrders: InvalidOrder[] = [
  { description: 'no items field', body: () => ({}), code: 'VALIDATION_FAILED', fields: ['items'] },
  {
    description: 'null items',
    body: () => ({ items: null }),
    code: 'VALIDATION_FAILED',
    fields: ['items'],
  },
  {
    description: 'an empty item list',
    body: () => ({ items: [] }),
    code: 'VALIDATION_FAILED',
    fields: ['items'],
  },
  {
    description: 'a null item',
    body: () => ({ items: [null] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0]'],
  },
  {
    description: 'an empty item',
    body: () => ({ items: [{}] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].productId', 'items[0].quantity'],
  },
  {
    description: 'a product ID of zero',
    body: () => ({ items: [{ productId: 0, quantity: 1 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].productId'],
  },
  {
    description: 'a negative product ID',
    body: () => ({ items: [{ productId: -1, quantity: 1 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].productId'],
  },
  {
    description: 'a missing product ID',
    body: () => ({ items: [{ quantity: 1 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].productId'],
  },
  {
    description: 'a null product ID',
    body: () => ({ items: [{ productId: null, quantity: 1 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].productId'],
  },
  {
    description: 'a quantity of zero',
    body: (productId) => ({ items: [{ productId, quantity: 0 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].quantity'],
  },
  {
    description: 'a negative quantity',
    body: (productId) => ({ items: [{ productId, quantity: -1 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].quantity'],
  },
  {
    description: `a quantity above ${MAX_LINE_QUANTITY}`,
    body: (productId) => ({ items: [{ productId, quantity: MAX_LINE_QUANTITY + 1 }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].quantity'],
  },
  {
    description: 'a missing quantity',
    body: (productId) => ({ items: [{ productId }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].quantity'],
  },
  {
    description: 'a null quantity',
    body: (productId) => ({ items: [{ productId, quantity: null }] }),
    code: 'VALIDATION_FAILED',
    fields: ['items[0].quantity'],
  },
  {
    description: 'the same product twice',
    body: (productId) => ({
      items: [
        { productId, quantity: 1 },
        { productId, quantity: 2 },
      ],
    }),
    code: 'VALIDATION_FAILED',
    fields: ['items'],
  },
  {
    description: 'a quantity given as text',
    body: (productId) => ({ items: [{ productId, quantity: 'two' }] }),
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'an item that is not an object',
    body: () => ({ items: ['item'] }),
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'a JSON array instead of an order object',
    body: (productId) => [{ productId, quantity: 1 }],
    code: 'MALFORMED_REQUEST',
  },
];

test.describe('Order request validation', () => {
  for (const { description, body, code, fields = [] } of invalidOrders) {
    test(`rejects an order with ${description}`, async ({ admin, customer, createProduct }) => {
      const product = await createProduct({ stock: 5 });
      const inventory = new InventoryApi(admin);
      const before = await inventoryState(inventory, product.id);

      const response = await customer.api.post(ORDERS_PATH, {
        headers: { [IDEMPOTENCY_KEY_HEADER]: uniqueIdempotencyKey() },
        body: body(product.id),
      });

      await expect(response).toBeProblem(400, code, { fields });
      expect(await inventoryState(inventory, product.id)).toEqual(before);
    });
  }
});

test.describe('Order size and quantity limits', () => {
  const unassignedProductIds = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      productId: Number.MAX_SAFE_INTEGER - index,
      quantity: 1,
    }));

  test(`accepts ${MAX_ORDER_LINES} items as far as validation`, async ({ customer }) => {
    const response = await new OrdersApi(customer.api).place(
      { items: unassignedProductIds(MAX_ORDER_LINES) },
      uniqueIdempotencyKey(),
    );

    await expect(response).toBeProblem(409, 'PRODUCT_NOT_AVAILABLE');
  });

  test(`rejects more than ${MAX_ORDER_LINES} items`, async ({ customer }) => {
    const response = await new OrdersApi(customer.api).place(
      { items: unassignedProductIds(MAX_ORDER_LINES + 1) },
      uniqueIdempotencyKey(),
    );

    await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['items'] });
  });

  test(`accepts the maximum quantity of ${MAX_LINE_QUANTITY}`, async ({
    admin,
    customer,
    createProduct,
  }) => {
    const product = await createProduct({ price: 0.99, stock: MAX_LINE_QUANTITY });

    const response = await new OrdersApi(customer.api).place(
      newOrder(orderLine(product, MAX_LINE_QUANTITY)),
      uniqueIdempotencyKey(),
    );

    expect(response.status()).toBe(201);
    const order = await parseResponse(response, orderSchema);
    expect(toCents(order.totalAmount)).toBe(lineTotalCents(0.99, MAX_LINE_QUANTITY));
    const { quantityOnHand } = await inventoryState(new InventoryApi(admin), product.id);
    expect(quantityOnHand).toBe(0);
  });
});
