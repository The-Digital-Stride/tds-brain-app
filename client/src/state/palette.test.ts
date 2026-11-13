import { describe, expect, it } from 'vitest';
import type { SearchContext, SearchHit, SearchSource } from '../shell/contract.ts';
import {
  type AsyncSlot,
  asyncLooking,
  asyncPending,
  asyncTrouble,
  groupCount,
  NOTE_FAILED,
  NOTE_UNFINISHED,
  optionKey,
  paletteGroups,
} from './palette.ts';

const hit = (id: string, label = id): SearchHit => ({ id, label, hint: null, icon: 'doc', run: () => {} });
const ctx: SearchContext = { me: 'sam', todos: null, live: [], past: [], skills: [], pins: [], clients: [] };

const sync = (id: string, labels: string[], total = labels.length): SearchSource => ({
  id,
  title: id.toUpperCase(),
  search: () => ({ hits: labels.map((l) => hit(l)), total }),
  idle: () => labels.slice(0, 1).map((l) => hit(l)),
});
const remote: SearchSource = {
  id: 'remote',
  title: 'Remote',
  searchAsync: async () => ({ hits: [], total: 0 }),
};

describe('paletteGroups', () => {
  it('follows the source order and leaves empty groups out', () => {
    const sources = [sync('a', ['a1']), sync('b', []), sync('c', ['c1', 'c2'])];
    const groups = paletteGroups(sources, 'x', ctx);
    expect(groups.map((g) => g.source.id)).toEqual(['a', 'c']);
    expect(groups[1]?.hits.map((h) => h.id)).toEqual(['c1', 'c2']);
  });

  it('uses idle hits for an empty query, and no group for a source without them', () => {
    const noIdle: SearchSource = { id: 'n', title: 'N', search: () => ({ hits: [hit('n1')], total: 1 }) };
    const groups = paletteGroups([sync('a', ['a1', 'a2']), noIdle, remote], '', ctx);
    expect(groups.map((g) => [g.source.id, g.hits.length])).toEqual([['a', 1]]);
  });

  it('adds an async group only from an answer to this exact query', () => {
    const slots: Record<string, AsyncSlot> = {
      remote: { query: 'rep', results: { hits: [hit('r1')], total: 1 }, looking: false },
    };
    const sources = [sync('a', ['a1']), remote];
    expect(paletteGroups(sources, 'rep', ctx, slots).map((g) => g.source.id)).toEqual(['a', 'remote']);
    // The person typed on: the old answer is stale and dropped.
    expect(paletteGroups(sources, 'repo', ctx, slots).map((g) => g.source.id)).toEqual(['a']);
  });

  it('leaves out an async group that is still looking with no hits, so no heading stands alone', () => {
    const looking: Record<string, AsyncSlot> = {
      remote: { query: 'q1', results: { hits: [], total: 0, partial: true }, looking: true },
    };
    expect(paletteGroups([remote], 'q1', ctx, looking)).toEqual([]);
    expect(paletteGroups([sync('a', ['a1']), remote], 'q1', ctx, looking).map((g) => g.source.id)).toEqual([
      'a',
    ]);
    expect(asyncLooking([remote], 'q1', looking)).toBe(true);
    expect(asyncLooking([remote], 'q2', looking)).toBe(false);
    const done: Record<string, AsyncSlot> = {
      remote: { query: 'q1', results: { hits: [], total: 0 }, looking: false },
    };
    expect(paletteGroups([remote], 'q1', ctx, done)).toEqual([]);
    const failed: Record<string, AsyncSlot> = { remote: { query: 'q1', results: null, looking: false } };
    expect(paletteGroups([remote], 'q1', ctx, failed)).toEqual([]);
  });

  it('async groups always come after the sync ones given before them in the list', () => {
    const slots: Record<string, AsyncSlot> = {
      remote: { query: 'q1', results: { hits: [hit('r1')], total: 1 }, looking: false },
    };
    const groups = paletteGroups([sync('a', ['a1']), sync('b', ['b1']), remote], 'q1', ctx, slots);
    expect(groups.map((g) => g.source.id)).toEqual(['a', 'b', 'remote']);
  });
});

describe('a search that could not finish', () => {
  const failed: Record<string, AsyncSlot> = { remote: { query: 'q1', results: null, looking: false } };
  const partial: Record<string, AsyncSlot> = {
    remote: { query: 'q1', results: { hits: [hit('r1')], total: 1, partial: true }, looking: false },
  };

  it('keeps its heading with a note while other groups have results, and drops it when nothing else does', () => {
    const [, g] = paletteGroups([sync('a', ['a1']), remote], 'q1', ctx, failed);
    expect(g).toMatchObject({ hits: [], note: NOTE_FAILED });
    expect(paletteGroups([remote], 'q1', ctx, failed)).toEqual([]);
  });

  it('says some folders were not searched when a partial answer ran out of retries', () => {
    const [g] = paletteGroups([remote], 'q1', ctx, partial);
    expect(g).toMatchObject({ note: NOTE_UNFINISHED });
    expect(g?.hits).toHaveLength(1);
  });

  it('is trouble for the palette line, but a complete or still-retrying answer is not', () => {
    expect(asyncTrouble([remote], 'q1', failed)).toBe(true);
    expect(asyncTrouble([remote], 'q1', partial)).toBe(true);
    expect(asyncTrouble([remote], 'q2', failed)).toBe(false);
    const done = { remote: { query: 'q1', results: { hits: [], total: 0 }, looking: false } };
    expect(asyncTrouble([remote], 'q1', done)).toBe(false);
    const retrying = {
      remote: { query: 'q1', results: { hits: [], total: 0, partial: true }, looking: true },
    };
    expect(asyncTrouble([remote], 'q1', retrying)).toBe(false);
  });
});

describe('groupCount and optionKey', () => {
  it('says "6 of 23" only when the group is cut short', () => {
    const [short] = paletteGroups([sync('a', ['1', '2', '3', '4', '5', '6'], 23)], 'x', ctx);
    expect(short && groupCount(short)).toBe('6 of 23');
    const [full] = paletteGroups([sync('a', ['1', '2'])], 'x', ctx);
    expect(full && groupCount(full)).toBeNull();
  });

  it('keeps ids apart across groups', () => {
    const [a] = paletteGroups([sync('a', ['x'])], 'q', ctx);
    const [b] = paletteGroups([sync('b', ['x'])], 'q', ctx);
    expect(a && b && optionKey(a, hit('x'))).not.toBe(b && a && optionKey(b, hit('x')));
  });
});

describe('asyncPending', () => {
  it('is true until every async source has answered the current query, and only for 2+ characters', () => {
    expect(asyncPending([remote], 'a', {})).toBe(false);
    expect(asyncPending([sync('a', [])], 'ab', {})).toBe(false);
    expect(asyncPending([remote], 'ab', {})).toBe(true);
    const slots = { remote: { query: 'ab', results: null, looking: false } };
    expect(asyncPending([remote], 'ab', slots)).toBe(false);
    expect(asyncPending([remote], 'abc', slots)).toBe(true);
  });
});
