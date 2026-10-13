import { apiClient, call, newIdempotencyKey, notFound, pollGeneration, ServiceError } from './apiClient';
import { getDb, mutate } from './mock/db';
import { currentUserId, logActivity, pickUser, touchTask } from './mock/relations';
import { enrichOutput } from './versionService';
import { GENERATORS } from './mock/aiGenerators';
import { detectFormat, parseDirectives } from '@/lib/promptHeuristics';
import { buildAiRequest } from '@/lib/aiRequestBuilder';
import { WRITING_FORMATS, TOOL_BY_ID } from '@/lib/constants';
import { createId, nowIso, truncate } from '@/lib/utils';

/**
 * AI SERVICE.
 *
 * Demo mode: responses are produced by local template generators — no request is
 * sent to OpenAI.
 *
 * API mode: the Node.js backend owns the OpenAI key, builds the request from the
 * stored client/job/task context and runs the generation in a queue. Generate
 * endpoints answer 200 (clarifying question, nothing queued) or 202 (queued) —
 * we then poll GET /ai/generations/:id until it succeeds or fails.
 */
const AI_LATENCY = 1300;

function prepare(db, { taskId, tool, prompt, options, conversationId, attachmentIds = [] }) {
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) throw notFound('Task');
  const job = db.jobs.find((j) => j.id === task.jobId);
  const client = db.clients.find((c) => c.id === task.clientId);
  if (!client || !job) throw new ServiceError('This task is missing its client or job.');
  const instructions = db.instructions.find((i) => i.toolId === tool);
  const preset = options?.presetId ? db.presets.find((p) => p.id === options.presetId) : null;
  const attachments = db.files.filter((f) => attachmentIds.includes(f.id));
  const history = conversationId ? db.messages.filter((m) => m.conversationId === conversationId) : [];
  return {
    task,
    job,
    client,
    instructions,
    request: buildAiRequest({ client, job, task, toolId: tool, instructions, prompt, options, history, preset, attachments, preferences: db.preferences }),
  };
}

function shouldFail(db, prompt) {
  if (/\[simulate[- ]error\]/i.test(prompt)) return true;
  return !!db.preferences?.simulateFailures && Math.random() < 0.25;
}

/** Creates outputs, versions and file records for generated results. */
function persistOutputs(db, { task, conversationId, tool, generated, userId, editOutputId }) {
  const created = [];
  const now = nowIso();
  generated.outputs.forEach((g) => {
    if (editOutputId) {
      const o = db.outputs.find((x) => x.id === editOutputId);
      if (o) {
        const prev = db.versions.filter((v) => v.outputId === o.id);
        const v = {
          id: createId('ver'),
          outputId: o.id,
          versionNumber: Math.max(...prev.map((x) => x.versionNumber)) + 1,
          kind: o.kind,
          content: g.content || '',
          sections: g.sections || null,
          image: g.image || null,
          missing: g.missing || null,
          note: 'AI edit of the previous version',
          status: 'draft',
          approvedAt: null,
          approvedBy: null,
          sourceVersionId: o.currentVersionId,
          createdAt: now,
          createdBy: userId,
        };
        db.versions.push(v);
        o.currentVersionId = v.id;
        o.updatedAt = now;
        const f = db.files.find((x) => x.id === o.fileId);
        if (f) f.updatedAt = now;
        created.push(o);
        return;
      }
    }
    const o = {
      id: createId('out'),
      taskId: task.id,
      jobId: task.jobId,
      clientId: task.clientId,
      conversationId,
      tool,
      kind: g.kind,
      title: g.title,
      format: g.format || null,
      currentVersionId: null,
      approvedVersionId: null,
      fileId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    };
    const v = {
      id: createId('ver'),
      outputId: o.id,
      versionNumber: 1,
      kind: g.kind,
      content: g.content || '',
      sections: g.sections || null,
      image: g.image || null,
      missing: g.missing || null,
      note: 'Initial generation',
      status: 'draft',
      approvedAt: null,
      approvedBy: null,
      sourceVersionId: null,
      createdAt: now,
      createdBy: userId,
    };
    const text = g.sections ? g.sections.map((s) => `${s.label}\n${s.text}`).join('\n\n') : g.content;
    const f = {
      id: createId('f'),
      name: `${g.title}.${g.kind === 'image' ? 'png' : 'txt'}`,
      kind: g.kind === 'image' ? 'image' : 'text',
      mimeType: g.kind === 'image' ? 'image/png' : 'text/plain',
      size: g.kind === 'image' ? Math.round((g.image.requestedWidth * g.image.requestedHeight) / 6) : new Blob([text || '']).size,
      clientId: task.clientId,
      jobId: task.jobId,
      taskId: task.id,
      outputId: o.id,
      category: 'output',
      storage: 'generated',
      url: null,
      description: g.kind === 'image' ? 'Demo image output (rendered placeholder)' : `${TOOL_BY_ID[tool]?.name} output`,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    };
    o.currentVersionId = v.id;
    o.fileId = f.id;
    db.outputs.push(o);
    db.versions.push(v);
    db.files.push(f);
    created.push(o);
  });
  return created;
}

