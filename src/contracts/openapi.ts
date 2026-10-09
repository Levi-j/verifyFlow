import { z } from 'zod';

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

const securityRequirementSchema = z.record(z.string(), z.array(z.string()));

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  schema: z
    .object({
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
});

const operationSchema = z.object({
  security: z.array(securityRequirementSchema).optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: z
    .object({
      required: z.boolean().optional(),
      content: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

const pathItemSchema = z.object({
  get: operationSchema.optional(),
  put: operationSchema.optional(),
  post: operationSchema.optional(),
  delete: operationSchema.optional(),
  patch: operationSchema.optional(),
});

const securitySchemeSchema = z.object({
  type: z.string(),
  scheme: z.string().optional(),
  bearerFormat: z.string().optional(),
});

export const openApiDocumentSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), version: z.string() }),
  security: z.array(securityRequirementSchema).optional(),
  paths: z.record(z.string(), pathItemSchema),
  components: z
    .object({ securitySchemes: z.record(z.string(), securitySchemeSchema).optional() })
    .optional(),
});

export type OpenApiDocument = z.infer<typeof openApiDocumentSchema>;
export type OpenApiOperation = z.infer<typeof operationSchema>;
export type SecurityRequirement = z.infer<typeof securityRequirementSchema>;
