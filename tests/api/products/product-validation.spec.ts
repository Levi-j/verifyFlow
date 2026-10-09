import { PRODUCT_PATHS, ProductsApi } from '../../../src/api/products-api';
import { parseResponse } from '../../../src/contracts/parse-response';
import { productSchema } from '../../../src/contracts/product';
import { newProduct, type NewProduct } from '../../../src/data/products';
import { expect, test } from '../../../src/fixtures/test';

test.describe('Product field boundaries', () => {
  const acceptedValues: { description: string; fields: Partial<NewProduct> }[] = [
    { description: 'a name of 200 characters', fields: { name: 'n'.repeat(200) } },
    { description: 'a description of 2,000 characters', fields: { description: 'd'.repeat(2000) } },
    { description: 'an empty description', fields: { description: '' } },
    { description: 'the minimum price of 0.01', fields: { price: 0.01 } },
    { description: 'the maximum price of 9999999999.99', fields: { price: 9_999_999_999.99 } },
  ];

  for (const { description, fields } of acceptedValues) {
    test(`accepts ${description}`, async ({ admin }) => {
      const submitted = newProduct(fields);

      const response = await new ProductsApi(admin).create(submitted);

      expect(response.status()).toBe(201);
      const product = await parseResponse(response, productSchema);
      expect(product).toMatchObject({
        name: submitted.name,
        description: submitted.description,
        price: submitted.price,
      });
    });
  }

  const rejectedValues: { description: string; fields: Partial<NewProduct>; field: string }[] = [
    { description: 'an empty name', fields: { name: '' }, field: 'name' },
    { description: 'a blank name', fields: { name: '   ' }, field: 'name' },
    { description: 'a name of 201 characters', fields: { name: 'n'.repeat(201) }, field: 'name' },
    {
      description: 'a description of 2,001 characters',
      fields: { description: 'd'.repeat(2001) },
      field: 'description',
    },
    { description: 'a zero price', fields: { price: 0 }, field: 'price' },
    { description: 'a negative price', fields: { price: -1 }, field: 'price' },
    { description: 'a price with three decimal places', fields: { price: 1.234 }, field: 'price' },
    {
      description: 'a price with 11 integer digits',
      fields: { price: 10_000_000_000 },
      field: 'price',
    },
  ];

  for (const { description, fields, field } of rejectedValues) {
    test(`rejects ${description}`, async ({ admin }) => {
      const response = await new ProductsApi(admin).create(newProduct(fields));

      await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: [field] });
    });
  }

  test('rejects a product without a name or price', async ({ admin }) => {
    const { sku } = newProduct();

    const response = await admin.post(PRODUCT_PATHS.adminCatalog, { body: { sku } });

    await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['name', 'price'] });
  });

  const nonNumericPrices = [
    { description: 'text', price: 'free' },
    { description: 'a boolean', price: true },
    { description: 'an object', price: { amount: 10 } },
  ];

  for (const { description, price } of nonNumericPrices) {
    test(`rejects ${description} as a price`, async ({ admin }) => {
      const response = await admin.post(PRODUCT_PATHS.adminCatalog, {
        body: { ...newProduct(), price },
      });

      await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
    });
  }
});
