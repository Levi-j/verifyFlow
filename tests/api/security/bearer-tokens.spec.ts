import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../../../src/api/api-client';
import { AUTH_PATHS, AuthApi } from '../../../src/api/auth-api';
import { loginResponseSchema, type Credentials } from '../../../src/contracts/auth';
import { parseResponse } from '../../../src/contracts/parse-response';
import { expect, test } from '../../../src/fixtures/test';

const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

interface Account extends Credentials {
  token: string;
}

test.describe('Bearer token authentication', () => {
  test('accepts a valid token with the Bearer scheme in any letter case', async ({
    anonymous,
    customer,
  }) => {
    const token = await issueToken(anonymous, customer);

    for (const scheme of ['Bearer', 'bearer', 'BEARER']) {
      const response = await currentUserWith(anonymous, `${scheme} ${token}`);

      expect(response.status(), `${scheme} scheme`).toBe(200);
    }
  });

  const missingBearerCredentials = [
    { description: 'no Authorization header', authorization: () => undefined },
    {
      description: 'a valid token without the Bearer scheme',
      authorization: (account: Account) => account.token,
    },
    {
      description: 'Basic authentication with valid account credentials',
      authorization: ({ email, password }: Account) =>
        `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`,
    },
  ];

  for (const { description, authorization } of missingBearerCredentials) {
    test(`rejects a request with ${description}`, async ({ anonymous, customer }) => {
      const account = { ...customer, token: await issueToken(anonymous, customer) };

      const response = await currentUserWith(anonymous, authorization(account));

      await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
      expect(response.headers()['www-authenticate']).toBe('Bearer');
    });
  }

  const invalidBearerTokens = [
    { description: 'the Bearer scheme without a token', authorization: 'Bearer' },
    { description: 'garbage token text', authorization: 'Bearer not-a-real-token' },
    { description: 'characters a bearer token cannot contain', authorization: 'Bearer {token}' },
    {
      description: 'a JWT with no signature segment',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30',
    },
    {
      description: 'three segments that are not Base64URL-encoded JSON',
      authorization: 'Bearer not.a.jwt',
    },
  ];

  for (const { description, authorization } of invalidBearerTokens) {
    test(`rejects ${description} as an invalid token`, async ({ anonymous }) => {
      const response = await currentUserWith(anonymous, authorization);

      await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
      expect(response.headers()['www-authenticate']).toBe(INVALID_TOKEN_CHALLENGE);
    });
  }

  test('rejects an invalid token on a public endpoint instead of ignoring it', async ({
    anonymous,
  }) => {
    const response = await anonymous.get('/api/v1/products', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });

    await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
    expect(response.headers()['www-authenticate']).toBe(INVALID_TOKEN_CHALLENGE);
  });
});

async function issueToken(anonymous: ApiClient, credentials: Credentials): Promise<string> {
  const response = await new AuthApi(anonymous).login({
    email: credentials.email,
    password: credentials.password,
  });
  expect(response.status()).toBe(200);
  return (await parseResponse(response, loginResponseSchema)).accessToken;
}

function currentUserWith(
  anonymous: ApiClient,
  authorization: string | undefined,
): Promise<APIResponse> {
  const headers: Record<string, string> =
    authorization === undefined ? {} : { Authorization: authorization };
  return anonymous.get(AUTH_PATHS.currentUser, { headers });
}
