import type { APIResponse } from '@playwright/test';
import type { ApiClient } from '../../../src/api/api-client';
import { AUTH_PATHS } from '../../../src/api/auth-api';
import type { ErrorCode } from '../../../src/contracts/problem';
import { uniqueSuffix } from '../../../src/data/unique';
import { validPassword } from '../../../src/data/users';
import type { Customer } from '../../../src/fixtures/identities';
import { expect, test } from '../../../src/fixtures/test';

const HEALTH_PATH = '/actuator/health';
const SERVER_GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNUSED_ID = 999_999_999;

interface Callers {
  anonymous: ApiClient;
  admin: ApiClient;
  createCustomer: () => Promise<Customer>;
}

interface CorrelatedError {
  status: number;
  code: ErrorCode;
  send: (callers: Callers, requestId: string) => Promise<APIResponse>;
}

test.describe('X-Request-Id handling', () => {
  const acceptedIds = [
    {
      description: 'letters, digits, hyphens, and underscores',
      requestId: `Client_Id-${uniqueSuffix()}`,
    },
    { description: 'a single character', requestId: 'a' },
    {
      description: 'the maximum 64 characters',
      requestId: `max-${uniqueSuffix()}`.padEnd(64, 'x'),
    },
  ];

  for (const { description, requestId } of acceptedIds) {
    test(`preserves a client ID made of ${description}`, async ({ anonymous }) => {
      const response = await anonymous.get(HEALTH_PATH, { requestId });

      expect(response.status()).toBe(200);
      expect(response.headers()['x-request-id']).toBe(requestId);
    });
  }

  const replacedIds = [
    {
      description: 'longer than 64 characters',
      requestId: `long-${uniqueSuffix()}`.padEnd(65, 'x'),
    },
    { description: 'containing a period', requestId: `vf.${uniqueSuffix()}` },
    { description: 'containing a space', requestId: `vf ${uniqueSuffix()}` },
    { description: 'containing markup', requestId: `<b>${uniqueSuffix()}</b>` },
    { description: 'that is empty', requestId: '' },
  ];

  for (const { description, requestId } of replacedIds) {
    test(`replaces a client ID ${description} with a generated one`, async ({ anonymous }) => {
      const response = await anonymous.get(HEALTH_PATH, { requestId });

      expect(response.status()).toBe(200);
      expect(response.headers()['x-request-id']).toMatch(SERVER_GENERATED_ID);
    });
  }

  test('generates a distinct ID for each request that has none', async ({ anonymous }) => {
    const first = await anonymous.get(HEALTH_PATH, { requestId: null });
    const second = await anonymous.get(HEALTH_PATH, { requestId: null });

    expect(first.headers()['x-request-id']).toMatch(SERVER_GENERATED_ID);
    expect(second.headers()['x-request-id']).toMatch(SERVER_GENERATED_ID);
    expect(first.headers()['x-request-id']).not.toBe(second.headers()['x-request-id']);
  });

  test('reports a generated ID in both the header and the problem body', async ({ anonymous }) => {
    const omitted = await anonymous.get(AUTH_PATHS.currentUser, { requestId: null });
    const replaced = await anonymous.get(AUTH_PATHS.currentUser, { requestId: 'not valid' });

    for (const response of [omitted, replaced]) {
      await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
      expect(response.headers()['x-request-id']).toMatch(SERVER_GENERATED_ID);
    }
  });

  const correlatedErrors: CorrelatedError[] = [
    {
      status: 400,
      code: 'VALIDATION_FAILED',
      send: ({ anonymous }, requestId) =>
        anonymous.post(AUTH_PATHS.register, { body: {}, requestId }),
    },
    {
      status: 401,
      code: 'UNAUTHENTICATED',
      send: ({ anonymous }, requestId) => anonymous.get(AUTH_PATHS.currentUser, { requestId }),
    },
    {
      status: 403,
      code: 'ACCESS_DENIED',
      send: async ({ createCustomer }, requestId) =>
        (await createCustomer()).api.get('/api/v1/admin/products', { requestId }),
    },
    {
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      send: ({ admin }, requestId) =>
        admin.get(`/api/v1/admin/products/${UNUSED_ID}`, { requestId }),
    },
    {
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
      send: async ({ anonymous, createCustomer }, requestId) => {
        const { email } = await createCustomer();
        return anonymous.post(AUTH_PATHS.register, {
          body: { email, password: validPassword() },
          requestId,
        });
      },
    },
  ];

  for (const { status, code, send } of correlatedErrors) {
    test(`keeps the client ID in the header and body of a ${status} ${code} problem`, async ({
      anonymous,
      admin,
      createCustomer,
    }) => {
      const requestId = `vf-correlation-${uniqueSuffix()}`;

      const response = await send({ anonymous, admin, createCustomer }, requestId);

      expect(response.headers()['x-request-id']).toBe(requestId);
      await expect(response).toBeProblem(status, code);
    });
  }
});
