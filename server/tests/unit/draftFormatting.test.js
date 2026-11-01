import { describe, expect, it } from 'vitest';
import { buildTextRequest, normaliseInstruction, WRITING_LAYOUT } from '../../src/services/ai/prompt.builder.js';
import { markdownToPlain } from '../../src/utils/markdown.js';

// The live writing instruction (v8) still says "no bold"; the layout rule must follow it and win.
const instruction = normaliseInstruction({ id: 'i1', name: 'Writing', version: 8, system_instruction: 'Write client messages.', formatting_preferences: 'Plain text. Short paragraphs. No markdown, no headings, no bold, no emojis.' });
const client = { id: 'c1', name: 'Acme' };

describe('draft formatting (client report: bold headings came out as asterisks)', () => {
  it('writing requests carry the layout rule after the stored formatting preference', () => {
    const r = buildTextRequest({ tool: 'writing', instruction, client, prompt: 'Make the headings in my email bold.' });
    expect(r.instructions).toContain(WRITING_LAYOUT);
    expect(r.instructions.indexOf(WRITING_LAYOUT)).toBeGreaterThan(r.instructions.indexOf('no bold'));
    expect(WRITING_LAYOUT).toMatch(/ALWAYS do it by wrapping exactly those words in \*\*double asterisks\*\*/);
    expect(WRITING_LAYOUT).toMatch(/keep its existing bold/);
  });

  it('other tools do not get it', () => {
    expect(buildTextRequest({ tool: 'vehicle', instruction, client, prompt: 'x' }).instructions).not.toContain(WRITING_LAYOUT);
  });

  it('a .txt download has no markdown symbols', () => {
    const md = '# Title\n\nHi **Muhammad**,\n\n**Payment summary**\n\n- **ERP:** $1,800 *pending*\n- EOS: 2 * 3 = 6\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nUse `code` and snake_case_name.';
    expect(markdownToPlain(md)).toBe('Title\n\nHi Muhammad,\n\nPayment summary\n\n• ERP: $1,800 pending\n• EOS: 2 * 3 = 6\n\nA\tB\n1\t2\n\nUse code and snake_case_name.');
  });
});
