import crypto from 'node:crypto';
import sharp from 'sharp';
import { AppError, badRequest, notFound } from '../utils/errors.js';
import { iso, toolId, userSummary, clientSummary, jobSummary, taskSummary } from '../utils/mappers.js';
import { TOOL_TO_DB, WRITING_FORMATS } from '../constants/domain.js';
import { buildObjectPath, makePreviewJpeg, putObject, removeObjects, sha256, signedUrl } from './storage.service.js';
import { logger } from '../utils/logger.js';
import * as outputsRepo from '../repositories/outputs.repository.js';
import * as versionsRepo from '../repositories/versions.repository.js';
import * as filesRepo from '../repositories/files.repository.js';

/**
 * Output + version domain service (cross-module interface).
 *
 * Every function takes an OPEN transaction `tx` from `db.withUser(...)` and
 * never opens its own, so callers control atomicity. Versions are immutable:
 * revisions always create a new draft through
 * `ai_workspace_create_output_version`. These functions do not log activity;
 * callers record the event that describes their action.
 *
 * Image outputs keep their pixels in private Storage:
 *   final    → clients/…/versions/<fileId>/<n>/<title>.<ext>
 *   original → clients/…/generated/<fileId>/original-v<n>.<ext>
 * Uploaded objects are removed again when a database write fails.
 */

/** DTO preview links live for an hour because the client caches DTOs; downloads use the short default TTL. */
export const PREVIEW_TTL_SECONDS = 3600;

