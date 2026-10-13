import { z } from 'zod';
import { IMAGE_QUALITIES } from '../constants/models.js';
import { WRITING_FORMATS } from '../constants/domain.js';

/**
 * AI request schemas. Object schemas strip unknown keys. Requested image
 * dimensions are range-checked in the service (64…IMAGE_MAX_DIMENSION_PX) so the
 * limit follows configuration.
 */
const id = z.uuid();
const text = (max) => z.string().trim().max(max);
const optText = (max) => text(max).optional().default('');
const scalar = (max) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().max(max))
    .optional()
    .default('');

const attachmentIds = z.array(id).max(10).optional().default([]);
const base = {
  taskId: id,
  conversationId: id.optional(),
  attachmentIds,
};

export const generationIdParams = z.object({ id });
export const outputIdParams = z.object({ outputId: id });

const writingOptions = z
  .object({
    format: z.enum(WRITING_FORMATS).optional(),
    tone: optText(40),
    length: optText(20),
  })
  .optional()
  .default({});

export const writingGenerateBody = z.object({
  ...base,
  prompt: optText(8000),
  options: writingOptions,
  clarifiesMessageId: id.optional(),
});

export const writingReviseBody = z.object({
  outputId: id,
  versionId: id.optional(),
  instructions: text(4000).min(1, 'Describe the revision you want.'),
});

const AD_TYPES = ['social', 'search', 'promo', 'headlines', 'short', 'cta'];
export const advertisingGenerateBody = z.object({
  ...base,
  prompt: optText(8000),
  options: z.object({
    campaignName: optText(120),
    platform: optText(60),
    objective: optText(60),
    audience: optText(500),
    product: optText(1000),
    tone: optText(40),
    length: optText(20),
    cta: optText(120),
    instructions: optText(4000),
    outputTypes: z.array(z.enum(AD_TYPES)).max(6).optional().default([]),
  }),
});

const required = (label) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().min(1, `${label} is required.`).max(60));

export const vehicleGenerateBody = z.object({
  ...base,
  prompt: optText(8000),
  options: z.object({
    year: required('Year').refine((v) => /^\d{4}$/.test(v), 'Year must be a 4-digit year.'),
    make: required('Make'),
    model: required('Model'),
    variant: scalar(80),
    mileage: scalar(40),
    fuelType: scalar(40),
    transmission: scalar(40),
    colour: scalar(40),
    condition: scalar(60),
    ownership: scalar(200),
    serviceHistory: scalar(400),
    warranty: scalar(2000),
    features: z.array(text(120)).max(40).optional().default([]),
    stockRef: scalar(60),
    instructions: optText(4000),
  }),
});

const dimension = z.coerce.number({ error: 'Width and height must be numbers.' });

export const imageGenerateBody = z.object({
  ...base,
  prompt: text(4000).min(1, 'Describe the image you want.'),
  options: z.object({
    presetId: id.optional().or(z.literal('').transform(() => undefined)),
    width: dimension.optional(),
    height: dimension.optional(),
    count: z.coerce.number().int().min(1).max(4).optional().default(1),
    quality: z.enum(IMAGE_QUALITIES).optional(),
    overlayLogo: z.boolean().optional().default(false),
    // Sent by the UI when "Edit existing image" is active → handled as an image edit.
    editOutputId: id.optional().or(z.literal('').transform(() => undefined)).or(z.null().transform(() => undefined)),
  }),
});

export const imageEditBody = z.preprocess(
  (b) => (b && typeof b === 'object' && !b.outputId && b.options?.editOutputId ? { ...b, outputId: b.options.editOutputId } : b),
  z.object({
    outputId: id,
    conversationId: id.optional(),
    attachmentIds,
    prompt: text(4000).min(1, 'Describe the edit you want.'),
    options: z
      .object({
        quality: z.enum(IMAGE_QUALITIES).optional(),
        overlayLogo: z.boolean().optional().default(false),
      })
      .optional()
      .default({ overlayLogo: false }),
  }),
);

export const regenerateBody = z.object({ note: optText(500) });

export const previewBody = z.object({
  ...base,
  tool: z.enum(['writing', 'image', 'advertising', 'vehicle']),
  prompt: optText(8000),
  options: z.record(z.string(), z.unknown()).optional().default({}),
});

export const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,120}$/);
