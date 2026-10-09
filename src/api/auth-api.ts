import type { APIResponse } from '@playwright/test';
import type { Credentials } from '../contracts/auth';
import type { ApiClient } from './api-client';

export const AUTH_PATHS = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  currentUser: '/api/v1/users/me',
} as const;

export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  register(credentials: Credentials): Promise<APIResponse> {
    return this.client.post(AUTH_PATHS.register, { body: credentials });
  }

  login(credentials: Credentials): Promise<APIResponse> {
    return this.client.post(AUTH_PATHS.login, { body: credentials });
  }

  currentUser(): Promise<APIResponse> {
    return this.client.get(AUTH_PATHS.currentUser);
  }
}
