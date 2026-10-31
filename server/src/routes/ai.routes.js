import { Router } from 'express';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/ai.validators.js';
import * as ctrl from '../controllers/ai.controller.js';

/**
 * AI generation routes. Every POST is behind the per-user `aiLimiter`
 * (applied before validation so rejected bodies count too).
 */
const router = Router();

router.post('/ai/writing/generate', aiLimiter, validate({ body: v.writingGenerateBody }), ctrl.writingGenerate);
router.post('/ai/writing/revise', aiLimiter, validate({ body: v.writingReviseBody }), ctrl.writingRevise);
router.post('/ai/advertising/generate', aiLimiter, validate({ body: v.advertisingGenerateBody }), ctrl.advertisingGenerate);
router.post('/ai/vehicle-description/generate', aiLimiter, validate({ body: v.vehicleGenerateBody }), ctrl.vehicleGenerate);
router.post('/ai/images/generate', aiLimiter, validate({ body: v.imageGenerateBody }), ctrl.imagesGenerate);
router.post('/ai/images/edit', aiLimiter, validate({ body: v.imageEditBody }), ctrl.imagesEdit);
router.post('/ai/assistant/message', aiLimiter, validate({ body: v.assistantMessageBody }), ctrl.assistantMessage);
router.get('/ai/generations/:id', validate({ params: v.generationIdParams }), ctrl.getGeneration);
router.post('/ai/generations/:id/retry', aiLimiter, validate({ params: v.generationIdParams }), ctrl.retryGeneration);
router.post('/ai/outputs/:outputId/regenerate', aiLimiter, validate({ params: v.outputIdParams, body: v.regenerateBody }), ctrl.regenerateOutput);
router.post('/ai/preview-request', aiLimiter, validate({ body: v.previewBody }), ctrl.previewRequest);

export default router;
