import type { APIResponse } from '@playwright/test';
import { z } from 'zod';
import type { ApiClient } from '../../../src/api/api-client';
import { AUTH_PATHS, AuthApi } from '../../../src/api/auth-api';
import { userSchema } from '../../../src/contracts/auth';
import { parseResponse } from '../../../src/contracts/parse-response';
import { uniqueSuffix } from '../../../src/data/unique';
import type { Customer } from '../../../src/fixtures/identities';
import { expect, test } from '../../../src/fixtures/test';

type AuthenticatedCaller = 'customer' | 'admin';

interface ProtectedOperation {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  allowed: AuthenticatedCaller[];
}

const UNUSED_ID = 999_999_999;

const OPERATIONS: ProtectedOperation[] = [
  { method: 'GET', path: AUTH_PATHS.currentUser, allowed: ['customer', 'admin'] },
  { method: 'GET', path: '/api/v1/orders', allowed: ['customer'] },
  { method: 'POST', path: '/api/v1/orders', allowed: ['customer'] },
  { method: 'GET', path: '/api/v1/orders/{id}', allowed: ['customer'] },
  { method: 'POST', path: '/api/v1/orders/{id}/cancel', allowed: ['customer'] },
  { method: 'GET', path: '/api/v1/admin/products', allowed: ['admin'] },
  { method: 'POST', path: '/api/v1/admin/products', allowed: ['admin'] },
  { method: 'GET', path: '/api/v1/admin/products/{id}', allowed: ['admin'] },
  { method: 'PUT', path: '/api/v1/admin/products/{id}', allowed: ['admin'] },
  { method: 'GET', path: '/api/v1/admin/inventory/{id}', allowed: ['admin'] },
  { method: 'POST', path: '/api/v1/admin/inventory/{id}/adjustments', allowed: ['admin'] },
  { method: 'GET', path: '/api/v1/admin/inventory/{id}/movements', allowed: ['admin'] },
  { method: 'GET', path: '/api/v1/admin/orders', allowed: ['admin'] },
  { method: 'GET', path: '/api/v1/admin/orders/{id}', allowed: ['admin'] },
  { method: 'POST', path: '/api/v1/admin/orders/{id}/confirm', allowed: ['admin'] },
  { method: 'POST', path: '/api/v1/admin/orders/{id}/cancel', allowed: ['admin'] },
];

const pageSchema = z.object({
  content: z.array(z.unknown()),
  totalElements: z.number().int().nonnegative(),
});

const createdProductSchema = z.object({ id: z.number().int().positive() });

const inventorySchema = z.object({
  productId: z.number().int(),
  quantityOnHand: z.number().int(),
});

test.describe('Authorization matrix: anonymous callers', () => {
  for (const operation of OPERATIONS) {
    test(`${label(operation)} requires authentication`, async ({ anonymous }) => {
      const response = await send(anonymous, operation);

      await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
      expect(response.headers()['www-authenticate']).toBe('Bearer');
    });
  }
});

test.describe('Authorization matrix: authenticated callers without the required role', () => {
  for (const operation of OPERATIONS) {
    for (const caller of deniedCallers(operation)) {
      test(`${label(operation)} is forbidden to the ${caller.toUpperCase()} role`, async ({
        admin,
        createCustomer,
      }) => {
        const client = await clientFor(caller, admin, createCustomer);

        const response = await send(client, operation);

        await expect(response).toBeProblem(403, 'ACCESS_DENIED');
        expect(response.headers()['www-authenticate']).toBeUndefined();
      });
    }
  }
});

test.describe('Authorization matrix: authorized callers', () => {
  test('customers and administrators can read their own identity', async ({ admin, customer }) => {
    const customerResponse = await new AuthApi(customer.api).currentUser();
    const adminResponse = await new AuthApi(admin).currentUser();

    expect(customerResponse.status()).toBe(200);
    expect(adminResponse.status()).toBe(200);
    expect((await parseResponse(customerResponse, userSchema)).role).toBe('CUSTOMER');
    expect((await parseResponse(adminResponse, userSchema)).role).toBe('ADMIN');
  });

  test('a new customer can list their orders and sees none', async ({ customer }) => {
    const response = await customer.api.get('/api/v1/orders');

    expect(response.status()).toBe(200);
    expect(await parseResponse(response, pageSchema)).toEqual({ content: [], totalElements: 0 });
  });

  test('administrators can list products and all orders', async ({ admin }) => {
    for (const path of ['/api/v1/admin/products', '/api/v1/admin/orders']) {
      const response = await admin.get(path);

      expect(response.status(), path).toBe(200);
      await parseResponse(response, pageSchema);
    }
  });

  test('administrators can create a product and read its inventory', async ({ admin }) => {
    const created = await admin.post('/api/v1/admin/products', {
      body: { sku: `VF-AUTHZ-${uniqueSuffix()}`, name: 'Authorization check', price: 9.99 },
    });
    expect(created.status()).toBe(201);
    const { id } = await parseResponse(created, createdProductSchema);

    const stock = await admin.get(`/api/v1/admin/inventory/${id}`);
    const movements = await admin.get(`/api/v1/admin/inventory/${id}/movements`);

    expect(stock.status()).toBe(200);
    expect(await parseResponse(stock, inventorySchema)).toEqual({
      productId: id,
      quantityOnHand: 0,
    });
    expect(movements.status()).toBe(200);
    expect(await parseResponse(movements, pageSchema)).toEqual({ content: [], totalElements: 0 });
  });
});

function label({ method, path }: ProtectedOperation): string {
  return `${method} ${path}`;
}

function deniedCallers({ allowed }: ProtectedOperation): AuthenticatedCaller[] {
  return (['customer', 'admin'] as const).filter((caller) => !allowed.includes(caller));
}

async function clientFor(
  caller: AuthenticatedCaller,
  admin: ApiClient,
  createCustomer: () => Promise<Customer>,
): Promise<ApiClient> {
  return caller === 'admin' ? admin : (await createCustomer()).api;
}

function send(client: ApiClient, { method, path }: ProtectedOperation): Promise<APIResponse> {
  const resolvedPath = path.replace('{id}', String(UNUSED_ID));
  switch (method) {
    case 'GET':
      return client.get(resolvedPath);
    case 'POST':
      return client.post(resolvedPath, { body: {} });
    case 'PUT':
      return client.put(resolvedPath, { body: {} });
  }
}
