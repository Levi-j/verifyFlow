import type { ApiClient } from '../api/api-client';
import { InventoryApi } from '../api/inventory-api';
import { ProductsApi } from '../api/products-api';
import { inventorySchema } from '../contracts/inventory';
import { parseResponse } from '../contracts/parse-response';
import { productSchema, type Product } from '../contracts/product';
import { restock } from '../data/inventory';
import { newProduct, type NewProduct } from '../data/products';
import { requireStatus } from './identities';

export const INITIAL_STOCK_NOTE = 'verifyFlow initial stock';

export interface ProductSetup extends Partial<NewProduct> {
  stock?: number;
}

export async function createProductAsAdmin(
  admin: ApiClient,
  { stock = 0, ...fields }: ProductSetup = {},
): Promise<Product> {
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error(
      `Test setup failed: initial stock must be a non-negative integer, got ${stock}.`,
    );
  }

  const response = await new ProductsApi(admin).create(newProduct(fields));
  await requireStatus(response, 201, 'Product creation');
  const product = await parseResponse(response, productSchema);

  if (stock > 0) {
    await addInitialStock(admin, product.id, stock);
  }
  return product;
}

async function addInitialStock(admin: ApiClient, productId: number, stock: number): Promise<void> {
  const response = await new InventoryApi(admin).adjust(
    productId,
    restock(stock, INITIAL_STOCK_NOTE),
  );
  await requireStatus(response, 200, 'Initial stock adjustment');
  const { quantityOnHand } = await parseResponse(response, inventorySchema);
  if (quantityOnHand !== stock) {
    throw new Error(
      `Test setup failed: product ${productId} has ${quantityOnHand} units after restocking ` +
        `${stock}; expected ${stock}.`,
    );
  }
}
