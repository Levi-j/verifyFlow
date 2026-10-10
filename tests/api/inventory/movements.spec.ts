import type { ApiClient } from '../../../src/api/api-client';
import { AuthApi } from '../../../src/api/auth-api';
import { InventoryApi } from '../../../src/api/inventory-api';
import type { PageQuery } from '../../../src/api/page-query';
import { userSchema } from '../../../src/contracts/auth';
import { movementPageSchema, type MovementPage } from '../../../src/contracts/inventory';
import { parseResponse } from '../../../src/contracts/parse-response';
import { adjustBy, restock, type InventoryAdjustment } from '../../../src/data/inventory';
import { expect, test } from '../../../src/fixtures/test';
import { inventoryState } from '../../../src/support/inventory-state';

test.describe('Inventory movement history', () => {
  test('is empty for a new product', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const page = await movementPage(admin, product.id);

    expect(page).toEqual({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
  });

  test('records who made each adjustment, why, and by how much', async ({
    admin,
    createProduct,
  }) => {
    const product = await createProduct();
    const adminUserId = await userIdOf(admin);

    await applyInOrder(admin, product.id, [restock(10, 'Supplier delivery'), adjustBy(-3)]);

    const { content } = await movementPage(admin, product.id);
    expect(content).toEqual([
      expect.objectContaining({
        productId: product.id,
        quantityChange: -3,
        reason: 'ADJUSTMENT',
        orderId: null,
        performedByUserId: adminUserId,
        note: null,
      }),
      expect.objectContaining({
        productId: product.id,
        quantityChange: 10,
        reason: 'RESTOCK',
        orderId: null,
        performedByUserId: adminUserId,
        note: 'Supplier delivery',
      }),
    ]);
    expect(new Set(content.map(({ id }) => id)).size).toBe(content.length);
  });

  test('lists movements newest first by default', async ({ admin, createProduct }) => {
    const product = await createProduct();
    await applyInOrder(admin, product.id, [restock(10), adjustBy(3), adjustBy(-4)]);

    const { content } = await movementPage(admin, product.id);

    expect(content.map(({ quantityChange }) => quantityChange)).toEqual([-4, 3, 10]);
    expect(isDescending(content.map(({ id }) => id))).toBe(true);
  });

  test('lists movements oldest first when sorted by creation time ascending', async ({
    admin,
    createProduct,
  }) => {
    const product = await createProduct();
    await applyInOrder(admin, product.id, [restock(10), adjustBy(3), adjustBy(-4)]);

    const { content } = await movementPage(admin, product.id, { sort: 'createdAt,id,asc' });

    expect(content.map(({ quantityChange }) => quantityChange)).toEqual([10, 3, -4]);
  });

  test('splits a product history into pages', async ({ admin, createProduct }) => {
    const product = await createProduct();
    await applyInOrder(
      admin,
      product.id,
      [1, 2, 3, 4, 5].map((quantity) => restock(quantity)),
    );

    const pages = [
      await movementPage(admin, product.id, { page: 0, size: 2 }),
      await movementPage(admin, product.id, { page: 1, size: 2 }),
      await movementPage(admin, product.id, { page: 2, size: 2 }),
    ];

    expect(pages.map(({ content }) => content.map((movement) => movement.quantityChange))).toEqual([
      [5, 4],
      [3, 2],
      [1],
    ]);
    for (const [index, page] of pages.entries()) {
      expect(page).toMatchObject({ page: index, size: 2, totalElements: 5, totalPages: 3 });
    }
  });

  test('limits a page to 100 movements', async ({ admin, createProduct }) => {
    const product = await createProduct({ stock: 1 });

    const page = await movementPage(admin, product.id, { size: 500 });

    expect(page).toMatchObject({ size: 100, totalElements: 1 });
  });

  test('rejects an unknown sort property', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const response = await new InventoryApi(admin).listMovements(product.id, {
      sort: 'popularity',
    });

    await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
  });
});

test.describe('Inventory consistency', () => {
  test('keeps stock equal to the sum of recorded movements', async ({ admin, createProduct }) => {
    const product = await createProduct();
    const inventory = new InventoryApi(admin);
    await applyInOrder(admin, product.id, [restock(20), adjustBy(5), adjustBy(-8), restock(3)]);
    await expect(await inventory.adjust(product.id, adjustBy(-21))).toBeProblem(
      409,
      'INSUFFICIENT_STOCK',
    );

    const { quantityOnHand, movements } = await inventoryState(inventory, product.id);

    expect(movements).toHaveLength(4);
    expect(sumOf(movements.map(({ quantityChange }) => quantityChange))).toBe(20);
    expect(quantityOnHand).toBe(20);
  });
});

async function applyInOrder(
  admin: ApiClient,
  productId: number,
  adjustments: InventoryAdjustment[],
): Promise<void> {
  const inventory = new InventoryApi(admin);
  for (const adjustment of adjustments) {
    const response = await inventory.adjust(productId, adjustment);
    expect(response.status()).toBe(200);
  }
}

async function movementPage(
  admin: ApiClient,
  productId: number,
  query: PageQuery = {},
): Promise<MovementPage> {
  const response = await new InventoryApi(admin).listMovements(productId, query);
  expect(response.status()).toBe(200);
  return parseResponse(response, movementPageSchema);
}

async function userIdOf(client: ApiClient): Promise<number> {
  const response = await new AuthApi(client).currentUser();
  expect(response.status()).toBe(200);
  return (await parseResponse(response, userSchema)).id;
}

function isDescending(values: number[]): boolean {
  return values.slice(1).every((value, index) => {
    const previous = values[index];
    return previous !== undefined && previous > value;
  });
}

function sumOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
