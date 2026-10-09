import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'RESOURCE_NOT_FOUND',
  'DUPLICATE_SKU',
  'INSUFFICIENT_STOCK',
  'PRODUCT_NOT_AVAILABLE',
  'INVALID_STATUS_TRANSITION',
  'CONCURRENT_MODIFICATION',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_KEY_IN_USE',
  'EMAIL_ALREADY_REGISTERED',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'ACCESS_DENIED',
  'DATA_CONFLICT',
  'METHOD_NOT_ALLOWED',
  'NOT_ACCEPTABLE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const validationErrorSchema = z.object({
  field: z.string().min(1),
  message: z.string(),
});

export const problemSchema = z.object({
  type: z.string().optional(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  code: z.enum(ERROR_CODES),
  requestId: z.string().min(1),
  errors: z.array(validationErrorSchema).optional(),
});

export type Problem = z.infer<typeof problemSchema>;
