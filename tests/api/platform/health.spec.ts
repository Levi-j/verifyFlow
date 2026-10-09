import { expect, test } from '@playwright/test';

test.describe('Health endpoint', () => {
  test('reports the application as UP', { tag: '@smoke' }, async ({ request }) => {
    const response = await request.get('/actuator/health');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('json');
    expect(await response.json()).toMatchObject({ status: 'UP' });
  });

  test('does not expose component details to anonymous clients', async ({ request }) => {
    const response = await request.get('/actuator/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).not.toHaveProperty('components');
  });
});
