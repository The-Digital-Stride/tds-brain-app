import { describe, expect, it } from 'vitest';
import { KIT_IDS } from '../../shared/kits-contract.ts';
import { createKitPicker, KIT_PICK_SYSTEM_PROMPT, parseKitPick } from './kit-picker.ts';
import { PICK_SYSTEM_PROMPT } from './level-picker.ts';

/** A fake engine that replies once with `result` and records the options it was given. */
function engine(result: string | null, subtype = 'success') {
  const seen: { options?: Record<string, unknown> } = {};
  const query = ((params: { options: Record<string, unknown> }) => {
    seen.options = params.options;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype, result };
      },
      close() {},
    };
  }) as never;
  return { query, seen };
}

describe('parseKitPick', () => {
  it('accepts every known kit, alone or in one fenced block', () => {
    for (const kit of KIT_IDS) expect(parseKitPick(`{"kit":"${kit}"}`)).toEqual({ kit, how: 'auto' });
    expect(parseKitPick('```json\n{"kit":"web"}\n```')).toEqual({ kit: 'web', how: 'auto' });
  });
  it('rejects anything else', () => {
    for (const raw of ['{"kit":"seo"}', '{"tier":"quick"}', 'core', '{"kit":"core"} because', '', '[]'])
      expect(parseKitPick(raw)).toBeNull();
  });
});

describe('createKitPicker', () => {
  it('runs one tool-less Haiku query outside the brain with its own prompt', async () => {
    const e = engine('{"kit":"ads"}');
    const p = createKitPicker({ query: e.query, claudePath: '/bin/claude', env: {} });
    expect(await p.pick('Audit the Google Ads account')).toEqual({ kit: 'ads', how: 'auto' });
    expect(e.seen.options).toMatchObject({
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
    });
    expect(e.seen.options?.systemPrompt).toBe(KIT_PICK_SYSTEM_PROMPT);
  });
  it('falls back to full on a bad reply, an error result, no engine or an empty message', async () => {
    const fallback = { kit: 'full', how: 'fallback' };
    expect(
      await createKitPicker({ query: engine('nope').query, claudePath: '/c', env: {} }).pick('x'),
    ).toEqual(fallback);
    expect(
      await createKitPicker({ query: engine(null, 'error').query, claudePath: '/c', env: {} }).pick('x'),
    ).toEqual(fallback);
    expect(
      await createKitPicker({ query: engine('{"kit":"web"}').query, claudePath: null, env: {} }).pick('x'),
    ).toEqual(fallback);
    expect(
      await createKitPicker({ query: engine('{"kit":"web"}').query, claudePath: '/c', env: {} }).pick('  '),
    ).toEqual(fallback);
  });
  it('never rejects when the engine throws', async () => {
    const query = (() => {
      throw new Error('boom');
    }) as never;
    expect(await createKitPicker({ query, claudePath: '/c', env: {} }).pick('x')).toEqual({
      kit: 'full',
      how: 'fallback',
    });
  });
  it("leaves the level pick's prompt without any kit wording (the level-pick gate)", () => {
    expect(PICK_SYSTEM_PROMPT).not.toMatch(/kit/i);
  });
});
