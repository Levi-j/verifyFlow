import { InventoryApi } from '../../../src/api/inventory-api';
import { inventorySchema } from '../../../src/contracts/inventory';
import { parseResponse } from '../../../src/contracts/parse-response';
import { restock } from '../../../src/data/inventory';
import { expect, test } from '../../../src/fixtures/test';

const UNKNOWN_PRODUCT_ID = Number.MAX_SAFE_INTEGER;

test.describe('Inventory levels', () => {
  test('reports zero stock for a new product', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const response = await new InventoryApi(admin).getStock(product.id);

    expect(response.status()).toBe(200);
    expect(await parseResponse(response, inventorySchema)).toEqual({
      productId: product.id,
      quantityOnHand: 0,
    });
  });

  test(
    'restocks a product and reports the new quantity',
    { tag: '@smoke' },
    async ({ admin, createProduct }) => {
      const product = await createProduct();
      const inventory = new InventoryApi(admin);

      const adjustment = await inventory.adjust(product.id, restock(5));
      const stock = await inventory.getStock(product.id);

      expect(adjustment.status()).toBe(200);
      expect(stock.status()).toBe(200);
      expect(await parseResponse(stock, inventorySchema)).toEqual({
        productId: product.id,
        quantityOnHand: 5,
      });
    },
  );

  test('reports the stock a product was created with', async ({ admin, createProduct }) => {
    const product = await createProduct({ stock: 25 });

    const response = await new InventoryApi(admin).getStock(product.id);

    expect(response.status()).toBe(200);
    expect((await parseResponse(response, inventorySchema)).quantityOnHand).toBe(25);
  });

  test('returns 404 for the stock and movements of an unknown product', async ({ admin }) => {
    const inventory = new InventoryApi(admin);

    await expect(await inventory.getStock(UNKNOWN_PRODUCT_ID)).toBeProblem(
      404,
      'RESOURCE_NOT_FOUND',
    );
    await expect(await inventory.listMovements(UNKNOWN_PRODUCT_ID)).toBeProblem(
      404,
      'RESOURCE_NOT_FOUND',
    );
  });
});
