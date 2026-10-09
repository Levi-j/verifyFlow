import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../../../src/api/api-client';
import { ProductsApi, type PageQuery } from '../../../src/api/products-api';
import { parseResponse } from '../../../src/contracts/parse-response';
import { productPageSchema, productSchema, type Product } from '../../../src/contracts/product';
import { productUpdate, type ProductUpdate } from '../../../src/data/products';
import { expect, test } from '../../../src/fixtures/test';

const MAX_PAGE_SIZE = 100;
const MAX_PAGES_TO_SCAN = 5;

type ListProducts = (query: PageQuery) => Promise<APIResponse>;

test.describe('Public product catalog', () => {
  test(
    'shows an administrator-created product to anonymous clients',
    { tag: '@smoke' },
    async ({ anonymous, createProduct }) => {
      const product = await createProduct();

      const response = await new ProductsApi(anonymous).getPublic(product.id);

      expect(response.status()).toBe(200);
      expect(await parseResponse(response, productSchema)).toEqual(product);
    },
  );

  test('lists an active product', async ({ anonymous, createProduct }) => {
    const product = await createProduct();

    expect(await isListed(publicList(anonymous), product)).toBe(true);
  });

  test('shows the latest details after an update', async ({ admin, anonymous, createProduct }) => {
    const product = await createProduct();
    const updated = await updateProduct(admin, product, { name: 'Renamed product', price: 24.99 });

    const response = await new ProductsApi(anonymous).getPublic(product.id);

    expect(response.status()).toBe(200);
    expect(await parseResponse(response, productSchema)).toEqual(updated);
  });

  test('hides a deactivated product from public retrieval and listing', async ({
    admin,
    anonymous,
    createProduct,
  }) => {
    const inactive = await updateProduct(admin, await createProduct(), { active: false });

    const response = await new ProductsApi(anonymous).getPublic(inactive.id);

    await expect(response).toBeProblem(404, 'RESOURCE_NOT_FOUND');
    expect(await isListed(publicList(anonymous), inactive)).toBe(false);
  });

  test('still shows a deactivated product to administrators', async ({ admin, createProduct }) => {
    const inactive = await updateProduct(admin, await createProduct(), { active: false });

    const response = await new ProductsApi(admin).getAdmin(inactive.id);

    expect(response.status()).toBe(200);
    expect(await parseResponse(response, productSchema)).toEqual(inactive);
    expect(await isListed(adminList(admin), inactive)).toBe(true);
  });

  test('restores public visibility when a product is reactivated', async ({
    admin,
    anonymous,
    createProduct,
  }) => {
    const inactive = await updateProduct(admin, await createProduct(), { active: false });
    const reactivated = await updateProduct(admin, inactive, { active: true });

    const response = await new ProductsApi(anonymous).getPublic(reactivated.id);

    expect(response.status()).toBe(200);
    expect(await parseResponse(response, productSchema)).toEqual(reactivated);
    expect(await isListed(publicList(anonymous), reactivated)).toBe(true);
  });
});

function publicList(client: ApiClient): ListProducts {
  return (query) => new ProductsApi(client).listPublic(query);
}

function adminList(client: ApiClient): ListProducts {
  return (query) => new ProductsApi(client).listAdmin(query);
}

async function updateProduct(
  admin: ApiClient,
  product: Product,
  changes: Partial<ProductUpdate>,
): Promise<Product> {
  const response = await new ProductsApi(admin).update(product.id, productUpdate(product, changes));
  expect(response.status()).toBe(200);
  return parseResponse(response, productSchema);
}

// Other workers keep adding products, so the catalog cannot be scanned for a reliable answer.
// Sorting newest-updated first puts a product changed moments ago at the front instead. Once a
// page ends, or its last entry was updated strictly before the product, that page covers every
// position the product could occupy, so its presence or absence there is conclusive.
async function isListed(listProducts: ListProducts, product: Product): Promise<boolean> {
  const productUpdatedAt = Date.parse(product.updatedAt);
  for (let page = 0; page < MAX_PAGES_TO_SCAN; page += 1) {
    const response = await listProducts({ page, size: MAX_PAGE_SIZE, sort: 'updatedAt,desc' });
    expect(response.status()).toBe(200);
    const { content } = await parseResponse(response, productPageSchema);

    if (content.some(({ id }) => id === product.id)) {
      return true;
    }
    const last = content.at(-1);
    if (
      last === undefined ||
      content.length < MAX_PAGE_SIZE ||
      Date.parse(last.updatedAt) < productUpdatedAt
    ) {
      return false;
    }
  }
  throw new Error(
    `More than ${MAX_PAGES_TO_SCAN * MAX_PAGE_SIZE} products were updated after product ` +
      `${product.id}; its listing could not be checked conclusively.`,
  );
}
