import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../api/api-client';
import { AuthApi } from '../api/auth-api';
import { loginResponseSchema, userSchema, type Credentials } from '../contracts/auth';
import { parseResponse } from '../contracts/parse-response';
import { newCustomerCredentials } from '../data/users';
import { describeResponse } from '../support/api-diagnostics';

const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface Customer extends Credentials {
  id: number;
  api: ApiClient;
}

interface IssuedToken {
  value: string;
  expiresAt: number;
}

export class AdminSession {
  private issuedToken: IssuedToken | undefined;

  constructor(
    private readonly auth: AuthApi,
    private readonly credentials: Credentials,
  ) {}

  async token(): Promise<string> {
    if (this.issuedToken === undefined || this.isNearExpiry(this.issuedToken)) {
      this.issuedToken = await this.login();
    }
    return this.issuedToken.value;
  }

  private isNearExpiry(token: IssuedToken): boolean {
    return Date.now() >= token.expiresAt - TOKEN_REFRESH_MARGIN_MS;
  }

  private async login(): Promise<IssuedToken> {
    const requestedAt = Date.now();
    const response = await this.auth.login(this.credentials);
    await requireStatus(
      response,
      200,
      'Administrator login (check ORDERFLOW_ADMIN_EMAIL and ORDERFLOW_ADMIN_PASSWORD)',
    );
    const { accessToken, expiresIn } = await parseResponse(response, loginResponseSchema);
    return { value: accessToken, expiresAt: requestedAt + expiresIn * 1_000 };
  }
}

export async function registerCustomer(anonymous: ApiClient): Promise<Customer> {
  const credentials = newCustomerCredentials();
  const auth = new AuthApi(anonymous);

  const registration = await auth.register(credentials);
  await requireStatus(registration, 201, 'Customer registration');
  const user = await parseResponse(registration, userSchema);

  const login = await auth.login(credentials);
  await requireStatus(login, 200, 'Customer login');
  const { accessToken } = await parseResponse(login, loginResponseSchema);

  return {
    id: user.id,
    email: user.email,
    password: credentials.password,
    api: anonymous.withToken(accessToken),
  };
}

export async function requireStatus(
  response: APIResponse,
  status: number,
  step: string,
): Promise<void> {
  if (response.status() !== status) {
    throw new Error(
      `Test setup failed: ${step} returned ${await describeResponse(response)}; ` +
        `expected HTTP ${status}.`,
    );
  }
}
