import type { APIResponse, ExpectMatcherState, MatcherReturnType } from '@playwright/test';
import { z } from 'zod';
import { problemSchema, type ErrorCode } from '../contracts/problem';
import { describeResponse, isProblemResponse, safeRequestId } from './api-diagnostics';

export interface ProblemExpectations {
  fields?: string[];
}

export const problemMatchers = {
  async toBeProblem(
    this: ExpectMatcherState,
    response: APIResponse,
    status: number,
    code: ErrorCode,
    expectations: ProblemExpectations = {},
  ): Promise<MatcherReturnType> {
    const mismatches = await findProblemMismatches(response, status, code, expectations);
    const pass = mismatches.length === 0;
    const observed = await describeResponse(response);
    const expected = `a ${status} ${code} problem response`;

    return {
      name: 'toBeProblem',
      pass,
      message: () =>
        pass
          ? `Expected the response not to be ${expected}.\nObserved: ${observed}`
          : `Expected ${expected}.\nObserved: ${observed}\n` +
            mismatches.map((mismatch) => `  - ${mismatch}`).join('\n'),
    };
  },
};

async function findProblemMismatches(
  response: APIResponse,
  status: number,
  code: ErrorCode,
  { fields }: ProblemExpectations,
): Promise<string[]> {
  const mismatches: string[] = [];

  if (response.status() !== status) {
    mismatches.push(`HTTP status was ${response.status()}, expected ${status}`);
  }
  if (!isProblemResponse(response)) {
    mismatches.push('Content-Type was not application/problem+json');
    return mismatches;
  }

  const parsed = problemSchema.safeParse(await readJsonOrUndefined(response));
  if (!parsed.success) {
    mismatches.push(`body does not match the problem contract:\n${z.prettifyError(parsed.error)}`);
    return mismatches;
  }

  const problem = parsed.data;
  if (problem.status !== response.status()) {
    mismatches.push(`body status ${problem.status} differs from HTTP status ${response.status()}`);
  }
  if (problem.code !== code) {
    mismatches.push(`code was ${problem.code}, expected ${code}`);
  }
  if (problem.requestId !== safeRequestId(response)) {
    mismatches.push('body requestId does not match the X-Request-Id response header');
  }
  if (fields !== undefined) {
    const actualFields = uniqueSorted((problem.errors ?? []).map((error) => error.field));
    const expectedFields = uniqueSorted(fields);
    if (actualFields.join() !== expectedFields.join()) {
      mismatches.push(
        `validation error fields were [${actualFields.join(', ')}], ` +
          `expected [${expectedFields.join(', ')}]`,
      );
    }
  }
  return mismatches;
}

async function readJsonOrUndefined(response: APIResponse): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return undefined;
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
