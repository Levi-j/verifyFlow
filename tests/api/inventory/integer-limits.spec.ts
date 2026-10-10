import { InventoryApi } from '../../../src/api/inventory-api';
import { inventorySchema } from '../../../src/contracts/inventory';
import { parseResponse } from '../../../src/contracts/parse-response';
import { adjustBy, INT32_MAX, restock } from '../../../src/data/inventory';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState } from '../../../src/support/inventory-state';

test.describe('Stock at the 32-bit integer limit', () => {
  test('accepts stock up to the maximum and rejects going beyond it', async ({
    admin,
    createProduct,
  }) => {
    const product = await createProduct();
    const inventory = new InventoryApi(admin);

    const filled = await inventory.adjust(product.id, restock(INT32_MAX));
    expect(filled.status()).toBe(200);
    expect((await parseResponse(filled, inventorySchema)).quantityOnHand).toBe(INT32_MAX);
    const before = await inventoryState(inventory, product.id);

    // The database rejects the overflowing sum; OrderFlow reports it as a generic data conflict.
    const overflow = await inventory.adjust(product.id, restock(1));

    await expect(overflow).toBeProblem(409, 'DATA_CONFLICT');
    expect(await inventoryState(inventory, product.id)).toEqual(before);
  });

  test('can remove the maximum stock again', async ({ admin, createProduct }) => {
    const product = await createProduct({ stock: INT32_MAX });

    const response = await new InventoryApi(admin).adjust(product.id, adjustBy(-INT32_MAX));

    expect(response.status()).toBe(200);
    expect((await parseResponse(response, inventorySchema)).quantityOnHand).toBe(0);
  });
});
