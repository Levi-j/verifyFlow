import { expect, test as setup, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { loadTestConfig } from '../src/config/env';

const HEALTH_PATH = '/actuator/health';
const POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 5_000;

const healthBodySchema = z.object({ status: z.string() });

setup('OrderFlow test environment reports UP', async ({ request }) => {
  const { healthTimeoutMs } = loadTestConfig();
  setup.setTimeout(healthTimeoutMs + REQUEST_TIMEOUT_MS * 2);

  await expect
    .poll(() => observeHealth(request), {
      message: `OrderFlow did not report UP at ${HEALTH_PATH}. Start it with "npm run sut:up".`,
      timeout: healthTimeoutMs,
      intervals: [POLL_INTERVAL_MS],
    })
    .toBe('HTTP 200 UP');
});

async function observeHealth(request: APIRequestContext): Promise<string> {
  try {
    const response = await request.get(HEALTH_PATH, { timeout: REQUEST_TIMEOUT_MS });
    return `HTTP ${response.status()} ${healthStatusOf(await response.text())}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n')[0] ?? message;
  }
}

function healthStatusOf(body: string): string {
  try {
    return healthBodySchema.parse(JSON.parse(body)).status;
  } catch {
    return body.slice(0, 200);
  }
}
