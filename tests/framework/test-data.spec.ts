import { expect, test } from '@playwright/test';
import {
  newCustomerCredentials,
  TEST_EMAIL_DOMAIN,
  uniqueEmail,
  uniqueEmailOfLength,
  validPassword,
} from '../../src/data/users';

const utf8Bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const codePoints = (value: string) => [...value].length;

test.describe('User test data', () => {
  test('generates unique lowercase emails on the test domain', () => {
    const emails = Array.from({ length: 1_000 }, () => uniqueEmail());

    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) {
      expect(email).toBe(email.toLowerCase());
      expect(email.endsWith(`@${TEST_EMAIL_DOMAIN}`)).toBe(true);
    }
  });

  test('generates unique passwords that satisfy the registration policy', () => {
    const passwords = Array.from({ length: 1_000 }, () => validPassword());

    expect(new Set(passwords).size).toBe(passwords.length);
    for (const password of passwords) {
      expect(codePoints(password)).toBeGreaterThanOrEqual(15);
      expect(utf8Bytes(password)).toBeLessThanOrEqual(72);
    }
  });

  test('builds customer credentials from those generators', () => {
    const credentials = newCustomerCredentials();

    expect(credentials.email.endsWith(`@${TEST_EMAIL_DOMAIN}`)).toBe(true);
    expect(codePoints(credentials.password)).toBeGreaterThanOrEqual(15);
  });

  for (const length of [254, 255]) {
    test(`builds a structurally valid, unique email of exactly ${length} characters`, () => {
      const email = uniqueEmailOfLength(length);
      const [localPart, domain] = email.split('@');

      expect(email).toHaveLength(length);
      expect(email).not.toBe(uniqueEmailOfLength(length));
      expect(localPart?.length).toBeLessThanOrEqual(64);
      for (const label of domain?.split('.') ?? []) {
        expect(label.length).toBeGreaterThan(0);
        expect(label.length).toBeLessThanOrEqual(63);
      }
    });
  }
});
