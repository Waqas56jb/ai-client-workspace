import { getDatabase } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { failInterruptedRuns, failRunsById, setRunOutputMessage } from '../repositories/generationRuns.repository.js';
import { insertMessage } from '../repositories/messages.repository.js';
import { DB_TO_TOOL } from '../constants/domain.js';
import { executeRun } from '../services/ai/execution.service.js';

/**
 * In-process generation queue with bounded global concurrency.
 *
 * Requests are accepted (202) after the run row is committed; a worker slot
 * then executes the run as its creator via `withUser` (RLS applies). Runs are
 * durable in the database: runs a process can no longer finish are failed by
 * `markRunsInterrupted()` (at shutdown, after start-up and by a periodic sweep)
 * so conversations never stay "generating" and users can retry them.
 */

export const MAX_GLOBAL_CONCURRENCY = 4;

const pending = [];
const queuedIds = new Set();
let active = 0;
const idleWaiters = [];

function settleIdle() {
  if (active === 0 && pending.length === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
}

function pump() {
  while (active < MAX_GLOBAL_CONCURRENCY && pending.length) {
    const job = pending.shift();
    active += 1;
    Promise.resolve()
      .then(() => executeRun(job.runId, job.userId))
      .catch((err) => logger.error({ runId: job.runId, code: err?.code }, 'generation worker crashed'))
      .finally(() => {
        queuedIds.delete(job.runId);
        active -= 1;
        pump();
        settleIdle();
      });
  }
}

/** Queues a committed run for execution. Duplicate ids are ignored. */
export function enqueueGeneration(runId, userId) {
  if (queuedIds.has(runId)) return;
  queuedIds.add(runId);
  pending.push({ runId, userId });
  setImmediate(pump);
}

/** Resolves once the queue is empty (used by tests and graceful shutdown). */
export function waitForIdle() {
  if (active === 0 && pending.length === 0 && queuedIds.size === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

export function queueStats() {
  return { active, pending: pending.length };
}

const INTERRUPTED_MESSAGE =
  'The AI request was interrupted because the server restarted. No output was created — retry to send the same request again.';

/** When this process started: runs started earlier belong to a previous process. */
export const PROCESS_STARTED_AT = new Date();

/**
 * A run older than this can never still be executing anywhere (provider timeout
 * plus processing for up to four images, with a wide margin).
 */
export function staleRunSeconds() {
  return Math.max(900, Math.ceil((env.OPENAI_TIMEOUT_MS / 1000) * 4));
}

/**
 * Reconciliation: marks queued/running runs that can never complete as failed
 * and adds an assistant error message to their conversation, so a conversation
 * never stays "generating" and the user's concurrency slots are released.
 *
 * - `startedBefore`: runs from a previous process (used at start-up, after the
 *   previous instance has had time to drain).
 * - `olderThanSeconds`: runs older than any run can take (periodic sweep; covers
 *   runs accepted by an old instance during a rolling deploy).
 * - `ids`: specific runs owned by this process (graceful shutdown).
 * Runs still owned by this process are never touched except via `ids`.
 *
 * Uses `withSystem` deliberately: this runs without any request user, across
 * runs created by many users, and only touches run status plus a fixed,
 * non-user-controlled error message. No user data is read or returned.
 */
export async function markRunsInterrupted({ olderThanSeconds = staleRunSeconds(), startedBefore = null, ids = null } = {}) {
  const db = getDatabase();
  const failed = await db.withSystem(async (tx) => {
    const rows = ids
      ? await failRunsById(tx, ids)
      : await failInterruptedRuns(tx, { olderThanSeconds, startedBefore, excludeIds: [...queuedIds] });
    for (const run of rows) {
      const msg = await insertMessage(tx, {
        conversationId: run.conversation_id,
        role: 'assistant',
        content: INTERRUPTED_MESSAGE,
        messageType: 'error',
        metadata: { tool: DB_TO_TOOL[run.tool_type] || null, generationId: run.id, outputIds: [] },
        userId: null,
      });
      await setRunOutputMessage(tx, run.id, msg.id);
    }
    return rows;
  });
  if (failed.length) logger.warn({ count: failed.length }, 'marked interrupted generation runs as failed');
  return failed.length;
}

let sweeper = null;
/**
 * Start-up reconciliation (after `graceMs`, so a previous instance in a rolling
 * deploy can finish its shutdown) plus a periodic sweep for stale runs.
 */
export function startRunReconciliation({ graceMs = 30_000, intervalMs = 60_000 } = {}) {
  const warn = (err) => logger.warn({ err: err?.message }, 'could not reconcile interrupted generation runs');
  const first = setTimeout(() => markRunsInterrupted({ startedBefore: PROCESS_STARTED_AT }).catch(warn), graceMs);
  first.unref();
  sweeper = setInterval(() => markRunsInterrupted().catch(warn), intervalMs);
  sweeper.unref();
  return () => {
    clearTimeout(first);
    clearInterval(sweeper);
  };
}

/**
 * Graceful shutdown: stop taking new work, give running generations up to
 * `timeoutMs` to finish, then mark whatever this process still owns as
 * interrupted (so it can be retried) before the database pool closes.
 */
export async function drainQueue({ timeoutMs = 8_000 } = {}) {
  if (sweeper) clearInterval(sweeper);
  pending.splice(0); // not started: their ids stay in queuedIds and are failed below
  if (active > 0) await Promise.race([new Promise((r) => idleWaiters.push(r)), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  const leftovers = [...queuedIds];
  if (leftovers.length) await markRunsInterrupted({ ids: leftovers }).catch(() => {});
  return leftovers.length;
}
