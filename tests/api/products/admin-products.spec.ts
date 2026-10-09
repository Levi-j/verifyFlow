import { PRODUCT_PATHS, ProductsApi } from '../../../src/api/products-api';
import { parseResponse } from '../../../src/contracts/parse-response';
import { productSchema } from '../../../src/contracts/product';
import {
  MAX_SKU_LENGTH,
  newProduct,
  productUpdate,
  uniqueSku,
  uniqueSkuOfLength,
} from '../../../src/data/products';
import { expect, test } from '../../../src/fixtures/test';

const UNKNOWN_PRODUCT_ID = Number.MAX_SAFE_INTEGER;

test.describe('Product creation', () => {
  test('creates an active product and returns its location', async ({ admin }) => {
    const submitted = newProduct();

    const response = await new ProductsApi(admin).create(submitted);

    expect(response.status()).toBe(201);
    expect(response.headers()['x-request-id']).toMatch(/^vf-[0-9a-f]{8}-\d+$/);
    const product = await parseResponse(response, productSchema);
    expect(product).toMatchObject({
      sku: submitted.sku.toUpperCase(),
      name: submitted.name,
      description: submitted.description,
      price: submitted.price,
      active: true,
    });
    expect(product.updatedAt).toBe(product.createdAt);
    const location = new URL(response.headers().location ?? '', response.url());
    expect(location.pathname).toBe(`${PRODUCT_PATHS.adminCatalog}/${product.id}`);
  });

  test('stores the product so administrators can retrieve it', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const response = await new ProductsApi(admin).getAdmin(product.id);

    expect(response.status()).toBe(200);
    expect(await parseResponse(response, productSchema)).toEqual(product);
  });

  test('accepts a product without a description', async ({ createProduct }) => {
    const product = await createProduct({ description: undefined });

    expect(product.description).toBeNull();
  });

  test('ignores an active flag supplied on creation', async ({ admin }) => {
    const response = await admin.post(PRODUCT_PATHS.adminCatalog, {
      body: { ...newProduct(), active: false },
    });

    expect(response.status()).toBe(201);
    expect((await parseResponse(response, productSchema)).active).toBe(true);
  });
});

test.describe('Product SKUs', () => {
  const skuSpellings = [
    { description: 'a lowercase SKU', sku: () => uniqueSku('lower') },
    { description: 'a mixed-case SKU', sku: () => `MiXeD-${uniqueSku('CaSe')}` },
    {
      description: `a SKU of the maximum ${MAX_SKU_LENGTH} characters`,
      sku: () => uniqueSkuOfLength(MAX_SKU_LENGTH),
    },
  ];

  for (const { description, sku } of skuSpellings) {
    test(`stores ${description} in uppercase`, async ({ createProduct }) => {
      const submittedSku = sku();

      const product = await createProduct({ sku: submittedSku });

      expect(product.sku).toBe(submittedSku.toUpperCase());
    });
  }

  const duplicateSpellings = [
    { description: 'the same SKU', toVariant: (sku: string) => sku },
    { description: 'the same SKU in lowercase', toVariant: (sku: string) => sku.toLowerCase() },
  ];

  for (const { description, toVariant } of duplicateSpellings) {
    test(`rejects ${description} as a duplicate`, async ({ admin, createProduct }) => {
      const existing = await createProduct();

      const response = await new ProductsApi(admin).create(
        newProduct({ sku: toVariant(existing.sku) }),
      );

      await expect(response).toBeProblem(409, 'DUPLICATE_SKU');
    });
  }

  test('accepts a single-character SKU', async ({ admin }) => {
    // A one-character SKU can exist only once per database, so this proves the SKU passes
    // validation without creating a product: the empty name is the only reported error.
    const response = await admin.post(PRODUCT_PATHS.adminCatalog, {
      body: newProduct({ sku: 'q', name: '' }),
    });

    await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['name'] });
  });

  const invalidSkus = [
    { description: 'longer than 64 characters', sku: uniqueSkuOfLength(MAX_SKU_LENGTH + 1) },
    { description: 'containing a space', sku: `vf ${uniqueSku()}` },
    { description: 'containing an underscore', sku: `vf_${uniqueSku()}` },
    { description: 'containing a period', sku: `vf.${uniqueSku()}` },
    { description: 'containing a non-ASCII letter', sku: `vf-Ä-${uniqueSku()}` },
    { description: 'that is empty', sku: '' },
    { description: 'that is blank', sku: '   ' },
  ];

  for (const { description, sku } of invalidSkus) {
    test(`rejects a SKU ${description}`, async ({ admin }) => {
      const response = await new ProductsApi(admin).create(newProduct({ sku }));

      await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['sku'] });
    });
  }

  test('rejects a product without a SKU', async ({ admin }) => {
    const { name, price } = newProduct();

    const response = await admin.post(PRODUCT_PATHS.adminCatalog, { body: { name, price } });

    await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['sku'] });
  });
});

test.describe('Product updates', () => {
  test('replaces the name, description, price, and active status', async ({
    admin,
    createProduct,
  }) => {
    const product = await createProduct();
    const products = new ProductsApi(admin);
    const update = {
      name: 'Updated verifyFlow product',
      description: 'Updated description.',
      price: 42.5,
      active: false,
    };

    const response = await products.update(product.id, update);

    expect(response.status()).toBe(200);
    const updated = await parseResponse(response, productSchema);
    expect(updated).toMatchObject({ ...update, id: product.id, sku: product.sku });
    expect(updated.createdAt).toBe(product.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(product.updatedAt));
    const stored = await parseResponse(await products.getAdmin(product.id), productSchema);
    expect(stored).toEqual(updated);
  });

  test('clears the description when an update omits it', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const response = await new ProductsApi(admin).update(
      product.id,
      productUpdate(product, { description: undefined }),
    );

    expect(response.status()).toBe(200);
    expect((await parseResponse(response, productSchema)).description).toBeNull();
  });

  test('does not change the SKU', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const response = await admin.put(`${PRODUCT_PATHS.adminCatalog}/${product.id}`, {
      body: { ...productUpdate(product), sku: uniqueSku('changed') },
    });

    expect(response.status()).toBe(200);
    expect((await parseResponse(response, productSchema)).sku).toBe(product.sku);
  });

  test('returns 404 for a product that does not exist', async ({ admin, createProduct }) => {
    const product = await createProduct();

    const response = await new ProductsApi(admin).update(
      UNKNOWN_PRODUCT_ID,
      productUpdate(product),
    );

    await expect(response).toBeProblem(404, 'RESOURCE_NOT_FOUND');
  });

  const invalidUpdates = [
    { description: 'an empty body', body: {}, fields: ['name', 'price', 'active'] },
    {
      description: 'a missing active status',
      body: { name: 'Name', price: 1 },
      fields: ['active'],
    },
    { description: 'a blank name', body: { name: ' ', price: 1, active: true }, fields: ['name'] },
    {
      description: 'a name longer than 200 characters',
      body: { name: 'n'.repeat(201), price: 1, active: true },
      fields: ['name'],
    },
    {
      description: 'a zero price',
      body: { name: 'Name', price: 0, active: true },
      fields: ['price'],
    },
  ];

  for (const { description, body, fields } of invalidUpdates) {
    test(`rejects an update with ${description}`, async ({ admin, createProduct }) => {
      const product = await createProduct();

      const response = await admin.put(`${PRODUCT_PATHS.adminCatalog}/${product.id}`, { body });

      await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields });
      const stored = await parseResponse(
        await new ProductsApi(admin).getAdmin(product.id),
        productSchema,
      );
      expect(stored).toEqual(product);
    });
  }
});
