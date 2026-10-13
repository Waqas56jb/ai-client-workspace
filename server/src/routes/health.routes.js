import { Router } from 'express';
import { getDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { checkBucket } from '../services/storage.service.js';

const router = Router();

/** Liveness: the process is up. No dependency checks, no sensitive data. */
router.get('/', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()) } });
});

/** Readiness: database reachable, schema migrated, private bucket present, AI configured. */
router.get('/ready', async (_req, res) => {
  const checks = { database: false, schema: false, storage: false, ai: Boolean(env.OPENAI_API_KEY) };
  try {
    await getDatabase().withSystem(async (tx) => {
      await tx.query('select 1');
      checks.database = true;
      const { rows } = await tx.query(`select to_regclass('public.ai_workspace_output_versions') is not null as ok`);
      checks.schema = rows[0]?.ok === true;
    });
  } catch {
    /* reported below */
  }
  try {
    const b = await checkBucket();
    checks.storage = b.ok && b.isPrivate === true;
  } catch {
    /* reported below */
  }
  const ready = checks.database && checks.schema && checks.storage;
  res.status(ready ? 200 : 503).json({ success: ready, data: { status: ready ? 'ready' : 'not_ready', checks } });
});

export default router;
