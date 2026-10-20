import OpenAI from 'openai';
import { getDatabase } from '../../config/db.js';
import { ACTIVITY, DB_TO_TOOL } from '../../constants/domain.js';
import { AppError, fromDatabaseError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { logActivity } from '../../repositories/activity.repository.js';
import * as runsRepo from '../../repositories/generationRuns.repository.js';
import { insertMessage } from '../../repositories/messages.repository.js';
import * as outputService from '../output.service.js';
import { getObject, removeObjects } from '../storage.service.js';
import {
  fetchAttachmentContent,
  fetchClientLogo,
  loadAttachments,
  loadHistory,
  loadInstruction,
  loadPreset,
  loadTaskScope,
} from './context.service.js';
import { buildImagePrompt, buildTextRequest } from './prompt.builder.js';
import { generateText, maxOutputTokens } from './text.service.js';
import { processGeneratedImage, requestImages } from './image.service.js';
import {
  WRITING_FORMAT_LABELS,
  advertisingTitle,
  deriveWritingTitle,
  parseAdvertisingSections,
  vehicleMissing,
  vehicleTitle,
} from './parsers.js';

/**
 * Executes one generation run (called by the in-process queue):
 *   1. (tx) queued → running, reload TRUSTED context as the run's creator (RLS)
 *   2. (no tx) call OpenAI, parse / post-process
 *   3. (tx) persist outputs + assistant message + run succeeded + activity
 * Any failure → (tx) run failed with a safe code/message + assistant error message.
 * Prompts and generated content are never logged — only ids, sizes and codes.
 */

const TOOL_NAMES = { writing: 'Writing', image: 'Image', advertising: 'Advertising', vehicle: 'Vehicle description' };
const RETRY_HINT = 'No output was created — retry to send the same request again.';

/** Maps any error to a safe { code, message } (never raw provider text). */
export function safeError(err) {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  const db = fromDatabaseError(err);
  if (db) return { code: db.code, message: db.message };
  if (err?.code === 'AI_NOT_CONFIGURED') return { code: 'AI_NOT_CONFIGURED', message: 'The AI service is not configured on the server.' };
  // The SDK's error classes all report name "Error"; classify by class (constructor name as a fallback).
  const kind = `${err?.name || ''} ${err?.constructor?.name || ''}`;
  const status = Number(err?.status);
  const providerCode = String(err?.code || err?.error?.code || '');
  if (err instanceof OpenAI.APIConnectionTimeoutError || /timeout/i.test(kind)) {
    return { code: 'AI_TIMEOUT', message: 'The AI service did not respond in time.' };
  }
  if (err instanceof OpenAI.APIConnectionError || /connection/i.test(kind)) return { code: 'AI_UNAVAILABLE', message: 'The AI service could not be reached.' };
  if (status === 429) return { code: 'AI_PROVIDER_BUSY', message: 'The AI service is busy or the usage limit was reached.' };
  if (status === 401 || status === 403) return { code: 'AI_PROVIDER_AUTH', message: 'The AI service rejected the server credentials.' };
  if (status === 400 && /moderation|content_policy|safety/i.test(providerCode)) {
    return { code: 'AI_CONTENT_REJECTED', message: 'The AI service declined this request under its content policy. Try rephrasing it.' };
  }
  if (status === 400) return { code: 'AI_BAD_REQUEST', message: 'The AI service could not process this request.' };
  if (status >= 500) return { code: 'AI_UNAVAILABLE', message: 'The AI service is temporarily unavailable.' };
  return { code: 'AI_PROVIDER_ERROR', message: 'The AI request could not be completed.' };
}

// ── Phase 1: context ───────────────────────────────────────────────────────────

async function loadRunContext(tx, run) {
  const ro = run.request_options || {};
  const tool = DB_TO_TOOL[run.tool_type];
  const { task, job, client } = await loadTaskScope(tx, run.task_id);
  if (task.client_id !== run.client_id) throw new AppError('CONTEXT_MISMATCH', 'The task no longer belongs to the original client.', 409);
  const instruction = await loadInstruction(tx, tool);
  const options = ro.options || {};
  const preset = tool === 'image' ? await loadPreset(tx, options.presetId, client) : null;
  const attachments = await loadAttachments(tx, ro.attachmentIds || [], task);
  const history = await loadHistory(tx, run.conversation_id, { excludeIds: [run.input_message_id].filter(Boolean) });
  const workspace = await runsRepo.getWorkspaceSettings(tx);

  let target = null;
  if (ro.targetOutputId) {
    target = await runsRepo.getOutputWithCurrentVersion(tx, ro.targetOutputId);
    if (!target || target.task_id !== task.id) throw new AppError('NOT_FOUND', 'The output to revise no longer exists.', 404);
    if (ro.sourceVersionId && ro.sourceVersionId !== target.version_id) {
      const v = await runsRepo.getOutputVersion(tx, target.id, ro.sourceVersionId);
      if (!v) throw new AppError('NOT_FOUND', 'The version to revise no longer exists.', 404);
      Object.assign(target, v);
    }
  }
  const logo = tool === 'image' && options.overlayLogo ? await fetchClientLogo(tx, client) : null;
  return { ro, tool, task, job, client, instruction, preset, attachments, history, workspace, target, logo };
}

// ── Phase 2: model calls ───────────────────────────────────────────────────────

async function runText(ctx, model) {
  const { ro, tool, task, job, client, instruction, history, workspace, target } = ctx;
  const { references } = await fetchAttachmentContent(ctx.attachments);
  const isRevision = ro.mode === 'revise';
  const options = ro.options || {};
  const { instructions, input } = buildTextRequest({
    tool,
    instruction,
    client,
    job,
    task,
    workspace,
    prompt: ro.prompt,
    options,
    history,
    references,
    revision: isRevision ? { content: versionText(target) } : null,
  });
  const result = await generateText({ model, instructions, input, maxTokens: maxOutputTokens(instruction) });

  let output;
  if (tool === 'advertising') {
    const sections = parseAdvertisingSections(result.text);
    output = { title: target?.title || advertisingTitle(options), content: '', sections, outputType: 'advertising' };
  } else if (tool === 'vehicle') {
    const missing = vehicleMissing(options, client.approved_warranty_wording);
    output = { title: target?.title || vehicleTitle(options), content: result.text, missing, outputType: 'vehicle' };
  } else {
    const format = options.format || 'other';
    output = { title: target?.title || deriveWritingTitle(result.text, format), content: result.text, outputType: format };
  }
  return { kind: 'text', outputs: [output], result };
}

function versionText(v) {
  if (!v) return '';
  if (Array.isArray(v.sections) && v.sections.length) return v.sections.map((s) => `${s.label}: ${s.text}`).join('\n');
  return v.content || '';
}

async function runImage(ctx, model) {
  const { ro, task, job, client, instruction, preset, target, logo } = ctx;
  const options = ro.options || {};
  const width = Number(options.width);
  const height = Number(options.height);
  const isEdit = ro.mode === 'image_edit';
  const { references, images } = await fetchAttachmentContent(ctx.attachments, { includeImages: true });

  let refImages = images;
  if (isEdit) {
    if (!target?.version_object_path) throw new AppError('NOT_FOUND', 'The image to edit could not be found.', 404);
    // The image being edited first, then any attached reference images (max 16 inputs).
    refImages = [{ buffer: await getObject(target.version_object_path), mimeType: 'image/png', name: 'current.png' }, ...images].slice(0, 16);
  }
  const prompt = buildImagePrompt({ instruction, client, job, task, prompt: ro.prompt, preset, width, height, references, edit: isEdit });
  const count = ro.targetOutputId ? 1 : Math.min(4, Math.max(1, Number(options.count) || 1));
  const quality = options.quality || instruction.modelConfiguration?.quality || 'medium';
  const gen = await requestImages({ model, prompt, count, width, height, quality, references: refImages });

  const strategy = preset?.resize_strategy || 'cover';
  const outputs = [];
  for (let i = 0; i < gen.buffers.length; i += 1) {
    const processed = await processGeneratedImage(gen.buffers[i], {
      width,
      height,
      strategy,
      background: client.background_colour,
      logo,
      logoPlacement: preset?.logo_placement_instructions || '',
      model,
      presetId: preset?.id || options.presetId || null,
      prompt: ro.prompt,
      size: gen.size,
    });
    const baseTitle = target?.title || imageTitle(ro.prompt);
    outputs.push({ ...processed, title: gen.buffers.length > 1 ? `${baseTitle} (${String.fromCharCode(65 + i)})` : baseTitle });
  }
  return { kind: 'image', outputs, result: { model, providerRequestId: gen.providerRequestId, usage: gen.usage, size: gen.size } };
}

function imageTitle(prompt = '') {
  const quoted = String(prompt).match(/[“"]([^”"]{2,60})[”"]/);
  const base = quoted ? quoted[1] : String(prompt).replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
  return (base || 'Generated image').slice(0, 60);
}

// ── Phase 3: persistence ───────────────────────────────────────────────────────

function replyFor(ctx, gen, outputIds) {
  const { ro, tool, client } = ctx;
  const options = ro.options || {};
  if (ro.mode === 'revise') return `Revised “${gen.outputs[0].title}” — saved as a new draft version.`;
  if (ro.mode === 'regenerate') return `Regenerated “${gen.outputs[0].title}” as a new draft version.`;
  if (ro.mode === 'image_edit') return `Edited “${gen.outputs[0].title}” — saved as a new draft version at ${options.width} × ${options.height}px.`;
  if (tool === 'image') {
    const n = outputIds.length;
    return `Created ${n} image${n > 1 ? 's' : ''} at ${options.width} × ${options.height}px for ${client.name}${ctx.preset ? ` using the “${ctx.preset.name}” preset` : ''}.`;
  }
  if (tool === 'advertising') return `Generated ${gen.outputs[0].sections.length} copy sections${options.platform ? ` for ${options.platform}` : ''}. Each section can be copied or edited on its own.`;
  if (tool === 'vehicle') {
    const m = gen.outputs[0].missing.length;
    return m
      ? `Listing generated from the supplied details only. ${m} item${m > 1 ? 's were' : ' was'} not supplied and ${m > 1 ? 'have' : 'has'} been left out — see “Missing information”.`
      : 'Listing generated from the supplied details.';
  }
  const label = WRITING_FORMAT_LABELS[options.format]?.toLowerCase() || 'draft';
  const noun = label === 'other text' ? 'draft' : label;
  return `Here is ${/^(e|sms|a|o|i|u)/i.test(noun) ? 'an' : 'a'} ${noun} in ${client.name}’s voice.`;
}

async function persist(tx, run, ctx, gen, model, startedAt) {
  const { ro, tool, task, client, instruction } = ctx;
  const userId = run.created_by;
  const outputIds = [];

  if (ro.targetOutputId) {
    const o = gen.outputs[0];
    const note = ro.note || (ro.mode === 'revise' ? 'AI revision' : ro.mode === 'image_edit' ? 'AI edit of the previous version' : 'Regenerated');
    if (gen.kind === 'image') {
      await outputService.addImageRevision(tx, { userId, outputId: ro.targetOutputId, finalImage: o.finalImage, originalImage: o.originalImage, imageMeta: o.imageMeta, note });
    } else {
      await outputService.addTextRevision(tx, {
        userId,
        outputId: ro.targetOutputId,
        content: o.content,
        sections: o.sections || null,
        missing: o.missing || null,
        note,
        sourceVersionId: ctx.target?.version_id || null,
      });
    }
    outputIds.push(ro.targetOutputId);
  } else {
    for (const o of gen.outputs) {
      if (gen.kind === 'image') {
        const r = await outputService.createImageOutput(tx, {
          userId,
          task,
          conversationId: run.conversation_id,
          title: o.title,
          finalImage: o.finalImage,
          originalImage: o.originalImage,
          imageMeta: o.imageMeta,
          note: 'Initial generation',
        });
        outputIds.push(r.outputId);
      } else {
        const r = await outputService.createTextOutput(tx, {
          userId,
          task,
          conversationId: run.conversation_id,
          tool,
          outputType: o.outputType,
          title: o.title,
          content: o.content,
          sections: o.sections || null,
          missing: o.missing || null,
          note: 'Initial generation',
        });
        outputIds.push(r.outputId);
      }
    }
  }

  const requestMeta = {
    simulated: false,
    tool,
    model,
    requestId: run.id,
    providerRequestId: gen.result.providerRequestId || null,
    instructionVersion: instruction.version,
    presetId: ctx.preset?.id || null,
    format: tool === 'writing' ? ro.options?.format || null : null,
  };
  const message = await insertMessage(tx, {
    conversationId: run.conversation_id,
    role: 'assistant',
    content: replyFor(ctx, gen, outputIds),
    messageType: 'response',
    metadata: { tool, outputIds, requestMeta, generationId: run.id },
    userId: null,
  });
  const succeeded = await runsRepo.markSucceeded(tx, run.id, {
    outputMessageId: message.id,
    model,
    outputMetadata: {
      model,
      mode: ro.mode,
      outputIds,
      usage: gen.result.usage || null,
      providerRequestId: gen.result.providerRequestId || null,
      generationSize: gen.result.size?.sizeParam || null,
      durationMs: Date.now() - startedAt,
    },
  });
  // The run was reconciled as interrupted meanwhile (e.g. by another instance):
  // roll everything back so a retry cannot produce duplicate outputs.
  if (!succeeded) throw new AppError('RUN_SUPERSEDED', 'This AI request was interrupted before it finished.', 409);
  await runsRepo.touchConversation(tx, run.conversation_id, { toolType: run.tool_type, userId });
  if (!ro.targetOutputId && gen.outputs[0]?.title) {
    await runsRepo.titleConversationFromFirstOutput(tx, run.conversation_id, gen.outputs[0].title.replace(/ — (email|SMS|WhatsApp)$/i, ''), outputIds);
  }
  await runsRepo.markTaskInProgress(tx, task.id, userId);
  const title = gen.outputs[0]?.title || 'output';
  await logActivity(tx, {
    userId,
    type: ACTIVITY.AI_REQUEST,
    resourceType: 'task',
    resourceId: task.id,
    clientId: task.client_id,
    jobId: task.job_id,
    taskId: task.id,
    description: `${TOOL_NAMES[tool] || 'AI'} ${ro.targetOutputId ? 'revision' : 'request'} for ${client.name}: ${title}`.slice(0, 500),
    metadata: { generationId: run.id, model, outputIds, mode: ro.mode, usage: gen.result.usage || null },
  });
}

async function recordFailure(runId, userId, err) {
  const safe = safeError(err);
  logger.warn({ runId, code: safe.code, providerStatus: err?.status ?? null }, 'generation run failed');
  try {
    await getDatabase().withUser(userId, async (tx) => {
      const run = await runsRepo.getRun(tx, runId);
      if (!run || !['queued', 'running'].includes(run.status)) return; // already succeeded or reconciled
      const tool = DB_TO_TOOL[run.tool_type];
      const message = await insertMessage(tx, {
        conversationId: run.conversation_id,
        role: 'assistant',
        content: `The AI request failed: ${safe.message} ${RETRY_HINT}`,
        messageType: 'error',
        metadata: { tool, outputIds: [], generationId: run.id, errorCode: safe.code, requestMeta: { tool, model: run.model, requestId: run.id } },
        userId: null,
      });
      await runsRepo.markFailed(tx, runId, { errorCode: safe.code, errorMessage: safe.message, outputMessageId: message.id });
    });
  } catch (e) {
    logger.error({ runId, code: e?.code }, 'could not record generation failure');
  }
}

/** Executes a queued run as its creator. Never throws. */
export async function executeRun(runId, userId) {
  const db = getDatabase();
  const startedAt = Date.now();
  let run;
  let ctx;
  try {
    ({ run, ctx } = await db.withUser(userId, async (tx) => {
      const r = await runsRepo.markRunning(tx, runId);
      if (!r) return { run: null, ctx: null };
      return { run: r, ctx: await loadRunContext(tx, r) };
    }));
    if (!run) return;

    const model = run.model;
    const gen = ctx.tool === 'image' ? await runImage(ctx, model) : await runText(ctx, model);
    // Storage objects uploaded during persistence are removed if the transaction fails.
    const uploaded = [];
    try {
      await db.withUser(userId, (tx) => persist(Object.assign(tx, { uploadedObjects: uploaded }), run, ctx, gen, model, startedAt));
    } catch (err) {
      if (uploaded.length) await removeObjects(uploaded).catch(() => {});
      throw err;
    }
    logger.info({ runId, tool: ctx.tool, outputs: gen.outputs.length, ms: Date.now() - startedAt }, 'generation run succeeded');
  } catch (err) {
    await recordFailure(runId, userId, err);
  }
}
