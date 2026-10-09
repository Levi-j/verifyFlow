import { AuthApi } from '../../../src/api/auth-api';
import { loginResponseSchema, userSchema } from '../../../src/contracts/auth';
import { parseResponse } from '../../../src/contracts/parse-response';
import { loadAdminCredentials } from '../../../src/config/env';
import { newCustomerCredentials } from '../../../src/data/users';
import { expect, test } from '../../../src/fixtures/test';

test.describe('Current user', () => {
  test(
    'registration, login, and current-user lookup work end to end',
    { tag: '@smoke' },
    async ({ anonymous }) => {
      const auth = new AuthApi(anonymous);
      const credentials = newCustomerCredentials();

      const registration = await auth.register(credentials);
      expect(registration.status()).toBe(201);
      const registeredUser = await parseResponse(registration, userSchema);

      const login = await auth.login(credentials);
      expect(login.status()).toBe(200);
      const { accessToken } = await parseResponse(login, loginResponseSchema);

      const response = await new AuthApi(anonymous.withToken(accessToken)).currentUser();

      expect(response.status()).toBe(200);
      expect(await parseResponse(response, userSchema)).toEqual(registeredUser);
    },
  );

  test('returns each customer their own identity', async ({ createCustomer }) => {
    const first = await createCustomer();
    const second = await createCustomer();

    const firstUser = await parseResponse(await new AuthApi(first.api).currentUser(), userSchema);
    const secondUser = await parseResponse(await new AuthApi(second.api).currentUser(), userSchema);

    expect(firstUser).toMatchObject({ id: first.id, email: first.email, role: 'CUSTOMER' });
    expect(secondUser).toMatchObject({ id: second.id, email: second.email, role: 'CUSTOMER' });
    expect(firstUser.id).not.toBe(secondUser.id);
  });

  test('does not expose credential fields', async ({ customer }) => {
    const response = await new AuthApi(customer.api).currentUser();

    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body.includes(customer.password), 'body must not echo the password').toBe(false);
    const user: unknown = JSON.parse(body);
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('passwordHash');
  });

  test('identifies the bootstrapped administrator with the ADMIN role', async ({ admin }) => {
    const response = await new AuthApi(admin).currentUser();

    expect(response.status()).toBe(200);
    const user = await parseResponse(response, userSchema);
    expect(user.role).toBe('ADMIN');
    expect(user.email).toBe(loadAdminCredentials().email.toLowerCase());
  });

  test('requires authentication', async ({ anonymous }) => {
    const response = await new AuthApi(anonymous).currentUser();

    await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });
});
