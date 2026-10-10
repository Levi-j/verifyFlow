import { expect, test } from '@playwright/test';
import { productPageSchema } from '../../src/contracts/product';

test.beforeEach(async ({ page }) => {
  await page.goto('/swagger-ui/index.html');
});

test('shows API operations and bearer authorization guidance without credentials', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { name: /^OrderFlow API/, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Products /, level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Orders /, level: 3 })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'GET /api/v1/products', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'POST /api/v1/orders', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Authorize', exact: true }).click();

  const authorizationHeading = page.getByRole('heading', { name: 'Available authorizations' });
  await expect(authorizationHeading).toBeVisible();
  await expect(page.getByRole('heading', { name: /^bearerAuth.*Bearer/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'auth-bearer-value', exact: true })).toHaveValue(
    '',
  );

  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(authorizationHeading).toBeHidden();
});

test('executes a public catalog request and renders its server response', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'GET /api/v1/products', exact: true });
  const operation = page.locator('.opblock').filter({ has: toggle });
  await toggle.click();
  await operation.getByRole('button', { name: 'Try it out', exact: true }).click();
  await operation.getByRole('textbox', { name: 'size', exact: true }).fill('1');

  const received = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/products' &&
      response.request().method() === 'GET',
  );
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  const response = await received;

  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get('size')).toBe('1');
  await expect(
    operation.getByRole('heading', { name: 'Server response', exact: true }),
  ).toBeVisible();
  // Swagger also shows a static example 200; assert the table populated by Execute.
  const liveResponse = operation.locator('.live-responses-table');
  await expect(liveResponse.getByRole('cell', { name: '200', exact: true })).toBeVisible();
  const renderedBody = liveResponse.locator('code');
  await expect(renderedBody).toContainText('"content"');
  const products = productPageSchema.parse(JSON.parse(await renderedBody.innerText()));
  expect(products).toMatchObject({ page: 0, size: 1 });
  expect(products.content.length).toBeLessThanOrEqual(1);
});
