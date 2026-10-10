import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../../../src/api/api-client';
import type { PageQuery } from '../../../src/api/page-query';
import { ProductsApi } from '../../../src/api/products-api';
import { parseResponse } from '../../../src/contracts/parse-response';
import { productPageSchema, type Product, type ProductPage } from '../../../src/contracts/product';
import { expect, test } from '../../../src/fixtures/test';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface Clients {
  anonymous: ApiClient;
  admin: ApiClient;
}

const catalogs = [
  {
    name: 'public catalog',
    list: ({ anonymous }: Clients, query: PageQuery) =>
      new ProductsApi(anonymous).listPublic(query),
  },
  {
    name: 'administrator catalog',
    list: ({ admin }: Clients, query: PageQuery) => new ProductsApi(admin).listAdmin(query),
  },
];

const byPriceThenId = (first: Product, second: Product) =>
  first.price - second.price || first.id - second.id;

for (const { name, list } of catalogs) {
  test.describe(`Pagination and sorting: ${name}`, () => {
    test(`returns ${DEFAULT_PAGE_SIZE} products per page by default`, async ({
      anonymous,
      admin,
      createProduct,
    }) => {
      await createProduct();

      const page = await pageOf(list({ anonymous, admin }, {}));

      expectConsistentPage(page, { page: 0, size: DEFAULT_PAGE_SIZE });
      expect(page.content.length).toBeGreaterThan(0);
    });

    const pageSizes = [
      { requested: 5, effective: 5 },
      { requested: MAX_PAGE_SIZE, effective: MAX_PAGE_SIZE },
      { requested: 500, effective: MAX_PAGE_SIZE },
      { requested: 0, effective: DEFAULT_PAGE_SIZE },
    ];

    for (const { requested, effective } of pageSizes) {
      test(`uses a page size of ${effective} when ${requested} is requested`, async ({
        anonymous,
        admin,
      }) => {
        const page = await pageOf(list({ anonymous, admin }, { size: requested }));

        expectConsistentPage(page, { page: 0, size: effective });
      });
    }

    test('returns the requested page number', async ({ anonymous, admin }) => {
      const page = await pageOf(list({ anonymous, admin }, { page: 1, size: 5 }));

      expectConsistentPage(page, { page: 1, size: 5 });
    });

    test('returns an empty page beyond the last page', async ({ anonymous, admin }) => {
      const page = await pageOf(list({ anonymous, admin }, { page: 999_999 }));

      expectConsistentPage(page, { page: 999_999, size: DEFAULT_PAGE_SIZE });
      expect(page.content).toEqual([]);
    });

    test('sorts by price ascending, with ID as the tie-breaker', async ({
      anonymous,
      admin,
      createProduct,
    }) => {
      await createProduct({ price: 0.01 });
      await createProduct({ price: 0.01 });

      const page = await pageOf(list({ anonymous, admin }, { sort: 'price,id,asc' }));

      expect(page.content.length).toBeGreaterThan(1);
      expect(isStrictlyOrdered(page.content, byPriceThenId)).toBe(true);
    });

    test('sorts by price descending, with ID as the tie-breaker', async ({
      anonymous,
      admin,
      createProduct,
    }) => {
      await createProduct({ price: 9_999_999_999.99 });
      await createProduct({ price: 9_999_999_999.99 });

      const page = await pageOf(list({ anonymous, admin }, { sort: 'price,id,desc' }));

      expect(page.content.length).toBeGreaterThan(1);
      expect(isStrictlyOrdered(page.content, (first, second) => byPriceThenId(second, first))).toBe(
        true,
      );
    });

    const invalidSorts = [
      { description: 'an unknown sort property', sort: 'popularity' },
      { description: 'a sort property in the wrong letter case', sort: 'PRICE' },
    ];

    for (const { description, sort } of invalidSorts) {
      test(`rejects ${description}`, async ({ anonymous, admin }) => {
        const response = await list({ anonymous, admin }, { sort });

        await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
      });
    }
  });
}

async function pageOf(request: Promise<APIResponse>): Promise<ProductPage> {
  const response = await request;
  expect(response.status()).toBe(200);
  return parseResponse(response, productPageSchema);
}

function expectConsistentPage(page: ProductPage, expected: { page: number; size: number }): void {
  expect(page.page).toBe(expected.page);
  expect(page.size).toBe(expected.size);
  expect(page.content.length).toBeLessThanOrEqual(page.size);
  expect(page.totalPages).toBe(Math.ceil(page.totalElements / page.size));
}

function isStrictlyOrdered(
  products: Product[],
  compare: (first: Product, second: Product) => number,
): boolean {
  return products.slice(1).every((product, index) => {
    const previous = products[index];
    return previous !== undefined && compare(previous, product) < 0;
  });
}
