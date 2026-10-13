import { z } from 'zod';
import { TOOL_TO_DB } from '../constants/domain.js';
import { IMAGE_QUALITIES } from '../constants/models.js';

const DB_TOOLS = Object.values(TOOL_TO_DB);

/** `:toolType` accepts frontend ids (writing|image|advertising|vehicle) or DB values; parsed to the DB value. */
export const toolParams = z.object({
  toolType: z
    .string()
    .refine((t) => Object.hasOwn(TOOL_TO_DB, t) || DB_TOOLS.includes(t), { message: 'Unknown AI tool.' })
    .transform((t) => (Object.hasOwn(TOOL_TO_DB, t) ? TOOL_TO_DB[t] : t)),
});

const longText = z.string().trim().max(4000);

export const exampleSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Example ids may contain letters, numbers, - and _ only.')
    .optional(),
  input: z.string().trim().min(1, 'Example input is required.').max(4000),
  output: z.string().trim().min(1, 'Example output is required.').max(4000),
});

/** Strict: unknown keys are rejected. Tool-specific model/quality rules are checked in the service. */
export const modelConfigurationSchema = z.strictObject({
  model: z.string().trim().min(1).max(80).optional(),
  maxOutputTokens: z.number().int().min(64).max(8000).optional(),
  quality: z.enum(IMAGE_QUALITIES).optional(),
});

export const updateInstructionBody = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80).optional(),
    description: z.string().trim().max(500).optional(),
    systemInstruction: z.string().trim().min(20, 'System instruction should be at least 20 characters.').max(8000).optional(),
    outputRules: longText.optional(),
    formatting: longText.optional(),
    constraints: longText.optional(),
    examples: z.array(exampleSchema).max(20, 'At most 20 examples are allowed.').optional(),
    active: z.boolean().optional(),
    modelConfiguration: modelConfigurationSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });
