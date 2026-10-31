import crypto from 'node:crypto';
import { getDatabase } from '../../config/db.js';
import { env } from '../../config/env.js';
import { DB_TO_TOOL, TOOL_TO_DB } from '../../constants/domain.js';
import { resolveImageModel, resolveTextModel } from '../../constants/models.js';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors.js';
import * as runsRepo from '../../repositories/generationRuns.repository.js';
import { getMessageRow, insertMessage, supersedeFrom, toMessageDto, updateMessageMetadata } from '../../repositories/messages.repository.js';
import { getOutputDto } from '../output.service.js';
import { enqueueGeneration } from '../../jobs/generationQueue.js';
import {
  loadAttachments,
  loadConversationForTask,
  loadHistory,
  loadImageInputs,
  loadInstruction,
  loadPreset,
  loadTaskScope,
} from './context.service.js';
import { buildPreview } from './prompt.builder.js';
import { WRITING_FORMAT_LABELS, detectFormat, vehicleName } from './parsers.js';
import { validateDimensions } from './imageProcessing.js';

/**
 * Request-side AI flow. Every request:
 *   validate → withUser tx: trusted context from the DB, user message, run row
 *   (idempotent, per-user concurrency) → commit → enqueue → 202 { generationId … }.
 * The model is only ever called by the queue worker (execution.service.js).
 */

const CLARIFY_TEXT = 'Is this for an email, an SMS or a WhatsApp message? Choose one and I’ll write it.';
const truncate = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

async function messageDto(tx, id) {
  if (!id) return null;
  const row = await getMessageRow(tx, id);
  return row ? toMessageDto(row) : null;
}

/** Model for a tool from the instruction configuration / env, validated against the allowlist. */
export function resolveModel(tool, instruction, { edit = false } = {}) {
  // Refuse before anything is stored, so no run or error message is created for a request that cannot run.
  if (!env.OPENAI_API_KEY) throw new AppError('AI_NOT_CONFIGURED', 'The AI service is not configured on the server. Ask your administrator to set it up.', 503);
  const requested = instruction?.modelConfiguration?.model;
  const model = tool === 'image' ? resolveImageModel(requested, { edit }) : resolveTextModel(requested);
  if (!model) throw new AppError('AI_CONFIG_ERROR', 'The AI model configured for this tool is not supported. Update AI Instructions or the server configuration.', 500);
  return model;
}

async function existingRunResponse(tx, run) {
  return {
    generationId: run.id,
    status: run.status,
    tool: DB_TO_TOOL[run.tool_type],
    conversation: await runsRepo.getConversationDto(tx, run.conversation_id),
    userMessage: await messageDto(tx, run.input_message_id),
    duplicate: true,
  };
}

async function assertCapacity(tx, userId) {
  await runsRepo.lockUserRuns(tx, userId);
  const active = await runsRepo.countActiveRuns(tx, userId);
  if (active >= env.AI_MAX_CONCURRENT_PER_USER) {
    throw new AppError(
      'AI_CONCURRENCY_LIMIT',
      `You already have ${active} AI request${active > 1 ? 's' : ''} in progress. Wait for ${active > 1 ? 'one' : 'it'} to finish before starting another.`,
      429,
    );
  }
}

async function ensureConversation(tx, { conversationId, task, tool, title, userId }) {
  if (conversationId) {
    await loadConversationForTask(tx, conversationId, task);
    return conversationId;
  }
  return runsRepo.createConversation(tx, { task, toolType: TOOL_TO_DB[tool], title: truncate(title || 'New conversation', 48) || 'New conversation', userId });
}

/**
 * Idempotency: the advisory lock serialises a user's start requests, so two
 * concurrent submissions with the same key resolve to the same run. A key may
 * only be reused for the same kind of request on the same target.
 */
async function findIdempotentRun(tx, userId, idempotencyKey, scope) {
  if (!idempotencyKey) return null;
  await runsRepo.lockUserRuns(tx, userId);
  const existing = await runsRepo.findRunByIdempotencyKey(tx, userId, idempotencyKey);
  if (existing && existing.request_options?.idempotencyScope && existing.request_options.idempotencyScope !== scope) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.', 422);
  }
  return existing;
}

/**
 * "Edit an earlier message": the new request replaces one of the user's own
 * prompts in this conversation. That prompt and everything after it are hidden
 * (not deleted) in the same transaction that stores the new prompt.
 */
async function replaceFrom(tx, conversationId, messageId) {
  const row = await getMessageRow(tx, messageId);
  if (!row || row.conversation_id !== conversationId || row.role !== 'user') throw notFound('Message');
  if (row.metadata?.supersededAt) throw conflict('This message was already changed. Reload the chat and try again.');
  if (await runsRepo.countActiveRunsInConversation(tx, conversationId)) {
    throw new AppError('CONVERSATION_BUSY', 'Wait for the current answer to finish before changing an earlier message.', 409);
  }
  await supersedeFrom(tx, conversationId, messageId);
}

/** Inserts the run + links the user message. Returns the run row. */
async function createRun(tx, { userId, tool, task, conversationId, userMessageId, model, requestOptions, idempotencyKey, runId }) {
  const run = await runsRepo.insertRun(tx, {
    id: runId,
    task,
    conversationId,
    toolType: TOOL_TO_DB[tool],
    model,
    inputMessageId: userMessageId,
    idempotencyKey,
    requestOptions,
    userId,
  });
  await runsRepo.touchConversation(tx, conversationId, { toolType: TOOL_TO_DB[tool], userId });
  return run;
}

function summarise(tool, o = {}) {
  if (tool === 'vehicle') return `Vehicle listing: ${vehicleName(o)}`;
  if (tool === 'advertising') return `Ad copy: ${o.campaignName || 'campaign'}${o.platform ? ` · ${o.platform}` : ''}`;
  return 'Request';
}

/**
 * Starts a writing / advertising / vehicle / image generation.
 * @returns {Promise<{ httpStatus: number, data: object }>}
 */
