import { defineConfig, type ReporterDescription } from '@playwright/test';
import { loadTestConfig } from './src/config/env';

const config = loadTestConfig();
const isCI = Boolean(process.env.CI);

const reporters: ReporterDescription[] = isCI
  ? [['github'], ['list'], ['html', { open: 'never' }]]
  : [['list'], ['html', { open: 'never' }]];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  failOnFlakyTests: isCI,
  workers: isCI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: reporters,
  use: {
    baseURL: config.baseUrl,
    trace: 'off',
  },
  projects: [
    {
      name: 'framework',
      testDir: './tests/framework',
    },
    {
      name: 'sut-ready',
      testMatch: 'sut-ready.setup.ts',
    },
    {
      name: 'api',
      testDir: './tests/api',
      dependencies: ['sut-ready'],
    },
    {
      name: 'concurrency',
      testDir: './tests/concurrency',
      dependencies: ['sut-ready'],
      fullyParallel: false,
      workers: 1,
      retries: 0,
      timeout: 60_000,
    },
    {
      name: 'browser',
      testDir: './tests/browser',
      dependencies: ['sut-ready'],
      fullyParallel: false,
      workers: 1,
      retries: 0,
      use: {
        browserName: 'chromium',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'off',
      },
    },
  ],
});
