import { AUTH_PATHS, AuthApi } from '../../../src/api/auth-api';
import { loginResponseSchema, userSchema } from '../../../src/contracts/auth';
import { parseResponse } from '../../../src/contracts/parse-response';
import { newCustomerCredentials } from '../../../src/data/users';
import { expect, test } from '../../../src/fixtures/test';

test.describe('Registration privileges', () => {
  const privilegeClaims = [
    { description: 'a role of ADMIN', claim: { role: 'ADMIN' } },
    { description: 'a role of ROLE_ADMIN', claim: { role: 'ROLE_ADMIN' } },
    {
      description: 'ADMIN roles and authorities lists',
      claim: { roles: ['ADMIN'], authorities: ['ROLE_ADMIN'] },
    },
  ];

  for (const { description, claim } of privilegeClaims) {
    test(`ignores ${description} in the request and creates a CUSTOMER`, async ({ anonymous }) => {
      const credentials = newCustomerCredentials();

      const registration = await anonymous.post(AUTH_PATHS.register, {
        body: { ...credentials, ...claim },
      });

      expect(registration.status()).toBe(201);
      expect((await parseResponse(registration, userSchema)).role).toBe('CUSTOMER');

      const login = await new AuthApi(anonymous).login(credentials);
      expect(login.status()).toBe(200);
      const { accessToken } = await parseResponse(login, loginResponseSchema);
      const account = anonymous.withToken(accessToken);

      const currentUser = await new AuthApi(account).currentUser();
      expect(currentUser.status()).toBe(200);
      expect((await parseResponse(currentUser, userSchema)).role).toBe('CUSTOMER');
      await expect(await account.get('/api/v1/admin/products')).toBeProblem(403, 'ACCESS_DENIED');
    });
  }
});
