import { expect, test } from '@playwright/test';
import { parseAdminCredentials } from '../../src/config/env';

test.describe('Administrator credentials', () => {
  test('reads the administrator email and password', () => {
    const credentials = parseAdminCredentials({
      ORDERFLOW_ADMIN_EMAIL: 'admin@verifyflow.test',
      ORDERFLOW_ADMIN_PASSWORD: 'an-admin-password',
    });

    expect(credentials).toEqual({
      email: 'admin@verifyflow.test',
      password: 'an-admin-password',
    });
  });

  test('names missing settings in the error', () => {
    expect(() => parseAdminCredentials({})).toThrow(
      /ORDERFLOW_ADMIN_EMAIL[\s\S]*ORDERFLOW_ADMIN_PASSWORD/,
    );
  });

  test('never includes the configured password in a configuration error', () => {
    const password = 'do-not-print-this-password';

    const message = errorMessageOf(() =>
      parseAdminCredentials({
        ORDERFLOW_ADMIN_EMAIL: 'not-an-email',
        ORDERFLOW_ADMIN_PASSWORD: password,
      }),
    );

    expect(message).toContain('ORDERFLOW_ADMIN_EMAIL');
    expect(message.includes(password), 'error must not contain the password').toBe(false);
  });
});

function errorMessageOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the action to throw, but it returned normally.');
}
