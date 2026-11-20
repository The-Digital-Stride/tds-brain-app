import { describe, expect, it } from 'vitest';
import type {
  AdsBoard,
  AdsHealth,
  AdsHealthFile,
  AdsMonthly,
  AdsPack,
} from '../../../../shared/ads-contract.ts';
import {
  dueCount,
  dueState,
  needsYou,
  readiness,
  WASTE_BAD_PCT,
  WASTE_WARN_PCT,
  worthALook,
} from './logic.ts';

// ---------- readiness ----------

const file = (status: string, group = 'daily', name = `${group}-${status}.csv`): AdsHealthFile => ({
  file: name,
  group,
  powers: `Powers ${name}`,
  status,
  latest: null,
  missingCols: [],
});
const health = (files: AdsHealthFile[], fetch: AdsHealth['fetch'] = null): AdsHealth => ({
  dir: 'clients/x/data',
  files,
  ok: files.filter((f) => f.status === 'ok').length,
  na: files.filter((f) => f.status === 'na').length,
  applicable: files.length,
  total: files.length,
  freshThrough: null,
  fetch,
});

describe('readiness', () => {
  it('gives null for null health, and for no files at all', () => {
    expect(readiness(null)).toBeNull();
    expect(readiness(health([]))).toBeNull();
    expect(readiness({ files: 'nope' } as unknown as AdsHealth)).toBeNull();
  });

  it('is ok only when every required file is ready, and na counts as ready', () => {
    const r = readiness(health([file('ok'), file('ok', 'search'), file('na', 'deep')]));
    expect(r?.tone).toBe('ok');
    expect(r?.ready).toBe(2);
    expect(r?.required).toBe(2);
    expect(r?.notNeeded).toBe(1);
    expect(r?.groups.every((g) => g.tone === 'ok')).toBe(true);
  });

  it('a group of only na files is ready, with a hollow dot', () => {
    const r = readiness(health([file('ok'), file('na', 'deep')]));
    const deep = r?.groups.find((g) => g.group === 'deep');
    expect(deep?.tone).toBe('ok');
    expect(deep?.required).toBe(0);
    expect(deep?.files[0]?.dot).toBe('na');
  });

  it('a missing file makes it bad, with a red dot', () => {
    const r = readiness(health([file('ok'), file('missing', 'search')]));
    expect(r?.tone).toBe('bad');
    expect(r?.groups.find((g) => g.group === 'search')?.files[0]?.dot).toBe('bad');
    expect(r?.ready).toBe(1);
    expect(r?.required).toBe(2);
  });

  it('stale, wrong-shape and unknown statuses are amber', () => {
    for (const status of ['stale', 'wrong-shape', 'something-new']) {
      const r = readiness(health([file('ok'), file(status)]));
      expect(r?.tone, status).toBe('warn');
      expect(r?.groups[0]?.files[1]?.dot, status).toBe('warn');
    }
  });

  it('bad beats warn', () => {
    expect(readiness(health([file('stale'), file('missing', 'search')]))?.tone).toBe('bad');
  });

  it('a fetch problem makes an otherwise ready account warn, never ok', () => {
    const fetch = { lastRun: '2026-11-18', errors: 2, total: 5, ageHours: 40, problem: true };
    expect(readiness(health([file('ok')], fetch))?.tone).toBe('warn');
    expect(readiness(health([file('ok')], { ...fetch, problem: false }))?.tone).toBe('ok');
  });

  it('a fetch problem does not hide a missing file', () => {
    const fetch = { lastRun: '2026-11-18', errors: 2, total: 5, ageHours: 40, problem: true };
    expect(readiness(health([file('missing')], fetch))?.tone).toBe('bad');
  });

  it('groups in a fixed order with display names, unknown groups after, as given', () => {
    const r = readiness(
      health([
        file('ok', 'deep'),
        file('ok', 'mystery'),
        file('ok', 'products'),
        file('ok', 'search'),
        file('ok', 'daily'),
      ]),
    );
    expect(r?.groups.map((g) => g.group)).toEqual(['daily', 'search', 'products', 'deep', 'mystery']);
    expect(r?.groups.map((g) => g.label)).toEqual([
      'Daily performance',
      'Search',
      'Shopping and products',
      'Deep dive',
      'mystery',
    ]);
  });
});

