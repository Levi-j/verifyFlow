import type { APIResponse } from '@playwright/test';
import type { NewOrder } from '../data/orders';
import type { ApiClient } from './api-client';
import { pageParams, type PageQuery } from './page-query';

export const ORDERS_PATH = '/api/v1/orders';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export class OrdersApi {
  constructor(private readonly client: ApiClient) {}

  place(order: NewOrder, idempotencyKey: string): Promise<APIResponse> {
    return this.client.post(ORDERS_PATH, {
      body: order,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    });
  }

  list(query: PageQuery = {}): Promise<APIResponse> {
    return this.client.get(ORDERS_PATH, { params: pageParams(query) });
  }

  get(orderId: number): Promise<APIResponse> {
    return this.client.get(`${ORDERS_PATH}/${orderId}`);
  }

  cancel(orderId: number): Promise<APIResponse> {
    return this.client.post(`${ORDERS_PATH}/${orderId}/cancel`);
  }
}
