import { z } from 'zod';
import { optionalUuid, pageQuery, searchText } from './files.validators.js';

/** Zod schemas for outputs and output versions. */

const emptyToUndefined = (v) => (v === '' || v === 'all' ? undefined : v);
const optionalEnum = (values) => z.preprocess(emptyToUndefined, z.enum(values).optional());

export const listOutputsQuery = z.object({
  taskId: optionalUuid,
  conversationId: optionalUuid,
  clientId: optionalUuid,
  jobId: optionalUuid,
  tool: optionalEnum(['writing', 'image', 'advertising', 'vehicle']),
  kind: optionalEnum(['text', 'image']),
  status: optionalEnum(['draft', 'approved']),
  search: searchText,
  sort: optionalEnum(['updated', 'created', 'title']),
  ...pageQuery,
});

export const renameOutputBody = z.object({ title: z.string().trim().min(1).max(160) });

const section = z.object({ label: z.string().max(200), text: z.string().max(20000) });

export const revisionBody = z
  .object({
    content: z.string().max(100000).optional(),
    sections: z.array(section).max(50).nullable().optional(),
    missing: z.array(z.string().max(500)).max(50).nullable().optional(),
    note: z.string().trim().max(500).optional().default(''),
    sourceVersionId: optionalUuid,
  })
  .refine((b) => b.content !== undefined || b.sections != null || b.sourceVersionId, {
    message: 'Provide new content, sections or a source version.',
  });

export const restoreBody = z.object({ note: z.string().trim().max(500).optional().default('') });
