import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api, closeDb, createQaClient, createQaJob, createQaTask, dbRead, expectSafeError, get, post, record, SERVER_ROOT, sleep, waitForGeneration,
} from './helpers/live.js';

/**
 * Fault injection: extra API instances run against the real database/storage
 * with ONE dependency broken. OpenAI faults use a local fake endpoint
 * (OPENAI_BASE_URL) so provider errors cost nothing. Nothing destructive is done:
 * the database fault is a refused port (never a wrong password, which could get
 * the shared pooler to ban this IP).
 */

const LOG_DIR = path.join(SERVER_ROOT, 'tests/live/.runs');
const children = [];

/** The parent env minus vitest's worker settings (NODE_OPTIONS loaders etc. break a plain node child). */
function childEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|NODE_OPTIONS|NODE_ENV|TEST$)/.test(k)));
  return { ...env, ...extra };
}

function startApi(port, envOverrides) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(LOG_DIR, `fault-api-${port}.log`));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVER_ROOT,
    env: childEnv({ NODE_ENV: 'development', PORT: String(port), LOG_LEVEL: 'warn', ...envOverrides }),
    stdio: ['ignore', 'pipe', 'pipe'], // (file-descriptor stdio does not work from a vitest worker on Windows)
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return `http://localhost:${port}/api/v1`;
}
async function waitUp(base) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  throw new Error(`API at ${base} did not start`);
}

