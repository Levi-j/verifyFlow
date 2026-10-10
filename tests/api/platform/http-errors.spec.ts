import type { RequestOptions } from '../../../src/api/api-client';
import { AUTH_PATHS } from '../../../src/api/auth-api';
import { uniqueSuffix } from '../../../src/data/unique';
import { expect, test } from '../../../src/fixtures/test';

const UNUSED_ID = 999_999_999;

// Playwright re-encodes a string body that is not valid JSON, so raw text is sent as bytes.
function rawBody(text: string, contentType = 'application/json'): RequestOptions {
  return { body: Buffer.from(text), headers: { 'Content-Type': contentType } };
}

test.describe('Malformed request bodies', () => {
  const malformedBodies = [
    { description: 'truncated JSON', text: '{"email": "someone@verifyflow.test", "password":' },
    { description: 'an empty body', text: '' },
    { description: 'a JSON array instead of an object', text: '[]' },
    { description: 'a JSON null', text: 'null' },
    {
      description: 'an object where a string is expected',
      text: '{"email": {"address": "someone@verifyflow.test"}, "password": "long-enough-password"}',
    },
  ];

  for (const { description, text } of malformedBodies) {
    test(`rejects ${description} as a malformed request`, async ({ anonymous }) => {
      const response = await anonymous.post(AUTH_PATHS.register, rawBody(text));

      await expect(response).toBeProblem(400, 'MALFORMED_REQUEST', { fields: [] });
    });
  }

  test('does not echo malformed input in the problem response', async ({ anonymous }) => {
    const marker = `marker-${uniqueSuffix()}`;

    const response = await anonymous.post(AUTH_PATHS.login, rawBody(`{"email": "${marker}`));

    await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
    expect((await response.text()).includes(marker), 'body must not echo the input').toBe(false);
  });

  test('reports well-formed JSON with invalid values as field validation errors', async ({
    anonymous,
  }) => {
    const response = await anonymous.post(AUTH_PATHS.login, {
      body: { email: 'not-an-email', password: '' },
    });

    await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['email', 'password'] });
  });

  test('rejects a non-numeric path ID as a malformed request', async ({ admin }) => {
    const response = await admin.get('/api/v1/admin/products/not-a-number');

    await expect(response).toBeProblem(400, 'MALFORMED_REQUEST');
  });
});

test.describe('Unsupported media types', () => {
  const unsupportedContentTypes = [
    { contentType: 'text/plain', text: 'email=someone@verifyflow.test' },
    { contentType: 'application/x-www-form-urlencoded', text: 'email=someone%40verifyflow.test' },
  ];

  for (const { contentType, text } of unsupportedContentTypes) {
    test(`rejects a ${contentType} body and lists the accepted types`, async ({ anonymous }) => {
      const response = await anonymous.post(AUTH_PATHS.login, rawBody(text, contentType));

      await expect(response).toBeProblem(415, 'UNSUPPORTED_MEDIA_TYPE');
      expect(response.headers().accept).toContain('application/json');
    });
  }

  test('rejects a request that accepts only XML', async ({ customer }) => {
    const response = await customer.api.get(AUTH_PATHS.currentUser, {
      headers: { Accept: 'application/xml' },
    });

    await expect(response).toBeProblem(406, 'NOT_ACCEPTABLE');
  });
});

test.describe('Unsupported methods', () => {
  test('rejects PUT on a read-only resource and lists the allowed methods', async ({
    customer,
  }) => {
    const response = await customer.api.put(AUTH_PATHS.currentUser, { body: {} });

    await expect(response).toBeProblem(405, 'METHOD_NOT_ALLOWED');
    expect(response.headers().allow).toBe('GET');
  });

  test('rejects POST on an item resource and lists the allowed methods', async ({ admin }) => {
    const response = await admin.post(`/api/v1/admin/products/${UNUSED_ID}`, { body: {} });

    await expect(response).toBeProblem(405, 'METHOD_NOT_ALLOWED');
    // Allow lists a set of methods, and OrderFlow's ordering differs between environments.
    const allowedMethods = (response.headers().allow ?? '')
      .split(',')
      .map((method) => method.trim())
      .sort();
    expect(allowedMethods).toEqual(['GET', 'PUT']);
  });
});

test.describe('Unknown routes', () => {
  const unknownPath = '/api/v1/no-such-resource';

  test('returns 404 to an authenticated caller', async ({ customer }) => {
    const response = await customer.api.get(unknownPath);

    await expect(response).toBeProblem(404, 'RESOURCE_NOT_FOUND');
  });

  test('requires authentication before revealing whether a route exists', async ({ anonymous }) => {
    const response = await anonymous.get(unknownPath);

    await expect(response).toBeProblem(401, 'UNAUTHENTICATED');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });
});
