import { describe, expect, it, vi } from 'vitest';

/**
 * A provider stream that goes silent is abandoned and retried once (before any
 * text arrived); a stall after text has started fails honestly instead of hanging.
 */
process.env.AI_STREAM_IDLE_MS = '150';
const calls = [];
let plan = [];
vi.mock('../../src/config/openai.js', () => ({
  getOpenAI: () => ({
    responses: {
      create: async (params, opts) => {
        calls.push(params);
        const kind = plan.shift();
        return (async function* events() {
          if (kind === 'text-then-hang') yield { type: 'response.output_text.delta', delta: 'Half an ans' };
          if (kind === 'hang' || kind === 'text-then-hang') {
            await new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
          }
          yield { type: 'response.output_text.delta', delta: 'Fine answer.' };
          yield { type: 'response.completed', response: { id: 'r', status: 'completed', usage: {} } };
        })();
      },
    },
  }),
}));
const { generateText } = await import('../../src/services/ai/text.service.js');

describe('stalled answer streams', () => {
  it('a stream silent from the start is retried and the retry answers', async () => {
    plan = ['hang', 'ok'];
    calls.length = 0;
    const deltas = [];
    const r = await generateText({ model: 'gpt-5.4-mini', instructions: 'x', input: 'y', maxTokens: 100, raw: true, onDelta: (d) => deltas.push(d) });
    expect(r.text).toBe('Fine answer.');
    expect(calls).toHaveLength(2);
  });

  it('a stream that stalls after writing fails with a clear, retryable error (no endless wait)', async () => {
    plan = ['text-then-hang', 'ok'];
    calls.length = 0;
    await expect(generateText({ model: 'gpt-5.4-mini', instructions: 'x', input: 'y', maxTokens: 100, raw: true, onDelta: () => {} })).rejects.toMatchObject({ code: 'AI_STREAM_STALLED' });
    expect(calls).toHaveLength(1);
  });
});
