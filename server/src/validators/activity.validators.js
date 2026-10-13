import { z } from 'zod';
import { id } from './clients.validators.js';

const scoped = z.union([id, z.literal('all')]).optional();

export const listActivityQuery = z.object({
  clientId: scoped,
  jobId: scoped,
  taskId: scoped,
  userId: scoped,
  type: z.string().trim().max(60).regex(/^[a-z_]+$/, { message: 'Unknown activity type.' }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
