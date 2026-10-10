import { randomUUID } from 'node:crypto';

export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 1000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

export interface OrderLine {
  productId: number;
  quantity: number;
}

export interface NewOrder {
  items: OrderLine[];
}

export function orderLine(product: { id: number }, quantity: number): OrderLine {
  return { productId: product.id, quantity };
}

export function newOrder(...lines: OrderLine[]): NewOrder {
  return { items: lines };
}

export function uniqueIdempotencyKey(prefix = 'vf-order'): string {
  return `${prefix}-${randomUUID()}`;
}
