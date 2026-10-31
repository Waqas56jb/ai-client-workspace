import { DEFAULT_INSTRUCTIONS } from '../../constants/defaults.js';
import { TOOL_TO_DB } from '../../constants/domain.js';
import { MAX_REFERENCE_CHARS, MAX_REFERENCE_TOTAL_CHARS } from '../../constants/files.js';
import { extractDocument } from '../documents.service.js';
import { AppError, badRequest, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { getObject } from '../storage.service.js';
import * as runsRepo from '../../repositories/generationRuns.repository.js';
import { getConversationScoped, listMessagesForContext } from '../../repositories/messages.repository.js';
import { getInstructionRow } from '../../repositories/instructions.repository.js';
import { getPresetRow } from '../../repositories/presets.repository.js';
import { normaliseInstruction } from './prompt.builder.js';
import { buildImageRegistry } from './imageRegistry.js';
import { latestSummary } from './memory.service.js';

/**
 * Resolves TRUSTED generation context from the database inside the caller's
 * RLS-scoped transaction. The client is always derived from the task — never
 * from the request — and every other record (conversation, attachments,
 * preset) must belong to that same client.
 */

export const REFERENCE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

/** task → job → client. 404 when the task does not exist (or is archived). */
export async function loadTaskScope(tx, taskId) {
  const scope = await runsRepo.getTaskScope(tx, taskId);
  if (!scope) throw notFound('Task');
  return scope;
}

/** The saved tool instruction (or the default template). Inactive → 409 TOOL_INACTIVE. */
export async function loadInstruction(tx, tool, { requireActive = true } = {}) {
  const dbTool = TOOL_TO_DB[tool];
  const row = await getInstructionRow(tx, dbTool);
  const instruction = normaliseInstruction(row, DEFAULT_INSTRUCTIONS[dbTool]);
  if (requireActive && !instruction.active) {
    throw new AppError('TOOL_INACTIVE', `${instruction.name} is turned off in AI Instructions. Re-activate it to generate.`, 409);
  }
  return instruction;
}

/** Conversation must belong to the task. Returns the conversation row. */
export async function loadConversationForTask(tx, conversationId, task) {
  const conv = await getConversationScoped(tx, conversationId);
  if (!conv || conv.archived_at || conv.task_id !== task.id) throw notFound('Conversation');
  return conv;
}

/** Preset: global or owned by the task's client, and active. */
export async function loadPreset(tx, presetId, client) {
  if (!presetId) return null;
  const preset = await getPresetRow(tx, presetId);
  if (!preset || preset.is_active === false || (preset.client_id && preset.client_id !== client.id)) throw notFound('Preset');
  return preset;
}

/**
 * Attachments must be files of the SAME client, attached to the same task or
 * client/job-level references of that client. Anything else is reported as
 * "not found" (no information about other clients' files is leaked).
 */
export async function loadAttachments(tx, attachmentIds, task) {
  const ids = [...new Set(attachmentIds || [])];
  if (!ids.length) return [];
  const rows = await runsRepo.getFilesWithPaths(tx, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const f = byId.get(id);
    const sameClient = f && f.client_id === task.client_id;
    const inScope = f && (f.task_id === task.id || (!f.task_id && (!f.job_id || f.job_id === task.job_id)));
    if (!sameClient || !inScope) throw notFound('Attachment');
    return f;
  });
}

/** Last 10 messages of the conversation (no error/status messages). */
/** Conversation memory: the last 20 exchanges (40 messages) of this conversation only. */
export const HISTORY_MESSAGES = 40;

export async function loadHistory(tx, conversationId, { excludeIds = [] } = {}) {
  if (!conversationId) return [];
  const rows = (await listMessagesForContext(tx, conversationId, HISTORY_MESSAGES + excludeIds.length)).filter(
    (m) => !excludeIds.includes(m.id) && m.message_type !== 'error',
  );
  // The assistant's chat reply is only a summary ("Here is an email…"); the memory must
  // carry the draft it actually produced, so follow-ups like "make it shorter" work.
  const outputIds = [...new Set(rows.flatMap((m) => (m.role === 'assistant' ? m.metadata?.outputIds || [] : [])))];
  const drafts = await outputTextsForContext(tx, outputIds);
  // Pictures are named the way the chat shows them ("Image 3"), so "the first image" stays resolvable.
  const registry = await buildImageRegistry(tx, conversationId);
  const labels = new Map();
  for (const e of registry.list) {
    if (!labels.has(e.messageId)) labels.set(e.messageId, []);
    labels.get(e.messageId).push(e.kind === 'upload' ? `[Added ${e.label}: ${e.name}]` : `[Made ${e.label}: ${e.name}, version ${e.versionNumber}]`);
  }
  const toItem = (m) => {
    const produced = m.role === 'assistant' ? (m.metadata?.outputIds || []).map((id) => drafts.get(id)).filter(Boolean) : [];
    const content = [m.content, ...(labels.get(m.id) || []), ...produced].filter(Boolean).join('\n\n');
    return { role: m.role, content, messageType: m.message_type };
  };
  const recent = rows.slice(-HISTORY_MESSAGES).map(toItem);
  // A long chat keeps its first request (the original goal) and the summary of everything older.
  const first = registry.messages.find((m) => m.role === 'user' && !excludeIds.includes(m.id));
  if (first && !rows.slice(-HISTORY_MESSAGES).some((m) => m.id === first.id)) {
    const summary = await latestSummary(tx, conversationId);
    if (summary) recent.unshift({ role: 'assistant', content: `(Summary of the earlier part of this chat)\n${summary.content}`, messageType: 'summary', pinned: true });
    recent.unshift({ role: 'user', content: `(First request in this chat) ${first.content}`, messageType: 'prompt', pinned: true });
  }
  return recent;
}

