import { describe, expect, it } from 'vitest';
import type { ChangeLine } from '../../shared/contract.ts';
import {
  CONTEXT_LINES,
  diffLines,
  MAX_CHANGE_CHARS,
  MAX_CHANGE_LINES,
  proposedChange,
  revealHidden,
  withGaps,
} from './file-change.ts';

const same = (text: string): ChangeLine => ({ kind: 'same', text });
const removed = (text: string): ChangeLine => ({ kind: 'removed', text });
const added = (text: string): ChangeLine => ({ kind: 'added', text });

describe('diffLines', () => {
  it('marks one changed line between unchanged ones', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([same('a'), removed('b'), added('B'), same('c')]);
  });

  it('shows an insertion and a deletion', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([same('a'), added('b'), same('c')]);
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([same('a'), removed('b'), same('c')]);
  });

  it('treats empty text as no lines', () => {
    expect(diffLines('', 'x\ny')).toEqual([added('x'), added('y')]);
    expect(diffLines('x', '')).toEqual([removed('x')]);
    expect(diffLines('', '')).toEqual([]);
  });

  it('drops a final newline only when both sides end with one', () => {
    expect(diffLines('a\n', 'b\n')).toEqual([removed('a'), added('b')]);
    expect(diffLines('a', 'a\n')).toEqual([same('a'), added('')]);
  });

  it('pairs lines by longest common run, not position', () => {
    expect(diffLines('x\na\nb', 'a\nb\ny')).toEqual([removed('x'), same('a'), same('b'), added('y')]);
  });

  it('falls back to all-removed then all-added when the texts are too big to align', () => {
    const before = Array.from({ length: 1500 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 1500 }, (_, i) => `new ${i}`).join('\n');
    const lines = diffLines(`top\n${before}\nend`, `top\n${after}\nend`);
    expect(lines[0]).toEqual(same('top'));
    expect(lines[1]).toEqual(removed('old 0'));
    expect(lines[1500]).toEqual(removed('old 1499'));
    expect(lines[1501]).toEqual(added('new 0'));
    expect(lines.at(-1)).toEqual(same('end'));
    expect(lines).toHaveLength(3002);
  });
});

describe('withGaps', () => {
  it('folds a long unchanged run in the middle, keeping context either side', () => {
    const middle = Array.from({ length: 10 }, (_, i) => same(`m${i}`));
    const lines = [removed('a'), ...middle, added('z')];
    expect(withGaps(lines)).toEqual([
      removed('a'),
      ...middle.slice(0, CONTEXT_LINES),
      { kind: 'gap', count: 10 - 2 * CONTEXT_LINES },
      ...middle.slice(10 - CONTEXT_LINES),
      added('z'),
    ]);
  });

  it('folds unchanged lines at the start and end down to the context', () => {
    const head = Array.from({ length: 6 }, (_, i) => same(`h${i}`));
    const tail = Array.from({ length: 6 }, (_, i) => same(`t${i}`));
    expect(withGaps([...head, added('x'), ...tail])).toEqual([
      { kind: 'gap', count: 6 - CONTEXT_LINES },
      ...head.slice(6 - CONTEXT_LINES),
      added('x'),
      ...tail.slice(0, CONTEXT_LINES),
      { kind: 'gap', count: 6 - CONTEXT_LINES },
    ]);
  });

  it('never folds a run that is barely longer than the context it keeps', () => {
    const middle = Array.from({ length: 2 * CONTEXT_LINES + 1 }, (_, i) => same(`m${i}`));
    const lines = [removed('a'), ...middle, added('z')];
    expect(withGaps(lines)).toEqual(lines);
  });
});

describe('diffLines: blank lines', () => {
  it('counts a text that is only a line break as one blank line', () => {
    expect(diffLines('\n', '\n\n')).toEqual([same(''), added('')]);
    expect(diffLines('\n', 'x\n')).toEqual([removed(''), added('x')]);
    expect(diffLines('a\n\n', 'a\nx\n')).toEqual([same('a'), removed(''), added('x')]);
  });
});

