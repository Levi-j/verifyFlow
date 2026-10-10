import type { APIResponse } from '@playwright/test';
import type { OrderStatus } from '../contracts/order';
import type { ApiClient } from './api-client';
import { pageParams, type PageQuery } from './page-query';

export const ADMIN_ORDERS_PATH = '/api/v1/admin/orders';

export interface AdminOrderQuery extends PageQuery {
  status?: OrderStatus;
}

export class AdminOrdersApi {
  constructor(private readonly client: ApiClient) {}

  list({ status, ...page }: AdminOrderQuery = {}): Promise<APIResponse> {
    const params = pageParams(page);
    if (status !== undefined) {
      params.status = status;
    }
    return this.client.get(ADMIN_ORDERS_PATH, { params });
  }

  get(orderId: number): Promise<APIResponse> {
    return this.client.get(`${ADMIN_ORDERS_PATH}/${orderId}`);
  }

  confirm(orderId: number): Promise<APIResponse> {
    return this.client.post(`${ADMIN_ORDERS_PATH}/${orderId}/confirm`);
  }

  cancel(orderId: number): Promise<APIResponse> {
    return this.client.post(`${ADMIN_ORDERS_PATH}/${orderId}/cancel`);
  }
}
