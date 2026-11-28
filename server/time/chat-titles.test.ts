import { describe, expect, it } from 'vitest';
import {
  type ChatTitleSource,
  cardRestricted,
  cleanTitle,
  TITLE_HINT_CHARS,
  titleHint,
} from './chat-titles.ts';

describe('titleHint (decision 32)', () => {
  it('uses the custom or AI title (the SDK puts the AI title in customTitle)', () => {
    expect(titleHint({ customTitle: 'Homepage audit' })).toBe('Homepage audit');
  });

  it("never uses the sessions list's summary: it can be the person's latest prompt", () => {
    // listSessions builds `summary` as customTitle, aiTitle, lastPrompt, summary, firstPrompt: with no
    // title it is prompt text. Passed through anyway (a wider object), it must give no hint.
    const latestPrompt: ChatTitleSource & { summary: string; firstPrompt: string } = {
      summary: 'now check the r4r ads too',
      firstPrompt: 'can you look at the r4r keywords',
    };
    expect(titleHint(latestPrompt)).toBeNull();
    const titled = { customTitle: 'Rubber4Roofs keyword research', summary: 'Rubber4Roofs keyword research' };
    expect(titleHint(titled)).toBe('Rubber4Roofs keyword research');
  });

  it('gives null with no title at all', () => {
    expect(titleHint(undefined)).toBeNull();
    expect(titleHint({})).toBeNull();
    expect(titleHint({ customTitle: '  \n ' })).toBeNull();
  });

  it('a project with no card counts as restricted (fails closed)', () => {
    expect(cardRestricted(null)).toBe(true);
    expect(cardRestricted(undefined)).toBe(true);
    expect(cardRestricted({ visibility: 'restricted' })).toBe(true);
    expect(cardRestricted({ visibility: 'everyone' })).toBe(false);
    expect(cardRestricted({})).toBe(false);
  });

  it('strips control characters and keeps one line', () => {
    const bell = String.fromCharCode(7);
    const override = String.fromCharCode(0x202e);
    expect(titleHint({ customTitle: `Line one\nLine\ttwo${bell}${override} end\r\n` })).toBe(
      'Line one Line two end',
    );
  });

  it(`cuts to ${TITLE_HINT_CHARS} characters with an ellipsis`, () => {
    const long = 'word '.repeat(40);
    const hint = titleHint({ customTitle: long }) as string;
    expect(Array.from(hint).length).toBeLessThanOrEqual(TITLE_HINT_CHARS);
    expect(hint.endsWith('…')).toBe(true);
    expect(cleanTitle('a'.repeat(80))).toBe('a'.repeat(80));
    expect(cleanTitle('a'.repeat(81))).toBe(`${'a'.repeat(79)}…`);
    // Never splits a character made of two code units.
    expect(cleanTitle('😀'.repeat(90))).toBe(`${'😀'.repeat(79)}…`);
  });
});
