import { z } from 'zod';
import { TASK_STATUSES, TASK_TYPES } from '../constants/domain.js';
import { flag, id, pageFields, search, text } from './clients.validators.js';

const taskFields = {
  clientId: id,
  jobId: id,
  title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(100),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  assigneeId: id.nullable(),
  description: text(1000),
  notes: text(2000),
};

const all = (schema) => z.union([schema, z.literal('all')]).optional();

export const taskIdParams = z.object({ taskId: id });

export const createTaskSchema = z.object({
  clientId: taskFields.clientId,
  jobId: taskFields.jobId,
  title: taskFields.title,
  type: taskFields.type,
  status: taskFields.status.optional(),
  assigneeId: taskFields.assigneeId.optional(),
  description: taskFields.description.optional(),
  notes: taskFields.notes.optional(),
});

export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const listTasksQuery = z.object({
  search,
  clientId: all(id),
  jobId: all(id),
  type: all(z.enum(TASK_TYPES)),
  status: all(z.enum([...TASK_STATUSES, 'open'])),
  approval: all(z.enum(['none', 'draft', 'approved'])),
  assigneeId: all(id),
  dateRange: z.enum(['24h', '7d', '30d', '90d', 'all']).optional(),
  includeArchived: flag,
  sort: z.enum(['updated', 'created', 'name', 'client']).optional(),
  ...pageFields,
});

export const taskChildrenQuery = z.object({ ...pageFields });
