import { z } from 'zod';

/*
 * Shared field schemas for the core modules (clients, jobs, tasks, users,
 * activity, dashboard, settings) plus the client-specific schemas.
 */

/** UUID path/query id. */
export const id = z.uuid({ message: 'Must be a valid id.' });

/** Optional query flag accepting true/false/1/0/yes/no. */
export const flag = z.stringbool().optional();

/** Pagination query fields shared by every paginated list. */
export const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
};

/** Optional text field: trimmed, bounded, defaults left to the database. */
export const text = (max) => z.string().trim().max(max);

/** Optional e-mail field that also accepts an empty string (meaning "none"). */
export const optionalEmail = z.union([z.literal(''), z.email({ message: 'Enter a valid email address.' }).max(320)]);

/** Optional search string (bounded so it cannot be abused). */
export const search = z.string().trim().max(200).optional();

export const clientIdParams = z.object({ clientId: id });

const HEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const hex = z.string().trim().regex(HEX, { message: 'Use a hex colour such as #1A2B3C.' });
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const clientFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80)
    .regex(SLUG, { message: 'Use lowercase letters, numbers and single hyphens only.' }),
  industry: text(80),
  status: z.enum(['active', 'prospect']),
  description: text(1000),
  address: text(240),
  contactName: text(80),
  email: optionalEmail,
  phone: text(40),
  website: text(300),
  notes: text(2000),
};

/** Brand profile fields (all optional for partial updates). */
export const brandSchema = z
  .object({
    logoFileId: id.nullable(),
    primaryColor: hex,
    secondaryColor: hex,
    accentColor: hex,
    backgroundColor: hex,
    fontFamily: text(80),
    headingFont: text(80),
    bodyFont: text(80),
    guidelines: text(4000),
    businessName: text(160),
    address: text(240),
    phone: text(40),
    email: optionalEmail,
    website: text(300),
    tone: text(60),
    formality: text(60),
    spelling: text(60),
    useWords: text(2000),
    avoidWords: text(2000),
    formatting: text(2000),
    writingInstructions: text(4000),
    warranty: text(4000),
    disclaimers: text(4000),
    terms: text(4000),
    legal: text(4000),
    referenceNotes: text(4000),
    productInfo: text(4000),
    targetAudience: text(1000),
    imageStyle: text(1000),
    otherInstructions: text(4000),
  })
  .partial();

export const createClientSchema = z.object({
  ...clientFields,
  slug: clientFields.slug.optional(),
  status: clientFields.status.optional(),
  industry: clientFields.industry.optional(),
  description: clientFields.description.optional(),
  address: clientFields.address.optional(),
  contactName: clientFields.contactName.optional(),
  email: clientFields.email.optional(),
  phone: clientFields.phone.optional(),
  website: clientFields.website.optional(),
  notes: clientFields.notes.optional(),
  brand: brandSchema.optional(),
});

export const updateClientSchema = z
  .object(clientFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const updateBrandSchema = brandSchema.refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one brand field to update.' });

export const listClientsQuery = z.object({
  search,
  status: z.enum(['active', 'prospect', 'archived', 'all']).optional(),
  includeArchived: flag,
  sort: z.enum(['recent', 'name', 'created', 'jobs']).optional(),
  ...pageFields,
});

export const clientActivityQuery = z.object({ limit: pageFields.limit });

export const clientFilesQuery = z.object({ ...pageFields });