describe('revealHidden', () => {
  it('shows characters that can change how text looks as visible markers', () => {
    expect(revealHidden('Account: ‮87654321')).toEqual({ text: 'Account: ⟨U+202E⟩87654321', found: true });
    expect(revealHidden('a​b﻿c\u0007')).toEqual({ text: 'a⟨U+200B⟩b⟨U+FEFF⟩c⟨U+0007⟩', found: true });
    expect(revealHidden('mid\rline')).toEqual({ text: 'mid⟨U+000D⟩line', found: true });
  });

  it('leaves ordinary text, tabs, emoji joins and a line-ending carriage return alone', () => {
    for (const text of ['plain', 'a\tb', 'café £5 – “quoted”', 'dev 👩‍💻', 'windows line\r']) {
      expect(revealHidden(text)).toEqual({ text, found: false });
    }
  });

  it('reveals invisible characters outside the basic range, and blank-looking ones', () => {
    const tagged = `ok${[...'ignore'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')}`;
    expect(revealHidden(tagged)).toEqual({
      text: 'ok⟨U+E0069⟩⟨U+E0067⟩⟨U+E006E⟩⟨U+E006F⟩⟨U+E0072⟩⟨U+E0065⟩',
      found: true,
    });
    for (const [ch, code] of [
      ['͏', '034F'],
      ['ᅟ', '115F'],
      ['ㅤ', '3164'],
      ['ﾠ', 'FFA0'],
      ['⠀', '2800'],
      [' ', '2028'],
      [' ', '2029'],
      ['︀', 'FE00'],
      ['\u{E0100}', 'E0100'],
      ['￼', 'FFFC'],
    ] as const) {
      expect(revealHidden(`a${ch}b`)).toEqual({ text: `a⟨U+${code}⟩b`, found: true });
    }
  });

  it('keeps emoji that need a style marker, and the England, Scotland and Wales flags', () => {
    for (const text of ['Love it ❤️', 'Done ✔️', 'Go 🏴󠁧󠁢󠁥󠁮󠁧󠁿 🏴󠁧󠁢󠁳󠁣󠁴󠁿 🏴󠁧󠁢󠁷󠁬󠁳󠁿']) {
      expect(revealHidden(text)).toEqual({ text, found: false });
    }
    // A black flag does not make any tag text after it safe.
    expect(revealHidden(`🏴${String.fromCodePoint(0xe0068)}\u{E007F}`).found).toBe(true);
  });
});

describe('withGaps: very large unchanged text', () => {
  it('does not overflow the stack on hundreds of thousands of unchanged lines', () => {
    const big = 'x\n'.repeat(200_000);
    expect(() =>
      proposedChange('Edit', { file_path: '/b/x.md', old_string: big, new_string: big }, false),
    ).not.toThrow();
  });
});

const lineTexts = (r: ReturnType<typeof proposedChange>, part = 0) => r.change?.parts[part]?.lines ?? [];

