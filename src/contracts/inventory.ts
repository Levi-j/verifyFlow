import { z } from 'zod';
import { INT32_MAX, MAX_NOTE_LENGTH } from '../data/inventory';
import { pageSchema } from './page';

export const inventorySchema = z.object({
  productId: z.number().int().positive(),
  quantityOnHand: z.number().int().min(0).max(INT32_MAX),
});

export const movementReasonSchema = z.enum([
  'RESTOCK',
  'ADJUSTMENT',
  'ORDER_PLACED',
  'ORDER_CANCELLED',
]);

export const inventoryMovementSchema = z.object({
  id: z.number().int().positive(),
  productId: z.number().int().positive(),
  quantityChange: z
    .number()
    .int()
    .refine((change) => change !== 0, 'must not be zero'),
  reason: movementReasonSchema,
  orderId: z.number().int().positive().nullable(),
  performedByUserId: z.number().int().positive(),
  note: z.string().max(MAX_NOTE_LENGTH).nullable(),
  createdAt: z.iso.datetime(),
});

export const movementPageSchema = pageSchema(inventoryMovementSchema);

export type Inventory = z.infer<typeof inventorySchema>;
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;
export type MovementPage = z.infer<typeof movementPageSchema>;
