import type { APIResponse } from '@playwright/test';
import { AUTH_PATHS, AuthApi } from '../../../src/api/auth-api';
import { loginResponseSchema } from '../../../src/contracts/auth';
import { parseResponse } from '../../../src/contracts/parse-response';
import { problemSchema } from '../../../src/contracts/problem';
import { uniqueEmail, validPassword } from '../../../src/data/users';
import { expect, test } from '../../../src/fixtures/test';

const ACCESS_TOKEN_LIFETIME_SECONDS = 30 * 60;

test.describe('Login', () => {
  test('issues a 30-minute bearer token for valid credentials', async ({ anonymous, customer }) => {
    const response = await new AuthApi(anonymous).login({
      email: customer.email,
      password: customer.password,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const token = await parseResponse(response, loginResponseSchema);
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresIn).toBe(ACCESS_TOKEN_LIFETIME_SECONDS);
  });

  test('treats the email address case-insensitively', async ({ anonymous, customer }) => {
    const response = await new AuthApi(anonymous).login({
      email: customer.email.toUpperCase(),
      password: customer.password,
    });

    expect(response.status()).toBe(200);
  });

  test('gives identical responses for a wrong password and an unknown email', async ({
    anonymous,
    customer,
  }) => {
    const auth = new AuthApi(anonymous);

    const wrongPassword = await auth.login({ email: customer.email, password: validPassword() });
    const unknownEmail = await auth.login({
      email: uniqueEmail('unknown'),
      password: customer.password,
    });

    for (const response of [wrongPassword, unknownEmail]) {
      await expect(response).toBeProblem(401, 'INVALID_CREDENTIALS');
      expect(response.headers()['www-authenticate']).toBe('Bearer');
    }
    expect(await visibleProblem(wrongPassword)).toEqual(await visibleProblem(unknownEmail));
  });

  test('rejects a password longer than 72 bytes instead of truncating it', async ({
    anonymous,
  }) => {
    const auth = new AuthApi(anonymous);
    const credentials = { email: uniqueEmail(), password: validPassword().padEnd(72, 'x') };
    expect((await auth.register(credentials)).status()).toBe(201);

    const response = await auth.login({ ...credentials, password: `${credentials.password}y` });

    await expect(response).toBeProblem(401, 'INVALID_CREDENTIALS');
    expect((await auth.login(credentials)).status()).toBe(200);
  });

  const invalidLogins = [
    { description: 'an empty body', body: {}, fields: ['email', 'password'] },
    { description: 'a missing email', body: { password: validPassword() }, fields: ['email'] },
    { description: 'a missing password', body: { email: uniqueEmail() }, fields: ['password'] },
    {
      description: 'an empty password',
      body: { email: uniqueEmail(), password: '' },
      fields: ['password'],
    },
    {
      description: 'a malformed email',
      body: { email: 'not-an-email', password: validPassword() },
      fields: ['email'],
    },
  ];

  for (const { description, body, fields } of invalidLogins) {
    test(`rejects ${description} as a validation error`, async ({ anonymous }) => {
      const response = await anonymous.post(AUTH_PATHS.login, { body });

      await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields });
    });
  }
});

async function visibleProblem(response: APIResponse) {
  const { status, title, detail, code } = await parseResponse(response, problemSchema);
  return { status, title, detail, code };
}