function runGeneration(db, { conversation, task, tool, prompt, options, attachmentIds, userId }) {
  const { request, client, instructions } = prepare(db, { taskId: task.id, tool, prompt, options, conversationId: conversation.id, attachmentIds });
  const now = nowIso();
  const meta = {
    simulated: true,
    tool,
    requestId: request.requestId,
    instructionVersion: instructions?.version,
    rulesApplied: parseDirectives(instructions).ruleCount,
    presetId: options?.presetId || null,
    format: options?.format || null,
  };

  if (shouldFail(db, prompt)) {
    const errMsg = {
      id: createId('m'),
      conversationId: conversation.id,
      taskId: task.id,
      role: 'assistant',
      content: 'The simulated AI service did not respond in time. No output was created — retry to send the same request again.',
      createdAt: now,
      userId: null,
      tool,
      status: 'error',
      outputIds: [],
      options: null,
      requestMeta: meta,
      request,
    };
    db.messages.push(errMsg);
    return { assistantMessage: errMsg, outputs: [], request };
  }

  const generated = GENERATORS[tool](request, { variantSeed: Date.now() });
  const outputs = persistOutputs(db, { task, conversationId: conversation.id, tool, generated, userId, editOutputId: options?.editOutputId });
  const assistantMessage = {
    id: createId('m'),
    conversationId: conversation.id,
    taskId: task.id,
    role: 'assistant',
    content: generated.reply,
    createdAt: nowIso(),
    userId: null,
    tool,
    status: 'complete',
    outputIds: outputs.map((o) => o.id),
    options: null,
    requestMeta: meta,
    request,
  };
  db.messages.push(assistantMessage);
  conversation.updatedAt = assistantMessage.createdAt;
  logActivity(db, {
    type: 'ai_request',
    resourceType: 'task',
    resourceId: task.id,
    clientId: task.clientId,
    jobId: task.jobId,
    taskId: task.id,
    description: `${TOOL_BY_ID[tool]?.short || 'AI'} request simulated for ${client.name}: ${truncate(outputs[0]?.title || prompt, 60)}`,
  });
  touchTask(db, task.id);
  if (task.status === 'todo') task.status = 'in_progress';
  return { assistantMessage, outputs, request };
}

