import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '../config/db.js';
import { validate } from '../middleware/validate.js';
import { handler } from '../utils/response.js';
import { badRequest, notFound } from '../utils/errors.js';
import { getMessageRow } from '../repositories/messages.repository.js';
import { buildDocx, docxFileName } from '../services/exportDocx.service.js';

/**
 * GET /exports/docx — a real Word file of a chat answer (?messageId=) or of a
 * saved draft version (?outputId=&versionId=). Built on request from the stored
 * text (RLS-scoped reads), so it always matches what the chat shows.
 */
const router = Router();
const id = z.guid('Invalid id.');
const query = z
  .object({ messageId: id.optional(), outputId: id.optional(), versionId: id.optional() })
  .refine((q) => q.messageId || (q.outputId && q.versionId), { message: 'Give messageId, or outputId and versionId.' });

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const firstHeading = (text) => String(text || '').match(/^#{1,3}\s+(.+)$/m)?.[1]?.replace(/\*\*/g, '').trim();

router.get(
  '/exports/docx',
  validate({ query }),
  handler(async (req, res) => {
    const { messageId, outputId, versionId } = req.query;
    const doc = await getDatabase().withUser(req.user.id, async (tx) => {
      if (messageId) {
        const row = await getMessageRow(tx, messageId);
        if (!row || row.role !== 'assistant' || row.metadata?.supersededAt) throw notFound('Message');
        if (!String(row.content || '').trim()) throw badRequest('This message has no text to export.');
        const { rows } = await tx.query('select title from public.ai_workspace_conversations where id = $1', [row.conversation_id]);
        return { title: firstHeading(row.content) || rows[0]?.title || 'StudioFlow AI answer', text: row.content };
      }
      const { rows } = await tx.query(
        `select o.title, v.content, v.sections from public.ai_workspace_output_versions v
           join public.ai_workspace_outputs o on o.id = v.output_id
          where v.id = $1 and o.id = $2 and o.archived_at is null and o.output_kind = 'text'`,
        [versionId, outputId],
      );
      if (!rows.length) throw notFound('Version');
      const v = rows[0];
      const text = Array.isArray(v.sections) && v.sections.length ? v.sections.map((s) => `## ${s.label}\n${s.text}`).join('\n\n') : v.content || '';
      return { title: v.title, text };
    });
    const buffer = await buildDocx(doc);
    const name = docxFileName(doc.title);
    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  }),
);

export default router;
