// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clientOptions,
  MAX_MATCHES,
  matchCount,
  matchRanges,
  matchRank,
  normalise,
  type PickOption,
  RECENT_MAX,
  readRecent,
  rememberRecent,
  shownGroups,
} from './search-select.ts';

const opt = (value: string, label: string, terms?: string[], group?: string): PickOption => ({
  value,
  label,
  ...(terms ? { terms } : {}),
  ...(group ? { group } : {}),
});

describe('normalise', () => {
  it('lower-cases, drops accents and turns punctuation into single spaces', () => {
    expect(normalise('Café-Bar  Ltd')).toBe('cafe bar ltd');
    expect(normalise('  urban_cooling ')).toBe('urban cooling');
    expect(normalise('A&B (UK)')).toBe('a b uk');
    expect(normalise('')).toBe('');
  });
});

describe('matchRank', () => {
  const uc = opt('urban-cooling', 'Urban Cooling', ['urban-cooling', 'UC', 'Air Con']);
  it('ranks a label that starts with the query best', () => {
    expect(matchRank(uc, 'urb')).toBe(0);
  });
  it('ranks an exact code next', () => {
    expect(matchRank(uc, 'uc')).toBe(1);
  });
  it('ranks a word in the label that starts with the query', () => {
    expect(matchRank(uc, 'cool')).toBe(2);
  });
  it('ranks a term (or a word in one) that starts with the query', () => {
    expect(matchRank(uc, 'air')).toBe(3);
    expect(matchRank(uc, 'con')).toBe(3);
  });
  it('ranks the label containing the query', () => {
    expect(matchRank(uc, 'ooli')).toBe(4);
  });
  it('ranks a term containing the query last', () => {
    expect(matchRank(opt('x', 'Skyseal', ['Rooflights']), 'ofli')).toBe(5);
  });
  it('gives null when nothing matches', () => {
    expect(matchRank(uc, 'zebra')).toBeNull();
  });
  it('finds a multi-word query word by word when it is not one run', () => {
    expect(matchRank(uc, 'urb cool')).toBe(2);
    expect(matchRank(uc, 'cool urb')).toBe(2);
    expect(matchRank(uc, 'urb zebra')).toBeNull();
  });
  it('finds the whole query as one run first', () => {
    expect(matchRank(uc, 'urban coo')).toBe(0);
  });
  it('matches through accents and punctuation', () => {
    expect(matchRank(opt('c', 'Café Nero'), 'cafe')).toBe(0);
    expect(matchRank(opt('a', 'A&B Ltd'), 'a b')).toBe(0);
  });
});

describe('matchRanges', () => {
  it('marks the matched run', () => {
    expect(matchRanges('Urban Cooling', 'cool')).toEqual([[6, 10]]);
  });
  it('marks each query word and merges touching runs', () => {
    expect(matchRanges('Urban Cooling', 'urb cool')).toEqual([
      [0, 3],
      [6, 10],
    ]);
    expect(matchRanges('Urban Cooling', 'urban coo')).toEqual([[0, 9]]);
  });
  it('prefers a word start over an earlier inner match', () => {
    expect(matchRanges('Bacon Cooling', 'co')).toEqual([[6, 8]]);
  });
  it('is case-insensitive and gives nothing for an empty query or a term-only match', () => {
    expect(matchRanges('Urban Cooling', 'URB')).toEqual([[0, 3]]);
    expect(matchRanges('Urban Cooling', '  ')).toEqual([]);
    expect(matchRanges('Urban Cooling', 'uc')).toEqual([]);
  });
  it('keeps offsets right past an accented letter', () => {
    expect(matchRanges('Café Nero', 'nero')).toEqual([[5, 9]]);
  });
});

