import { badRequest } from '../utils/errors.js';
import { handler, ok } from '../utils/response.js';
import { idempotencyKey as idempotencySchema } from '../validators/ai.validators.js';
import * as service from '../services/ai/generation.service.js';

/**
 * AI endpoints. Generation is always asynchronous: POSTs respond 202 with a
 * `generationId` to poll via GET /ai/generations/:id (writing clarifications
 * respond 200 because no run is created).
 */

/** Optional `Idempotency-Key` header (8–120 chars of [A-Za-z0-9._:-]). */
function idempotencyKey(req) {
  const raw = req.get('idempotency-key');
  if (raw === undefined || raw === '') return undefined;
  const r = idempotencySchema.safeParse(raw);
  if (!r.success) throw badRequest('The Idempotency-Key header must be 8–120 letters, digits or . _ : - characters.');
  return r.data;
}

const send = (res, { httpStatus, data }, message) => ok(res, data, { status: httpStatus, message });
const accepted = 'Generation started. Poll the generation for its result.';

/** POST /ai/writing/generate */
export const writingGenerate = handler(async (req, res) => {
  const r = await service.startGeneration(req.user, 'writing', req.body, { idempotencyKey: idempotencyKey(req) });
  return send(res, r, r.httpStatus === 202 ? accepted : undefined);
});

/** POST /ai/writing/revise */
export const writingRevise = handler(async (req, res) => send(res, await service.startWritingRevision(req.user, req.body, { idempotencyKey: idempotencyKey(req) }), accepted));

/** POST /ai/advertising/generate */
export const advertisingGenerate = handler(async (req, res) =>
  send(res, await service.startGeneration(req.user, 'advertising', req.body, { idempotencyKey: idempotencyKey(req) }), accepted),
);

/** POST /ai/vehicle-description/generate */
export const vehicleGenerate = handler(async (req, res) =>
  send(res, await service.startGeneration(req.user, 'vehicle', req.body, { idempotencyKey: idempotencyKey(req) }), accepted),
);

/** POST /ai/images/generate */
export const imagesGenerate = handler(async (req, res) => {
  const key = idempotencyKey(req);
  const { editOutputId, editVersionId, ...options } = req.body.options || {};
  if (editOutputId) {
    // "Edit existing image" submitted to the generate endpoint → new version of that output
    const body = {
      outputId: editOutputId,
      versionId: editVersionId,
      conversationId: req.body.conversationId,
      replacesMessageId: req.body.replacesMessageId,
      prompt: req.body.prompt,
      options,
      attachmentIds: req.body.attachmentIds,
    };
    return send(res, await service.startImageEdit(req.user, body, { idempotencyKey: key }), accepted);
  }
  return send(res, await service.startGeneration(req.user, 'image', { ...req.body, options }, { idempotencyKey: key }), accepted);
});

/** POST /ai/images/edit */
export const imagesEdit = handler(async (req, res) => send(res, await service.startImageEdit(req.user, req.body, { idempotencyKey: idempotencyKey(req) }), accepted));

/** GET /ai/generations/:id */
export const getGeneration = handler(async (req, res) => ok(res, await service.getGeneration(req.user, req.params.id)));

/** POST /ai/generations/:id/retry */
export const retryGeneration = handler(async (req, res) => send(res, await service.retryGeneration(req.user, req.params.id), accepted));

/** POST /ai/outputs/:outputId/regenerate */
export const regenerateOutput = handler(async (req, res) =>
  send(res, await service.regenerateOutput(req.user, req.params.outputId, req.body, { idempotencyKey: idempotencyKey(req) }), accepted),
);

/** POST /ai/preview-request — prepared request without instruction text; no model call. */
export const previewRequest = handler(async (req, res) => ok(res, await service.previewRequest(req.user, req.body)));