export async function startGeneration(user, tool, body, { idempotencyKey } = {}) {
  const db = getDatabase();
  const result = await db.withUser(user.id, async (tx) => {
    const idempotencyScope = `${tool}:${body.taskId}`;
    const existing = await findIdempotentRun(tx, user.id, idempotencyKey, idempotencyScope);
    if (existing) return { httpStatus: 202, data: await existingRunResponse(tx, existing) };

    const { task, client } = await loadTaskScope(tx, body.taskId);
    const instruction = await loadInstruction(tx, tool);
    const attachments = await loadAttachments(tx, body.attachmentIds, task);
    // Files from earlier in the chat that the assistant picked for this task (validated the same way).
    const contextFiles = await loadAttachments(tx, (body.contextFileIds || []).filter((id) => !attachments.some((a) => a.id === id)), task);
    let options = { ...(body.options || {}) };
    // Assistant requests (assistant.service.js) may send what the model should do
    // (generationPrompt) separately from what the user typed (displayContent).
    const mode = body.mode || 'generate';
    let prompt = String(body.generationPrompt ?? body.prompt ?? '').trim();
    let displayContent = body.displayContent !== undefined ? String(body.displayContent) : prompt;
    const imageInputs = await loadImageInputs(tx, body.imageInputs, task);
    const vision = await loadImageInputs(tx, body.vision, task);

    // Answering a "which format?" question re-uses the original prompt
    let clarification = null;
    if (body.clarifiesMessageId) {
      if (tool !== 'writing' || !body.conversationId) throw badRequest('A clarification answer needs its conversation.');
      await loadConversationForTask(tx, body.conversationId, task);
      const row = await getMessageRow(tx, body.clarifiesMessageId);
      if (!row || row.conversation_id !== body.conversationId || row.message_type !== 'clarification') throw notFound('Clarification');
      if (row.metadata?.resolved) throw conflict('This question has already been answered.');
      const original = row.metadata?.clarifiesUserMessageId ? await getMessageRow(tx, row.metadata.clarifiesUserMessageId) : null;
      prompt = original?.metadata?.generationPrompt || original?.content || prompt;
      options = { ...(original?.metadata?.requestOptions || {}), ...options };
      displayContent = WRITING_FORMAT_LABELS[options.format] || prompt;
      clarification = row;
    }

    if (tool === 'writing' && !prompt) throw badRequest('Enter a prompt before sending.');
    if (body.replacesMessageId) {
      if (!body.conversationId || body.clarifiesMessageId) throw badRequest('Changing a message needs its conversation.');
      await loadConversationForTask(tx, body.conversationId, task);
      // Hide the old message first, so the format remembered below comes only from the part of the chat that stays.
      await replaceFrom(tx, body.conversationId, body.replacesMessageId);
    }
    if (tool === 'writing' && mode !== 'answer' && !options.format) {
      const detected = detectFormat(prompt) || (body.conversationId ? await runsRepo.lastWritingFormat(tx, body.conversationId) : null);
      // A follow-up in a conversation keeps the format already confirmed there ("make it shorter").
      if (detected) options.format = detected;
    }

    let preset = null;
    if (tool === 'image') {
      preset = await loadPreset(tx, options.presetId, client);
      options.width = options.width ?? preset?.width_px;
      options.height = options.height ?? preset?.height_px;
      validateDimensions(options.width, options.height);
      options.count = Math.min(4, Math.max(1, Number(options.count) || 1));
    }

    const needsClarify = tool === 'writing' && mode !== 'answer' && !options.format;
    const model = needsClarify ? null : resolveModel(tool, instruction, { edit: tool === 'image' && (imageInputs.length > 0 || attachments.some((a) => a.file_category === 'image')) });
    if (!needsClarify) await assertCapacity(tx, user.id);

    const conversationId = await ensureConversation(tx, { conversationId: body.conversationId, task, tool, title: displayContent || prompt || summarise(tool, options), userId: user.id });
    const runId = needsClarify ? null : crypto.randomUUID();
    const attachmentIds = attachments.map((a) => a.id);

    const userRow = await insertMessage(tx, {
      conversationId,
      role: 'user',
      content: body.mode ? displayContent : displayContent || summarise(tool, options),
      messageType: 'prompt',
      metadata: {
        tool,
        generationPrompt: prompt,
        requestOptions: options,
        attachmentIds,
        generationId: runId,
        ...(body.replacesMessageId ? { replacesMessageId: body.replacesMessageId } : {}),
        ...(body.intent ? { intent: body.intent } : {}),
      },
      userId: user.id,
    });
    if (clarification) await updateMessageMetadata(tx, clarification.id, { resolved: true, answeredByMessageId: userRow.id });

    if (needsClarify) {
      const clarifyRow = await insertMessage(tx, {
        conversationId,
        role: 'assistant',
        content: CLARIFY_TEXT,
        messageType: 'clarification',
        metadata: {
          tool,
          options: Object.entries(WRITING_FORMAT_LABELS).map(([id, label]) => ({ id, label })),
          resolved: false,
          clarifiesUserMessageId: userRow.id,
          requestMeta: { tool, simulated: false },
        },
        userId: null,
      });
      await runsRepo.touchConversation(tx, conversationId, { toolType: TOOL_TO_DB[tool], userId: user.id });
      return {
        httpStatus: 200,
        data: {
          generationId: null,
          status: 'clarify',
          tool,
          conversation: await runsRepo.getConversationDto(tx, conversationId),
          userMessage: await messageDto(tx, userRow.id),
          assistantMessage: await messageDto(tx, clarifyRow.id),
          outputs: [],
          request: null,
        },
      };
    }

    const run = await createRun(tx, {
      userId: user.id,
      tool,
      task,
      conversationId,
      userMessageId: userRow.id,
      model,
      idempotencyKey,
      runId,
      requestOptions: {
        mode,
        tool,
        prompt,
        options,
        attachmentIds: [...attachmentIds, ...contextFiles.map((a) => a.id)],
        idempotencyScope,
        ...(imageInputs.length ? { imageInputs: imageInputs.map(({ fileId, outputId, versionId, role }) => ({ fileId, outputId, versionId, role })) } : {}),
        ...(vision.length ? { vision: vision.map(({ fileId, outputId, versionId }) => ({ fileId, outputId, versionId })) } : {}),
        ...(body.edit ? { edit: body.edit } : {}),
      },
    });
    return {
      httpStatus: 202,
      enqueue: run.id,
      data: {
        generationId: run.id,
        status: run.status,
        tool,
        conversation: await runsRepo.getConversationDto(tx, conversationId),
        userMessage: await messageDto(tx, userRow.id),
      },
    };
  });
  if (result.enqueue) enqueueGeneration(result.enqueue, user.id);
  return result;
}

/**
 * Starts a run that produces a NEW version of an existing output
 * (writing revise, image edit, regenerate).
 */