describe('proposedChange', () => {
  it('shows an Edit as one part, with replace_all carried', () => {
    const r = proposedChange(
      'Edit',
      { file_path: '/b/x.md', old_string: 'Hello', new_string: 'Hi', replace_all: true },
      false,
    );
    expect(r).toEqual({
      change: { kind: 'edit', parts: [{ everyMatch: true, lines: [removed('Hello'), added('Hi')] }] },
      cut: null,
      hiddenChars: false,
    });
  });

  it('shows each MultiEdit edit as its own part', () => {
    const r = proposedChange(
      'MultiEdit',
      {
        file_path: '/b/x.md',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd', replace_all: true },
        ],
      },
      true,
    );
    expect(r.change?.kind).toBe('edit');
    expect(r.change?.parts).toEqual([
      { everyMatch: false, lines: [removed('a'), added('b')] },
      { everyMatch: true, lines: [removed('c'), added('d')] },
    ]);
  });

  it('shows a Write to a new file as added lines, without a trailing empty line', () => {
    const r = proposedChange('Write', { file_path: '/b/new.md', content: '# Title\n\nBody\n' }, false);
    expect(r.change).toEqual({
      kind: 'new-file',
      parts: [{ everyMatch: false, lines: [added('# Title'), added(''), added('Body')] }],
    });
  });

  it('says a Write to an existing file replaces it', () => {
    const r = proposedChange('Write', { file_path: '/b/x.md', content: 'new' }, true);
    expect(r.change?.kind).toBe('replace-file');
    expect(lineTexts(r)).toEqual([added('new')]);
  });

  it('shows an empty Write as no lines, and a lone line break as one blank line', () => {
    expect(proposedChange('Write', { file_path: '/b/x.md', content: '' }, false).change).toEqual({
      kind: 'new-file',
      parts: [{ everyMatch: false, lines: [] }],
    });
    expect(lineTexts(proposedChange('Write', { file_path: '/b/x.md', content: '\n' }, false))).toEqual([
      added(''),
    ]);
  });

  it('returns nothing for other tools or input it cannot read', () => {
    expect(proposedChange('Bash', { command: 'ls' }, false).change).toBeNull();
    expect(proposedChange('Edit', { file_path: '/b/x.md', old_string: 1 }, false).change).toBeNull();
    expect(proposedChange('Write', { file_path: '/b/x.md' }, false).change).toBeNull();
    expect(proposedChange('MultiEdit', { file_path: '/b/x.md', edits: [] }, false).change).toBeNull();
    expect(
      proposedChange('MultiEdit', { file_path: '/b/x.md', edits: [{ old_string: 'a' }] }, false).change,
    ).toBeNull();
  });

  it('cuts a change that is too long to show, marks the cut, and reports how long it was', () => {
    const line = 'x'.repeat(99);
    const content = Array.from({ length: 1000 }, () => line).join('\n');
    const r = proposedChange('Write', { file_path: '/b/big.txt', content }, false);
    const lines = lineTexts(r);
    const shown = lines.reduce((n, l) => n + ('text' in l ? l.text.length + 1 : 0), 0);
    expect(shown).toBeLessThanOrEqual(MAX_CHANGE_CHARS);
    expect(lines.at(-1)).toEqual({ kind: 'cut' });
    expect(r.cut).toEqual({ lines: 1000, chars: 100 * 1000 });
  });

  it('counts line breaks and lines, so blank-line padding cannot slip past the limit', () => {
    const content = `Hello, updated notes\n${'\n'.repeat(200_000)}rm -rf important\n`;
    const r = proposedChange('Write', { file_path: '/b/notes.md', content }, false);
    const lines = lineTexts(r);
    expect(lines.length).toBeLessThanOrEqual(MAX_CHANGE_LINES + 1);
    expect(lines.at(-1)).toEqual({ kind: 'cut' });
    expect(r.cut?.lines).toBe(200_002);
  });

  it('stops at the line limit even when the lines are short', () => {
    const content = Array.from({ length: MAX_CHANGE_LINES + 5 }, (_, i) => `${i}`).join('\n');
    const r = proposedChange('Write', { file_path: '/b/list.txt', content }, false);
    expect(lineTexts(r)).toHaveLength(MAX_CHANGE_LINES + 1);
    expect(lineTexts(r).at(-1)).toEqual({ kind: 'cut' });
    expect(r.cut?.lines).toBe(MAX_CHANGE_LINES + 5);
  });

  it('cuts one very long line rather than dropping it', () => {
    const r = proposedChange(
      'Write',
      { file_path: '/b/min.js', content: 'y'.repeat(MAX_CHANGE_CHARS * 2) },
      false,
    );
    const [first, second] = lineTexts(r);
    expect(first?.kind).toBe('added');
    expect(first && 'text' in first ? first.text.length : 0).toBe(MAX_CHANGE_CHARS - 1);
    expect(second).toEqual({ kind: 'cut' });
    expect(r.cut).toEqual({ lines: 1, chars: MAX_CHANGE_CHARS * 2 + 1 });
  });

  it('keeps every MultiEdit part when cutting, so the count and every-match notes stay true', () => {
    const r = proposedChange(
      'MultiEdit',
      {
        file_path: '/b/x.md',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'z'.repeat(60_000), new_string: 'short' },
          { old_string: 'secret', new_string: 'gone', replace_all: true },
        ],
      },
      true,
    );
    expect(r.change?.parts).toHaveLength(3);
    expect(r.change?.parts.map((p) => p.everyMatch)).toEqual([false, false, true]);
    expect(lineTexts(r, 0)).toEqual([removed('a'), added('b')]);
    expect(lineTexts(r, 1).at(-1)).toEqual({ kind: 'cut' });
    expect(lineTexts(r, 2)).toEqual([{ kind: 'cut' }]);
    expect(r.cut).not.toBeNull();
  });

  it('makes hidden characters visible in the lines it shows, and says so', () => {
    const r = proposedChange(
      'Edit',
      { file_path: '/b/x.md', old_string: 'Account: 12345678', new_string: 'Account: ‮87654321' },
      false,
    );
    expect(lineTexts(r)).toEqual([removed('Account: 12345678'), added('Account: ⟨U+202E⟩87654321')]);
    expect(r.hiddenChars).toBe(true);
  });
});
