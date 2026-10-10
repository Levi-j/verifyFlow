import { z } from 'zod';
import { isCentsAmount } from '../support/money';
import { pageSchema } from './page';

const moneySchema = z
  .number()
  .positive()
  .refine(isCentsAmount, 'must have at most two decimal places');

export const orderStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']);

export const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  productSku: z.string().regex(/^[A-Z0-9-]{1,64}$/, 'must be an uppercase SKU of 1-64 characters'),
  productName: z.string().min(1).max(200),
  unitPrice: moneySchema,
  quantity: z.number().int().min(1).max(1000),
  lineTotal: moneySchema,
});

export const orderSchema = z.object({
  id: z.number().int().positive(),
  customerId: z.number().int().positive(),
  status: orderStatusSchema,
  totalAmount: moneySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  items: z.array(orderItemSchema).min(1).max(50),
});

export const orderSummarySchema = orderSchema.omit({ customerId: true, items: true });

export const adminOrderSummarySchema = orderSchema.omit({ items: true });

export const orderSummaryPageSchema = pageSchema(orderSummarySchema);

export const adminOrderSummaryPageSchema = pageSchema(adminOrderSummarySchema);

export type Order = z.infer<typeof orderSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type AdminOrderSummary = z.infer<typeof adminOrderSummarySchema>;
