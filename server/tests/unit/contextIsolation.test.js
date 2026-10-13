import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, provisionUser } from '../helpers/testDb.js';
import { pgliteAdapter, USERS } from '../helpers/testApp.js';
import { loadAttachments, loadInstruction, loadTaskScope } from '../../src/services/ai/context.service.js';
import { buildImagePrompt, buildPreview, buildTextRequest } from '../../src/services/ai/prompt.builder.js';

/**
 * Client isolation: context for a task of client A must never contain any of
 * client B's data, even though B exists in the same workspace.
 */
let adapter;
const ids = {
  clientA: 'aaaaaaaa-0000-4000-8000-000000000001',
  clientB: 'bbbbbbbb-0000-4000-8000-000000000001',
  jobA: 'aaaaaaaa-0000-4000-8000-000000000002',
  jobB: 'bbbbbbbb-0000-4000-8000-000000000002',
  taskA: 'aaaaaaaa-0000-4000-8000-000000000003',
  taskB: 'bbbbbbbb-0000-4000-8000-000000000003',
  fileB: 'bbbbbbbb-0000-4000-8000-000000000004',
};
const B_SECRETS = ['Beta Bakery', '#ABCDEF', '#FEDCBA', 'BETA-ONLY warranty', 'BETA-ONLY terms', 'beta-secret-notes', 'Playful'];

beforeAll(async () => {
  const db = await createTestDb();
  await provisionUser(db, USERS.amelia);
  adapter = pgliteAdapter(db);
  await db.query(
    `insert into public.ai_workspace_clients (id, name, slug, primary_colour, secondary_colour, business_name, approved_warranty_wording, standard_terms, reference_notes, writing_preferences)
     values ($1, 'Alpha Autos', 'alpha-autos', '#111111', '#222222', 'Alpha Autos Ltd', 'Alpha warranty', 'Alpha terms', 'alpha notes', '{"tone":"Warm"}'),
            ($2, 'Beta Bakery', 'beta-bakery', '#ABCDEF', '#FEDCBA', 'Beta Bakery Ltd', 'BETA-ONLY warranty', 'BETA-ONLY terms', 'beta-secret-notes', '{"tone":"Playful"}')`,
    [ids.clientA, ids.clientB],
  );
  await db.query(`insert into public.ai_workspace_jobs (id, client_id, title) values ($1, $2, 'Alpha job'), ($3, $4, 'Beta job')`, [ids.jobA, ids.clientA, ids.jobB, ids.clientB]);
  await db.query(
    `insert into public.ai_workspace_tasks (id, client_id, job_id, title, task_type)
     values ($1, $2, $3, 'Alpha task', 'writing_editing'), ($4, $5, $6, 'Beta task', 'writing_editing')`,
    [ids.taskA, ids.clientA, ids.jobA, ids.taskB, ids.clientB, ids.jobB],
  );
  await db.query(
    `insert into public.ai_workspace_files (id, client_id, file_name, mime_type, file_category, source_type)
     values ($1, $2, 'beta.txt', 'text/plain', 'text', 'reference')`,
    [ids.fileB, ids.clientB],
  );
});

describe('client context isolation', () => {
  it('context and prompts for client A contain nothing from client B', async () => {
    const out = await adapter.withUser(USERS.amelia.id, async (tx) => {
      const scope = await loadTaskScope(tx, ids.taskA);
      const instruction = await loadInstruction(tx, 'writing');
      return { scope, instruction };
    });
    expect(out.scope.client.id).toBe(ids.clientA);
    expect(out.scope.task.client_id).toBe(ids.clientA);

    const { client, job, task } = out.scope;
    const texts = [];
    for (const tool of ['writing', 'advertising', 'vehicle']) {
      const r = buildTextRequest({ tool, instruction: out.instruction, client, job, task, prompt: 'Write something', options: { format: 'email', year: '2020', make: 'A', model: 'B' } });
      texts.push(r.instructions, r.input);
    }
    texts.push(buildImagePrompt({ instruction: out.instruction, client, job, task, prompt: 'Poster', width: 1080, height: 1080 }));
    texts.push(JSON.stringify(buildPreview({ requestId: 'r', tool: 'writing', instruction: out.instruction, client, job, task, prompt: 'x' })));
    const all = texts.join('\n');

    expect(all).toContain('Alpha Autos');
    expect(all).toContain('Alpha warranty');
    for (const secret of B_SECRETS) expect(all).not.toContain(secret);
  });

  it('rejects another client\'s file as an attachment with 404', async () => {
    await expect(
      adapter.withUser(USERS.amelia.id, async (tx) => {
        const { task } = await loadTaskScope(tx, ids.taskA);
        return loadAttachments(tx, [ids.fileB], task);
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
