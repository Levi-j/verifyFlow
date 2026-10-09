import { expect, test } from '@playwright/test';

test.describe('OpenAPI document', () => {
  test('is published without authentication', async ({ request }) => {
    const response = await request.get('/v3/api-docs');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const document: unknown = await response.json();
    expect(document).toMatchObject({
      openapi: expect.stringMatching(/^3\./),
      info: { title: 'OrderFlow API', version: 'v1' },
    });
  });
});