/**
 * Pictures given to the image model or the vision model, re-checked inside the
 * caller's RLS transaction: an uploaded photo of this task/client ({ fileId }) or a
 * stored version of an image output of this task ({ outputId, versionId }).
 * @returns {Promise<Array<{ fileId?, outputId?, versionId?, role, objectPath, mimeType, name, imageMeta? }>>}
 */
export async function loadImageInputs(tx, refs, task) {
  const out = [];
  for (const ref of (refs || []).slice(0, 8)) {
    const role = ref.role === 'source' ? 'source' : 'reference';
    if (ref.fileId) {
      const [f] = await loadAttachments(tx, [ref.fileId], task);
      if (!REFERENCE_IMAGE_MIMES.includes(f.mime_type)) throw badRequest(`“${f.file_name}” is not a picture the AI can use. Please use a JPG, PNG or WebP picture.`);
      out.push({ fileId: f.id, role, objectPath: f.object_path, mimeType: f.mime_type, name: f.file_name });
    } else if (ref.versionId && ref.outputId) {
      const o = await runsRepo.getOutputWithCurrentVersion(tx, ref.outputId);
      if (!o || o.task_id !== task.id || o.output_kind !== 'image') throw notFound('Image');
      const v = await runsRepo.getOutputVersion(tx, o.id, ref.versionId);
      if (!v?.version_object_path) throw notFound('Image');
      out.push({ outputId: o.id, versionId: v.version_id, role, objectPath: v.version_object_path, mimeType: 'image/png', name: o.title, imageMeta: v.image_meta || {} });
    } else {
      throw badRequest('An image reference is incomplete.');
    }
  }
  return out;
}

/** Bytes of loaded image inputs (call outside the transaction). */
export async function fetchImageInputs(inputs) {
  return Promise.all(inputs.map(async (i) => ({ ...i, buffer: await getObject(i.objectPath) })));
}

/** Current text of the outputs referenced in the history (same conversation, RLS-scoped). */
async function outputTextsForContext(tx, outputIds) {
  const map = new Map();
  if (!outputIds.length) return map;
  const { rows } = await tx.query(
    `select o.id, o.title, o.output_kind, v.content, v.sections
       from public.ai_workspace_outputs o
       left join public.ai_workspace_output_versions v on v.id = o.current_version_id
      where o.id = any($1::uuid[])`,
    [outputIds],
  );
  for (const r of rows) {
    if (r.output_kind === 'image') {
      map.set(r.id, `[Image created: ${r.title}]`);
      continue;
    }
    const text = Array.isArray(r.sections) && r.sections.length ? r.sections.map((s) => `${s.label}: ${s.text}`).join('\n') : r.content || '';
    if (text) map.set(r.id, `[Draft: ${r.title}]\n${text.slice(0, 3000)}`);
  }
  return map;
}

/**
 * Downloads authorised attachments (call AFTER loadAttachments). Textual files
 * become reference text (≤ MAX_REFERENCE_CHARS each); images become reference
 * images for image generation. Other types are ignored.
 */
export async function fetchAttachmentContent(attachments, { includeImages = false } = {}) {
  const references = [];
  const images = [];
  const pdfs = [];
  const unreadable = [];
  let budget = MAX_REFERENCE_TOTAL_CHARS;
  for (const f of attachments) {
    if (!f.object_path) continue;
    if (REFERENCE_IMAGE_MIMES.includes(f.mime_type) || f.file_category === 'image') {
      if (includeImages && REFERENCE_IMAGE_MIMES.includes(f.mime_type)) images.push({ id: f.id, name: f.file_name, buffer: await getObject(f.object_path), mimeType: f.mime_type });
      continue;
    }
    if (f.mime_type === 'application/pdf') {
      pdfs.push({ id: f.id, name: f.file_name, buffer: await getObject(f.object_path) });
      continue;
    }
    // Word, Excel, PowerPoint, CSV, text: the real text, within a per-file and per-request budget.
    const doc = await extractDocument(await getObject(f.object_path), f.mime_type);
    if (!doc.text) {
      unreadable.push({ id: f.id, name: f.file_name, reason: doc.error || 'No readable text.' });
      continue;
    }
    const text = doc.text.slice(0, Math.max(0, Math.min(MAX_REFERENCE_CHARS, budget)));
    budget -= text.length;
    references.push({ id: f.id, name: f.file_name, text, partial: doc.truncated || text.length < doc.text.length });
  }
  return { references, images, pdfs, unreadable };
}

/** Client logo bytes (only the task's own client). Null when none / unreadable. */
export async function fetchClientLogo(tx, client) {
  if (!client?.logo_file_id) return null;
  const [file] = await runsRepo.getFilesWithPaths(tx, [client.logo_file_id]);
  if (!file || file.client_id !== client.id || !file.object_path || !REFERENCE_IMAGE_MIMES.includes(file.mime_type)) return null;
  try {
    return await getObject(file.object_path);
  } catch (err) {
    logger.warn({ code: err?.code, clientId: client.id }, 'client logo could not be loaded; continuing without it');
    return null;
  }
}
