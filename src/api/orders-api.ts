import type { APIResponse } from '@playwright/test';
import type { NewOrder } from '../data/orders';
import type { ApiClient } from './api-client';

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
}
