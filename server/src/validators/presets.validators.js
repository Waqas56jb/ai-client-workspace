import { z } from 'zod';
import { env } from '../config/env.js';

const id = z.guid('Invalid id.');
const dimension = z.coerce
  .number({ error: 'Must be a number.' })
  .int('Must be a whole number of pixels.')
  .min(64, 'Must be at least 64 px.')
  // Same ceiling as generation (IMAGE_MAX_DIMENSION_PX) so every saved preset is usable.
  .max(env.IMAGE_MAX_DIMENSION_PX, `Must be at most ${env.IMAGE_MAX_DIMENSION_PX} px.`);
const text = (max) => z.string().trim().max(max);
const optionalClientId = z.union([id, z.literal('')]).optional();

export const presetParams = z.object({ id });

export const listPresetsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  scope: z.enum(['all', 'global', 'client']).optional(),
  clientId: z.union([id, z.literal('all'), z.literal('')]).optional(),
  forClientId: z.union([id, z.literal('')]).optional(),
  includeArchived: z.enum(['true', 'false', 'only']).optional(),
});

const fields = {
  name: z.string().trim().min(2, 'Preset name must be at least 2 characters.').max(60),
  description: text(300).optional(),
  width: dimension,
  height: dimension,
  scope: z.enum(['global', 'client']),
  clientId: optionalClientId,
  resizeStrategy: z.enum(['cover', 'contain', 'fill']).optional(),
  background: text(200).optional(),
  layout: text(2000).optional(),
  typography: text(2000).optional(),
  brandColors: text(1000).optional(),
  logoPlacement: text(500).optional(),
  safeArea: text(500).optional(),
};

const clientRequired = (v) => v.scope !== 'client' || !!v.clientId;
const clientMsg = { path: ['clientId'], message: 'Select a client for a client-specific preset.' };

export const createPresetBody = z.object({ ...fields, scope: fields.scope.default('global') }).refine(clientRequired, clientMsg);

export const updatePresetBody = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.optional()])))
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });
