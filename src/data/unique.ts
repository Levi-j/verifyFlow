import { randomUUID } from 'node:crypto';

export function uniqueSuffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}
