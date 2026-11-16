// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { countTasks, setTask, toDoc } from './index.ts';

/** Task items in the document, in order, as the panel sees them. */
function docTasks(md: string): boolean[] {
  const out: boolean[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'taskItem') out.push(n.attrs?.checked === true);
    for (const c of n.content ?? []) walk(c);
  };
  walk(toDoc(md));
  return out;
}

const BODY = [
  '# Launch',
  '',
  '- [ ] first',
  '- [x] second',
  '  - [ ] nested a',
  '    - [X] nested deeper',
  '- [ ] third',
  '',
  'Text between.',
  '',
  '```',
  '- [ ] in code, not a task',
  '```',
  '',
  '> - [ ] in a quote, not a task',
  '',
  '| Task | State |',
  '|---|---|',
  '| - [ ] in a table | no |',
  '',
  '* [ ] star task',
].join('\n');

describe('countTasks', () => {
  it('counts task items in document order, nested ones included', () => {
    expect(countTasks('- [ ] a\n- [x] b\n  - [ ] c')).toBe(3);
  });

  it('is zero without tasks', () => {
    expect(countTasks('')).toBe(0);
    expect(countTasks('- a\n- b\n\nText [ ] here')).toBe(0);
  });

  it('does not count tasks inside kept blocks or code', () => {
    expect(countTasks(BODY)).toBe(6);
  });

  it('matches the task items in the document', () => {
    for (const md of [BODY, '- [ ] a', '- [ ] a\n- b\n- [x] c', '1. step\n   - [ ] sub task', 'none']) {
      expect(countTasks(md)).toBe(docTasks(md).length);
    }
  });
});

describe('setTask', () => {
  it('ticks only the one item', () => {
    const md = '- [ ] a\n- [ ] b\n- [ ] c';
    expect(setTask(md, 1, true)).toBe('- [ ] a\n- [x] b\n- [ ] c');
  });

  it('unticks, including a capital X', () => {
    expect(setTask('- [x] a\n- [X] b', 0, false)).toBe('- [ ] a\n- [X] b');
    expect(setTask('- [x] a\n- [X] b', 1, false)).toBe('- [x] a\n- [ ] b');
  });

  it('reaches nested items in document order', () => {
    const out = setTask(BODY, 3, false);
    expect(out).toBe(BODY.replace('    - [X] nested deeper', '    - [ ] nested deeper'));
    expect(setTask(BODY, 2, true)).toBe(BODY.replace('  - [ ] nested a', '  - [x] nested a'));
  });

  it('skips tasks in code, quotes and tables', () => {
    expect(setTask(BODY, 5, true)).toBe(BODY.replace('* [ ] star task', '* [x] star task'));
  });

  it('changes nothing for a missing index or the same state', () => {
    expect(setTask(BODY, 6, true)).toBe(BODY);
    expect(setTask(BODY, -1, true)).toBe(BODY);
    expect(setTask(BODY, 1.5, true)).toBe(BODY);
    expect(setTask(BODY, 1, true)).toBe(BODY);
    expect(setTask(BODY, 0, false)).toBe(BODY);
  });

  it('agrees with the document after the change', () => {
    for (let i = 0; i < countTasks(BODY); i++) {
      const before = docTasks(BODY);
      const after = docTasks(setTask(BODY, i, !before[i]));
      const expected = before.slice();
      expected[i] = !before[i];
      expect(after).toEqual(expected);
    }
  });

  it('handles a task list straight after text and in a numbered item', () => {
    const md = 'Steps:\n- [ ] one\n\n1. step\n   - [ ] sub';
    expect(setTask(md, 0, true)).toBe('Steps:\n- [x] one\n\n1. step\n   - [ ] sub');
    expect(setTask(md, 1, true)).toBe('Steps:\n- [ ] one\n\n1. step\n   - [x] sub');
  });
});
