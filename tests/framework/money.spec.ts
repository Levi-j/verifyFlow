import { expect, test } from '@playwright/test';
import { isCentsAmount, lineTotalCents, sumCents, toCents } from '../../src/support/money';

test.describe('Money helpers', () => {
  const amounts = [
    { amount: 7, cents: 700 },
    { amount: 0.1, cents: 10 },
    { amount: 0.07, cents: 7 },
    { amount: 19.99, cents: 1999 },
    { amount: 1234.56, cents: 123456 },
    { amount: 9_999_999_999.99, cents: 999_999_999_999 },
  ];

  for (const { amount, cents } of amounts) {
    test(`converts ${amount} to ${cents} cents`, () => {
      expect(toCents(amount)).toBe(cents);
      expect(isCentsAmount(amount)).toBe(true);
    });
  }

  const invalidAmounts = [10.005, 0.001, -1, Number.NaN, 1e21];

  for (const amount of invalidAmounts) {
    test(`rejects ${amount} instead of rounding it`, () => {
      expect(() => toCents(amount)).toThrow();
      expect(isCentsAmount(amount)).toBe(false);
    });
  }

  test('multiplies in cents, avoiding floating-point error', () => {
    expect(0.1 * 3).not.toBe(0.3);
    expect(lineTotalCents(0.1, 3)).toBe(30);
    expect(lineTotalCents(19.99, 3)).toBe(5997);
  });

  test('adds amounts in cents', () => {
    expect(sumCents([30, 5997, 864_192])).toBe(870_219);
    expect(sumCents([])).toBe(0);
  });
});
