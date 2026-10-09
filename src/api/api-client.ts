import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ApiExchangeLog } from '../support/api-diagnostics';

type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  requestId?: string | null;
}

export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly exchangeLog: ApiExchangeLog,
    private readonly token?: string,
  ) {}

  withToken(token: string): ApiClient {
    return new ApiClient(this.request, this.exchangeLog, token);
  }

  get(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.send('GET', path, options);
  }

  post(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.send('POST', path, options);
  }

  put(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.send('PUT', path, options);
  }

  private async send(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<APIResponse> {
    const startedAt = performance.now();
    const response = await this.request.fetch(path, {
      method,
      data: options.body,
      params: options.params,
      headers: { ...this.defaultHeaders(options.requestId), ...options.headers },
      failOnStatusCode: false,
    });
    await this.exchangeLog.record(method, response, performance.now() - startedAt);
    return response;
  }

  private defaultHeaders(requestId: string | null | undefined): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token !== undefined) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (requestId !== null) {
      headers['X-Request-Id'] = requestId ?? this.exchangeLog.nextRequestId();
    }
    return headers;
  }
}
