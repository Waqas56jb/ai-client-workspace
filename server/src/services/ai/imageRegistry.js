import sharp from 'sharp';
import { getObject } from '../storage.service.js';
import { logger } from '../../utils/logger.js';

/**
 * "Image 1, Image 2 …" for one conversation — the SAME numbering the chat shows
 * (client/src/lib/imageReferences.js): every picture in the active messages, in the
 * order it first appears; photos the user added and versions the AI made.
 * Each entry points at stored records, never at a URL or a description:
 *   upload    → { fileId }
 *   generated → { outputId, versionId }
 * Runs inside the caller's RLS-scoped transaction, so only this user's visible
 * records of this conversation can appear.
 */

const MAX_MESSAGES = 1000;

async function activeMessages(tx, conversationId) {
  const { rows } = await tx.query(
    `select id, role, content, metadata, created_at
       from public.ai_workspace_messages
      where conversation_id = $1 and role <> 'system' and metadata ->> 'supersededAt' is null
      order by created_at asc, id asc
      limit $2`,
    [conversationId, MAX_MESSAGES],
  );
  return rows;
}

async function filesById(tx, ids) {
  if (!ids.length) return new Map();
  const { rows } = await tx.query(
    `select f.id, f.client_id, f.task_id, f.file_name, f.mime_type, f.file_category,
            coalesce(fv.storage_path, f.storage_path) as object_path, fv.metadata ->> 'previewPath' as preview_path
       from public.ai_workspace_files f
       left join public.ai_workspace_file_versions fv on fv.id = f.current_version_id
      where f.id = any($1::uuid[]) and f.archived_at is null`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function versionsByOutput(tx, outputIds) {
  if (!outputIds.length) return new Map();
  const { rows } = await tx.query(
    `select o.id as output_id, o.title, o.output_kind, v.id, v.version_number, v.image_meta,
            fv.storage_path as object_path, fv.metadata ->> 'previewPath' as preview_path
       from public.ai_workspace_outputs o
       join public.ai_workspace_output_versions v on v.output_id = o.id
       left join public.ai_workspace_file_versions fv on fv.id = v.file_version_id
      where o.id = any($1::uuid[]) and o.archived_at is null
      order by o.id, v.version_number asc`,
    [outputIds],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.output_id)) map.set(r.output_id, { title: r.title, kind: r.output_kind, versions: [] });
    map.get(r.output_id).versions.push(r);
  }
  return map;
}

/**
 * @param {object} tx
 * @param {string|null} conversationId
 * @param {{ pendingAttachments?: object[] }} [opts] images being added with the message now (numbered last)
 * @returns {Promise<{ list: object[], messages: object[] }>}
 */
export async function buildImageRegistry(tx, conversationId, { pendingAttachments = [] } = {}) {
  const messages = conversationId ? await activeMessages(tx, conversationId) : [];
  const fileIds = [...new Set(messages.flatMap((m) => (m.role === 'user' ? m.metadata?.attachmentIds || [] : [])))];
  const outputIds = [...new Set(messages.flatMap((m) => (m.role === 'assistant' ? m.metadata?.outputIds || [] : [])))];
  const [files, outputs] = await Promise.all([filesById(tx, fileIds), versionsByOutput(tx, outputIds)]);

  const list = [];
  const seen = new Set();
  const add = (key, entry) => {
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ ...entry, key, number: list.length + 1, label: `Image ${list.length + 1}` });
  };
  const occurrences = {};
  for (const m of messages) {
    const meta = m.metadata || {};
    if (m.role === 'user') {
      for (const id of meta.attachmentIds || []) {
        const f = files.get(id);
        if (f && f.file_category === 'image') {
          add(`file:${id}`, { kind: 'upload', fileId: id, name: f.file_name, mimeType: f.mime_type, objectPath: f.object_path, previewPath: f.preview_path, messageId: m.id, at: m.created_at });
        }
      }
      continue;
    }
    (meta.outputIds || []).forEach((outputId, i) => {
      const o = outputs.get(outputId);
      if (!o || o.kind !== 'image') return;
      occurrences[outputId] = (occurrences[outputId] || 0) + 1;
      const vid = meta.versionIds?.[i];
      const v = (vid && o.versions.find((x) => x.id === vid)) || o.versions[occurrences[outputId] - 1] || o.versions[o.versions.length - 1];
      if (!v) return;
      const im = v.image_meta || {};
      add(`version:${v.id}`, {
        kind: 'generated',
        outputId,
        versionId: v.id,
        versionNumber: v.version_number,
        name: o.title,
        mimeType: 'image/png',
        objectPath: v.object_path,
        previewPath: v.preview_path,
        width: im.actualWidth ?? im.requestedWidth ?? null,
        height: im.actualHeight ?? im.requestedHeight ?? null,
        editedFrom: im.editedFrom || null,
        messageId: m.id,
        at: m.created_at,
      });
    });
  }
  for (const f of pendingAttachments) {
    if (f.file_category === 'image') add(`file:${f.id}`, { kind: 'upload', fileId: f.id, name: f.file_name, mimeType: f.mime_type, objectPath: f.object_path, previewPath: null, messageId: null, pending: true });
  }
  return { list, messages };
}

