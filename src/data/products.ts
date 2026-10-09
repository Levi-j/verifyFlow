import type { Product } from '../contracts/product';
import { uniqueSuffix } from './unique';

export const MAX_SKU_LENGTH = 64;

export interface NewProduct {
  sku: string;
  name: string;
  description?: string | null;
  price: number;
}

export interface ProductUpdate {
  name: string;
  description?: string | null;
  price: number;
  active: boolean;
}

export function uniqueSku(prefix = 'vf'): string {
  return `${prefix}-${uniqueSuffix()}`;
}

export function uniqueSkuOfLength(length: number): string {
  return uniqueSku('vf-long').padEnd(length, 'x');
}

export function newProduct(overrides: Partial<NewProduct> = {}): NewProduct {
  return {
    sku: uniqueSku(),
    name: 'verifyFlow test product',
    description: 'Created by the verifyFlow API tests.',
    price: 19.99,
    ...overrides,
  };
}

export function productUpdate(
  product: Product,
  overrides: Partial<ProductUpdate> = {},
): ProductUpdate {
  return {
    name: product.name,
    description: product.description,
    price: product.price,
    active: product.active,
    ...overrides,
  };
}
