import { z } from 'zod';
import { dateRange, optionalUuid, pageQuery, searchText } from './files.validators.js';

/** Zod schemas for approvals and Approved Work. */

const notes = z.string().trim().max(1000).optional().default('');

export const createApprovalBody = z.union([
  z.object({ outputId: z.uuid(), versionId: z.uuid(), notes }),
  z.object({ fileId: z.uuid(), fileVersionId: z.uuid(), notes }),
]);

export const listApprovalsQuery = z.object({
  clientId: optionalUuid,
  jobId: optionalUuid,
  taskId: optionalUuid,
  outputId: optionalUuid,
  fileId: optionalUuid,
  approvedBy: optionalUuid,
  dateRange,
  ...pageQuery,
});

const optionalEnum = (values) => z.preprocess((v) => (v === '' || v === 'all' ? undefined : v), z.enum(values).optional());

export const listApprovedQuery = z.object({
  clientId: optionalUuid,
  jobId: optionalUuid,
  taskId: optionalUuid,
  kind: optionalEnum(['text', 'image']),
  tool: optionalEnum(['writing', 'image', 'advertising', 'vehicle']),
  approvedBy: optionalUuid,
  dateRange,
  search: searchText,
  sort: optionalEnum(['approved', 'title', 'client']),
  ...pageQuery,
});
