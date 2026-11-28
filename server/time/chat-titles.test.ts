import { describe, expect, it } from 'vitest';
import { cleanTitle, TITLE_HINT_CHARS, titleHint } from './chat-titles.ts';

describe('titleHint (decision 32)', () => {
  it('uses a custom title', () => {
    expect(titleHint({ customTitle: 'Homepage audit', summary: 'x', firstPrompt: 'y' })).toBe(
      'Homepage audit',
    );
  });

  it("uses Claude Code's summary when it isn't the first prompt", () => {
    expect(
      titleHint({
        summary: 'Rubber4Roofs keyword research',
        firstPrompt: 'can you look at the r4r keywords',
      }),
    ).toBe('Rubber4Roofs keyword research');
  });

  it('gives null when the summary is only the first prompt (equal, or either a prefix of the other)', () => {
    const firstPrompt = 'Can you look at the  Rubber4Roofs keywords for me please';
    expect(titleHint({ summary: firstPrompt, firstPrompt })).toBeNull();
    expect(titleHint({ summary: 'Can you look at the Rubber4Roofs…', firstPrompt })).toBeNull();
    expect(titleHint({ summary: `${firstPrompt} and the ads too`, firstPrompt })).toBeNull();
    expect(
      titleHint({ summary: 'can you look at the rubber4roofs keywords for me please', firstPrompt }),
    ).toBeNull();
  });

  it('gives null with no title at all, or a summary with no first prompt to tell them apart', () => {
    expect(titleHint(undefined)).toBeNull();
    expect(titleHint({})).toBeNull();
    expect(titleHint({ firstPrompt: 'hello' })).toBeNull();
    expect(titleHint({ summary: 'A summary' })).toBeNull();
    expect(titleHint({ customTitle: '  \n ', summary: '', firstPrompt: 'hi' })).toBeNull();
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
