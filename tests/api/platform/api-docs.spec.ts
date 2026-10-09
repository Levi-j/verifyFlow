import type { ApiClient } from '../../../src/api/api-client';
import {
  HTTP_METHODS,
  openApiDocumentSchema,
  type OpenApiDocument,
  type OpenApiOperation,
  type SecurityRequirement,
} from '../../../src/contracts/openapi';
import { parseResponse } from '../../../src/contracts/parse-response';
import { expect, test } from '../../../src/fixtures/test';

const API_DOCS_PATH = '/v3/api-docs';

const PUBLIC_OPERATIONS: readonly string[] = [
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'GET /api/v1/products',
  'GET /api/v1/products/{id}',
];

const PROTECTED_OPERATIONS: readonly string[] = [
  'GET /api/v1/users/me',
  'GET /api/v1/orders',
  'POST /api/v1/orders',
  'GET /api/v1/orders/{id}',
  'POST /api/v1/orders/{id}/cancel',
  'GET /api/v1/admin/products',
  'POST /api/v1/admin/products',
  'GET /api/v1/admin/products/{id}',
  'PUT /api/v1/admin/products/{id}',
  'GET /api/v1/admin/inventory/{productId}',
  'POST /api/v1/admin/inventory/{productId}/adjustments',
  'GET /api/v1/admin/inventory/{productId}/movements',
  'GET /api/v1/admin/orders',
  'GET /api/v1/admin/orders/{id}',
  'POST /api/v1/admin/orders/{id}/confirm',
  'POST /api/v1/admin/orders/{id}/cancel',
];

test.describe('OpenAPI document', () => {
  test('is published without authentication', async ({ anonymous }) => {
    const response = await anonymous.get(API_DOCS_PATH);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const document = await parseResponse(response, openApiDocumentSchema);
    expect(document).toMatchObject({
      openapi: expect.stringMatching(/^3\./),
      info: { title: 'OrderFlow API', version: 'v1' },
    });
  });

  test('documents the public and protected operations', async ({ anonymous }) => {
    const documented = [...documentedOperations(await fetchDocument(anonymous)).keys()];

    expect(documented).toEqual(
      expect.arrayContaining([...PUBLIC_OPERATIONS, ...PROTECTED_OPERATIONS]),
    );
  });

  test('declares a JWT bearer authentication scheme', async ({ anonymous }) => {
    const document = await fetchDocument(anonymous);

    expect(Object.values(document.components?.securitySchemes ?? {})).toContainEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  test('requires no authentication for the public operations', async ({ anonymous }) => {
    const document = await fetchDocument(anonymous);

    for (const key of PUBLIC_OPERATIONS) {
      expect(effectiveSecurity(document, operation(document, key)), key).toEqual([]);
    }
  });

  test('requires bearer authentication for every other operation', async ({ anonymous }) => {
    const document = await fetchDocument(anonymous);
    const bearerRequirement = { [bearerSchemeName(document)]: [] };
    const otherOperations = [...documentedOperations(document)].filter(
      ([key]) => !PUBLIC_OPERATIONS.includes(key),
    );

    expect(otherOperations.length).toBeGreaterThanOrEqual(PROTECTED_OPERATIONS.length);
    for (const [key, documentedOperation] of otherOperations) {
      expect(effectiveSecurity(document, documentedOperation), key).toContainEqual(
        bearerRequirement,
      );
    }
  });

  test('requires a JSON body for registration and login', async ({ anonymous }) => {
    const document = await fetchDocument(anonymous);

    for (const key of ['POST /api/v1/auth/register', 'POST /api/v1/auth/login']) {
      expect(operation(document, key).requestBody, key).toMatchObject({
        required: true,
        content: { 'application/json': expect.anything() },
      });
    }
  });

  test('requires an Idempotency-Key header to place an order', async ({ anonymous }) => {
    const document = await fetchDocument(anonymous);

    expect(operation(document, 'POST /api/v1/orders').parameters).toContainEqual(
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: expect.objectContaining({
          minLength: 1,
          maxLength: 100,
          pattern: '^[A-Za-z0-9_-]{1,100}$',
        }),
      }),
    );
  });
});

async function fetchDocument(anonymous: ApiClient): Promise<OpenApiDocument> {
  const response = await anonymous.get(API_DOCS_PATH);
  expect(response.status()).toBe(200);
  return parseResponse(response, openApiDocumentSchema);
}

function documentedOperations(document: OpenApiDocument): Map<string, OpenApiOperation> {
  const operations = new Map<string, OpenApiOperation>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const documentedOperation = pathItem[method];
      if (documentedOperation !== undefined) {
        operations.set(`${method.toUpperCase()} ${path}`, documentedOperation);
      }
    }
  }
  return operations;
}

function operation(document: OpenApiDocument, key: string): OpenApiOperation {
  const documentedOperation = documentedOperations(document).get(key);
  if (documentedOperation === undefined) {
    throw new Error(`${key} is not in the OpenAPI document.`);
  }
  return documentedOperation;
}

function effectiveSecurity(
  document: OpenApiDocument,
  documentedOperation: OpenApiOperation,
): SecurityRequirement[] {
  return documentedOperation.security ?? document.security ?? [];
}

function bearerSchemeName(document: OpenApiDocument): string {
  const schemes = Object.entries(document.components?.securitySchemes ?? {});
  const bearer = schemes.find(([, scheme]) => scheme.type === 'http' && scheme.scheme === 'bearer');
  if (bearer === undefined) {
    throw new Error('The OpenAPI document declares no HTTP bearer security scheme.');
  }
  return bearer[0];
}
