import { z } from 'zod';

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    content: z.array(item),
    page: z.number().int().nonnegative(),
    size: z.number().int().positive(),
    totalElements: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  });
}
