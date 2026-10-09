import { expect, test } from '@playwright/test';
import { parseTestConfig } from '../../src/config/env';

test.describe('Target safety guard', () => {
  test('defaults to the isolated test environment', () => {
    expect(parseTestConfig({}).baseUrl).toBe('http://127.0.0.1:18080');
  });

  for (const baseUrl of [
    'http://127.0.0.1:18080',
    'http://localhost:18080',
    'http://LOCALHOST:18080/',
  ]) {
    test(`accepts the isolated test environment at ${baseUrl}`, () => {
      expect(parseTestConfig({ ORDERFLOW_BASE_URL: baseUrl }).baseUrl).toBe(baseUrl);
    });
  }

  for (const baseUrl of [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost',
    'https://localhost:18080',
    'http://[::1]:18080',
    'http://0.0.0.0:18080',
    'http://localhost.example.com:18080',
    'https://api.example.com',
  ]) {
    test(`rejects ${baseUrl} without explicit opt-in`, () => {
      expect(() => parseTestConfig({ ORDERFLOW_BASE_URL: baseUrl })).toThrow(
        /Refusing to run against .*VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET=true/s,
      );
    });
  }

  for (const baseUrl of ['http://localhost:8080', 'https://api.example.com']) {
    test(`accepts ${baseUrl} with explicit opt-in`, () => {
      const config = parseTestConfig({
        ORDERFLOW_BASE_URL: baseUrl,
        VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET: 'true',
      });

      expect(config.baseUrl).toBe(baseUrl);
    });
  }

  test('keeps rejecting when the opt-in is explicitly false', () => {
    expect(() =>
      parseTestConfig({
        ORDERFLOW_BASE_URL: 'http://localhost:8080',
        VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET: 'false',
      }),
    ).toThrow(/Refusing to run against http:\/\/localhost:8080/);
  });

  test('rejects an unrecognised opt-in value instead of guessing', () => {
    expect(() =>
      parseTestConfig({
        ORDERFLOW_BASE_URL: 'http://localhost:8080',
        VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET: 'maybe',
      }),
    ).toThrow(/Invalid verifyFlow configuration.*VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET/s);
  });

  test('rejects a base URL that is not HTTP or HTTPS', () => {
    expect(() => parseTestConfig({ ORDERFLOW_BASE_URL: 'ftp://127.0.0.1:18080' })).toThrow(
      /Invalid verifyFlow configuration.*ORDERFLOW_BASE_URL/s,
    );
  });
});
