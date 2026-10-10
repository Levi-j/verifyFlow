import type { APIResponse } from '@playwright/test';
import { InventoryApi } from '../../../src/api/inventory-api';
import { OrdersApi } from '../../../src/api/orders-api';
import { orderSchema, orderSummaryPageSchema } from '../../../src/contracts/order';
import { parseResponse } from '../../../src/contracts/parse-response';
import { problemSchema } from '../../../src/contracts/problem';
import { orderLine } from '../../../src/data/orders';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState } from '../../../src/support/inventory-state';

const UNKNOWN_ORDER_ID = Number.MAX_SAFE_INTEGER;

test.describe('Order ownership', () => {
  test("treats another customer's order as if it does not exist", async ({
    createCustomer,
    createProduct,
    placeOrder,
  }) => {
    const owner = await createCustomer();
    const other = await createCustomer();
    const order = await placeOrder(owner, [orderLine(await createProduct({ stock: 5 }), 1)]);
    const orders = new OrdersApi(other.api);

    const foreign = await orders.get(order.id);
    const missing = await orders.get(UNKNOWN_ORDER_ID);

    await expect(foreign).toBeProblem(404, 'RESOURCE_NOT_FOUND');
    await expect(missing).toBeProblem(404, 'RESOURCE_NOT_FOUND');
    expect(await visibleProblem(foreign)).toEqual(await visibleProblem(missing));
    const body = await foreign.text();
    const sku = order.items[0]?.productSku ?? '';
    expect(body.includes(sku), 'error must not reveal the ordered product').toBe(false);
  });

  test("does not let a customer cancel another customer's order", async ({
    admin,
    createCustomer,
    createProduct,
    placeOrder,
  }) => {
    const owner = await createCustomer();
    const other = await createCustomer();
    const product = await createProduct({ stock: 5 });
    const order = await placeOrder(owner, [orderLine(product, 2)]);
    const inventory = new InventoryApi(admin);
    const before = await inventoryState(inventory, product.id);

    const response = await new OrdersApi(other.api).cancel(order.id);

    await expect(response).toBeProblem(404, 'RESOURCE_NOT_FOUND');
    const ownerView = await new OrdersApi(owner.api).get(order.id);
    expect(ownerView.status()).toBe(200);
    expect(await parseResponse(ownerView, orderSchema)).toEqual(order);
    expect(await inventoryState(inventory, product.id)).toEqual(before);
  });

  test('lists only the orders a customer placed', async ({
    createCustomer,
    createProduct,
    placeOrder,
  }) => {
    const first = await createCustomer();
    const second = await createCustomer();
    const product = await createProduct({ stock: 5 });
    const firstOrder = await placeOrder(first, [orderLine(product, 1)]);
    const secondOrder = await placeOrder(second, [orderLine(product, 1)]);

    const firstList = await orderIds(new OrdersApi(first.api).list());
    const secondList = await orderIds(new OrdersApi(second.api).list());

    expect(firstList).toEqual([firstOrder.id]);
    expect(secondList).toEqual([secondOrder.id]);
  });
});

async function visibleProblem(response: APIResponse) {
  const { status, title, code } = await parseResponse(response, problemSchema);
  return { status, title, code };
}

async function orderIds(request: Promise<APIResponse>): Promise<number[]> {
  const response = await request;
  expect(response.status()).toBe(200);
  const { content } = await parseResponse(response, orderSummaryPageSchema);
  return content.map(({ id }) => id);
}
