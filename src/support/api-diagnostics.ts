import type { APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const REQUEST_ID_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;

const problemCodeSchema = z.object({ code: z.string().regex(/^[A-Z][A-Z_]{0,63}$/) });

export interface ApiExchange {
  method: string;
  path: string;
  status: number;
  requestId: string | null;
  durationMs: number;
  problemCode: string | null;
}

export class ApiExchangeLog {
  private readonly requestIdPrefix = `vf-${randomUUID().slice(0, 8)}`;
  private requestCount = 0;
  private readonly exchanges: ApiExchange[] = [];

  nextRequestId(): string {
    this.requestCount += 1;
    return `${this.requestIdPrefix}-${this.requestCount}`;
  }

  async record(method: string, response: APIResponse, durationMs: number): Promise<void> {
    this.exchanges.push({
      method,
      path: safePath(response.url()),
      status: response.status(),
      requestId: safeRequestId(response),
      durationMs: Math.round(durationMs),
      problemCode: await safeProblemCode(response),
    });
  }

  entries(): ApiExchange[] {
    return this.exchanges.map((exchange) => ({ ...exchange }));
  }
}

export async function describeResponse(response: APIResponse): Promise<string> {
  const code = await safeProblemCode(response);
  return (
    `HTTP ${response.status()}${code === null ? '' : ` ${code}`} ` +
    `from ${safePath(response.url())} (request ID ${safeRequestId(response) ?? 'none'})`
  );
}

export function safePath(url: string): string {
  return new URL(url).pathname;
}

export function safeRequestId(response: APIResponse): string | null {
  const requestId = response.headers()['x-request-id'];
  return requestId !== undefined && REQUEST_ID_FORMAT.test(requestId) ? requestId : null;
}

export async function safeProblemCode(response: APIResponse): Promise<string | null> {
  if (!isProblemResponse(response)) {
    return null;
  }
  try {
    const result = problemCodeSchema.safeParse(await response.json());
    return result.success ? result.data.code : null;
  } catch {
    return null;
  }
}

export function isProblemResponse(response: APIResponse): boolean {
  return (response.headers()['content-type'] ?? '').startsWith('application/problem+json');
}