// ---------- dueState ----------

// Local times throughout, so the tests mean the same in any time zone.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const iso = (y: number, m: number, d: number, h = 12) => at(y, m, d, h).toISOString();

describe('dueState', () => {
  it('daily: due the day after the last run, not the same day', () => {
    expect(dueState('daily', iso(2026, 11, 18), at(2026, 11, 18, 23))).toBeNull();
    expect(dueState('daily', iso(2026, 11, 18, 23), at(2026, 11, 19, 0))).toEqual({ kind: 'due' });
    expect(dueState('daily', iso(2026, 11, 1), at(2026, 11, 19))).toEqual({ kind: 'due' });
  });

  it('counts local calendar days, not 24-hour spans', () => {
    // 23:30 yesterday is one local day ago although it is only 30 minutes earlier.
    expect(dueState('daily', at(2026, 11, 18, 23).toISOString(), at(2026, 11, 19, 0))).toEqual({
      kind: 'due',
    });
    // 00:30 today is the same day, however long ago it feels.
    expect(dueState('daily', at(2026, 11, 19, 0).toISOString(), at(2026, 11, 19, 23))).toBeNull();
  });

  it('weekly: due at 7 days, overdue at 14, inclusive, days counted from the due date', () => {
    expect(dueState('weekly', iso(2026, 11, 13), at(2026, 11, 19))).toBeNull(); // 6 days
    expect(dueState('weekly', iso(2026, 11, 12), at(2026, 11, 19))).toEqual({ kind: 'due' }); // 7
    expect(dueState('weekly', iso(2026, 11, 6), at(2026, 11, 19))).toEqual({ kind: 'due' }); // 13
    expect(dueState('weekly', iso(2026, 11, 5), at(2026, 11, 19))).toEqual({ kind: 'overdue', days: 7 }); // 14
    expect(dueState('weekly', iso(2026, 10, 29), at(2026, 11, 19))).toEqual({ kind: 'overdue', days: 14 }); // 21
  });

  it('fortnightly: due at 14 days, overdue at 28, inclusive', () => {
    expect(dueState('fortnightly', iso(2026, 11, 6), at(2026, 11, 19))).toBeNull(); // 13
    expect(dueState('fortnightly', iso(2026, 11, 5), at(2026, 11, 19))).toEqual({ kind: 'due' }); // 14
    expect(dueState('fortnightly', iso(2026, 10, 23), at(2026, 11, 19))).toEqual({ kind: 'due' }); // 27
    expect(dueState('fortnightly', iso(2026, 10, 22), at(2026, 11, 19))).toEqual({
      kind: 'overdue',
      days: 14,
    }); // 28
  });

  it('monthly: due on the 1st after the last run, overdue 7 days after, upcoming before', () => {
    // Last run in October: due from Nov 1.
    expect(dueState('monthly', iso(2026, 10, 15), at(2026, 10, 31))).toEqual({
      kind: 'upcoming',
      on: '2026-11-01',
    });
    expect(dueState('monthly', iso(2026, 10, 15), at(2026, 11, 1))).toEqual({ kind: 'due' });
    expect(dueState('monthly', iso(2026, 10, 15), at(2026, 11, 7))).toEqual({ kind: 'due' }); // 6 days after
    expect(dueState('monthly', iso(2026, 10, 15), at(2026, 11, 8))).toEqual({ kind: 'overdue', days: 7 });
    expect(dueState('monthly', iso(2026, 10, 15), at(2026, 11, 19))).toEqual({ kind: 'overdue', days: 18 });
    // Run this month: next one is next month's 1st.
    expect(dueState('monthly', iso(2026, 11, 3), at(2026, 11, 19))).toEqual({
      kind: 'upcoming',
      on: '2026-12-01',
    });
    // The year turns over.
    expect(dueState('monthly', iso(2026, 12, 20), at(2026, 12, 21))).toEqual({
      kind: 'upcoming',
      on: '2027-01-01',
    });
  });

  it('quarterly: due on the first day of the next quarter, upcoming before; never overdue', () => {
    expect(dueState('quarterly', iso(2026, 8, 20), at(2026, 9, 30))).toEqual({
      kind: 'upcoming',
      on: '2026-10-01',
    });
    expect(dueState('quarterly', iso(2026, 8, 20), at(2026, 10, 1))).toEqual({ kind: 'due' });
    expect(dueState('quarterly', iso(2026, 8, 20), at(2027, 3, 1))).toEqual({ kind: 'due' });
    expect(dueState('quarterly', iso(2026, 11, 3), at(2026, 11, 19))).toEqual({
      kind: 'upcoming',
      on: '2027-01-01',
    });
  });

  it('a last run in the future, or an unreadable date, gives no badge', () => {
    expect(dueState('daily', iso(2026, 11, 20), at(2026, 11, 19))).toBeNull();
    expect(dueState('weekly', iso(2027, 1, 1), at(2026, 11, 19))).toBeNull();
    for (const c of ['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly'] as const) {
      expect(dueState(c, 'not a date', at(2026, 11, 19))).toBeNull();
      expect(dueState(c, '', at(2026, 11, 19))).toBeNull();
    }
  });

  it('a task that has never run is due only if daily, and is never overdue', () => {
    expect(dueState('daily', null, at(2026, 11, 19))).toEqual({ kind: 'due' });
    for (const c of ['weekly', 'fortnightly', 'monthly', 'quarterly'] as const) {
      expect(dueState(c, null, at(2026, 11, 19))).toBeNull();
    }
  });

  it('reads a bare date as a local day', () => {
    expect(dueState('daily', '2026-11-18', at(2026, 11, 19))).toEqual({ kind: 'due' });
    expect(dueState('daily', '2026-11-19', at(2026, 11, 19))).toBeNull();
  });
});

