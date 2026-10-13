import { getDatabase } from '../config/db.js';
import { LIST_LIMITS } from './files.service.js';
import { ACTIVITY, TOOL_TO_DB } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as approvalsRepo from '../repositories/approvals.repository.js';
import * as outputsRepo from '../repositories/outputs.repository.js';
import * as versionsRepo from '../repositories/versions.repository.js';
import * as filesRepo from '../repositories/files.repository.js';
import { notFound, badRequest } from '../utils/errors.js';
import { clientSummary, iso, jobSummary, pageMeta, pagination, rangeInterval, taskSummary, userSummary } from '../utils/mappers.js';
import { buildOutputDtos, getOutputDto } from './output.service.js';

/**
 * Approvals: approving specific immutable versions (append-only history),
 * approval history and the Approved Work list. A newer draft never replaces
 * the approved version — `approved_version_id` only moves on explicit approval.
 */

/** Approval row → Approval DTO. */
function toApprovalDto(a) {
  const isOutput = !!a.output_version_id;
  return {
    id: a.id,
    type: isOutput ? 'output' : 'file',
    clientId: a.client_id,
    jobId: a.job_id,
    taskId: a.task_id,
    outputId: a.output_id || null,
    versionId: a.output_version_id || null,
    fileId: a.file_id || null,
    fileVersionId: a.file_version_id || null,
    versionNumber: isOutput ? a.output_version_number : a.file_version_number,
    title: isOutput ? a.output_title : a.file_name,
    kind: a.output_kind || null,
    status: a.status,
    notes: a.notes,
    approvedAt: iso(a.approved_at),
    approvedBy: userSummary(a, 'approver_'),
    approvedById: a.approved_by || null,
    isCurrent: isOutput ? a.output_approved_version_id === a.output_version_id : a.status === 'approved',
    createdAt: iso(a.created_at),
    client: clientSummary(a),
    job: jobSummary(a),
    task: taskSummary(a),
  };
}

/** Approves an output version inside `tx` and logs it. Returns the approval row. */
async function approveOutputTx(tx, user, outputId, versionId, notes) {
  const output = await outputsRepo.findOutputRow(tx, outputId);
  if (!output) throw notFound('Output');
  const version = await versionsRepo.findVersion(tx, outputId, versionId);
  if (!version) throw notFound('Version');
  const approval = await approvalsRepo.approveOutputVersion(tx, outputId, versionId, notes);
  await logActivity(tx, {
    userId: user.id,
    type: ACTIVITY.OUTPUT_APPROVED,
    resourceType: 'output',
    resourceId: outputId,
    clientId: output.client_id,
    jobId: output.job_id,
    taskId: output.task_id,
    description: `Approved v${version.version_number} of “${output.title}”`,
    metadata: { versionId, approvalId: approval.id },
  });
  return approval;
}

async function approveFileTx(tx, user, fileId, fileVersionId, notes) {
  const file = await filesRepo.findFileRow(tx, fileId);
  if (!file) throw notFound('File');
  if (file.output_id) throw badRequest('Approve generated outputs through their output version.');
  if (!(await filesRepo.findFileVersion(tx, fileId, fileVersionId))) throw notFound('Version');
  const approval = await approvalsRepo.approveFileVersion(tx, fileId, fileVersionId, notes);
  await logActivity(tx, {
    userId: user.id,
    type: ACTIVITY.OUTPUT_APPROVED,
    resourceType: 'file',
    resourceId: fileId,
    clientId: file.client_id,
    jobId: file.job_id,
    taskId: file.task_id,
    description: `Approved “${file.file_name}”`,
    metadata: { fileVersionId, approvalId: approval.id },
  });
  return approval;
}

/**
 * Approves one output version (409 when it is already the approved version).
 * @returns {Promise<object>} the updated Output DTO with versions
 */
export async function approveOutputVersion(user, outputId, versionId, notes = '') {
  return getDatabase().withUser(user.id, async (tx) => {
    await approveOutputTx(tx, user, outputId, versionId, notes);
    return getOutputDto(tx, outputId, { withVersions: true });
  });
}

/** Generic approval: { outputId, versionId } or { fileId, fileVersionId }. Returns the Approval DTO. */
export async function createApproval(user, body) {
  return getDatabase().withUser(user.id, async (tx) => {
    const approval = body.outputId
      ? await approveOutputTx(tx, user, body.outputId, body.versionId, body.notes)
      : await approveFileTx(tx, user, body.fileId, body.fileVersionId, body.notes);
    return toApprovalDto(await approvalsRepo.findApprovalById(tx, approval.id));
  });
}

/** Approval history of an output, newest first. */
export async function outputApprovalHistory(user, outputId) {
  return getDatabase().withUser(user.id, async (tx) => {
    if (!(await outputsRepo.findOutputRow(tx, outputId))) throw notFound('Output');
    return (await approvalsRepo.listApprovalsForOutput(tx, outputId)).map(toApprovalDto);
  });
}

export async function listApprovals(user, q) {
  const page = pagination(q, LIST_LIMITS);
  return getDatabase().withUser(user.id, async (tx) => {
    const { rows, total } = await approvalsRepo.listApprovals(tx, { ...q, interval: rangeInterval(q.dateRange) }, page);
    return { data: rows.map(toApprovalDto), meta: pageMeta(page, total) };
  });
}

export async function getApproval(user, id) {
  return getDatabase().withUser(user.id, async (tx) => {
    const row = await approvalsRepo.findApprovalById(tx, id);
    if (!row) throw notFound('Approval');
    return toApprovalDto(row);
  });
}

/** Approved Work: outputs with an approved version (DTO includes `approvedVersion`). */
export async function listApproved(user, q) {
  const page = pagination(q, LIST_LIMITS);
  return getDatabase().withUser(user.id, async (tx) => {
    const { rows, total } = await outputsRepo.listApprovedOutputs(
      tx,
      { ...q, toolType: q.tool ? TOOL_TO_DB[q.tool] : undefined, interval: rangeInterval(q.dateRange) },
      page,
    );
    return { data: await buildOutputDtos(tx, rows), meta: pageMeta(page, total) };
  });
}
