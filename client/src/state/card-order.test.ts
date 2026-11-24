import { describe, expect, it } from 'vitest';
import { arrange, homeOrderKey, mergeOrder, moveItem, readOrder, writeOrder } from './card-order.ts';

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
};

describe('arrange, moveItem, mergeOrder', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  it('puts saved ids first, then the rest in their default order', () => {
    expect(arrange(items, ['c', 'x', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('moves one id to a place, clamped to the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 'z', 0)).toEqual(['a', 'b', 'c']);
  });
  it('keeps a saved card that is not shown now in its place', () => {
    // "ads" is saved second but hidden today; moving the shown cards leaves it where it was.
    expect(mergeOrder(['todos', 'ads', 'chats'], ['chats', 'todos'])).toEqual(['chats', 'ads', 'todos']);
  });
});

describe('the saved order, per person', () => {
  it('is kept under a key for each person', () => {
    expect(homeOrderKey('ian-hancock')).not.toBe(homeOrderKey('sam-tester'));
    const s = memory();
    writeOrder(homeOrderKey('ian-hancock'), ['files', 'todos'], s);
    expect(readOrder(homeOrderKey('ian-hancock'), s)).toEqual(['files', 'todos']);
    expect(readOrder(homeOrderKey('sam-tester'), s)).toEqual([]);
  });
  it('reads bad, missing or blocked storage as no saved order', () => {
    const s = memory();
    s.setItem(homeOrderKey('a'), '{not json');
    expect(readOrder(homeOrderKey('a'), s)).toEqual([]);
    s.setItem(homeOrderKey('a'), JSON.stringify({ order: ['x'] }));
    expect(readOrder(homeOrderKey('a'), s)).toEqual([]);
    s.setItem(homeOrderKey('a'), JSON.stringify(['ok', 7, '', 'ok', 'y'.repeat(65)]));
    expect(readOrder(homeOrderKey('a'), s)).toEqual(['ok']);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readOrder(homeOrderKey('a'), blocked)).toEqual([]);
    expect(() => writeOrder(homeOrderKey('a'), ['x'], blocked)).not.toThrow();
  });
});
