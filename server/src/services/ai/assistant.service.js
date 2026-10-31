import sharp from 'sharp';
import { getDatabase } from '../../config/db.js';
import { env } from '../../config/env.js';
import { resolveTextModel } from '../../constants/models.js';
import { AppError, badRequest, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { getObject } from '../storage.service.js';
import { loadAttachments, loadConversationForTask, loadPreset, loadTaskScope } from './context.service.js';
import { buildFileList, buildImageRegistry, findEntry, imageDataUrl } from './imageRegistry.js';
import { applyMemoryUpdates, clientMemories, latestSummary } from './memory.service.js';
import { extractDocument } from '../documents.service.js';
import { buildRouterInput, routeMessage } from './router.service.js';
import { recordReply, startGeneration, startImageEdit } from './generation.service.js';
import { sourceCanvas, validateDimensions } from './imageProcessing.js';
import { safeError } from './execution.service.js';

/**
 * ChatGPT-style entry point: the user just writes (and adds files); the server
 * works out what is needed and runs the right capability.
 *
 *   1. (tx, read only) trusted context: task → client, this chat's pictures as
 *      "Image N" with their stored ids, the active messages, the new files.
 *   2. Router (text model + small copies of the relevant pictures): answer, write,
 *      generate_image, edit_image, clarify or unsupported, with the picture to
 *      edit, what to change and what to keep.
 *   3. Every picture number is checked against the stored list, then the request
 *      goes to the existing pipeline (runs, versions, approvals, memory):
 *        answer          → text run, mode 'answer' (vision + PDFs)
 *        write           → writing run (the agency's email brief)
 *        generate_image  → image run (new picture, optional references)
 *        edit_image      → stored AI picture → new version of it (exact version)
 *                          uploaded photo    → new picture made from it ('photo_edit')
 *        clarify / unsupported → the question / limitation is stored as the reply
 */

const MAX_ROUTER_IMAGES = 6;
const DOCUMENT_WORDS = /\b(document|doc|docx|file|form|policy|contract|agreement|spreadsheet|sheet|excel|report|presentation|slides?|pdf|attachment|attached|letter|proposal|application)\b/i;

async function loadContext(user, body) {
  return getDatabase().withUser(user.id, async (tx) => {
    const { task, client } = await loadTaskScope(tx, body.taskId);
    if (body.conversationId) await loadConversationForTask(tx, body.conversationId, task);
    const attachments = await loadAttachments(tx, body.attachmentIds, task);
    let registry = await buildImageRegistry(tx, body.conversationId, {
      pendingAttachments: attachments,
    });
    if (body.replacesMessageId) {
      // Edit of an earlier message: decide from the part of the chat that stays.
      const idx = registry.messages.findIndex((m) => m.id === body.replacesMessageId && m.role === 'user');
      if (idx < 0) throw notFound('Message');
      const kept = new Set(registry.messages.slice(0, idx).map((m) => m.id));
      const list = registry.list.filter((e) => e.pending || kept.has(e.messageId)).map((e, i) => ({ ...e, number: i + 1, label: `Image ${i + 1}` }));
      registry = { list, messages: registry.messages.slice(0, idx) };
    }
    const explicit = (body.imageRefs || []).map((r) => findEntry(registry, r));
    if (explicit.some((e) => !e)) throw notFound('Image');
    const preset = body.options?.presetId ? await loadPreset(tx, body.options.presetId, client).catch(() => null) : null;
    const files = await buildFileList(tx, registry.messages, attachments);
    const memories = await clientMemories(tx, client.id);
    const summary = body.conversationId && !body.replacesMessageId ? (await latestSummary(tx, body.conversationId))?.content || null : null;
    return {
      task,
      client,
      attachments,
      registry,
      explicit,
      preset,
      files,
      memories,
      summary,
    };
  });
}

const historyFor = (registry) =>
  registry.messages
    .filter((m) => m.content || m.role === 'user')
    .map((m) => {
      const pics = registry.list.filter((e) => e.messageId === m.id).map((e) => (e.kind === 'upload' ? `[added ${e.label}]` : `[made ${e.label}]`));
      return {
        role: m.role,
        content: [m.content, ...pics].filter(Boolean).join(' '),
      };
    });

/** Picture copies the router looks at: new photos, the user's selection, then the latest pictures. */
async function routerImages(registry, explicit) {
  const chosen = [];
  const push = (e) => e && !chosen.includes(e) && chosen.length < MAX_ROUTER_IMAGES && chosen.push(e);
  registry.list.filter((e) => e.pending).forEach(push);
  explicit.forEach(push);
  registry.list.slice(-3).reverse().forEach(push);
  const out = [];
  for (const e of chosen) {
    const dataUrl = await imageDataUrl(e, { maxEdge: 512 });
    if (dataUrl) out.push({ label: e.label, dataUrl });
  }
  return out;
}

const refOf = (e, role) => (e.kind === 'upload' ? { fileId: e.fileId, role } : { outputId: e.outputId, versionId: e.versionId, role });

async function pixelSize(entry) {
  if (entry.width && entry.height) return { width: entry.width, height: entry.height };
  const meta = await sharp(await getObject(entry.objectPath)).metadata();
  // EXIF rotation swaps the visible width and height
  const rotated = (meta.orientation || 1) >= 5;
  return {
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
  };
}

/**
 * @returns {Promise<{ httpStatus: number, data: object }>}
 */
export async function handleAssistantMessage(user, body, { idempotencyKey } = {}) {
  if (!env.OPENAI_API_KEY) throw new AppError('AI_NOT_CONFIGURED', 'The AI service is not configured on the server. Ask your administrator to set it up.', 503);
  const prompt = String(body.prompt || '').trim();
  if (!prompt && !body.attachmentIds?.length) throw badRequest('Type a message or add a file.');

  const timing = { start: Date.now() };
  const ctx = await loadContext(user, body);
  timing.context = Date.now() - timing.start;
  const { registry, explicit, client } = ctx;
  const routerModel = resolveTextModel(env.OPENAI_ROUTER_MODEL || null);
  if (!routerModel) throw new AppError('AI_CONFIG_ERROR', 'The AI model configured for the assistant is not supported.', 500);

  // The router reads the start of documents added now, so it knows what they are.
  const excerpts = [];
  for (const a of ctx.attachments.filter((x) => x.file_category !== 'image' && x.mime_type !== 'application/pdf').slice(0, 4)) {
    try {
      const doc = await extractDocument(await getObject(a.object_path), a.mime_type);
      if (doc.text)
        excerpts.push({
          name: a.file_name,
          label: ctx.files.find((f) => f.fileId === a.id)?.label || 'the file',
          text: doc.text,
        });
    } catch {
      /* the answer step reports unreadable files */
    }
  }
  const text = buildRouterInput({
    files: ctx.files,
    memories: ctx.memories,
    summary: ctx.summary,
    excerpts,
    client,
    registry,
    history: historyFor(registry),
    firstUserMessage: registry.messages.find((m) => m.role === 'user')?.content,
    prompt,
    attachments: ctx.attachments,
    explicit: explicit[0] || null,
    hints: { format: body.options?.format, tone: body.options?.tone },
  });
  let route;
  try {
    ({ route } = await routeMessage({
      model: routerModel,
      text,
      images: await routerImages(registry, explicit),
    }));
  } catch (err) {
    if (err instanceof AppError) throw err;
    const safe = safeError(err);
    throw new AppError(safe.code, `${safe.message} Your message was not sent — please try again.`, safe.code === 'AI_PROVIDER_BUSY' ? 429 : 502);
  }
  timing.router = Date.now() - timing.start - timing.context;

  const byNumber = (n) => registry.list.find((e) => e.number === n) || null;
  const intent = { action: route.action, summary: route.summary };
  // Files for the task: everything added now, plus earlier files of this chat the router picked.
  let contextFileIds = route.useFiles.map((n) => ctx.files.find((f) => f.number === n && !f.pending)?.fileId).filter(Boolean);
  // Safety net: the message talks about a document but no earlier file was picked → use the latest readable ones.
  if (!contextFileIds.length && ['answer', 'write'].includes(route.action) && DOCUMENT_WORDS.test(prompt) && !ctx.attachments.some((a) => a.file_category !== 'image')) {
    contextFileIds = ctx.files
      .filter((f) => !f.pending && !['failed', 'unsupported'].includes(f.extract?.status))
      .slice(-2)
      .map((f) => f.fileId);
  }
  const common = {
    taskId: body.taskId,
    conversationId: body.conversationId,
    replacesMessageId: body.replacesMessageId,
    attachmentIds: body.attachmentIds || [],
  };
  const withFiles = { ...common, contextFileIds };
  const reply = (message, kind) =>
    recordReply(user, {
      ...common,
      prompt,
      reply: message,
      intent: { ...intent, reply: kind },
    });
  const requestedSize = () => {
    if (!route.width || !route.height) return null;
    validateDimensions(route.width, route.height);
    return { width: route.width, height: route.height };
  };

  const result = await dispatch();
  timing.dispatch = Date.now() - timing.start - timing.context - timing.router;
  // How long each step took (no content), to spot slow providers.
  logger.info({ action: route.action, conversationId: body.conversationId || null, ms: { context: timing.context, router: timing.router, start: timing.dispatch } }, 'assistant route');
  // Lasting facts the user stated (or asked to forget) — stored after the message itself was accepted.
  const userMessageId = result.data?.userMessage?.id;
  if (userMessageId && (route.remember.length || route.forget.length)) {
    try {
      result.data.memoryUpdates = await applyMemoryUpdates(user, {
        clientId: client.id,
        conversationId: result.data.conversation?.id,
        messageId: userMessageId,
        remember: route.remember,
        forget: route.forget,
        memories: ctx.memories,
      });
    } catch (err) {
      logger.warn({ code: err?.code }, 'memory update failed');
    }
  }
  return result;

  async function dispatch() {
    switch (route.action) {
      case 'clarify':
        return reply(route.question || 'Could you tell me a little more about what you need?', 'clarify');
      case 'unsupported':
        return reply(route.limitation || 'Sorry — that is not something I can do here.', 'unsupported');

      case 'answer': {
        const look = [...new Set([...route.lookAtImages.map(byNumber), ...registry.list.filter((e) => e.pending), ...explicit].filter(Boolean))].slice(0, 6);
        return startGeneration(
          user,
          'writing',
          {
            ...withFiles,
            prompt,
            displayContent: prompt,
            generationPrompt: prompt || 'Describe the picture I added in a few sentences, then ask what I would like to do with it.',
            mode: 'answer',
            vision: look.map((e) => refOf(e, 'reference')),
            intent,
          },
          { idempotencyKey },
        );
      }

      case 'write': {
        const format = route.writingFormat !== 'unknown' ? route.writingFormat : body.options?.format || undefined;
        return startGeneration(
          user,
          'writing',
          {
            ...withFiles,
            prompt,
            options: {
              ...(format ? { format } : {}),
              ...(body.options?.tone ? { tone: body.options.tone } : {}),
            },
            intent,
          },
          { idempotencyKey },
        );
      }

      case 'generate_image': {
        const size = requestedSize() || (ctx.preset ? { width: ctx.preset.width_px, height: ctx.preset.height_px } : { width: body.options?.width, height: body.options?.height });
        const refs = [...new Set([...route.referenceImages.map(byNumber), ...explicit].filter(Boolean))].slice(0, 6);
        return startGeneration(
          user,
          'image',
          {
            ...common,
            prompt,
            displayContent: prompt,
            generationPrompt: route.change || prompt,
            options: {
              presetId: ctx.preset?.id,
              width: size.width,
              height: size.height,
              count: 1,
            },
            imageInputs: refs.map((e) => refOf(e, 'reference')),
            intent,
          },
          { idempotencyKey },
        );
      }

      case 'edit_image': {
        // The user's own selection wins; otherwise the router's number; a single picture is unambiguous.
        const source = explicit[0] || byNumber(route.sourceImage) || (registry.list.length === 1 ? registry.list[0] : null);
        if (!source) {
          return reply(
            registry.list.length
              ? `Which picture should I change? ${registry.list.map((e) => e.label).join(', ')}. You can also tap “Edit this image” under it.`
              : 'There is no picture in this chat yet. Tap “Add photo or file” to add the picture you want me to change.',
            'clarify',
          );
        }
        const refs = route.referenceImages
          .map(byNumber)
          .filter((e) => e && e !== source)
          .slice(0, 5);
        const size = requestedSize() || sourceCanvas(...Object.values(await pixelSize(source)));
        validateDimensions(size.width, size.height);
        const edit = {
          change: route.change || prompt,
          preserve: route.preserve,
          scope: route.editScope,
          useBrandStyle: route.useBrandStyle,
          sourceLabel: source.label,
          title: source.name,
        };
        if (source.kind === 'generated') {
          return startImageEdit(
            user,
            {
              outputId: source.outputId,
              versionId: source.versionId,
              conversationId: body.conversationId,
              replacesMessageId: body.replacesMessageId,
              prompt: route.change || prompt,
              displayContent: prompt,
              attachmentIds: refs.filter((e) => e.kind === 'upload').map((e) => e.fileId),
              edit,
              size,
              intent,
              options: {},
            },
            { idempotencyKey },
          );
        }
        return startGeneration(
          user,
          'image',
          {
            ...common,
            prompt,
            displayContent: prompt,
            generationPrompt: route.change || prompt,
            mode: 'photo_edit',
            options: { width: size.width, height: size.height, count: 1 },
            imageInputs: [refOf(source, 'source'), ...refs.map((e) => refOf(e, 'reference'))],
            edit,
            intent,
          },
          { idempotencyKey },
        );
      }

      default:
        throw new AppError('AI_ROUTER_FAILED', 'The assistant could not work out this request. Please try again.', 502);
    }
  }
}
