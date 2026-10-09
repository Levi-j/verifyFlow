import { existsSync } from 'node:fs';
import { z } from 'zod';

const ENV_FILE = '.env';

export const ISOLATED_SUT_ORIGINS: readonly string[] = [
  'http://127.0.0.1:18080',
  'http://localhost:18080',
];

const environmentSchema = z.object({
  ORDERFLOW_BASE_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:18080'),
  VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET: z.stringbool().default(false),
  VERIFYFLOW_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

export interface TestConfig {
  baseUrl: string;
  healthTimeoutMs: number;
}

export function loadTestConfig(): TestConfig {
  if (existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
  }
  return parseTestConfig(process.env);
}

export function parseTestConfig(environment: NodeJS.ProcessEnv): TestConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Invalid verifyFlow configuration:\n${z.prettifyError(result.error)}`);
  }

  const env = result.data;
  assertSafeTarget(new URL(env.ORDERFLOW_BASE_URL), env.VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET);

  return {
    baseUrl: env.ORDERFLOW_BASE_URL,
    healthTimeoutMs: env.VERIFYFLOW_HEALTH_TIMEOUT_MS,
  };
}

function assertSafeTarget(target: URL, nonIsolatedTargetAllowed: boolean): void {
  if (ISOLATED_SUT_ORIGINS.includes(target.origin) || nonIsolatedTargetAllowed) {
    return;
  }
  throw new Error(
    `Refusing to run against ${target.origin}. verifyFlow creates and changes data in the API ` +
      `under test, so by default it only targets its isolated test environment ` +
      `(${ISOLATED_SUT_ORIGINS.join(' or ')}). To target a different environment deliberately, ` +
      'set VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET=true.',
  );
}