/** One line per image for the model ("Image 2 — made by the AI: “Cake”, version 1, 1080×1080"). */
export function describeImage(e) {
  if (e.kind === 'upload') return `${e.label} — photo the user added${e.pending ? ' with THIS message' : ''}: “${e.name}”`;
  const size = e.width && e.height ? `, ${e.width}×${e.height}px` : '';
  const from = e.editedFrom ? `, an edit of ${e.editedFrom}` : '';
  return `${e.label} — made by the AI: “${e.name}”, version ${e.versionNumber}${size}${from}`;
}

/** Finds a registry entry by an explicit reference from the UI ({ fileId } or { outputId, versionId }). */
export function findEntry(registry, ref) {
  if (!ref) return null;
  if (ref.fileId) return registry.list.find((e) => e.fileId === ref.fileId) || null;
  if (ref.versionId) return registry.list.find((e) => e.versionId === ref.versionId && (!ref.outputId || e.outputId === ref.outputId)) || null;
  return null;
}

/**
 * Downloads a picture and returns a small JPEG data URL for a vision model
 * (the preview when there is one). Null when the file can't be read.
 */
export async function imageDataUrl(entry, { maxEdge = 768 } = {}) {
  const path = entry.previewPath || entry.objectPath;
  if (!path) return null;
  try {
    const buf = await getObject(path);
    const jpg = await sharp(buf).rotate().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch (err) {
    logger.warn({ code: err?.code, key: entry.key }, 'image for the vision model could not be loaded');
    return null;
  }
}

const KIND = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/msword': 'old Word (.doc)',
  'application/vnd.ms-excel': 'old Excel (.xls)',
  'text/csv': 'CSV',
  'text/plain': 'text file',
  'text/markdown': 'text file',
};

/**
 * Documents in this chat (everything the user added that is not a picture), in
 * the order they were added, plus those added with the current message.
 * @returns {Promise<Array<{ number, label, fileId, name, mimeType, kind, extract, pending }>>}
 */
export async function buildFileList(tx, messages, pendingAttachments = []) {
  const ids = [...new Set(messages.flatMap((m) => (m.role === 'user' ? m.metadata?.attachmentIds || [] : [])))];
  const rows = ids.length
    ? (
        await tx.query(
          `select f.id, f.file_name, f.mime_type, f.file_category, fv.metadata -> 'extract' as extract
             from public.ai_workspace_files f
             left join public.ai_workspace_file_versions fv on fv.id = f.current_version_id
            where f.id = any($1::uuid[]) and f.archived_at is null`,
          [ids],
        )
      ).rows
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const list = [];
  const add = (f, pending) => {
    if (!f || f.file_category === 'image' || list.some((x) => x.fileId === f.id)) return;
    list.push({ number: list.length + 1, label: `File ${list.length + 1}`, fileId: f.id, name: f.file_name, mimeType: f.mime_type, kind: KIND[f.mime_type] || f.mime_type, extract: f.extract || null, pending });
  };
  ids.forEach((id) => add(byId.get(id), false));
  pendingAttachments.forEach((f) => add(f, true));
  return list;
}

/** One line per file for the model ("File 1 — Word document “x.docx”: read (12,340 characters)"). */
export function describeFile(f) {
  const e = f.extract;
  const status = !e
    ? f.mimeType === 'application/pdf'
      ? 'the model reads it directly'
      : 'reading status unknown'
    : e.status === 'ok'
      ? `read (${Number(e.chars || 0).toLocaleString('en-AU')} characters${e.parts?.length > 1 ? `; ${e.parts.length} parts: ${e.parts.slice(0, 6).map((p) => p.label.split(' (')[0]).join(', ')}` : ''})`
      : e.status === 'partial'
        ? 'partly read (very long — only the first part can be used)'
        : e.status === 'model'
          ? 'the model reads it directly'
          : `could NOT be read — ${e.error || 'unreadable'}`;
  return `${f.label} — ${f.kind} “${f.name}”${f.pending ? ' (added with THIS message)' : ''}: ${status}`;
}