async function startOutputRun(user, { outputId, mode, prompt, versionId, note, idempotencyKey, extraOptions = {}, attachmentIds = [], conversationId: requestedConversationId, replacesMessageId, edit, size, intent, displayContent }) {
  const db = getDatabase();
  const result = await db.withUser(user.id, async (tx) => {
    const idempotencyScope = `${mode}:${outputId}`;
    const existing = await findIdempotentRun(tx, user.id, idempotencyKey, idempotencyScope);
    if (existing) return { httpStatus: 202, data: await existingRunResponse(tx, existing) };
    const output = await runsRepo.getOutputWithCurrentVersion(tx, outputId);
    if (!output) throw notFound('Output');
    const tool = DB_TO_TOOL[output.tool_type];
    if (mode === 'revise' && output.output_kind !== 'text') throw badRequest('Only text outputs can be revised with writing instructions.');
    if (mode === 'image_edit' && output.output_kind !== 'image') throw badRequest('Only image outputs can be edited.');
    const version = versionId ? await runsRepo.getOutputVersion(tx, outputId, versionId) : null;
    if (versionId && !version) throw notFound('Version');

    const { task } = await loadTaskScope(tx, output.task_id);
    const instruction = await loadInstruction(tx, tool);

    let requestOptions;
    let content;
    if (mode === 'regenerate') {
      const origin = await runsRepo.findRunForOutput(tx, outputId);
      const ro = origin?.request_options || {};
      const options = { ...(ro.options || {}), count: 1 };
      const meta = output.image_meta || {};
      if (output.output_kind === 'image') {
        options.width = meta.requestedWidth ?? options.width;
        options.height = meta.requestedHeight ?? options.height;
        if (meta.presetId) options.presetId = meta.presetId;
      }
      requestOptions = {
        mode: 'regenerate',
        tool,
        prompt: ro.prompt || meta.prompt || output.title,
        options,
        attachmentIds: ro.attachmentIds || [],
        targetOutputId: outputId,
        note: note || 'Regenerated',
      };
      content = `Regenerate “${output.title}”`;
    } else if (mode === 'image_edit') {
      // Start from the chosen version ("Image 2" in the chat) or the current one.
      const meta = (version || output).image_meta || {};
      if (!(version || output).version_object_path) throw new AppError('INVALID_STATE', 'This image has no stored pixels to edit.', 409);
      const options = {
        width: size?.width ?? meta.actualWidth ?? meta.requestedWidth,
        height: size?.height ?? meta.actualHeight ?? meta.requestedHeight,
        count: 1,
        ...(meta.presetId ? { presetId: meta.presetId } : {}),
        ...extraOptions,
      };
      validateDimensions(options.width, options.height);
      // Extra reference images must belong to the same client/job/task scope (same rule as generation).
      const refs = await loadAttachments(tx, attachmentIds, task);
      requestOptions = {
        mode: 'image_edit',
        tool,
        prompt,
        options,
        attachmentIds: refs.map((a) => a.id),
        targetOutputId: outputId,
        ...(version ? { sourceVersionId: version.version_id } : {}),
        ...(edit ? { edit } : {}),
        note: version ? `AI edit of v${version.version_number}` : 'AI edit of the previous version',
      };
      content = displayContent !== undefined ? displayContent : prompt;
    } else {
      // Carry the original request's options (vehicle facts, ad settings) so the
      // revision keeps the same supplied details and missing-information list.
      const origin = await runsRepo.findRunForOutput(tx, outputId);
      const { count: _count, ...originalOptions } = origin?.request_options?.options || {};
      requestOptions = {
        mode: 'revise',
        tool,
        prompt,
        options: { ...originalOptions, format: ['email', 'sms', 'whatsapp', 'other'].includes(output.output_type) ? output.output_type : undefined },
        attachmentIds: [],
        targetOutputId: outputId,
        sourceVersionId: versionId || output.version_id,
        note: 'AI revision',
      };
      content = prompt;
    }

    const model = resolveModel(tool, instruction, { edit: mode === 'image_edit' });
    await assertCapacity(tx, user.id);
    const conversationId = requestedConversationId
      ? (await loadConversationForTask(tx, requestedConversationId, task)).id
      : output.conversation_id
      ? (await loadConversationForTask(tx, output.conversation_id, task)).id
      : await ensureConversation(tx, { task, tool, title: output.title, userId: user.id });

    if (replacesMessageId) {
      if (mode !== 'image_edit') throw badRequest('Only image edits can replace an earlier message here.');
      await replaceFrom(tx, conversationId, replacesMessageId);
    }

    const runId = crypto.randomUUID();
    const userRow = await insertMessage(tx, {
      conversationId,
      role: 'user',
      content,
      messageType: 'prompt',
      metadata: {
        tool,
        generationPrompt: requestOptions.prompt,
        requestOptions: {
          ...requestOptions.options,
          ...(mode === 'image_edit' ? { editOutputId: outputId, ...(requestOptions.sourceVersionId ? { editVersionId: requestOptions.sourceVersionId } : {}) } : {}),
        },
        attachmentIds: requestOptions.attachmentIds || [],
        generationId: runId,
        targetOutputId: outputId,
        ...(replacesMessageId ? { replacesMessageId } : {}),
        ...(intent ? { intent } : {}),
      },
      userId: user.id,
    });
    const run = await createRun(tx, { userId: user.id, tool, task, conversationId, userMessageId: userRow.id, model, requestOptions: { ...requestOptions, idempotencyScope }, idempotencyKey, runId });
    return {
      httpStatus: 202,
      enqueue: run.id,
      data: {
        generationId: run.id,
        status: run.status,
        tool,
        outputId,
        conversation: await runsRepo.getConversationDto(tx, conversationId),
        userMessage: await messageDto(tx, userRow.id),
      },
    };
  });
  if (result.enqueue) enqueueGeneration(result.enqueue, user.id);
  return result;
}

