export function toCents(amount: number): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (match === null) {
    throw new Error(`${amount} is not a non-negative amount with at most two decimal places.`);
  }
  const [, units = '', fraction = ''] = match;
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`${amount} is too large to compare exactly in cents.`);
  }
  return cents;
}

export function isCentsAmount(amount: number): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(String(amount));
}

export function lineTotalCents(unitPrice: number, quantity: number): number {
  return toCents(unitPrice) * quantity;
}

export function sumCents(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
