/**
 * Live text of answers that are still being written, so the chat can show them
 * token by token (GET /ai/generations/:id/stream).
 *
 * In-process, like the generation queue (the API runs as ONE replica). It holds
 * only the text of runs in progress, and forgets a run shortly after it ends —
 * the finished answer is always read from the database. If a viewer connects
 * late it first gets everything written so far.
 */

const runs = new Map(); // runId → { text, done, status, listeners: Set<fn> }
const KEEP_AFTER_DONE_MS = 60_000;

function entry(runId) {
  if (!runs.has(runId)) runs.set(runId, { text: '', done: false, status: 'running', listeners: new Set() });
  return runs.get(runId);
}

export function startStream(runId) {
  entry(runId);
}

export function pushText(runId, delta) {
  if (!delta) return;
  const e = entry(runId);
  if (e.done) return;
  e.text += delta;
  for (const fn of e.listeners) fn({ type: 'delta', text: delta });
}

/** Marks the run finished (succeeded | failed) and tells everyone watching. */
export function endStream(runId, status) {
  const e = runs.get(runId);
  if (!e || e.done) return;
  e.done = true;
  e.status = status;
  for (const fn of e.listeners) fn({ type: 'done', status });
  e.listeners.clear();
  setTimeout(() => runs.delete(runId), KEEP_AFTER_DONE_MS).unref?.();
}

/**
 * @param {string} runId
 * @param {(event: { type: 'snapshot'|'delta'|'done', text?: string, status?: string }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(runId, fn) {
  const e = runs.get(runId);
  if (!e) {
    fn({ type: 'idle' }); // nothing streaming for this run (finished long ago, not text, or another process)
    return () => {};
  }
  fn({ type: 'snapshot', text: e.text });
  if (e.done) {
    fn({ type: 'done', status: e.status });
    return () => {};
  }
  e.listeners.add(fn);
  return () => e.listeners.delete(fn);
}

/** For tests. */
export const _streams = runs;
