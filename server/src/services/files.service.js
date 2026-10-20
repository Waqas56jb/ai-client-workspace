import crypto from 'node:crypto';
import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as filesRepo from '../repositories/files.repository.js';
import * as outputsRepo from '../repositories/outputs.repository.js';
import * as versionsRepo from '../repositories/versions.repository.js';
import * as approvalsRepo from '../repositories/approvals.repository.js';
import { detectFile } from '../utils/fileDetection.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { clientSummary, iso, jobSummary, pageMeta, pagination, rangeInterval, taskSummary, userSummary } from '../utils/mappers.js';
import { buildObjectPath, makePreviewJpeg, putObject, removeObjects, sha256, signedUrl } from './storage.service.js';
import { logger } from '../utils/logger.js';
import { buildOutputDtos, displayFileName, signer, toVersionDto, versionText } from './output.service.js';

/**
 * Files & storage: uploads (content-verified), listing, signed download and
 * preview links, metadata edits, archiving and physical file versions.
 * Every lookup runs under RLS before any Storage call; storage paths are
 * always built server-side and never accepted from or returned to clients.
 */

const PREVIEWABLE_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PREVIEWABLE = [...PREVIEWABLE_IMAGES, 'application/pdf', 'text/plain', 'text/markdown', 'text/csv'];
/** Lists return the full filtered set unless the client pages explicitly. */
export const LIST_LIMITS = { defaultLimit: 200, maxLimit: 500 };
const CATEGORY_TO_SOURCE = { reference: 'reference', attachment: 'attachment', logo: 'logo', output: 'generated' };
const SOURCE_TO_CATEGORY = { reference: 'reference', attachment: 'attachment', logo: 'logo', generated: 'output' };