describe('shownGroups', () => {
  const fixed = [opt('auto', 'Auto'), opt('none', 'No client')];
  const many = Array.from({ length: 12 }, (_, i) =>
    opt(`c${i}`, `Client ${String(i).padStart(2, '0')}`, [], 'Clients'),
  );

  it('shows the fixed choices untitled, then each group in order, with an empty query', () => {
    const groups = shownGroups([...fixed, ...many.slice(0, 2)], '', []);
    expect(groups.map((g) => [g.id, g.title])).toEqual([
      ['fixed', null],
      ['g:Clients', 'Clients'],
    ]);
    expect(groups[0]?.rows.map((r) => r.key)).toEqual(['fixed:auto', 'fixed:none']);
    expect(groups[1]?.rows.map((r) => r.option.value)).toEqual(['c0', 'c1']);
  });

  it('keeps groups in first-seen order and fixed options that come after a group', () => {
    const list = [
      opt('a', 'A', [], 'Mine'),
      opt('b', 'B', [], 'Clients'),
      opt('c', 'C'),
      opt('d', 'D', [], 'Mine'),
    ];
    const groups = shownGroups(list, '', []);
    expect(groups.map((g) => g.id)).toEqual(['fixed', 'g:Mine', 'g:Clients']);
    expect(groups[1]?.rows.map((r) => r.option.value)).toEqual(['a', 'd']);
  });

  it('adds Recent under the fixed choices once the list is long enough', () => {
    const groups = shownGroups([...fixed, ...many], '', ['c5', 'gone', 'c2']);
    expect(groups.map((g) => g.id)).toEqual(['fixed', 'recent', 'g:Clients']);
    expect(groups[1]?.title).toBe('Recent');
    expect(groups[1]?.rows.map((r) => r.key)).toEqual(['recent:c5', 'recent:c2']);
    // Still in the A–Z list too, with its own key.
    expect(groups[2]?.rows.some((r) => r.key === 'g:Clients:c5')).toBe(true);
  });

  it('shows no Recent for a short list, an empty recent list or none left', () => {
    expect(shownGroups([...fixed, ...many.slice(0, 3)], '', ['c1']).some((g) => g.id === 'recent')).toBe(
      false,
    );
    expect(shownGroups([...fixed, ...many], '', []).some((g) => g.id === 'recent')).toBe(false);
    expect(shownGroups([...fixed, ...many], '', ['gone']).some((g) => g.id === 'recent')).toBe(false);
  });

  it('leaves fixed choices out of Recent', () => {
    const groups = shownGroups([...fixed, ...many], '', ['auto', 'c3']);
    expect(groups.find((g) => g.id === 'recent')?.rows.map((r) => r.option.value)).toEqual(['c3']);
  });

  it('caps Recent at RECENT_MAX', () => {
    const recent = many.map((o) => o.value);
    expect(shownGroups(many, '', recent).find((g) => g.id === 'recent')?.rows).toHaveLength(RECENT_MAX);
  });

  it('gives one matches group, best first, fixed choices included, with a query', () => {
    const list = [
      ...fixed,
      opt('nw', 'Northwind', [], 'Clients'),
      opt('kn', 'Known Co', [], 'Clients'),
      opt('sn', 'Snow', [], 'Clients'),
    ];
    const groups = shownGroups(list, 'no', ['nw']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe('matches');
    expect(groups[0]?.title).toBeNull();
    // "No client" and "Northwind" start with it (given order); "Known" contains it; "Snow" contains it.
    expect(groups[0]?.rows.map((r) => r.option.value)).toEqual(['none', 'nw', 'kn', 'sn']);
    expect(groups[0]?.rows[1]?.ranges).toEqual([[0, 2]]);
  });

  it('finds a client by its code', () => {
    const list = [
      opt('ab', 'Fuchsia', [], 'Clients'),
      ...clientOptions([{ slug: 'urban-cooling', name: 'Urban Cooling', aliases: ['UC'] }]),
    ];
    expect(shownGroups(list, 'uc', [])[0]?.rows.map((r) => r.option.value)).toEqual(['urban-cooling', 'ab']);
  });

  it('gives nothing when nothing matches, and caps the matches', () => {
    expect(shownGroups(many, 'zebra', [])).toEqual([]);
    const lots = Array.from({ length: MAX_MATCHES + 20 }, (_, i) => opt(`v${i}`, `Acme ${i}`));
    expect(shownGroups(lots, 'acme', [])[0]?.rows).toHaveLength(MAX_MATCHES);
    expect(matchCount(lots, 'acme')).toBe(MAX_MATCHES + 20);
    expect(matchCount(lots, '')).toBe(lots.length);
  });

  it('makes every key unique', () => {
    const keys = shownGroups([...fixed, ...many], '', ['c1', 'c2']).flatMap((g) => g.rows.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('clientOptions', () => {
  it('labels by name, finds by slug and aliases, under Clients by default', () => {
    expect(
      clientOptions([
        { slug: 'urban-cooling', name: 'Urban Cooling', aliases: ['UC'] },
        { slug: 'astrum', name: 'Astrum' },
      ]),
    ).toEqual([
      { value: 'urban-cooling', label: 'Urban Cooling', terms: ['urban-cooling', 'UC'], group: 'Clients' },
      { value: 'astrum', label: 'Astrum', terms: ['astrum'], group: 'Clients' },
    ]);
    expect(clientOptions([{ slug: 'a', name: 'A' }], 'Other')[0]?.group).toBe('Other');
  });
});

describe('recent picks', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('remembers picks newest first, without repeats, at most RECENT_MAX', () => {
    rememberRecent('clients', 'a');
    rememberRecent('clients', 'b');
    expect(rememberRecent('clients', 'a')).toEqual(['a', 'b']);
    for (const v of ['c', 'd', 'e', 'f', 'g']) rememberRecent('clients', v);
    expect(readRecent('clients')).toEqual(['g', 'f', 'e', 'd', 'c']);
    expect(readRecent('library')).toEqual([]);
  });

  it('reads junk, wrong shapes and over-long values as nothing', () => {
    localStorage.setItem('tds-brain-recent.clients', '{not json');
    expect(readRecent('clients')).toEqual([]);
    localStorage.setItem('tds-brain-recent.clients', JSON.stringify({ a: 1 }));
    expect(readRecent('clients')).toEqual([]);
    localStorage.setItem('tds-brain-recent.clients', JSON.stringify(['ok', 7, 'x'.repeat(201), 'fine']));
    expect(readRecent('clients')).toEqual(['ok', 'fine']);
  });

  it('never throws when storage does', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readRecent('clients')).toEqual([]);
    expect(rememberRecent('clients', 'a')).toEqual(['a']);
  });
});