export const startWritingRevision = (user, body, opts = {}) =>
  startOutputRun(user, { outputId: body.outputId, versionId: body.versionId, mode: 'revise', prompt: body.instructions, idempotencyKey: opts.idempotencyKey });

export const startImageEdit = (user, body, opts = {}) =>
  startOutputRun(user, {
    outputId: body.outputId,
    versionId: body.versionId,
    conversationId: body.conversationId,
    replacesMessageId: body.replacesMessageId,
    edit: body.edit,
    size: body.size,
    intent: body.intent,
    displayContent: body.displayContent,
    mode: 'image_edit',
    prompt: body.prompt,
    idempotencyKey: opts.idempotencyKey,
    extraOptions: { ...(body.options?.quality ? { quality: body.options.quality } : {}), overlayLogo: !!body.options?.overlayLogo },
    attachmentIds: body.attachmentIds || [],
  });

export const regenerateOutput = (user, outputId, body = {}, opts = {}) =>
  startOutputRun(user, { outputId, mode: 'regenerate', note: body.note, idempotencyKey: opts.idempotencyKey });

/**
 * Run status; when finished also the assistant message and the outputs (with
 * versions). `request` is the prepared request WITHOUT instruction text.
 */
export async function getGeneration(user, id) {
  return getDatabase().withUser(user.id, async (tx) => {
    const run = await runsRepo.getRun(tx, id);
    if (!run) throw notFound('Generation');
    const dto = runsRepo.toRunDto(run);
    dto.conversation = await runsRepo.getConversationDto(tx, run.conversation_id);
    dto.userMessage = await messageDto(tx, run.input_message_id);
    dto.assistantMessage = null;
    dto.outputs = [];
    dto.error = run.status === 'failed' ? { code: run.error_code, message: run.error_message } : null;
    if (run.status === 'succeeded' || run.status === 'failed') {
      dto.assistantMessage = await messageDto(tx, run.output_message_id);
      const ids = run.status === 'succeeded' ? run.output_metadata?.outputIds || [] : [];
      for (const outputId of ids) {
        try {
          dto.outputs.push(await getOutputDto(tx, outputId, { withVersions: true }));
        } catch (err) {
          if (err?.status !== 404) throw err; // archived since — skip
        }
      }
      if (run.status === 'succeeded') dto.usage = run.output_metadata?.usage || null;
    }
    const ro = run.request_options || {};
    try {
      dto.request = await preparedRequest(tx, {
        tool: DB_TO_TOOL[run.tool_type],
        taskId: run.task_id,
        conversationId: run.conversation_id,
        prompt: ro.prompt,
        options: ro.options,
        attachmentIds: ro.attachmentIds,
        model: run.model,
        requestId: run.id,
        excludeMessageIds: [run.input_message_id, run.output_message_id].filter(Boolean),
      });
    } catch (err) {
      if (err?.status !== 404) throw err; // context archived since
      dto.request = null;
    }
    return dto;
  });
}

