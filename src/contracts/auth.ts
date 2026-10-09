import { z } from 'zod';

const JWT_FORMAT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const roleSchema = z.enum(['CUSTOMER', 'ADMIN']);

export const userSchema = z.object({
  id: z.number().int().positive(),
  email: z.email(),
  role: roleSchema,
  createdAt: z.iso.datetime(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string().regex(JWT_FORMAT, 'must be a compact JWT'),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

export type Role = z.infer<typeof roleSchema>;
export type User = z.infer<typeof userSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export interface Credentials {
  email: string;
  password: string;
}
