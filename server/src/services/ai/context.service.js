import { DEFAULT_INSTRUCTIONS } from '../../constants/defaults.js';
import { TOOL_TO_DB } from '../../constants/domain.js';
import { MAX_REFERENCE_CHARS, UPLOAD_TYPES } from '../../constants/files.js';
import { AppError, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { getObject } from '../storage.service.js';
import * as runsRepo from '../../repositories/generationRuns.repository.js';
import { getConversationScoped, listMessagesForContext } from '../../repositories/messages.repository.js';
import { getInstructionRow } from '../../repositories/instructions.repository.js';
import { getPresetRow } from '../../repositories/presets.repository.js';
import { normaliseInstruction } from './prompt.builder.js';

/**
 * Resolves TRUSTED generation context from the database inside the caller's
 * RLS-scoped transaction. The client is always derived from the task — never
 * from the request — and every other record (conversation, attachments,
 * preset) must belong to that same client.
 */

export const REFERENCE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const isTextual = (mime) => !!UPLOAD_TYPES[mime]?.textual;

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
export async function loadHistory(tx, conversationId, { excludeIds = [] } = {}) {
  if (!conversationId) return [];
  const rows = await listMessagesForContext(tx, conversationId, 12);
  return rows
    .filter((m) => !excludeIds.includes(m.id) && m.message_type !== 'error')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content, messageType: m.message_type }));
}

/**
 * Downloads authorised attachments (call AFTER loadAttachments). Textual files
 * become reference text (≤ MAX_REFERENCE_CHARS each); images become reference
 * images for image generation. Other types are ignored.
 */
export async function fetchAttachmentContent(attachments, { includeImages = false } = {}) {
  const references = [];
  const images = [];
  for (const f of attachments) {
    if (!f.object_path) continue;
    if (isTextual(f.mime_type)) {
      const buf = await getObject(f.object_path);
      references.push({ id: f.id, name: f.file_name, text: buf.toString('utf8').slice(0, MAX_REFERENCE_CHARS) });
    } else if (includeImages && REFERENCE_IMAGE_MIMES.includes(f.mime_type)) {
      const buf = await getObject(f.object_path);
      images.push({ id: f.id, name: f.file_name, buffer: buf, mimeType: f.mime_type });
    }
  }
  return { references, images };
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