/** Sanitised display name for an uploaded file (record only, never a path). */
function uploadDisplayName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop();
  return base.replace(/[\x00-\x1f<>:"|?*]/g, '').trim().slice(-255) || 'file';
}

/** Content-Disposition value with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(fileName, type = 'attachment') {
  const name = String(fileName || 'download').replace(/[\x00-\x1f\\/"]/g, '').trim() || 'download';
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[%;]/g, '') || 'download';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function textDownloadName(output, version) {
  return displayFileName(`${output.title}-v${version.version_number}`, 'txt');
}

// ── DTO ──────────────────────────────────────────────────────────────────────

/**
 * File rows (files.repository FILE_SELECT) → File DTOs, attaching enriched outputs.
 * @param {import('../config/db.js').Tx} tx
 */
export async function buildFileDtos(tx, rows, { withOutputVersions = false, withPreview = true } = {}) {
  const sign = signer();
  const outputIds = [...new Set(rows.map((r) => r.output_id).filter(Boolean))];
  const outputRows = await outputsRepo.findOutputsByIds(tx, outputIds);
  const outputs = new Map((await buildOutputDtos(tx, outputRows, { withVersions: withOutputVersions })).map((o) => [o.id, o]));

  return Promise.all(
    rows.map(async (f) => {
      const output = f.output_id ? outputs.get(f.output_id) || null : null;
      let previewUrl;
      if (withPreview && f.storage_path && PREVIEWABLE_IMAGES.includes(f.mime_type)) {
        previewUrl = await sign(f.storage_path);
      }
      return {
        id: f.id,
        name: f.file_name,
        kind: f.file_category,
        mimeType: f.mime_type,
        size: Number(f.file_size_bytes),
        clientId: f.client_id,
        jobId: f.job_id || null,
        taskId: f.task_id || null,
        outputId: f.output_id || null,
        category: SOURCE_TO_CATEGORY[f.source_type] || f.source_type,
        storage: 'supabase',
        description: f.description,
        checksum: f.file_checksum || null,
        approvalStatus: f.approval_status,
        archived: !!f.archived_at,
        archivedAt: iso(f.archived_at),
        createdAt: iso(f.created_at),
        updatedAt: iso(f.updated_at),
        createdBy: f.created_by || null,
        client: clientSummary(f),
        job: jobSummary(f),
        task: taskSummary(f),
        createdByUser: userSummary(f, 'creator_'),
        status: output ? output.status : null,
        pendingRevision: output ? output.pendingRevision : false,
        lastRevisionAt: output ? output.updatedAt : iso(f.updated_at),
        versionCount: output ? output.versionCount : f.file_version_count || 1,
        output,
        conversation: f.conversation_id_ref ? { id: f.conversation_id_ref, title: f.conversation_title, taskId: f.conversation_task_id } : null,
        ...(previewUrl !== undefined ? { previewUrl } : {}),
      };
    }),
  );
}

/** Physical file version row → DTO (storage paths are never exposed). */
function toFileVersionDto(v) {
  const { originalPath, ...meta } = v.metadata || {};
  return {
    id: v.id,
    fileId: v.file_id,
    versionNumber: v.version_number,
    fileName: v.file_name,
    mimeType: v.mime_type,
    size: Number(v.file_size_bytes),
    checksum: v.file_checksum,
    metadata: { ...meta, hasOriginal: !!originalPath },
    note: v.revision_note,
    status: v.approval_status,
    approvedAt: iso(v.approved_at),
    approvedBy: v.approved_by || null,
    createdAt: iso(v.created_at),
    createdBy: v.created_by || null,
    createdByUser: userSummary(v, 'creator_'),
    approvedByUser: userSummary(v, 'approver_'),
  };
}

async function loadFile(tx, id) {
  const row = await filesRepo.findFileById(tx, id);
  if (!row) throw notFound('File');
  return row;
}

async function fileDto(tx, id, opts = { withOutputVersions: true, withPreview: true }) {
  const [dto] = await buildFileDtos(tx, [await loadFile(tx, id)], opts);
  return dto;
}

// ── Upload ───────────────────────────────────────────────────────────────────

/** Validates client/job/task scope and returns the normalised { clientId, jobId, taskId }. */
async function resolveScope(tx, { clientId, jobId, taskId }) {
  const client = await filesRepo.findClient(tx, clientId);
  if (!client) throw badRequest('The selected client does not exist.');
  if (client.archived_at || client.status === 'archived') throw badRequest('Files cannot be uploaded to an archived client.');

  if (taskId) {
    const task = await filesRepo.findTask(tx, taskId);
    if (!task || task.archived_at) throw badRequest('The selected task does not exist.');
    if (task.client_id !== clientId) throw badRequest('The task does not belong to the selected client.');
    if (jobId && jobId !== task.job_id) throw badRequest('The task does not belong to the selected job.');
    return { clientId, jobId: task.job_id, taskId };
  }
  if (jobId) {
    const job = await filesRepo.findJob(tx, jobId);
    if (!job || job.archived_at) throw badRequest('The selected job does not exist.');
    if (job.client_id !== clientId) throw badRequest('The job does not belong to the selected client.');
  }
  return { clientId, jobId: jobId || null, taskId: null };
}

/**
 * Uploads a verified file: Storage object + file record + file version 1
 * (+ brand asset for reference/logo uploads), atomically.
 * @param {{ id: string }} user
 * @param {{ buffer: Buffer, mimetype: string, originalname: string, size: number }} file — multer file
 * @param {{ clientId: string, jobId?: string, taskId?: string, category: 'reference'|'attachment'|'logo', description?: string }} input
 */
export async function uploadFile(user, file, input) {
  if (!file?.buffer) throw badRequest('Choose a file to upload.');
  const detected = await detectFile({ buffer: file.buffer, declaredMime: file.mimetype, originalName: file.originalname });
  if (input.category === 'logo' && detected.category !== 'image') {
    throw new AppError('UNSUPPORTED_FILE_TYPE', 'Logos must be PNG, JPG, WebP or GIF images.', 415);
  }
  const displayName = uploadDisplayName(file.originalname);
  const checksum = sha256(file.buffer);
  const fileId = crypto.randomUUID();
  let uploadedPath = null;
  let previewPath = null;

  try {
    return await getDatabase().withUser(user.id, async (tx) => {
      const scope = await resolveScope(tx, input);
      const path = buildObjectPath({ kind: input.category === 'attachment' ? 'originals' : 'references', ...scope, fileId, fileName: displayName });
      await putObject(path, file.buffer, detected.mimeType);
      uploadedPath = path;
      if (detected.category === 'image') {
        // Small JPEG for fast thumbnails; the original is always what gets downloaded or sent to the AI.
        try {
          const candidate = buildObjectPath({ kind: input.category === 'attachment' ? 'originals' : 'references', ...scope, fileId, fileName: 'preview.jpg' });
          await putObject(candidate, await makePreviewJpeg(file.buffer), 'image/jpeg');
          previewPath = candidate;
        } catch (e) {
          logger.warn({ code: e?.code }, 'upload preview could not be created');
        }
      }

      await filesRepo.insertFile(tx, {
        id: fileId,
        ...scope,
        fileName: displayName,
        originalFileName: displayName,
        description: input.description || '',
        storagePath: path,
        mimeType: detected.mimeType,
        size: file.buffer.length,
        checksum,
        category: detected.category,
        sourceType: CATEGORY_TO_SOURCE[input.category],
        userId: user.id,
      });
      const fv = await filesRepo.insertFileVersion(tx, {
        fileId,
        versionNumber: 1,
        storagePath: path,
        fileName: displayName,
        mimeType: detected.mimeType,
        size: file.buffer.length,
        checksum,
        note: 'Original upload',
        userId: user.id,
        metadata: { originalFileName: displayName, ...(previewPath ? { previewPath } : {}) },
      });
      await filesRepo.setCurrentFileVersion(tx, fileId, fv, user.id);

      if (input.category !== 'attachment') {
        const assetType = input.category === 'logo' ? 'logo' : detected.category === 'image' ? 'reference_image' : 'reference_document';
        await filesRepo.insertBrandAsset(tx, { clientId: scope.clientId, assetType, title: displayName, description: input.description, fileId, userId: user.id });
      }

      await logActivity(tx, {
        userId: user.id,
        type: ACTIVITY.FILE_UPLOADED,
        resourceType: 'file',
        resourceId: fileId,
        ...scope,
        description: `Uploaded “${displayName}”`,
        metadata: { category: input.category, mimeType: detected.mimeType, size: file.buffer.length },
      });
      return fileDto(tx, fileId);
    });
  } catch (err) {
    if (uploadedPath) await removeObjects([uploadedPath, previewPath].filter(Boolean));
    throw err;
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Paginated file list → { data, meta }. */
export async function listFiles(user, q) {
  const page = pagination(q, LIST_LIMITS);
  return getDatabase().withUser(user.id, async (tx) => {
    const { rows, total } = await filesRepo.listFiles(
      tx,
      {
        ...q,
        category: q.category ? CATEGORY_TO_SOURCE[q.category] : undefined,
        interval: rangeInterval(q.dateRange),
      },
      page,
    );
    return { data: await buildFileDtos(tx, rows), meta: pageMeta(page, total) };
  });
}

/** One file with its output (all versions), conversation and an image preview link. */
export async function getFile(user, id) {
  return getDatabase().withUser(user.id, (tx) => fileDto(tx, id));
}

/**
 * Resolves the version to download for a file.
 * `versionId` may be a physical file version id or (for outputs) an output version id.
 */
async function resolveDownloadTarget(tx, file, versionId) {
  if (file.output_id) {
    const output = await outputsRepo.findOutputRow(tx, file.output_id);
    if (!output) throw notFound('Output');
    let version;
    if (versionId) {
      version = await versionsRepo.findVersion(tx, output.id, versionId);
      if (!version && output.output_kind === 'image') {
        const fv = await filesRepo.findFileVersion(tx, file.id, versionId);
        if (fv) return { kind: 'stored', path: fv.storage_path, fileName: fv.file_name };
      }
      if (!version) throw notFound('Version');
    } else {
      version = await versionsRepo.findVersion(tx, output.id, output.current_version_id);
      if (!version) throw notFound('Version');
    }
    if (output.output_kind === 'text') {
      return { kind: 'text', text: versionText(version), fileName: textDownloadName(output, version) };
    }
    if (!version.fv_storage_path) throw notFound('Image');
    return { kind: 'stored', path: version.fv_storage_path, fileName: displayFileName(`${output.title}-v${version.version_number}`, version.fv_file_name?.split('.').pop() || 'png') };
  }
  if (versionId) {
    const fv = await filesRepo.findFileVersion(tx, file.id, versionId);
    if (!fv) throw notFound('Version');
    return { kind: 'stored', path: fv.storage_path, fileName: file.file_name };
  }
  if (!file.storage_path) throw notFound('File content');
  return { kind: 'stored', path: file.storage_path, fileName: file.file_name };
}

/**
 * Download target for a file: `{ kind: 'text', text, fileName }` for text outputs
 * (sent directly) or `{ kind: 'link', url, expiresAt, fileName }` (signed, attachment).
 */
export async function downloadFile(user, id, { versionId } = {}) {
  const target = await getDatabase().withUser(user.id, async (tx) => resolveDownloadTarget(tx, await loadFile(tx, id), versionId));
  if (target.kind === 'text') return target;
  const link = await signedUrl(target.path, { downloadName: target.fileName });
  return { kind: 'link', ...link, fileName: target.fileName };
}

/**
 * Inline preview link for images, PDFs and stored text files. Text outputs
 * return their current content instead of a link. Other types → 415.
 */
export async function previewFile(user, id) {
  const result = await getDatabase().withUser(user.id, async (tx) => {
    const file = await loadFile(tx, id);
    if (file.output_id && file.output_kind === 'text') {
      const target = await resolveDownloadTarget(tx, file, null);
      return { inline: { url: null, expiresAt: null, mimeType: 'text/plain', content: target.text } };
    }
    if (!file.storage_path || !PREVIEWABLE.includes(file.mime_type)) {
      throw new AppError('UNSUPPORTED_FILE_TYPE', 'This file type cannot be previewed. Download it instead.', 415);
    }
    return { path: file.storage_path, mimeType: file.mime_type };
  });
  if (result.inline) return result.inline;
  const link = await signedUrl(result.path);
  return { ...link, mimeType: result.mimeType };
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Renames / re-describes a file. Generated output files also rename the output. */
export async function updateFile(user, id, patch) {
  return getDatabase().withUser(user.id, async (tx) => {
    const file = await filesRepo.findFileRow(tx, id, { forUpdate: true });
    if (!file) throw notFound('File');
    if (file.archived_at) throw conflict('Archived files cannot be edited.');

    let fileName = patch.name;
    if (fileName !== undefined && file.output_id) {
      const output = await outputsRepo.findOutputRow(tx, file.output_id);
      const ext = file.file_name.includes('.') ? file.file_name.split('.').pop() : output?.output_kind === 'image' ? 'png' : 'txt';
      const title = fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim().slice(0, 160) || output?.title || 'Untitled';
      fileName = displayFileName(title, ext);
      if (output) await outputsRepo.updateOutputTitle(tx, output.id, title, user.id);
    }
    await filesRepo.updateFileDetails(tx, id, { fileName, description: patch.description }, user.id);
    if (fileName !== undefined && fileName !== file.file_name) {
      await logActivity(tx, {
        userId: user.id,
        type: ACTIVITY.FILE_RENAMED,
        resourceType: 'file',
        resourceId: id,
        clientId: file.client_id,
        jobId: file.job_id,
        taskId: file.task_id,
        description: `Renamed a file to “${fileName}”`,
      });
    }
    return fileDto(tx, id);
  });
}

/** Archives an uploaded/reference file. Storage objects and versions are kept. */
export async function archiveFile(user, id) {
  return getDatabase().withUser(user.id, async (tx) => {
    const file = await filesRepo.findFileRow(tx, id, { forUpdate: true });
    if (!file) throw notFound('File');
    if (file.output_id) throw conflict('Generated outputs keep their revision history and cannot be archived from the library.');
    if (!file.archived_at) {
      await filesRepo.archiveFile(tx, id, user.id);
      await logActivity(tx, {
        userId: user.id,
        type: ACTIVITY.FILE_DELETED,
        resourceType: 'file',
        resourceId: id,
        clientId: file.client_id,
        jobId: file.job_id,
        taskId: file.task_id,
        description: `Archived “${file.file_name}”`,
      });
    }
    return fileDto(tx, id);
  });
}

/**
 * Versions of a file: output versions (Version DTOs) for generated outputs,
 * physical file versions otherwise.
 */
export async function listFileVersions(user, id) {
  return getDatabase().withUser(user.id, async (tx) => {
    const file = await loadFile(tx, id);
    if (file.output_id) {
      const rows = await versionsRepo.listVersionsByOutputIds(tx, [file.output_id]);
      return Promise.all(rows.map((r) => toVersionDto(r)));
    }
    return (await filesRepo.listFileVersions(tx, id)).map(toFileVersionDto);
  });
}

/** Approves a physical version of a non-output task file. Returns the File DTO. */
export async function approveFileVersion(user, id, versionId, notes = '') {
  return getDatabase().withUser(user.id, async (tx) => {
    const file = await loadFile(tx, id);
    if (file.output_id) throw badRequest('Approve generated outputs through their output version.');
    if (!(await filesRepo.findFileVersion(tx, id, versionId))) throw notFound('Version');
    await approvalsRepo.approveFileVersion(tx, id, versionId, notes);
    await logActivity(tx, {
      userId: user.id,
      type: ACTIVITY.OUTPUT_APPROVED,
      resourceType: 'file',
      resourceId: id,
      clientId: file.client_id,
      jobId: file.job_id,
      taskId: file.task_id,
      description: `Approved “${file.file_name}”`,
    });
    return fileDto(tx, id);
  });
}
