import type { APIResponse } from '@playwright/test';
import type { NewProduct, ProductUpdate } from '../data/products';
import type { ApiClient } from './api-client';

export const PRODUCT_PATHS = {
  publicCatalog: '/api/v1/products',
  adminCatalog: '/api/v1/admin/products',
} as const;

export interface PageQuery {
  page?: number;
  size?: number;
  sort?: string;
}

export class ProductsApi {
  constructor(private readonly client: ApiClient) {}

  listPublic(query: PageQuery = {}): Promise<APIResponse> {
    return this.client.get(PRODUCT_PATHS.publicCatalog, { params: pageParams(query) });
  }

  getPublic(id: number): Promise<APIResponse> {
    return this.client.get(`${PRODUCT_PATHS.publicCatalog}/${id}`);
  }

  listAdmin(query: PageQuery = {}): Promise<APIResponse> {
    return this.client.get(PRODUCT_PATHS.adminCatalog, { params: pageParams(query) });
  }

  getAdmin(id: number): Promise<APIResponse> {
    return this.client.get(`${PRODUCT_PATHS.adminCatalog}/${id}`);
  }

  create(product: NewProduct): Promise<APIResponse> {
    return this.client.post(PRODUCT_PATHS.adminCatalog, { body: product });
  }

  update(id: number, update: ProductUpdate): Promise<APIResponse> {
    return this.client.put(`${PRODUCT_PATHS.adminCatalog}/${id}`, { body: update });
  }
}

function pageParams({ page, size, sort }: PageQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (page !== undefined) {
    params.page = page;
  }
  if (size !== undefined) {
    params.size = size;
  }
  if (sort !== undefined) {
    params.sort = sort;
  }
  return params;
}
