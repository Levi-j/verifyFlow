import { AUTH_PATHS, AuthApi } from '../../../src/api/auth-api';
import { userSchema } from '../../../src/contracts/auth';
import { parseResponse } from '../../../src/contracts/parse-response';
import { uniqueSuffix } from '../../../src/data/unique';
import {
  newCustomerCredentials,
  uniqueEmail,
  uniqueEmailOfLength,
  validPassword,
} from '../../../src/data/users';
import { expect, test } from '../../../src/fixtures/test';

test.describe('Customer registration', () => {
  test('creates a CUSTOMER account and returns its identity', async ({ anonymous }) => {
    const credentials = newCustomerCredentials();

    const response = await new AuthApi(anonymous).register(credentials);

    expect(response.status()).toBe(201);
    expect(response.headers()['content-type']).toContain('application/json');
    const user = await parseResponse(response, userSchema);
    expect(user).toMatchObject({ email: credentials.email, role: 'CUSTOMER' });
  });

  test('never returns the password or a password hash', async ({ anonymous }) => {
    const credentials = newCustomerCredentials();

    const response = await new AuthApi(anonymous).register(credentials);

    expect(response.status()).toBe(201);
    const body = await response.text();
    expect(body.includes(credentials.password), 'body must not echo the password').toBe(false);
    const user: unknown = JSON.parse(body);
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('passwordHash');
  });

  test('stores the email address in lowercase', async ({ anonymous }) => {
    const email = `Mixed.Case-${uniqueSuffix()}@VerifyFlow.Test`;

    const response = await new AuthApi(anonymous).register({ email, password: validPassword() });

    expect(response.status()).toBe(201);
    const user = await parseResponse(response, userSchema);
    expect(user.email).toBe(email.toLowerCase());
  });

  const duplicateEmailVariants = [
    { description: 'the same email address', toVariant: (email: string) => email },
    {
      description: 'the same email address in different letter case',
      toVariant: (email: string) => email.toUpperCase(),
    },
  ];

  for (const { description, toVariant } of duplicateEmailVariants) {
    test(`rejects ${description} as already registered`, async ({ anonymous, customer }) => {
      const response = await new AuthApi(anonymous).register({
        email: toVariant(customer.email),
        password: validPassword(),
      });

      await expect(response).toBeProblem(409, 'EMAIL_ALREADY_REGISTERED');
    });
  }

  test('accepts an email address of exactly 254 characters', async ({ anonymous }) => {
    const email = uniqueEmailOfLength(254);

    const response = await new AuthApi(anonymous).register({ email, password: validPassword() });

    expect(response.status()).toBe(201);
    const user = await parseResponse(response, userSchema);
    expect(user.email).toBe(email);
  });

  const invalidRegistrations = [
    { description: 'an empty body', body: {}, fields: ['email', 'password'] },
    { description: 'a missing email', body: { password: validPassword() }, fields: ['email'] },
    { description: 'a missing password', body: { email: uniqueEmail() }, fields: ['password'] },
    {
      description: 'a blank email',
      body: { email: '   ', password: validPassword() },
      fields: ['email'],
    },
    {
      description: 'a malformed email',
      body: { email: 'not-an-email', password: validPassword() },
      fields: ['email'],
    },
    {
      description: 'an email longer than 254 characters',
      body: { email: uniqueEmailOfLength(255), password: validPassword() },
      fields: ['email'],
    },
  ];

  for (const { description, body, fields } of invalidRegistrations) {
    test(`rejects ${description}`, async ({ anonymous }) => {
      const response = await anonymous.post(AUTH_PATHS.register, { body });

      await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields });
    });
  }
});

test.describe('Registration password policy', () => {
  const passwordBoundaries = [
    { description: '14 ASCII characters', password: 'a'.repeat(14), accepted: false },
    { description: '15 ASCII characters', password: 'a'.repeat(15), accepted: true },
    { description: '72 ASCII characters (72 bytes)', password: 'a'.repeat(72), accepted: true },
    { description: '73 ASCII characters (73 bytes)', password: 'a'.repeat(73), accepted: false },
    {
      description: '14 emoji (14 code points, but 28 UTF-16 units)',
      password: '😀'.repeat(14),
      accepted: false,
    },
    {
      description: '18 emoji (18 code points, 72 bytes)',
      password: '😀'.repeat(18),
      accepted: true,
    },
    {
      description: '19 emoji (only 19 code points, but 76 bytes)',
      password: '😀'.repeat(19),
      accepted: false,
    },
  ];

  for (const { description, password } of passwordBoundaries.filter((c) => c.accepted)) {
    test(`accepts a password of ${description} and allows login with it`, async ({ anonymous }) => {
      const auth = new AuthApi(anonymous);
      const credentials = { email: uniqueEmail(), password };

      const registration = await auth.register(credentials);

      expect(registration.status()).toBe(201);
      expect((await auth.login(credentials)).status()).toBe(200);
    });
  }

  for (const { description, password } of passwordBoundaries.filter((c) => !c.accepted)) {
    test(`rejects a password of ${description} without creating an account`, async ({
      anonymous,
    }) => {
      const auth = new AuthApi(anonymous);
      const credentials = { email: uniqueEmail(), password };

      const registration = await auth.register(credentials);

      await expect(registration).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['password'] });
      const body = await registration.text();
      expect(body.includes(password), 'error must not echo the password').toBe(false);
      await expect(await auth.login(credentials)).toBeProblem(401, 'INVALID_CREDENTIALS');
    });
  }
});
