import { z } from 'zod';
import { id, text } from './clients.validators.js';

/** Workspace preferences (single shared row). All fields optional for partial updates. */
export const updateWorkspaceSchema = z
  .object({
    workspaceName: z.string().trim().min(1, 'Workspace name is required.').max(80),
    writingPreferences: text(4000),
    spelling: z.string().trim().min(1).max(40),
    defaultTone: z.string().trim().min(1).max(40),
    dateFormat: z.string().trim().min(1).max(40),
    defaultFileView: z.enum(['grid', 'list']),
    defaultPresetId: id.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one setting to update.' });
