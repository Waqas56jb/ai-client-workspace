import { z } from 'zod';
import { flag, id, pageFields, search, text } from './clients.validators.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' (a real calendar date), or '' / null to clear the deadline. */
const deadline = z
  .union([
    z.literal(''),
    z.null(),
    z
      .string()
      .regex(DATE, { message: 'Use the format YYYY-MM-DD.' })
      .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
        message: 'Enter a valid date.',
      }),
  ])
  .transform((v) => v || null);

const jobFields = {
  clientId: id,
  title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(100),
  description: text(1000),
  status: z.enum(['active', 'on_hold', 'completed']),
  deadline,
  notes: text(2000),
};

export const jobIdParams = z.object({ jobId: id });

export const createJobSchema = z.object({
  clientId: jobFields.clientId,
  title: jobFields.title,
  description: jobFields.description.optional(),
  status: jobFields.status.optional(),
  deadline: jobFields.deadline.optional(),
  notes: jobFields.notes.optional(),
});

export const updateJobSchema = z
  .object(jobFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const listJobsQuery = z.object({
  search,
  clientId: z.union([id, z.literal('all')]).optional(),
  status: z.enum(['active', 'on_hold', 'completed', 'archived', 'all']).optional(),
  includeArchived: flag,
  sort: z.enum(['updated', 'created', 'name', 'deadline']).optional(),
  ...pageFields,
});

export const jobChildrenQuery = z.object({ ...pageFields });
