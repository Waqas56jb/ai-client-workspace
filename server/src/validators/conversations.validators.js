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