describe('dueCount', () => {
  const card = (id: string, cadence: AdsBoard['cards'][number]['cadence'], last: string | null) =>
    ({ id, cadence, lastRun: last ? { at: last, by: 'x', byName: 'X' } : null }) as AdsBoard['cards'][number];

  it('counts due and overdue cards, not upcoming or quiet ones', () => {
    const now = at(2026, 11, 19);
    const cards = [
      card('a', 'daily', iso(2026, 11, 18)), // due
      card('b', 'weekly', iso(2026, 11, 1)), // overdue
      card('c', 'weekly', iso(2026, 11, 17)), // quiet
      card('d', 'monthly', iso(2026, 11, 3)), // upcoming
      card('e', 'daily', null), // never run, daily: due
      card('f', 'monthly', null), // never run, not daily: none
    ];
    expect(dueCount(cards, now)).toBe(3);
  });

  it('counts a locally recorded run when it is newer than the brain run', () => {
    const now = at(2026, 11, 19);
    const cards = [card('a', 'daily', iso(2026, 11, 10))];
    expect(dueCount(cards, now, () => iso(2026, 11, 19))).toBe(0);
    expect(dueCount(cards, now, () => iso(2026, 11, 1))).toBe(1);
  });

  it('counts a set-up Daily standup on the daily rule, with the newer of the brain and local runs', () => {
    const now = at(2026, 11, 19);
    expect(dueCount([], now, undefined, { sharedAt: iso(2026, 11, 18), localAt: null })).toBe(1);
    expect(dueCount([], now, undefined, { sharedAt: iso(2026, 11, 18), localAt: iso(2026, 11, 19) })).toBe(0);
    expect(dueCount([], now, undefined, { sharedAt: iso(2026, 11, 19), localAt: iso(2026, 11, 1) })).toBe(0);
    expect(dueCount([], now, undefined, null)).toBe(0);
    // Never run: due, as a daily card is.
    expect(
      dueCount([card('a', 'daily', iso(2026, 11, 18))], now, undefined, { sharedAt: null, localAt: null }),
    ).toBe(2);
  });
});

// ---------- needsYou ----------

const pack = (verification: AdsPack['verification'], report = 'clients/x/reports/week.md'): AdsPack => ({
  date: '2026-11-17',
  act: 0,
  watch: 0,
  provisional: false,
  report,
  verification,
});
const monthly = (patch: Partial<AdsMonthly> = {}): AdsMonthly =>
  ({
    month: '2026-10',
    monthName: 'October 2026',
    partial: false,
    signed: false,
    stale: false,
    reason: null,
    canSign: true,
    files: {},
    ...patch,
  }) as AdsMonthly;
const none = { pack: null, monthly: null, health: null, open: [] };

describe('needsYou', () => {
  it('gives nothing when there is nothing', () => {
    expect(needsYou(none)).toEqual([]);
  });

  it('turns act findings into bad lines and watch findings into warn lines; info is left out', () => {
    const items = needsYou({
      ...none,
      pack: pack([
        { severity: 'info', title: 'Fine', detail: 'ok' },
        { severity: 'watch', title: 'Watch one', detail: 'w' },
        { severity: 'act', title: 'Act one', detail: 'a' },
      ]),
    });
    expect(items.map((i) => [i.tone, i.text])).toEqual([
      ['bad', 'Act one'],
      ['warn', 'Watch one'],
    ]);
    expect(items[0]?.sub).toBe('a');
    expect(items[0]?.action).toBe('Open report');
    expect(items[0]?.target).toEqual({ kind: 'report', path: 'clients/x/reports/week.md' });
  });

  it('a finding with no report path to open has no line to act on, so it is left out', () => {
    expect(needsYou({ ...none, pack: pack([{ severity: 'act', title: 'A', detail: 'd' }], '') })).toEqual([]);
  });

  it('a missing data file is one bad line and a stale one a warn line, both to Ads Command Centre', () => {
    const items = needsYou({
      ...none,
      health: health([file('missing', 'search'), file('stale', 'daily'), file('ok', 'deep')]),
    });
    expect(items.map((i) => i.tone)).toEqual(['bad', 'warn']);
    expect(items[0]?.action).toBe('Ads Command Centre');
    expect(items[0]?.target).toEqual({ kind: 'tool', tool: 'ads-command-centre', anchor: 'readiness' });
    expect(items[1]?.target).toEqual({ kind: 'tool', tool: 'ads-command-centre', anchor: 'readiness' });
  });

  it('a fetch problem is a warn line, even when every file is ready', () => {
    const items = needsYou({
      ...none,
      health: health([file('ok')], {
        lastRun: '2026-11-17',
        errors: 1,
        total: 3,
        ageHours: 50,
        problem: true,
      }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.tone).toBe('warn');
  });

  it('an unsigned month is a warn line that goes to the monthly close', () => {
    const items = needsYou({ ...none, monthly: monthly() });
    expect(items).toHaveLength(1);
    expect(items[0]?.tone).toBe('warn');
    expect(items[0]?.action).toBe('Go to monthly close');
    expect(items[0]?.target).toEqual({ kind: 'jump', anchor: 'close' });
    expect(items[0]?.text).toContain('October 2026');
  });

  it('an unsigned earlier month that can be signed is a warn line to the monthly close', () => {
    const items = needsYou({
      ...none,
      earlier: [
        monthly({ month: '2026-09', monthName: 'September 2026' }),
        monthly({ month: '2026-08', monthName: 'August 2026', signed: true }),
        monthly({ month: '2026-07', monthName: 'July 2026', canSign: false }),
      ],
    });
    expect(items.map((i) => i.text)).toEqual(['September 2026 is not signed off']);
    expect(items[0]?.target).toEqual({ kind: 'jump', anchor: 'close' });
  });

  it('puts dates in words and a proposal title for its id in findings', () => {
    const items = needsYou({
      ...none,
      open: [{ id: '20261026-04-water', fm: { title: 'Water-cooled bidding' } } as never],
      pack: pack([
        {
          severity: 'watch',
          title: '20261026-04-water: decision due',
          detail: 'Due 2026-11-09',
        },
      ]),
    });
    expect(items[0]?.text).toBe('Water-cooled bidding: decision due');
    expect(items[0]?.sub).toMatch(/^Due Mon 9 Nov/);
  });

  it('a signed month, or a month still in progress, is no line', () => {
    expect(needsYou({ ...none, monthly: monthly({ signed: true }) })).toEqual([]);
    expect(needsYou({ ...none, monthly: monthly({ partial: true }) })).toEqual([]);
  });

  it('orders bad before warn across sources, keeping order within a tone, one target per line', () => {
    const items = needsYou({
      pack: pack([
        { severity: 'watch', title: 'W', detail: '' },
        { severity: 'act', title: 'A', detail: '' },
      ]),
      monthly: monthly(),
      health: health([file('missing')]),
      open: [],
    });
    expect(items.map((i) => i.tone)).toEqual(['bad', 'bad', 'warn', 'warn']);
    expect(items.map((i) => i.text)[0]).toBe('A');
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) expect(i.target).toBeDefined();
  });
});

// ---------- worthALook ----------

const table = (
  id: string,
  title: string,
  cols: { key: string; label: string; type: AdsBoard['tables'][number]['cols'][number]['type'] }[],
  rows: (string | number | null)[][],
) => ({ id, title, subtitle: '', cols, rows, defaultSort: 0 });
const board = (tables: AdsBoard['tables'], wastePct = 0): AdsBoard =>
  ({ key: 'x', name: 'X', currency: 'GBP', tables, wastePct }) as unknown as AdsBoard;

const wasteTable = table('waste', 'Wasted spend', [{ key: 'term', label: 'Term', type: 'text' }], [['a']]);
const campaigns = (rows: (string | number | null)[][]) =>
  table(
    'campaigns',
    'Top campaigns',
    [
      { key: 'campaign', label: 'Campaign', type: 'text' },
      { key: 'spend', label: 'Spend', type: 'money' },
      { key: 'roas', label: 'ROAS', type: 'x' },
    ],
    rows,
  );
const quality = (rows: (string | number | null)[][]) =>
  table(
    'quality',
    'Quality Score',
    // As the board builds it: one row per score band, with how many keywords sit in it.
    [
      { key: 'qs', label: 'Quality Score', type: 'qs' },
      { key: 'kw', label: 'Keywords', type: 'int' },
      { key: 'pct', label: 'Share', type: 'pct' },
    ],
    rows,
  );

describe('worthALook', () => {
  it('gives nothing for an empty board', () => {
    expect(worthALook(board([]))).toEqual([]);
  });

  it('wasted spend: a line from the warn share, bad from the higher one, never without its table', () => {
    expect(worthALook(board([wasteTable], WASTE_WARN_PCT - 0.1))).toEqual([]);
    const warn = worthALook(board([wasteTable], WASTE_WARN_PCT));
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ tone: 'warn', table: 'waste', tableTitle: 'Wasted spend' });
    expect(warn[0]?.text).toContain(`${WASTE_WARN_PCT}%`);
    expect(worthALook(board([wasteTable], WASTE_BAD_PCT))[0]?.tone).toBe('bad');
    // A share but no table to jump to: no line.
    expect(worthALook(board([], 40))).toEqual([]);
  });

  it('ROAS: counts rows that spent and returned under 1.00x, jumping to that table', () => {
    const t = campaigns([
      ['good', 200, 4],
      ['poor', 100, 0.5],
      ['worse', 50, 0.99],
      ['edge', 80, 1],
      ['idle', 0, 0],
    ]);
    const out = worthALook(board([t]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tone: 'warn', table: 'campaigns', tableTitle: 'Top campaigns' });
    expect(out[0]?.text).toBe('2 campaigns return less than they cost (ROAS under 1.00x)');
  });

  it("ROAS: names the table's own noun, in the singular for one, and falls back to rows", () => {
    const cols = [
      { key: 'x', label: 'X', type: 'text' as const },
      { key: 'spend', label: 'Spend', type: 'money' as const },
      { key: 'roas', label: 'ROAS', type: 'x' as const },
    ];
    const text = (id: string, rows: (string | number)[][]) =>
      worthALook(board([table(id, 'T', cols, rows)]))[0]?.text;
    expect(text('searchterms', [['a', 5, 0.2]])).toBe(
      '1 search term returns less than it cost (ROAS under 1.00x)',
    );
    expect(
      text('searchterms', [
        ['a', 5, 0.2],
        ['b', 5, 0.2],
      ]),
    ).toBe('2 search terms return less than they cost (ROAS under 1.00x)');
    expect(text('products', [['a', 5, 0.2]])).toBe('1 product returns less than it cost (ROAS under 1.00x)');
    expect(text('mystery', [['a', 5, 0.2]])).toBe('1 row returns less than it cost (ROAS under 1.00x)');
  });

  it('ROAS: no line when nothing returns anything yet, or none is under 1', () => {
    expect(
      worthALook(
        board([
          campaigns([
            ['a', 10, 0],
            ['b', 10, 0],
          ]),
        ]),
      ),
    ).toEqual([]);
    expect(
      worthALook(
        board([
          campaigns([
            ['a', 10, 1],
            ['b', 10, 3],
          ]),
        ]),
      ),
    ).toEqual([]);
  });

  it('Quality Score: adds up the keywords in bands of 4 or below, and 5 is fine', () => {
    const out = worthALook(
      board([
        quality([
          [7, 30, 50],
          [5, 9, 15],
          [4, 12, 20],
          [2, 9, 15],
        ]),
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ table: 'quality', tableTitle: 'Quality Score' });
    expect(out[0]?.text).toBe('21 keywords have a Quality Score of 4 or below');
    expect(worthALook(board([quality([[3, 1, 100]])]))[0]?.text).toBe(
      '1 keyword has a Quality Score of 4 or below',
    );
    expect(
      worthALook(
        board([
          quality([
            [5, 4, 40],
            [8, 6, 60],
          ]),
        ]),
      ),
    ).toEqual([]);
  });

  it('Quality Score: gives no second line from the QS column on Top keywords', () => {
    const keywords = table(
      'keywords',
      'Top keywords',
      [
        { key: 'kw', label: 'Keyword', type: 'text' },
        { key: 'qs', label: 'QS', type: 'qs' },
      ],
      [['a', 3]],
    );
    const out = worthALook(board([keywords, quality([[3, 2, 100]])]));
    expect(out.map((i) => i.table)).toEqual(['quality']);
  });

  it('a missing table gives no line, and the others still show', () => {
    const out = worthALook(board([campaigns([['poor', 100, 0.5]])], 50));
    expect(out.map((i) => i.table)).toEqual(['campaigns']);
  });

  it('puts bad before warn', () => {
    const out = worthALook(board([campaigns([['poor', 100, 0.5]]), wasteTable], WASTE_BAD_PCT));
    expect(out.map((i) => i.tone)).toEqual(['bad', 'warn']);
  });

  it('tolerates a board with no tables array', () => {
    expect(worthALook({ wastePct: 30 } as unknown as AdsBoard)).toEqual([]);
  });
});
