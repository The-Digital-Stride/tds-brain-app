// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.tsx';

function table(...lines: string[]) {
  const box = document.createElement('div');
  box.innerHTML = renderMarkdown(lines.join('\n'));
  const text = (sel: string) => Array.from(box.querySelectorAll(sel), (c) => c.textContent);
  return {
    box,
    head: text('th'),
    rows: Array.from(box.querySelectorAll('tbody tr'), (r) =>
      Array.from(r.querySelectorAll('td'), (c) => c.textContent),
    ),
  };
}

const HEAD = '| Campaign | Now | Proposed |';
const RULE = '|---|---:|---:|';

describe('pipes inside code in a table', () => {
  it('keeps a campaign name in one cell, so no value is dropped', () => {
    const t = table(
      HEAD,
      RULE,
      '| `TDS | Search | Brand` | £100 | £150 |',
      '| `TDS | PMax | Photobooks & Calendars` | £80 | £116 |',
      '| Total | £180 | **£266** |',
    );
    expect(t.rows).toEqual([
      ['TDS | Search | Brand', '£100', '£150'],
      ['TDS | PMax | Photobooks & Calendars', '£80', '£116'],
      ['Total', '£180', '£266'],
    ]);
    expect(t.box.querySelectorAll('td code')).toHaveLength(2);
  });

  it('keeps the column alignment the table asks for', () => {
    const t = table(HEAD, RULE, '| A | 1 | 2 |');
    const align = Array.from(t.box.querySelectorAll('td'), (c) => c.getAttribute('align'));
    expect(align).toEqual([null, 'right', 'right']);
  });

  it('leaves an already escaped pipe as one pipe', () => {
    const t = table(HEAD, RULE, '| `A \\| B | C` | 1 | 2 |', '| `D \\| E` | 3 | 4 |');
    expect(t.rows).toEqual([
      ['A | B | C', '1', '2'],
      ['D | E', '3', '4'],
    ]);
  });

  it('works in the header, without outer pipes, and with double backticks', () => {
    const t = table('`A | B` | Spend', '---|---', '``C | `D` `` | £1');
    expect(t.head).toEqual(['A | B', 'Spend']);
    // Markdown strips the padding space only when both ends have one.
    expect(t.rows).toEqual([['C | `D` ', '£1']]);
  });

  it('works inside a quote and a list', () => {
    const quoted = table(`> ${HEAD}`, `> ${RULE}`, '> | `A | B` | 1 | 2 |');
    expect(quoted.rows).toEqual([['A | B', '1', '2']]);
    const listed = table('- item', '', `  ${HEAD}`, `  ${RULE}`, '  | `A | B` | 1 | 2 |');
    expect(listed.rows).toEqual([['A | B', '1', '2']]);
  });

  it('does not join cells in a row that already fits, even with stray backticks', () => {
    const t = table(HEAD, RULE, '| ` | backtick | ` |');
    expect(t.rows).toEqual([['`', 'backtick', '`']]);
  });

  it('carries on with the text after the table', () => {
    const t = table(HEAD, RULE, '| `A | B` | 1 | 2 |', '', 'After `x | y` the table.');
    expect(t.box.querySelector('p')?.textContent).toBe('After x | y the table.');
    expect(t.box.querySelectorAll('table')).toHaveLength(1);
  });

  it('leaves a table shown as code exactly as written', () => {
    const t = table('```', HEAD, RULE, '| `A | B` | 1 | 2 |', '```');
    expect(t.box.querySelector('pre')?.textContent).toContain('| `A | B` | 1 | 2 |');
  });
});