/** Re-runs a FAILED run with its stored input. */
export async function retryGeneration(user, id) {
  const db = getDatabase();
  const result = await db.withUser(user.id, async (tx) => {
    const run = await runsRepo.getRun(tx, id);
    if (!run) throw notFound('Generation');
    if (run.status !== 'failed') throw conflict('Only failed AI requests can be retried.');
    const tool = DB_TO_TOOL[run.tool_type];
    const instruction = await loadInstruction(tx, tool);
    resolveModel(tool, instruction, { edit: run.request_options?.mode === 'image_edit' });
    await assertCapacity(tx, user.id);
    if (run.output_message_id) await updateMessageMetadata(tx, run.output_message_id, { resolved: true, retried: true });
    const queued = await runsRepo.requeueRun(tx, id);
    if (!queued) throw conflict('This AI request is already being retried.');
    await runsRepo.touchConversation(tx, run.conversation_id, { userId: user.id });
    return {
      enqueue: queued.id,
      data: { generationId: queued.id, status: queued.status, tool, conversation: await runsRepo.getConversationDto(tx, run.conversation_id), userMessage: await messageDto(tx, run.input_message_id) },
    };
  });
  // The run keeps its original creator; the worker executes as the retrying member.
  enqueueGeneration(result.enqueue, user.id);
  return { httpStatus: 202, data: result.data };
}

/** Builds the prepared request (no instruction text) inside an RLS-scoped tx. */
async function preparedRequest(tx, { tool, taskId, conversationId, prompt, options: rawOptions, attachmentIds, model, requestId, excludeMessageIds = [] }) {
  const { task, job, client } = await loadTaskScope(tx, taskId);
  const instruction = await loadInstruction(tx, tool, { requireActive: false });
  const attachments = await loadAttachments(tx, attachmentIds, task);
  const options = sanitiseOptions(rawOptions);
  const preset = tool === 'image' && typeof options.presetId === 'string' && options.presetId ? await loadPreset(tx, options.presetId, client) : null;
  let history = [];
  if (conversationId) {
    await loadConversationForTask(tx, conversationId, task);
    history = await loadHistory(tx, conversationId, { excludeIds: excludeMessageIds });
  }
  let resolved = model || null;
  if (!resolved) {
    try {
      resolved = resolveModel(tool, instruction);
    } catch {
      resolved = null;
    }
  }
  return buildPreview({
    requestId: requestId || `preview_${crypto.randomUUID()}`,
    tool,
    instruction,
    model: resolved,
    client,
    job,
    task,
    workspace: await runsRepo.getWorkspaceSettings(tx),
    prompt,
    options,
    history,
    attachments,
    preset,
  });
}

/** The prepared request WITHOUT instruction text; never calls OpenAI. */
export async function previewRequest(user, body) {
  return getDatabase().withUser(user.id, (tx) => preparedRequest(tx, body));
}

/** Keeps only plain option values (strings, numbers, booleans, string arrays) for the preview echo. */
function sanitiseOptions(options = {}) {
  const out = {};
  for (const [k, v] of Object.entries(options || {}).slice(0, 40)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 4000);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 40).map((x) => x.slice(0, 200));
  }
  return out;
}

/**
 * Stores the user's message and a direct reply without calling a generator — for
 * a clarifying question or an honest "this can't be done here" from the assistant.
 */
export async function recordReply(user, { taskId, conversationId, prompt, attachmentIds = [], replacesMessageId, reply, intent }) {
  return getDatabase().withUser(user.id, async (tx) => {
    const { task } = await loadTaskScope(tx, taskId);
    const attachments = await loadAttachments(tx, attachmentIds, task);
    if (conversationId) await loadConversationForTask(tx, conversationId, task);
    if (replacesMessageId) {
      if (!conversationId) throw badRequest('Changing a message needs its conversation.');
      await replaceFrom(tx, conversationId, replacesMessageId);
    }
    const convId = await ensureConversation(tx, { conversationId, task, tool: 'writing', title: prompt || 'New chat', userId: user.id });
    const userRow = await insertMessage(tx, {
      conversationId: convId,
      role: 'user',
      content: prompt || '',
      messageType: 'prompt',
      metadata: { tool: 'writing', attachmentIds: attachments.map((a) => a.id), intent, ...(replacesMessageId ? { replacesMessageId } : {}) },
      userId: user.id,
    });
    const replyRow = await insertMessage(tx, {
      conversationId: convId,
      role: 'assistant',
      content: reply,
      messageType: 'response',
      metadata: { tool: 'writing', outputIds: [], intent, requestMeta: { tool: 'assistant', simulated: false } },
      userId: null,
    });
    await runsRepo.touchConversation(tx, convId, { userId: user.id });
    return {
      httpStatus: 200,
      data: {
        generationId: null,
        status: 'answered',
        conversation: await runsRepo.getConversationDto(tx, convId),
        userMessage: await messageDto(tx, userRow.id),
        assistantMessage: await messageDto(tx, replyRow.id),
      },
    };
  });
}
