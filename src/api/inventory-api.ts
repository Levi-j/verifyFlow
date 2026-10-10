import type { APIResponse } from '@playwright/test';
import type { InventoryAdjustment } from '../data/inventory';
import type { ApiClient } from './api-client';
import { pageParams, type PageQuery } from './page-query';

export const INVENTORY_PATH = '/api/v1/admin/inventory';

export function adjustmentsPath(productId: number): string {
  return `${INVENTORY_PATH}/${productId}/adjustments`;
}

export class InventoryApi {
  constructor(private readonly client: ApiClient) {}

  getStock(productId: number): Promise<APIResponse> {
    return this.client.get(`${INVENTORY_PATH}/${productId}`);
  }

  adjust(productId: number, adjustment: InventoryAdjustment): Promise<APIResponse> {
    return this.client.post(adjustmentsPath(productId), { body: adjustment });
  }

  listMovements(productId: number, query: PageQuery = {}): Promise<APIResponse> {
    return this.client.get(`${INVENTORY_PATH}/${productId}/movements`, {
      params: pageParams(query),
    });
  }
}
