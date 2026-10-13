import { getDatabase } from '../config/db.js';
import { LIST_LIMITS } from './files.service.js';
import { ACTIVITY, TOOL_TO_DB } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as outputsRepo from '../repositories/outputs.repository.js';
import * as versionsRepo from '../repositories/versions.repository.js';
import * as filesRepo from '../repositories/files.repository.js';
import { badRequest, notFound } from '../utils/errors.js';
import { pageMeta, pagination } from '../utils/mappers.js';
import { signedUrl } from './storage.service.js';
import { addTextRevision, buildOutputDtos, displayFileName, getOutputDto, restoreVersion, toVersionDto, versionText } from './output.service.js';

/**
 * Outputs and their immutable versions: listing, renaming, text revisions,
 * restoring earlier versions as new drafts and per-version downloads.
 */

async function lockedOutput(tx, id) {
  const output = await outputsRepo.findOutputRow(tx, id, { forUpdate: true });
  if (!output) throw notFound('Output');
  return output;
}

async function logRevision(tx, user, output, versionId, description) {
  await logActivity(tx, {
    userId: user.id,
    type: ACTIVITY.OUTPUT_REVISED,
    resourceType: 'output',
    resourceId: output.id,
    clientId: output.client_id,
    jobId: output.job_id,
    taskId: output.task_id,
    description,
    metadata: { versionId },
  });
}

/** Paginated output list → { data, meta }. */
export async function listOutputs(user, q) {
  const page = pagination(q, LIST_LIMITS);
  return getDatabase().withUser(user.id, async (tx) => {
    const { rows, total } = await outputsRepo.listOutputs(tx, { ...q, toolType: q.tool ? TOOL_TO_DB[q.tool] : undefined }, page);
    return { data: await buildOutputDtos(tx, rows), meta: pageMeta(page, total) };
  });
}

/** Output DTO with all versions. */
export async function getOutput(user, id) {
  return getDatabase().withUser(user.id, (tx) => getOutputDto(tx, id, { withVersions: true }));
}

/** Renames an output (and its generated file record). Versions keep their original titles. */
export async function renameOutput(user, id, title) {
  return getDatabase().withUser(user.id, async (tx) => {
    const output = await lockedOutput(tx, id);
    await outputsRepo.updateOutputTitle(tx, id, title, user.id);
    if (output.file_id) await filesRepo.renameOutputFile(tx, id, displayFileName(title, output.output_kind === 'image' ? 'png' : 'txt'), user.id);
    return getOutputDto(tx, id, { withVersions: true });
  });
}

/** All versions of an output, oldest first. */
export async function listVersions(user, id) {
  return getDatabase().withUser(user.id, async (tx) => {
    if (!(await outputsRepo.findOutputRow(tx, id))) throw notFound('Output');
    const rows = await versionsRepo.listVersionsByOutputIds(tx, [id]);
    return Promise.all(rows.map((r) => toVersionDto(r)));
  });
}

export async function getVersion(user, id, versionId) {
  return getDatabase().withUser(user.id, async (tx) => {
    if (!(await outputsRepo.findOutputRow(tx, id))) throw notFound('Output');
    const row = await versionsRepo.findVersion(tx, id, versionId);
    if (!row) throw notFound('Version');
    return toVersionDto(row);
  });
}

/**
 * Creates a new DRAFT revision. Text outputs accept content/sections/missing;
 * image outputs only accept `sourceVersionId` (new pixels come from the AI module).
 * Returns the Output DTO with versions.
 */
export async function createRevision(user, id, body) {
  return getDatabase().withUser(user.id, async (tx) => {
    const output = await lockedOutput(tx, id);
    if (body.sourceVersionId && !(await versionsRepo.findVersion(tx, id, body.sourceVersionId))) throw notFound('Version');

    let versionId;
    if (output.output_kind === 'image') {
      if (body.content !== undefined || body.sections !== undefined || body.missing !== undefined) {
        throw badRequest('Image revisions with new pixels are created through the AI image tools.');
      }
      if (!body.sourceVersionId) throw badRequest('Choose the version to duplicate as a new draft.');
      ({ versionId } = await restoreVersion(tx, { userId: user.id, outputId: id, sourceVersionId: body.sourceVersionId, note: body.note }));
    } else {
      ({ versionId } = await addTextRevision(tx, {
        userId: user.id,
        outputId: id,
        content: body.content ?? null,
        sections: body.sections ?? null,
        missing: body.missing ?? null,
        note: body.note,
        sourceVersionId: body.sourceVersionId ?? null,
      }));
    }
    const dto = await getOutputDto(tx, id, { withVersions: true });
    const created = dto.versions.find((v) => v.id === versionId);
    await logRevision(
      tx,
      user,
      output,
      versionId,
      `Created v${created?.versionNumber} of “${output.title}”${output.approved_version_id ? ' — approved version preserved' : ''}`,
    );
    return dto;
  });
}

/** Copies an earlier version into a NEW draft version. Returns the Output DTO with versions. */
export async function restore(user, id, versionId, note) {
  return getDatabase().withUser(user.id, async (tx) => {
    const output = await lockedOutput(tx, id);
    const source = await versionsRepo.findVersion(tx, id, versionId);
    if (!source) throw notFound('Version');
    const { versionId: newId } = await restoreVersion(tx, { userId: user.id, outputId: id, sourceVersionId: versionId, note: note || `Restored from v${source.version_number}` });
    const dto = await getOutputDto(tx, id, { withVersions: true });
    const created = dto.versions.find((v) => v.id === newId);
    await logRevision(tx, user, output, newId, `Restored v${source.version_number} of “${output.title}” as v${created?.versionNumber}`);
    return dto;
  });
}

/**
 * Download of one version: `{ kind: 'text', text, fileName }` for text outputs,
 * `{ kind: 'link', url, expiresAt, fileName }` (signed, attachment) for images.
 */
export async function downloadVersion(user, id, versionId) {
  const target = await getDatabase().withUser(user.id, async (tx) => {
    const output = await outputsRepo.findOutputRow(tx, id);
    if (!output) throw notFound('Output');
    const v = await versionsRepo.findVersion(tx, id, versionId);
    if (!v) throw notFound('Version');
    if (output.output_kind === 'text') {
      return { kind: 'text', text: versionText(v), fileName: displayFileName(`${output.title}-v${v.version_number}`, 'txt') };
    }
    if (!v.fv_storage_path) throw notFound('Image');
    const ext = v.fv_file_name?.includes('.') ? v.fv_file_name.split('.').pop() : 'png';
    const size = v.image_meta?.actualWidth ? `-${v.image_meta.actualWidth}x${v.image_meta.actualHeight}` : '';
    return { kind: 'stored', path: v.fv_storage_path, fileName: displayFileName(`${output.title}-v${v.version_number}${size}`, ext) };
  });
  if (target.kind === 'text') return target;
  const link = await signedUrl(target.path, { downloadName: target.fileName });
  return { kind: 'link', ...link, fileName: target.fileName };
}
