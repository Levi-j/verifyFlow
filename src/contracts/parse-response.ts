import type { APIResponse } from '@playwright/test';
import { z } from 'zod';

export async function parseResponse<Schema extends z.ZodType>(
  response: APIResponse,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const result = schema.safeParse(await response.json());
  if (!result.success) {
    throw new Error(
      `Response from ${new URL(response.url()).pathname} does not match its contract:\n` +
        z.prettifyError(result.error),
    );
  }
  return result.data;
}
