import { z } from 'zod';

/** Zod schemas for the files module. Unknown keys are stripped. */

const emptyToUndefined = (v) => (v === '' || v === 'null' || v === 'undefined' || v === 'all' ? undefined : v);
export const optionalUuid = z.preprocess(emptyToUndefined, z.uuid().optional());
const optionalEnum = (values) => z.preprocess(emptyToUndefined, z.enum(values).optional());
const boolFlag = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).optional();

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
};
export const dateRange = optionalEnum(['24h', '7d', '30d', '90d']);
export const searchText = z.preprocess(emptyToUndefined, z.string().trim().max(200).optional());

export const idParams = z.object({ id: z.uuid() });
export const versionParams = z.object({ id: z.uuid(), versionId: z.uuid() });

/** Multipart text fields of POST /files/upload. */
export const uploadBody = z.object({
  clientId: z.uuid(),
  jobId: optionalUuid,
  taskId: optionalUuid,
  category: z.preprocess(emptyToUndefined, z.enum(['reference', 'attachment', 'logo']).default('reference')),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
});

export const listFilesQuery = z.object({
  kind: optionalEnum(['image', 'document', 'text', 'other']),
  status: optionalEnum(['draft', 'approved', 'reference']),
  clientId: optionalUuid,
  jobId: optionalUuid,
  taskId: optionalUuid,
  createdBy: optionalUuid,
  category: optionalEnum(['reference', 'attachment', 'output', 'logo']),
  dateRange,
  search: searchText,
  sort: optionalEnum(['updated', 'created', 'name', 'size']),
  includeArchived: boolFlag,
  ...pageQuery,
});

export const downloadQuery = z.object({ versionId: optionalUuid });

export const updateFileBody = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(1000).optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined, { message: 'Provide a name or description.' });

export const approveBody = z.object({ notes: z.string().trim().max(1000).optional().default('') });
