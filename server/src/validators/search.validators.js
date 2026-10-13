import { z } from 'zod';

const scopeId = z.union([z.guid('Invalid id.'), z.literal('all'), z.literal('')]).optional();
const TYPES = { client: 'clients', job: 'jobs', task: 'tasks', conversation: 'conversations', file: 'files' };

export const searchQuery = z.object({
  q: z.string().max(200, 'Search text is too long.').optional().default(''),
  clientId: scopeId,
  jobId: scopeId,
  taskId: scopeId,
  dateRange: z.enum(['24h', '7d', '30d', '90d', 'all', '']).optional(),
  fileKind: z.enum(['image', 'document', 'text', 'other', 'all', '']).optional(),
  approval: z.enum(['approved', 'draft', 'reference', 'all', '']).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(25),
  // group filter: plural group ids, singular result types, or 'all'
  type: z
    .enum(['clients', 'jobs', 'tasks', 'conversations', 'files', 'approved', 'client', 'job', 'task', 'conversation', 'file', 'all', ''])
    .optional()
    .transform((t) => TYPES[t] || t),
});

export const suggestionsQuery = z.object({
  q: z.string().max(200, 'Search text is too long.').optional().default(''),
});
