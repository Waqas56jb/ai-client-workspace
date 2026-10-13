#!/usr/bin/env node
/**
 * Seeds application configuration (npm run db:seed). Safe to run repeatedly:
 * every insert is "insert if missing" — existing (possibly edited) AI
 * instructions, presets and workspace settings are NEVER overwritten.
 * Creates no user accounts.
 */
import { createScriptClient } from './lib/pg.js';
import { seed } from './lib/seedData.js';

const client = createScriptClient();
await client.connect();
try {
  await client.query('begin');
  const report = await seed(client);
  await client.query('commit');
  console.log(`Seed complete — inserted ${report.instructions} instruction sets, ${report.presets} presets, ${report.settings} settings row (existing rows untouched).`);
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error(`Seed failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
