import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '../config/db.js';
import { validate } from '../middleware/validate.js';
import { handler, ok, created } from '../utils/response.js';
import { AppError, badRequest, notFound } from '../utils/errors.js';
import * as repo from '../repositories/memories.repository.js';

/**
 * What the assistant remembers about a client. The team can read, add and delete
 * these facts; the chat adds them when a user states a lasting fact (see
 * assistant.service.js) and removes them when asked to forget.
 */
const router = Router();
const id = z.guid('Invalid id.');
const clientParams = z.object({ clientId: id });
const memoryParams = z.object({ clientId: id, memoryId: id });
const createBody = z.object({ fact: z.string().trim().min(3, 'Write the fact to remember.').max(500) });

async function assertReady(tx) {
  if (!(await repo.memoryEnabled(tx))) throw new AppError('MEMORY_NOT_SET_UP', 'Client memory is not set up on the server yet (database migration 0005).', 503);
}

async function assertClient(tx, clientId) {
  await assertReady(tx);
  const { rows } = await tx.query('select id from public.ai_workspace_clients where id = $1', [clientId]);
  if (!rows.length) throw notFound('Client');
}

router.get(
  '/clients/:clientId/memories',
  validate({ params: clientParams }),
  handler(async (req, res) =>
    ok(
      res,
      await getDatabase().withUser(req.user.id, async (tx) => {
        await assertClient(tx, req.params.clientId);
        return (await repo.listForClient(tx, req.params.clientId)).map(repo.toMemoryDto);
      }),
    ),
  ),
);

router.post(
  '/clients/:clientId/memories',
  validate({ params: clientParams, body: createBody }),
  handler(async (req, res) =>
    created(
      res,
      await getDatabase().withUser(req.user.id, async (tx) => {
        await assertClient(tx, req.params.clientId);
        if ((await repo.countForClient(tx, req.params.clientId)) >= repo.MAX_MEMORIES_PER_CLIENT) {
          throw badRequest(`This client already has ${repo.MAX_MEMORIES_PER_CLIENT} memories. Delete some first.`);
        }
        const row = await repo.insertMemory(tx, { clientId: req.params.clientId, fact: req.body.fact, userId: req.user.id });
        if (!row) throw badRequest('That is already remembered.');
        return repo.toMemoryDto(row);
      }),
    ),
  ),
);

router.delete(
  '/clients/:clientId/memories/:memoryId',
  validate({ params: memoryParams }),
  handler(async (req, res) => {
    const row = await getDatabase().withUser(req.user.id, async (tx) => {
      await assertReady(tx);
      return repo.deleteMemory(tx, req.params.clientId, req.params.memoryId);
    });
    if (!row) throw notFound('Memory');
    return ok(res, { id: row.id, deleted: true });
  }),
);

export default router;
