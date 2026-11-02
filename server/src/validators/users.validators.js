import { z } from 'zod';
import { id } from './clients.validators.js';

export const userIdParams = z.object({ userId: id });

export const listUsersQuery = z.object({ status: z.enum(['active', 'inactive', 'all']).optional() });

/** Members may change only their own display fields. Email and membership are managed by provisioning. */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120),
    role: z.string().trim().max(80),
    avatarColor: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Use a hex colour such as #6257E8.' }),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

const password = z.string().min(8, 'Use at least 8 characters.').max(72, 'Use at most 72 characters.');

/** Administrator: a new member account. */
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  role: z.string().trim().max(80).default('Team member'),
  password,
  isAdmin: z.boolean().default(false),
});

export const setPasswordSchema = z.object({ password });
