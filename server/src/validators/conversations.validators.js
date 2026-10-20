import { z } from 'zod';
import { TOOL_IDS } from '../constants/domain.js';

const id = z.guid('Invalid id.');
const tool = z.enum(TOOL_IDS);
const title = z.string().trim().min(1, 'Title is required.').max(120);

export const taskParams = z.object({ taskId: id });
export const conversationParams = z.object({ id });

export const listConversationsQuery = z.object({
  includeArchived: z.enum(['true', 'false', 'only']).optional(),
});

export const createConversationBody = z.object({
  title: title.optional().or(z.literal('').transform(() => undefined)),
  tool: tool.nullable().optional(),
});

export const updateConversationBody = z
  .object({
    title: title.optional(),
    tool: tool.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });

export const listMessagesQuery = z.object({
  before: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createMessageBody = z.object({
  content: z.string().trim().min(1, 'Message is required.').max(20000),
  attachmentIds: z.array(id).max(10).optional(),
});

/** GET /conversations — workspace chat history. Dates are ISO instants computed in the user's timezone. */
export const listAllConversationsQuery = z.object({
  search: z.string().trim().max(200).optional(),
  clientId: z.union([id, z.literal(''), z.literal('all')]).optional().transform((v) => (v && v !== 'all' ? v : undefined)),
  tool: z.union([tool, z.literal(''), z.literal('all')]).optional().transform((v) => (v && v !== 'all' ? v : undefined)),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/** POST /assistant/session — the client the AI Assistant chat is for. */
export const assistantSessionBody = z.object({ clientId: id });