export const aiService = {
  /** Builds the request without generating — used for the "View prepared request" panel. */
  previewRequest: (params) =>
    call({
      latency: 60,
      mock: () => prepare(getDb(), params).request,
      api: () => apiClient.post('/ai/preview-request', params),
    }),

  /**
   * Sends a prompt in a conversation.
   * @param {{ taskId, conversationId?, tool, prompt, options?, attachmentIds?, clarifiesMessageId? }} params
   */
  send: (params) =>
    call({
      latency: AI_LATENCY,
      mock: () =>
        mutate((db) => {
          const { taskId, tool, attachmentIds = [] } = params;
          let options = { ...(params.options || {}) };
          // Editing an existing image produces exactly one new version of it
          if (options.editOutputId) options.count = 1;
          const task = db.tasks.find((t) => t.id === taskId);
          if (!task) throw notFound('Task');
          if (!GENERATORS[tool]) throw new ServiceError('Select an AI tool before sending.');
          const instructions = db.instructions.find((i) => i.toolId === tool);
          if (instructions && !instructions.active) {
            throw new ServiceError(`${instructions.name} is turned off in AI Instructions. Re-activate it to generate.`, { code: 'tool_inactive' });
          }
          const userId = currentUserId();
          let prompt = (params.prompt || '').trim();
          if (!params.clarifiesMessageId && !prompt && tool !== 'vehicle' && tool !== 'advertising') {
            throw new ServiceError('Enter a prompt before sending.');
          }
          let conversation = params.conversationId ? db.conversations.find((c) => c.id === params.conversationId) : null;
          if (!conversation) {
            conversation = { id: createId('cv'), taskId, tool, title: truncate(prompt || 'New conversation', 48), createdAt: nowIso(), updatedAt: nowIso(), createdBy: userId };
            db.conversations.push(conversation);
          }
          if (!conversation.tool) conversation.tool = tool;

          // Answering a "which format?" question re-uses the original prompt
          let displayContent = prompt;
          if (params.clarifiesMessageId) {
            const idx = db.messages.findIndex((m) => m.id === params.clarifiesMessageId);
            const original = db.messages.slice(0, idx).reverse().find((m) => m.role === 'user' && m.conversationId === conversation.id);
            displayContent = WRITING_FORMATS.find((f) => f.id === options.format)?.label || prompt;
            prompt = original?.generationPrompt || original?.content || prompt;
            options = { ...(original?.requestOptions || {}), ...options };
            const clarify = db.messages[idx];
            if (clarify) clarify.resolved = true;
          }
          if (tool === 'writing' && !options.format) {
            const detected = detectFormat(prompt);
            if (detected) options.format = detected;
          }

          const userMessage = {
            id: createId('m'),
            conversationId: conversation.id,
            taskId,
            role: 'user',
            content: displayContent || summarizeOptions(tool, options),
            generationPrompt: prompt,
            requestOptions: options,
            attachmentIds,
            createdAt: nowIso(),
            userId,
            tool,
            status: 'complete',
            outputIds: [],
            options: null,
            requestMeta: null,
          };
          db.messages.push(userMessage);

          if (tool === 'writing' && !options.format) {
            const clarify = {
              id: createId('m'),
              conversationId: conversation.id,
              taskId,
              role: 'assistant',
              content: 'Which format do you need for this piece? Choose one and I will write it.',
              createdAt: nowIso(),
              userId: null,
              tool,
              status: 'clarify',
              outputIds: [],
              options: WRITING_FORMATS.map(({ id, label }) => ({ id, label })),
              requestMeta: { simulated: true, tool },
            };
            db.messages.push(clarify);
            conversation.updatedAt = clarify.createdAt;
            return { conversation, userMessage, assistantMessage: clarify, outputs: [], request: null };
          }

          const res = runGeneration(db, { conversation, task, tool, prompt, options, attachmentIds, userId });
          return {
            conversation,
            userMessage,
            assistantMessage: res.assistantMessage,
            outputs: res.outputs.map((o) => enrichOutput(db, o, { withVersions: true })),
            request: res.request,
          };
        }),
      api: () => apiSend(params),
    }),

  /** Retries a failed assistant message using the preceding user request. */
  retry: (messageId, { generationId } = {}) =>
    call({
      latency: AI_LATENCY,
      mock: () =>
        mutate((db) => {
          const failed = db.messages.find((m) => m.id === messageId);
          if (!failed) throw notFound('Message');
          const conversation = db.conversations.find((c) => c.id === failed.conversationId);
          const task = db.tasks.find((t) => t.id === failed.taskId);
          const idx = db.messages.indexOf(failed);
          const userMsg = db.messages.slice(0, idx).reverse().find((m) => m.role === 'user' && m.conversationId === failed.conversationId);
          if (!userMsg || !conversation || !task) throw new ServiceError('The original request could not be found.');
          db.messages.splice(idx, 1);
          const res = runGeneration(db, {
            conversation,
            task,
            tool: failed.tool,
            prompt: userMsg.generationPrompt || userMsg.content,
            options: userMsg.requestOptions || {},
            attachmentIds: userMsg.attachmentIds || [],
            userId: currentUserId(),
          });
          return { assistantMessage: res.assistantMessage, outputs: res.outputs.map((o) => enrichOutput(db, o, { withVersions: true })) };
        }),
      api: () => apiRetry(messageId, generationId),
    }),

  /**
   * Regenerates an existing output as a NEW draft version (never overwrites).
   * Uses the original prompt/options stored on the conversation's user message.
   */
  regenerate: (outputId, { note } = {}) =>
    call({
      latency: AI_LATENCY,
      mock: () =>
        mutate((db) => {
          const o = db.outputs.find((x) => x.id === outputId);
          if (!o) throw notFound('Output');
          const task = db.tasks.find((t) => t.id === o.taskId);
          const sourceMsg = [...db.messages].reverse().find((m) => m.outputIds?.includes(o.id));
          const userMsg = sourceMsg
            ? db.messages
                .slice(0, db.messages.indexOf(sourceMsg))
                .reverse()
                .find((m) => m.role === 'user' && m.conversationId === sourceMsg.conversationId)
            : null;
          const current = db.versions.find((v) => v.id === o.currentVersionId);
          const prompt = userMsg?.generationPrompt || userMsg?.content || current?.image?.prompt || o.title;
          const options = { ...(userMsg?.requestOptions || {}), count: 1 };
          if (o.kind === 'image' && current?.image) {
            options.width = current.image.requestedWidth;
            options.height = current.image.requestedHeight;
            options.presetId = current.image.presetId;
          }
          const { request } = prepare(db, { taskId: o.taskId, tool: o.tool, prompt, options, conversationId: o.conversationId });
          const g = GENERATORS[o.tool](request, { variantSeed: Date.now() }).outputs[0];
          const prev = db.versions.filter((v) => v.outputId === o.id);
          const v = {
            id: createId('ver'),
            outputId: o.id,
            versionNumber: Math.max(...prev.map((x) => x.versionNumber)) + 1,
            kind: o.kind,
            content: g.content || '',
            sections: g.sections || null,
            image: g.image || null,
            missing: g.missing || null,
            note: note || 'Regenerated',
            status: 'draft',
            approvedAt: null,
            approvedBy: null,
            sourceVersionId: o.currentVersionId,
            createdAt: nowIso(),
            createdBy: currentUserId(),
          };
          db.versions.push(v);
          o.currentVersionId = v.id;
          o.updatedAt = v.createdAt;
          const f = db.files.find((x) => x.id === o.fileId);
          if (f) f.updatedAt = v.createdAt;
          logActivity(db, {
            type: 'output_revised',
            resourceType: 'output',
            resourceId: o.id,
            clientId: o.clientId,
            jobId: o.jobId,
            taskId: o.taskId,
            description: `Regenerated “${o.title}” as v${v.versionNumber}${o.approvedVersionId ? ' — approved version preserved' : ''}`,
          });
          touchTask(db, task?.id);
          return enrichOutput(db, o, { withVersions: true });
        }),
      api: () => apiRegenerate(outputId, note),
    }),

  /** Messages for a conversation with authors (alias of conversationService.get for convenience). */
  messages: (conversationId) =>
    call({
      latency: 120,
      mock: () => {
        const db = getDb();
        return db.messages.filter((m) => m.conversationId === conversationId).map((m) => ({ ...m, user: pickUser(db, m.userId) }));
      },
      api: () => apiClient.get(`/conversations/${conversationId}/messages`),
    }),
};

function summarizeOptions(tool, o) {
  if (tool === 'vehicle') return `Vehicle listing: ${[o.year, o.make, o.model, o.variant].filter(Boolean).join(' ') || 'details supplied in form'}`;
  if (tool === 'advertising') return `Ad copy: ${o.campaignName || 'campaign'}${o.platform ? ` · ${o.platform}` : ''}`;
  return 'Request';
}

/* ───────────────────────── API mode ───────────────────────── */

const GENERATE_PATHS = {
  writing: () => '/ai/writing/generate',
  advertising: () => '/ai/advertising/generate',
  vehicle: () => '/ai/vehicle-description/generate',
  image: (options) => (options?.editOutputId ? '/ai/images/edit' : '/ai/images/generate'),
};

function generationIdOf(data) {
  return data?.generationId || data?.generation?.id || (data?.status && data?.id ? data.id : null);
}

/** Turns a finished generation into the same `{ conversation, userMessage, assistantMessage, outputs, request }` shape as the mock. */
async function collectGeneration(gen, accepted = {}) {
  let outputs = Array.isArray(gen?.outputs) ? gen.outputs : null;
  const outputIds = gen?.outputIds || gen?.assistantMessage?.outputIds || [];
  if (!outputs) {
    outputs = await Promise.all(outputIds.map((id) => apiClient.get(`/outputs/${id}`).then((r) => r.data)));
  }
  const conversation = gen?.conversation || accepted.conversation || (gen?.conversationId ? { id: gen.conversationId } : null);
  return {
    conversation,
    userMessage: gen?.userMessage || accepted.userMessage || null,
    assistantMessage: gen?.assistantMessage || {
      id: gen?.assistantMessageId || null,
      conversationId: conversation?.id || null,
      role: 'assistant',
      status: 'complete',
      outputIds: outputs.map((o) => o.id),
      generationId: gen?.id || null,
    },
    outputs,
    request: gen?.request || accepted.request || null,
  };
}

/**
 * A failed generation is shown like the mock's failed reply (an error message
 * with Retry) instead of a thrown error, so the conversation keeps its context.
 */
function failedGeneration(err, accepted = {}) {
  const gen = err.details?.generation || {};
  return {
    conversation: gen.conversation || accepted.conversation || (gen.conversationId ? { id: gen.conversationId } : null),
    userMessage: gen.userMessage || accepted.userMessage || null,
    assistantMessage: gen.assistantMessage || {
      id: gen.assistantMessageId || null,
      role: 'assistant',
      status: 'error',
      content: err.message,
      outputIds: [],
      generationId: err.generationId,
    },
    outputs: [],
    request: gen.request || accepted.request || null,
    generationId: err.generationId,
  };
}

async function awaitGeneration(res, accepted) {
  const id = generationIdOf(res.data);
  if (!id) return collectGeneration(res.data, accepted);
  try {
    const gen = await pollGeneration(id);
    return await collectGeneration(gen, accepted);
  } catch (err) {
    if (err?.code === 'generation_failed') return failedGeneration(err, accepted);
    throw err;
  }
}

async function apiSend(params) {
  const { taskId, conversationId, tool, prompt, attachmentIds = [], clarifiesMessageId } = params;
  const options = { ...(params.options || {}) };
  const pathFor = GENERATE_PATHS[tool];
  if (!pathFor) throw new ServiceError('Select an AI tool before sending.');
  if (options.editOutputId) options.count = 1;
  const body = {
    taskId,
    conversationId: conversationId || undefined,
    prompt: prompt || '',
    options,
    attachmentIds,
    clarifiesMessageId: clarifiesMessageId || undefined,
  };
  if (tool === 'image' && options.editOutputId) body.outputId = options.editOutputId;
  const res = await apiClient.post(pathFor(options), body, { idempotencyKey: newIdempotencyKey() });
  const data = res.data || {};
  // 200 → a clarifying question (e.g. "which format?"); nothing was queued.
  if (res.status !== 202 && !generationIdOf(data)) {
    return { data: { conversation: data.conversation || null, userMessage: data.userMessage || null, assistantMessage: data.assistantMessage || null, outputs: data.outputs || [], request: data.request || null } };
  }
  return { data: await awaitGeneration(res, data) };
}

async function apiRetry(messageId, generationId) {
  if (!generationId) {
    throw new ServiceError('This request can’t be retried because its generation record is missing. Send the prompt again.', { code: 'no_generation' });
  }
  const res = await apiClient.post(`/ai/generations/${generationId}/retry`, {}, { idempotencyKey: newIdempotencyKey() });
  const result = await awaitGeneration(res, res.data || {});
  return { data: { assistantMessage: result.assistantMessage, outputs: result.outputs, retriedMessageId: messageId } };
}

async function apiRegenerate(outputId, note) {
  const res = await apiClient.post(`/ai/outputs/${outputId}/regenerate`, note ? { note } : {}, { idempotencyKey: newIdempotencyKey() });
  const id = generationIdOf(res.data);
  if (id) await pollGeneration(id);
  else if (res.data?.id === outputId && res.data?.currentVersion) return res;
  // Mock returns the output with its versions.
  return apiClient.get(`/outputs/${outputId}`);
}