// ── fake OpenAI ────────────────────────────────────────────────────────────────
let mode = 'ok';
let hits = 0;
const fakeOpenAI = http.createServer((req, res) => {
  hits += 1;
  req.resume();
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'x-request-id': 'req_fake' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const response = (text, status = 'completed') => ({
    id: 'resp_fake', object: 'response', created_at: 0, status, model: 'gpt-5.4-mini',
    output: text === null ? [] : [{ type: 'message', id: 'msg_fake', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
  });
  switch (mode) {
    case 'ok': return send(200, response('Subject: Recovered\n\nThis is the recovered draft.\n\nKind regards'));
    case '429': return send(429, { error: { message: 'Rate limit reached for org-SECRETORG', type: 'requests', code: 'rate_limit_exceeded' } });
    case '500': return send(500, { error: { message: 'internal upstream failure at db-shard-7', type: 'server_error' } });
    case '401': return send(401, { error: { message: 'Incorrect API key provided: sk-abc***', type: 'invalid_request_error', code: 'invalid_api_key' } });
    case 'malformed': return send(200, '<html>gateway</html>', 'text/html');
    case 'empty': return send(200, response(''));
    case 'incomplete': return send(200, response('Subject: Half\n\nThis is cut o', 'incomplete'));
    case 'hang': return undefined; // never answers → client timeout
    default: return send(500, {});
  }
});

describe('fault injection (live)', () => {
  let task;
  let aiBase;
  beforeAll(async () => {
    await new Promise((r) => fakeOpenAI.listen(0, '127.0.0.1', r));
    const { port } = fakeOpenAI.address();
    aiBase = startApi(5071, { OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`, OPENAI_API_KEY: 'sk-fake-key-for-fault-tests', OPENAI_TIMEOUT_MS: '5000' });
    await waitUp(aiBase);
    const c = await createQaClient('Faults');
    const j = await createQaJob(c.id, 'Faults job');
    task = await createQaTask(c.id, j.id, 'Faults task');
  });
  afterAll(async () => {
    children.forEach((c) => c.kill());
    fakeOpenAI.close();
    await closeDb();
  });

  const start = () => api('POST', '/ai/writing/generate', { base: aiBase, body: { taskId: task.id, prompt: 'Email about our new opening hours', options: { format: 'email' } } });

  it.each([
    ['429', 'AI_PROVIDER_BUSY'],
    ['500', 'AI_UNAVAILABLE'],
    ['401', 'AI_PROVIDER_AUTH'],
    ['malformed', null],
    ['empty', 'AI_EMPTY_RESPONSE'],
    ['incomplete', 'AI_INCOMPLETE'],
    ['hang', 'AI_TIMEOUT'],
  ])('provider fault %s → run failed (%s), safe error message, no output, nothing leaked', async (m, code) => {
    mode = m;
    const s = await start();
    expect(s.status).toBe(202);
    const run = await waitForGeneration(s.data.generationId, { base: aiBase, timeoutMs: 90_000 });
    expect(run.status).toBe('failed');
    const [row] = await dbRead('select status, error_code, error_message, output_metadata from public.ai_workspace_generation_runs where id = $1', [s.data.generationId]);
    record('generation', s.data.generationId, { fault: m });
    if (code) expect(row.error_code).toBe(code);
    else expect(row.error_code).toMatch(/^AI_/);
    expect(row.error_message).not.toMatch(/SECRETORG|db-shard|sk-abc|gateway|html/i);
    const outs = await dbRead('select count(*)::int n from public.ai_workspace_outputs where conversation_id = $1', [s.data.conversation.id]);
    expect(outs[0].n).toBe(0);
    const msgs = await dbRead(`select content from public.ai_workspace_messages where conversation_id = $1 and message_type = 'error'`, [s.data.conversation.id]);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toMatch(/retry/i);
    const poll = await get(`/ai/generations/${s.data.generationId}`, { base: aiBase });
    expect(JSON.stringify(poll.json)).not.toMatch(/SECRETORG|db-shard|sk-abc|sk-fake/);
  }, 120_000);

  it('a failed run can be retried once the provider recovers, producing exactly one output', async () => {
    mode = '500';
    const s = await start();
    expect((await waitForGeneration(s.data.generationId, { base: aiBase, timeoutMs: 60_000 })).status).toBe('failed');
    mode = 'ok';
    const retry = await api('POST', `/ai/generations/${s.data.generationId}/retry`, { base: aiBase, body: {} });
    expect(retry.status).toBe(202);
    const dup = await api('POST', `/ai/generations/${s.data.generationId}/retry`, { base: aiBase, body: {} });
    expect([409, 429]).toContain(dup.status); // already queued/running — no duplicate run
    const run = await waitForGeneration(s.data.generationId, { base: aiBase });
    expect(run.status).toBe('succeeded');
    const outs = await dbRead('select count(*)::int n from public.ai_workspace_outputs where conversation_id = $1', [s.data.conversation.id]);
    expect(outs[0].n).toBe(1);
  }, 120_000);

  it('the same Idempotency-Key submitted twice (double click) creates one run', async () => {
    mode = 'ok';
    const key = `qa-dbl-${Date.now()}`;
    const body = { taskId: task.id, prompt: 'Email about parking', options: { format: 'email' } };
    const [a, b] = await Promise.all([
      api('POST', '/ai/writing/generate', { base: aiBase, body, headers: { 'Idempotency-Key': key } }),
      api('POST', '/ai/writing/generate', { base: aiBase, body, headers: { 'Idempotency-Key': key } }),
    ]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.data.generationId).toBe(b.data.generationId);
    await waitForGeneration(a.data.generationId, { base: aiBase });
  });

  it('database unreachable → readiness 503 and requests fail with a safe error', async () => {
    const base = startApi(5072, { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '1', DATABASE_URL: '' });
    await waitUp(base);
    const ready = await fetch(`${base}/health/ready`);
    expect(ready.status).toBe(503);
    expect((await ready.json()).data.checks.database).toBe(false);
    const r = await api('GET', '/clients', { base });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expectSafeError(r, r.status, expect);
    expect(JSON.stringify(r.json)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|password/);
  }, 60_000);

  it('storage unavailable → upload fails safely and leaves no database record', async () => {
    const base = startApi(5073, { STORAGE_BUCKET: 'ai-workspace-files-qa-missing' });
    await waitUp(base);
    const before = await dbRead('select count(*)::int n from public.ai_workspace_files where client_id = $1', [task.clientId]);
    const form = new FormData();
    form.append('clientId', task.clientId);
    form.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'hello.txt');
    const r = await api('POST', '/files/upload', { base, form });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expectSafeError(r, r.status, expect);
    const after = await dbRead('select count(*)::int n from public.ai_workspace_files where client_id = $1', [task.clientId]);
    expect(after[0].n).toBe(before[0].n);
    const ready = await fetch(`${base}/health/ready`);
    expect((await ready.json()).data.checks.storage).toBe(false);
  }, 60_000);

  it('AI not configured → generation is refused up front with a clear error (no run created)', async () => {
    const base = startApi(5074, { OPENAI_API_KEY: '' });
    await waitUp(base);
    const before = await dbRead('select count(*)::int n from public.ai_workspace_generation_runs where task_id = $1', [task.id]);
    const r = await api('POST', '/ai/writing/generate', { base, body: { taskId: task.id, prompt: 'Email about x', options: { format: 'email' } } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expectSafeError(r, r.status, expect);
    const after = await dbRead('select count(*)::int n from public.ai_workspace_generation_runs where task_id = $1', [task.id]);
    expect(after[0].n).toBe(before[0].n);
  }, 60_000);

  it('invalid configuration stops the process without printing secrets', async () => {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: SERVER_ROOT,
      env: childEnv({ PORT: '5075', SUPABASE_URL: 'not-a-url' }),
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const code = await new Promise((r) => child.on('exit', r));
    expect(code).not.toBe(0);
    expect(output).toMatch(/SUPABASE_URL/);
    for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.OPENAI_API_KEY, process.env.DATABASE_PASSWORD]) expect(output.includes(secret)).toBe(false);
  }, 30_000);
});