const IMAGE_MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const IMAGE_META_KEYS = [
  'requestedWidth', 'requestedHeight', 'actualWidth', 'actualHeight', 'presetId', 'prompt',
  'resizeStrategy', 'model', 'generatedWidth', 'generatedHeight',
  // faithful edits: what was edited and how much changed (see execution.service.js)
  'changeCheck', 'inputFidelity', 'editedFrom', 'sourceFileId', 'sourceVersionId', 'editScope',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Plain-text representation of a version (download/search/size). */
export function versionText(v) {
  if (!v) return '';
  const sections = v.sections;
  if (Array.isArray(sections) && sections.length) {
    return sections.map((s) => `${s?.label ?? ''}\n${s?.text ?? ''}`).join('\n\n');
  }
  return v.content || '';
}

/** Human-readable record name ("Spring launch email.txt"); never used as a storage path. */
export function displayFileName(title, ext) {
  const base = String(title || 'Untitled')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || 'Untitled';
  return `${base}.${ext}`;
}

const byteLength = (s) => Buffer.byteLength(s, 'utf8');
const pickImageMeta = (meta) => Object.fromEntries(IMAGE_META_KEYS.filter((k) => meta?.[k] !== undefined).map((k) => [k, meta[k]]));

/** Signs storage paths once per DTO build; a missing object yields null instead of failing the list. */
export function signer() {
  const cache = new Map();
  return (path) => {
    if (!path) return Promise.resolve(null);
    if (!cache.has(path)) {
      cache.set(
        path,
        signedUrl(path, { ttl: PREVIEW_TTL_SECONDS })
          .then((r) => r.url)
          .catch((err) => {
            logger.warn({ code: err?.code }, 'preview link could not be created');
            return null;
          }),
      );
    }
    return cache.get(path);
  };
}

/**
 * Validates an image buffer against the requested dimensions.
 * @throws {AppError} 422 IMAGE_DIMENSION_MISMATCH / INVALID_IMAGE
 */
async function assertImage(image, imageMeta, label) {
  if (!image?.buffer || !Buffer.isBuffer(image.buffer) || !image.buffer.length) {
    throw new AppError('INVALID_IMAGE', `The ${label} image is missing.`, 422);
  }
  if (!IMAGE_MIME_EXT[image.mimeType]) throw new AppError('INVALID_IMAGE', `The ${label} image format is not supported.`, 422);
  let meta;
  try {
    meta = await sharp(image.buffer).metadata();
  } catch {
    throw new AppError('INVALID_IMAGE', `The ${label} image could not be read.`, 422);
  }
  if (meta.width !== image.width || meta.height !== image.height) {
    throw new AppError('IMAGE_DIMENSION_MISMATCH', `The ${label} image is ${meta.width}×${meta.height}, not the declared ${image.width}×${image.height}.`, 422);
  }
  if (imageMeta && (image.width !== imageMeta.requestedWidth || image.height !== imageMeta.requestedHeight)) {
    throw new AppError(
      'IMAGE_DIMENSION_MISMATCH',
      `The final image is ${image.width}×${image.height} but ${imageMeta.requestedWidth}×${imageMeta.requestedHeight} was requested.`,
      422,
    );
  }
}

async function validateImages({ finalImage, originalImage, imageMeta }) {
  if (!imageMeta || !Number.isInteger(imageMeta.requestedWidth) || !Number.isInteger(imageMeta.requestedHeight)) {
    throw badRequest('Requested image dimensions are required.');
  }
  await assertImage(finalImage, imageMeta, 'final');
  if (originalImage) await assertImage(originalImage, null, 'original');
}

/**
 * Uploads final (+ original) pixels for file version `versionNumber`, inserts
 * the immutable file version and makes it the file's current version.
 * Removes uploaded objects if any database write fails.
 */
async function storeImageVersion(tx, { userId, scope, fileId, versionNumber, title, finalImage, originalImage, imageMeta, note, createFileRow }) {
  const ext = IMAGE_MIME_EXT[finalImage.mimeType];
  const finalPath = buildObjectPath({ kind: 'versions', ...scope, fileId, versionNumber, fileName: `${title}.${ext}` });
  const originalPath = originalImage
    ? buildObjectPath({ kind: 'generated', ...scope, fileId, fileName: `original-v${versionNumber}.${IMAGE_MIME_EXT[originalImage.mimeType]}` })
    : null;

  const uploaded = [];
  try {
    await putObject(finalPath, finalImage.buffer, finalImage.mimeType);
    uploaded.push(finalPath);
    if (originalPath) {
      await putObject(originalPath, originalImage.buffer, originalImage.mimeType);
      uploaded.push(originalPath);
    }
    // A small JPEG for fast on-screen previews; failure here never blocks saving the image.
    let previewPath = null;
    try {
      const candidate = buildObjectPath({ kind: 'versions', ...scope, fileId, versionNumber, fileName: 'preview.jpg' });
      await putObject(candidate, await makePreviewJpeg(finalImage.buffer), 'image/jpeg');
      uploaded.push(candidate);
      previewPath = candidate;
    } catch (err) {
      logger.warn({ code: err?.code }, 'image preview could not be created');
    }

    const checksum = sha256(finalImage.buffer);
    const fileName = displayFileName(title, ext);
    if (createFileRow) await createFileRow({ finalPath, checksum, fileName, ext });

    const fileVersion = await filesRepo.insertFileVersion(tx, {
      fileId,
      versionNumber,
      storagePath: finalPath,
      fileName,
      mimeType: finalImage.mimeType,
      size: finalImage.buffer.length,
      checksum,
      note,
      userId,
      metadata: {
        ...pickImageMeta(imageMeta),
        actualWidth: finalImage.width,
        actualHeight: finalImage.height,
        originalPath,
        previewPath,
        originalMimeType: originalImage?.mimeType || null,
        originalWidth: originalImage?.width ?? null,
        originalHeight: originalImage?.height ?? null,
        originalChecksum: originalImage ? sha256(originalImage.buffer) : null,
        originalSize: originalImage?.buffer.length ?? null,
      },
    });
    await filesRepo.setCurrentFileVersion(tx, fileId, fileVersion, userId);
    // Lets the caller remove these objects if its surrounding transaction fails later.
    if (Array.isArray(tx.uploadedObjects)) tx.uploadedObjects.push(...uploaded);
    return fileVersion;
  } catch (err) {
    await removeObjects(uploaded);
    throw err;
  }
}

function imageMetaFor(imageMeta, finalImage) {
  return { ...pickImageMeta(imageMeta), actualWidth: finalImage.width, actualHeight: finalImage.height };
}

/** Keeps the output's file record in step with the new current version. */
async function syncOutputFile(tx, output, versionRow, userId) {
  if (!output.file_id) return;
  if (output.output_kind === 'text') {
    await filesRepo.updateFileSize(tx, output.file_id, byteLength(versionText(versionRow)), userId);
  } else if (versionRow.file_version_id) {
    const fv = await filesRepo.findFileVersion(tx, output.file_id, versionRow.file_version_id);
    if (fv) await filesRepo.setCurrentFileVersion(tx, output.file_id, fv, userId);
  }
}

async function lockOutput(tx, outputId, kind) {
  const output = await outputsRepo.findOutputRow(tx, outputId, { forUpdate: true });
  if (!output) throw notFound('Output');
  if (kind && output.output_kind !== kind) throw badRequest(`This output is not a ${kind} output.`);
  return output;
}

function taskScope(task) {
  if (!task?.id || !task?.job_id || !task?.client_id) throw badRequest('A task with job and client is required.');
  return { clientId: task.client_id, jobId: task.job_id, taskId: task.id };
}

// ── Creation ─────────────────────────────────────────────────────────────────

/**
 * Creates a text output, its generated file record (no storage object) and v1.
 * @param {import('../config/db.js').Tx} tx
 * @param {{ userId: string, task: { id: string, job_id: string, client_id: string }, conversationId?: string|null,
 *   tool: 'writing'|'advertising'|'vehicle', outputType: 'email'|'sms'|'whatsapp'|'other'|'advertising'|'vehicle',
 *   title: string, content?: string, sections?: Array<{label: string, text: string}>|null, missing?: string[]|null, note?: string }} input
 * @returns {Promise<{ outputId: string, versionId: string, fileId: string }>}
 */
export async function createTextOutput(tx, { userId, task, conversationId = null, tool, outputType, title, content = '', sections = null, missing = null, note = '' }) {
  const scope = taskScope(task);
  const toolType = TOOL_TO_DB[tool];
  if (!toolType || tool === 'image') throw badRequest('Unsupported tool for a text output.');
  const safeTitle = String(title || 'Untitled').trim().slice(0, 160) || 'Untitled';

  const output = await outputsRepo.insertOutput(tx, { ...scope, conversationId, toolType, kind: 'text', outputType, title: safeTitle, userId });
  const text = versionText({ content, sections });
  const file = await filesRepo.insertFile(tx, {
    id: crypto.randomUUID(),
    ...scope,
    conversationId,
    outputId: output.id,
    fileName: displayFileName(safeTitle, 'txt'),
    mimeType: 'text/plain',
    size: byteLength(text),
    category: 'text',
    sourceType: 'generated',
    approvalStatus: 'draft',
    userId,
  });
  await outputsRepo.setOutputFile(tx, output.id, file.id);
  const version = await versionsRepo.createOutputVersion(tx, {
    outputId: output.id,
    content: content ?? '',
    sections,
    missing,
    note: note || 'Initial generation',
  });
  return { outputId: output.id, versionId: version.id, fileId: file.id };
}

/**
 * Creates an image output: stores the final (and optional original) pixels,
 * the file record, file version 1, the output and output version 1.
 * The final image MUST be exactly the requested size (422 IMAGE_DIMENSION_MISMATCH otherwise; nothing is stored).
 * @param {import('../config/db.js').Tx} tx
 * @param {{ userId: string, task: { id: string, job_id: string, client_id: string }, conversationId?: string|null, title: string,
 *   finalImage: { buffer: Buffer, mimeType: string, width: number, height: number },
 *   originalImage?: { buffer: Buffer, mimeType: string, width: number, height: number },
 *   imageMeta: { requestedWidth: number, requestedHeight: number, presetId?: string, prompt?: string, resizeStrategy?: string, model?: string, generatedWidth?: number, generatedHeight?: number },
 *   note?: string }} input
 * @returns {Promise<{ outputId: string, versionId: string, fileId: string, fileVersionId: string }>}
 */
export async function createImageOutput(tx, { userId, task, conversationId = null, title, finalImage, originalImage = null, imageMeta, note = '' }) {
  const scope = taskScope(task);
  await validateImages({ finalImage, originalImage, imageMeta });
  const safeTitle = String(title || 'Untitled image').trim().slice(0, 160) || 'Untitled image';
  const fileId = crypto.randomUUID();

  let output;
  const fileVersion = await storeImageVersion(tx, {
    userId,
    scope,
    fileId,
    versionNumber: 1,
    title: safeTitle,
    finalImage,
    originalImage,
    imageMeta,
    note: note || 'Initial generation',
    createFileRow: async ({ finalPath, checksum, fileName }) => {
      output = await outputsRepo.insertOutput(tx, { ...scope, conversationId, toolType: TOOL_TO_DB.image, kind: 'image', outputType: 'image', title: safeTitle, userId });
      await filesRepo.insertFile(tx, {
        id: fileId,
        ...scope,
        conversationId,
        outputId: output.id,
        fileName,
        storagePath: finalPath,
        mimeType: finalImage.mimeType,
        size: finalImage.buffer.length,
        checksum,
        category: 'image',
        sourceType: 'generated',
        approvalStatus: 'draft',
        userId,
      });
      await outputsRepo.setOutputFile(tx, output.id, fileId);
    },
  });

  // Paths were uploaded above; a failure here must also remove them.
  try {
    const version = await versionsRepo.createOutputVersion(tx, {
      outputId: output.id,
      imageMeta: imageMetaFor(imageMeta, finalImage),
      fileVersionId: fileVersion.id,
      note: note || 'Initial generation',
    });
    return { outputId: output.id, versionId: version.id, fileId, fileVersionId: fileVersion.id };
  } catch (err) {
    await removeObjects([fileVersion.storage_path, fileVersion.metadata?.originalPath].filter(Boolean));
    throw err;
  }
}

// ── Revisions ────────────────────────────────────────────────────────────────

/**
 * Adds a new DRAFT version to a text output (never modifies existing versions).
 * Omitted fields are copied from `sourceVersionId` (or the current version).
 * @returns {Promise<{ versionId: string }>}
 */
export async function addTextRevision(tx, { userId, outputId, content = null, sections = null, missing = null, note = '', sourceVersionId = null }) {
  const output = await lockOutput(tx, outputId, 'text');
  const row = await versionsRepo.createOutputVersion(tx, { outputId, content, sections, missing, note: note || 'Revision', sourceVersionId });
  await syncOutputFile(tx, output, row, userId);
  return { versionId: row.id };
}

/**
 * Adds a new DRAFT version with new pixels to an image output.
 * @returns {Promise<{ versionId: string, fileVersionId: string }>}
 */
export async function addImageRevision(tx, { userId, outputId, finalImage, originalImage = null, imageMeta, note = '' }) {
  await validateImages({ finalImage, originalImage, imageMeta });
  const output = await lockOutput(tx, outputId, 'image');
  if (!output.file_id) throw new AppError('INVALID_STATE', 'This image output has no file record.', 409);
  const versionNumber = await filesRepo.nextFileVersionNumber(tx, output.file_id);
  const scope = { clientId: output.client_id, jobId: output.job_id, taskId: output.task_id };
  const fileVersion = await storeImageVersion(tx, {
    userId,
    scope,
    fileId: output.file_id,
    versionNumber,
    title: output.title,
    finalImage,
    originalImage,
    imageMeta,
    note: note || 'Revision',
  });
  try {
    const row = await versionsRepo.createOutputVersion(tx, {
      outputId,
      imageMeta: imageMetaFor(imageMeta, finalImage),
      fileVersionId: fileVersion.id,
      note: note || 'Revision',
    });
    return { versionId: row.id, fileVersionId: fileVersion.id };
  } catch (err) {
    await removeObjects([fileVersion.storage_path, fileVersion.metadata?.originalPath].filter(Boolean));
    throw err;
  }
}

/**
 * Copies an earlier version (text or image) into a NEW draft version.
 * @returns {Promise<{ versionId: string }>}
 */
export async function restoreVersion(tx, { userId, outputId, sourceVersionId, note = '' }) {
  const output = await lockOutput(tx, outputId);
  const source = await versionsRepo.findVersion(tx, outputId, sourceVersionId);
  if (!source) throw notFound('Version');
  const row = await versionsRepo.createOutputVersion(tx, {
    outputId,
    note: note || `Restored from v${source.version_number}`,
    sourceVersionId,
  });
  await syncOutputFile(tx, output, row, userId);
  return { versionId: row.id };
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** Version row (from versions.repository) → Version DTO. */
export async function toVersionDto(row, sign = signer()) {
  let image = null;
  if (row.output_kind === 'image') {
    image = {
      ...pickImageMeta(row.image_meta || {}),
      fileVersionId: row.file_version_id || null,
      previewUrl: await sign(row.fv_metadata?.previewPath || row.fv_storage_path),
    };
  }
  return {
    id: row.id,
    outputId: row.output_id,
    versionNumber: row.version_number,
    kind: row.output_kind,
    title: row.title,
    content: row.content,
    sections: Array.isArray(row.sections) && row.sections.length ? row.sections : null, // an empty list means plain text, not 0 sections
    image,
    missing: row.missing_info ?? null,
    note: row.revision_note,
    status: row.approval_status,
    approvedAt: iso(row.approved_at),
    approvedBy: row.approved_by || null,
    sourceVersionId: row.source_version_id || null,
    createdAt: iso(row.created_at),
    createdBy: row.created_by || null,
    createdByUser: userSummary(row, 'creator_'),
    approvedByUser: userSummary(row, 'approver_'),
  };
}

function toOutputDto(row, { currentVersion, approvedVersion, versions }) {
  return {
    id: row.id,
    taskId: row.task_id,
    jobId: row.job_id,
    clientId: row.client_id,
    conversationId: row.conversation_id || null,
    tool: toolId(row.tool_type),
    kind: row.output_kind,
    title: row.title,
    format: WRITING_FORMATS.includes(row.output_type) ? row.output_type : null,
    outputType: row.output_type,
    currentVersionId: row.current_version_id || null,
    approvedVersionId: row.approved_version_id || null,
    fileId: row.file_id || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by || null,
    status: row.approved_version_id ? 'approved' : 'draft',
    pendingRevision: !!row.approved_version_id && row.current_version_id !== row.approved_version_id,
    versionCount: row.version_count ?? 0,
    client: clientSummary(row),
    job: jobSummary(row),
    task: taskSummary(row),
    createdByUser: userSummary(row, 'creator_'),
    currentVersion: currentVersion || null,
    approvedVersion: approvedVersion || null,
    ...(versions ? { versions } : {}),
  };
}

/**
 * Builds Output DTOs for output rows from outputs.repository (keeps order).
 * @param {import('../config/db.js').Tx} tx
 * @param {object[]} rows
 * @param {{ withVersions?: boolean }} [opts]
 */
export async function buildOutputDtos(tx, rows, { withVersions = false } = {}) {
  if (!rows.length) return [];
  const sign = signer();
  const versionRows = withVersions
    ? await versionsRepo.listVersionsByOutputIds(tx, rows.map((r) => r.id))
    : await versionsRepo.listVersionsByIds(tx, rows.flatMap((r) => [r.current_version_id, r.approved_version_id]));
  const dtos = new Map(await Promise.all(versionRows.map(async (v) => [v.id, await toVersionDto(v, sign)])));
  const byOutput = new Map();
  versionRows.forEach((v) => {
    if (!byOutput.has(v.output_id)) byOutput.set(v.output_id, []);
    byOutput.get(v.output_id).push(dtos.get(v.id));
  });
  return rows.map((row) => {
    const list = byOutput.get(row.id) || [];
    const currentVersion = dtos.get(row.current_version_id) || list[list.length - 1] || null;
    return toOutputDto(row, {
      currentVersion,
      approvedVersion: dtos.get(row.approved_version_id) || null,
      versions: withVersions ? [...list].sort((a, b) => a.versionNumber - b.versionNumber) : undefined,
    });
  });
}

/**
 * Output DTO by id (RLS-scoped). Image versions include a short-lived `image.previewUrl`.
 * @param {import('../config/db.js').Tx} tx
 * @param {string} outputId
 * @param {{ withVersions?: boolean }} [opts]
 * @throws {AppError} 404 when the output does not exist or is archived
 */
export async function getOutputDto(tx, outputId, { withVersions = true } = {}) {
  const row = await outputsRepo.findOutputById(tx, outputId);
  if (!row) throw notFound('Output');
  const [dto] = await buildOutputDtos(tx, [row], { withVersions });
  return dto;
}
