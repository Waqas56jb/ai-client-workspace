import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/testDb.js';
import { seed } from '../../scripts/lib/seedData.js';

let db;
beforeAll(async () => {
  db = await createTestDb();
});

describe('seed', () => {
  it('inserts instructions, starter presets and settings once', async () => {
    const first = await seed(db);
    expect(first).toEqual({ instructions: 4, presets: 6, settings: 1 });
    const second = await seed(db);
    expect(second).toEqual({ instructions: 0, presets: 0, settings: 0 });
  });

  it('never overwrites edited instructions or presets', async () => {
    await db.query(`update public.ai_workspace_ai_instructions set system_instruction = 'EDITED BY TEAM — keep this instruction intact', version = 7 where tool_type = 'writing_editing'`);
    await db.query(`update public.ai_workspace_image_presets set width_px = 1234 where seed_key = 'square'`);
    await seed(db);
    const i = await db.query(`select system_instruction, version from public.ai_workspace_ai_instructions where tool_type = 'writing_editing'`);
    expect(i.rows[0]).toEqual({ system_instruction: 'EDITED BY TEAM — keep this instruction intact', version: 7 });
    const p = await db.query(`select width_px from public.ai_workspace_image_presets where seed_key = 'square'`);
    expect(p.rows[0].width_px).toBe(1234);
  });

  it('default preset dimensions are valid for image generation', async () => {
    const { rows } = await db.query(`select width_px, height_px from public.ai_workspace_image_presets`);
    rows.forEach((r) => {
      expect(r.width_px).toBeGreaterThanOrEqual(64);
      expect(r.height_px).toBeGreaterThanOrEqual(64);
    });
  });
});
