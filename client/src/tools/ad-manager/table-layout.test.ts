import { describe, expect, it } from 'vitest';
import { arrange, moveTable, readLayout, TABLE_LAYOUT_KEY, writeLayout } from './table-layout.ts';

const t = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((x) => x.id);

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(TABLE_LAYOUT_KEY, initial);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('arrange', () => {
  it('keeps the default order when nothing is saved', () => {
    expect(ids(arrange(t('a', 'b', 'c'), []))).toEqual(['a', 'b', 'c']);
  });
  it('puts saved tables first, in the saved order', () => {
    expect(ids(arrange(t('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });
  it('adds tables the saved order has never seen at the end, in default order', () => {
    expect(ids(arrange(t('a', 'b', 'c', 'd'), ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
  });
  it('skips saved ids this account has no table for', () => {
    expect(ids(arrange(t('a', 'b'), ['products', 'b', 'a']))).toEqual(['b', 'a']);
  });
});

describe('moveTable', () => {
  const shown = ['a', 'b', 'c', 'd'];
  it('moves a table to a new place', () => {
    expect(moveTable(shown, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTable(shown, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('clamps a place past either end', () => {
    expect(moveTable(shown, 'b', -3)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveTable(shown, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
  });
  it('changes nothing for an unknown table', () => {
    expect(moveTable(shown, 'zz', 0)).toEqual(shown);
  });
});

describe('readLayout and writeLayout', () => {
  it('reads nothing saved as the default layout', () => {
    expect(readLayout(memory())).toEqual({ order: [], wide: [] });
  });
  it('round-trips a layout', () => {
    const m = memory();
    writeLayout({ order: ['c', 'a'], wide: ['c'] }, m);
    expect(readLayout(m)).toEqual({ order: ['c', 'a'], wide: ['c'] });
  });
  it('ignores broken or odd saved text', () => {
    for (const bad of ['not json', '42', 'null', '[]', '{"order":"a"}', '{"order":[1,2]}']) {
      expect(readLayout(memory(bad))).toEqual({ order: [], wide: [] });
    }
  });
  it('drops repeats, non-strings and over-long ids, and caps the list', () => {
    const many = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const saved = JSON.stringify({ order: ['a', 'a', 7, 'x'.repeat(65), ...many], wide: ['a', null] });
    const got = readLayout(memory(saved));
    expect(got.order.slice(0, 2)).toEqual(['a', 't0']);
    expect(got.order).toHaveLength(32);
    expect(got.wide).toEqual(['a']);
  });
  it('copes with storage that throws (private window, blocked site data)', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLayout(boom)).toEqual({ order: [], wide: [] });
    expect(() => writeLayout({ order: ['a'], wide: [] }, boom)).not.toThrow();
  });
  it('copes with no storage at all', () => {
    expect(readLayout(null)).toEqual({ order: [], wide: [] });
    expect(() => writeLayout({ order: ['a'], wide: [] }, null)).not.toThrow();
  });
});
