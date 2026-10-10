import type { ApiClient } from '../../../src/api/api-client';
import { InventoryApi } from '../../../src/api/inventory-api';
import { inventorySchema, type Inventory } from '../../../src/contracts/inventory';
import { parseResponse } from '../../../src/contracts/parse-response';
import { adjustBy, restock, type InventoryAdjustment } from '../../../src/data/inventory';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState } from '../../../src/support/inventory-state';

test.describe('Inventory adjustments', () => {
  test('adds successive restocks to the stored quantity', async ({ admin, createProduct }) => {
    const product = await createProduct();
    const inventory = new InventoryApi(admin);

    expect(await adjust(admin, product.id, restock(10))).toEqual({
      productId: product.id,
      quantityOnHand: 10,
    });
    expect((await inventoryState(inventory, product.id)).quantityOnHand).toBe(10);

    expect((await adjust(admin, product.id, restock(4))).quantityOnHand).toBe(14);
    expect((await inventoryState(inventory, product.id)).quantityOnHand).toBe(14);
  });

  const stockChanges = [
    { description: 'increases stock by a positive adjustment', change: 5, expected: 15 },
    { description: 'decreases stock by a negative adjustment', change: -4, expected: 6 },
    { description: 'reduces stock to exactly zero', change: -10, expected: 0 },
  ];

  for (const { description, change, expected } of stockChanges) {
    test(description, async ({ admin, createProduct }) => {
      const product = await createProduct({ stock: 10 });

      const updated = await adjust(admin, product.id, adjustBy(change));

      expect(updated).toEqual({ productId: product.id, quantityOnHand: expected });
      const state = await inventoryState(new InventoryApi(admin), product.id);
      expect(state.quantityOnHand).toBe(expected);
    });
  }

  test('changes only the adjusted product', async ({ admin, createProduct }) => {
    const adjusted = await createProduct({ stock: 5 });
    const untouched = await createProduct({ stock: 5 });
    const inventory = new InventoryApi(admin);
    const untouchedBefore = await inventoryState(inventory, untouched.id);

    await adjust(admin, adjusted.id, adjustBy(-2));

    expect((await inventoryState(inventory, adjusted.id)).quantityOnHand).toBe(3);
    expect(await inventoryState(inventory, untouched.id)).toEqual(untouchedBefore);
  });
});

test.describe('Insufficient stock', () => {
  const overdrafts = [
    { description: 'one unit more than is in stock', stock: 5, change: -6 },
    { description: 'stock from a product that has none', stock: 0, change: -1 },
    { description: 'far more than is in stock', stock: 5, change: -1_000_000 },
  ];

  for (const { description, stock, change } of overdrafts) {
    test(`rejects removing ${description} without changing stock or history`, async ({
      admin,
      createProduct,
    }) => {
      const product = await createProduct({ stock });
      const inventory = new InventoryApi(admin);
      const before = await inventoryState(inventory, product.id);

      const response = await inventory.adjust(product.id, adjustBy(change));

      await expect(response).toBeProblem(409, 'INSUFFICIENT_STOCK');
      expect(await inventoryState(inventory, product.id)).toEqual(before);
    });
  }

  test('accepts a valid adjustment after rejecting an overdraft', async ({
    admin,
    createProduct,
  }) => {
    const product = await createProduct({ stock: 5 });
    const inventory = new InventoryApi(admin);
    const before = await inventoryState(inventory, product.id);
    await expect(await inventory.adjust(product.id, adjustBy(-6))).toBeProblem(
      409,
      'INSUFFICIENT_STOCK',
    );

    const updated = await adjust(admin, product.id, adjustBy(-5));

    expect(updated.quantityOnHand).toBe(0);
    const after = await inventoryState(inventory, product.id);
    expect(after.movements).toHaveLength(before.movements.length + 1);
    expect(after.movements.slice(1)).toEqual(before.movements);
    expect(after.movements[0]).toMatchObject({ quantityChange: -5, reason: 'ADJUSTMENT' });
  });
});

async function adjust(
  admin: ApiClient,
  productId: number,
  adjustment: InventoryAdjustment,
): Promise<Inventory> {
  const response = await new InventoryApi(admin).adjust(productId, adjustment);
  expect(response.status()).toBe(200);
  return parseResponse(response, inventorySchema);
}
