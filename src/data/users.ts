import { randomUUID } from 'node:crypto';
import type { Credentials } from '../contracts/auth';
import { uniqueSuffix } from './unique';

export const TEST_EMAIL_DOMAIN = 'verifyflow.test';

const MAX_EMAIL_LOCAL_PART_LENGTH = 64;
const DOMAIN_LABEL_LENGTH = 50;

export function uniqueEmail(prefix = 'customer'): string {
  return `${prefix}-${uniqueSuffix()}@${TEST_EMAIL_DOMAIN}`;
}

export function validPassword(): string {
  return `vf-pass-${randomUUID()}`;
}

export function newCustomerCredentials(): Credentials {
  return { email: uniqueEmail(), password: validPassword() };
}

export function uniqueEmailOfLength(length: number): string {
  const localPart = `long-${uniqueSuffix()}`.padEnd(MAX_EMAIL_LOCAL_PART_LENGTH, 'x');
  const domainLength = length - localPart.length - 1;
  return `${localPart}@${domainOfLength(domainLength)}`;
}

function domainOfLength(length: number): string {
  const topLevelDomain = '.test';
  const labelsLength = length - topLevelDomain.length;
  const labels = Array.from({ length: labelsLength }, (_, index) =>
    isLabelSeparator(index, labelsLength) ? '.' : 'a',
  ).join('');
  return `${labels}${topLevelDomain}`;
}

function isLabelSeparator(index: number, labelsLength: number): boolean {
  const position = index + 1;
  return position % (DOMAIN_LABEL_LENGTH + 1) === 0 && position < labelsLength;
}
