import type { ApiClient } from '../api/api-client';
import { ProductsApi } from '../api/products-api';
import { parseResponse } from '../contracts/parse-response';
import { productSchema, type Product } from '../contracts/product';
import { newProduct, type NewProduct } from '../data/products';
import { requireStatus } from './identities';

export async function createProductAsAdmin(
  admin: ApiClient,
  overrides: Partial<NewProduct> = {},
): Promise<Product> {
  const response = await new ProductsApi(admin).create(newProduct(overrides));
  await requireStatus(response, 201, 'Product creation');
  return parseResponse(response, productSchema);
}
