import { z } from 'zod';
import { pageSchema } from './page';

export const productSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string().regex(/^[A-Z0-9-]{1,64}$/, 'must be an uppercase SKU of 1-64 characters'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  price: z.number().positive(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const productPageSchema = pageSchema(productSchema);

export type Product = z.infer<typeof productSchema>;
export type ProductPage = z.infer<typeof productPageSchema>;
