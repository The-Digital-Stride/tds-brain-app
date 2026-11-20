import { describe, expect, it, vi } from 'vitest';
import { ADS_ERROR_MESSAGES } from '../../../../shared/ads-contract.ts';

vi.mock('../../api.ts', () => ({ ApiFailure: class extends Error {} }));
const {
  fmt,
  sortRows,
  actionLabel,
  moneyDigits,
  isLow,
  isQuietZero,
  shortDate,
  rangeWords,
  totalsValue,
  totalsChange,
  proposalFacts,
  personName,
  decisionWords,
  datesInWords,
  earlierMonthWords,
  triageWords,
} = await import('./words.ts');

describe('fmt', () => {
  it('formats the Workbench column types', () => {
    expect(fmt(1234.4, 'money', 'GBP')).toBe('£1,234');
    expect(fmt(5, 'money', 'USD')).toBe('US$5');
    expect(fmt(12.34, 'num1', 'GBP')).toBe('12.3');
    expect(fmt(3.456, 'x', 'GBP')).toBe('3.46x');
    expect(fmt(8, 'pct', 'GBP')).toBe('8.0%');
    expect(fmt(null, 'int', 'GBP')).toBe('—');
  });
});

describe('fmt by column', () => {
  it('uses the real currency, and survives a bad code', () => {
    expect(fmt(10, 'money', 'EUR')).toBe('€10');
    expect(fmt(10, 'money', 'CAD')).toBe('CA$10');
    expect(fmt(10, 'money', 'nonsense!')).toBe('nonsense! 10');
    expect(fmt('n/a', 'money', 'GBP')).toBe('n/a');
  });
  it('picks money decimals per column', () => {
    expect(moneyDigits([3.5, 99.9, null])).toBe(2);
    expect(moneyDigits([3.5, 100])).toBe(0);
    expect(moneyDigits([-250, 4])).toBe(0);
    expect(fmt(3.5, 'money', 'GBP', 2)).toBe('£3.50');
    expect(fmt(1234.5, 'money', 'GBP', 0)).toBe('£1,235');
  });
  it('formats Quality Score and conversions', () => {
    expect(fmt(7, 'qs', 'GBP')).toBe('7');
    expect(fmt(6.5, 'qs', 'GBP')).toBe('6.5');
    expect(fmt(2, 'num1', 'GBP')).toBe('2.0');
    expect(fmt(0, 'x', 'GBP')).toBe('0.00x');
  });
  it('flags low ROAS and Quality Score', () => {
    expect(isLow(0.8, 'x', [0.8, 2])).toBe(true);
    expect(isLow(1, 'x', [1, 2])).toBe(false);
    expect(isLow(0, 'x', [0, 0])).toBe(false);
    expect(isLow(0, 'x', [0, 3])).toBe(true);
    // A row that spent nothing has no return to judge: its 0.00x is not low.
    expect(isLow(0, 'x', [0, 3], false)).toBe(false);
    expect(isLow(0.5, 'x', [0.5, 3], true)).toBe(true);
    expect(isLow(4, 'qs', [4])).toBe(true);
    expect(isLow(5, 'qs', [5])).toBe(false);
    expect(isLow(null, 'qs', [null])).toBe(false);
    expect(isLow(0.1, 'money', [0.1])).toBe(false);
  });
  it('quietens true zeros but not a ROAS of 0', () => {
    expect(isQuietZero(0, 'num1')).toBe(true);
    expect(isQuietZero(0, 'money')).toBe(true);
    expect(isQuietZero(0, 'x')).toBe(false);
    expect(isQuietZero(0, 'text')).toBe(false);
    expect(isQuietZero(2, 'int')).toBe(false);
  });
});

describe('sortRows', () => {
  it('sorts numbers by value and puts empty last', () => {
    const rows = [
      ['a', 2],
      ['b', null],
      ['c', 10],
    ] as (string | number | null)[][];
    expect(sortRows(rows, 1, 'desc').map((r) => r[0])).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['a', 'b', 'c']);
  });
});

describe('actionLabel', () => {
  it('uses the account labels, then the known ones, then words', () => {
    expect(actionLabel('NONE')).toBe('Hold');
    expect(actionLabel('NONE', { NONE: 'Leave it' })).toBe('Leave it');
    expect(actionLabel('SOME_NEW_THING')).toBe('Some new thing');
  });
});

it('keeps the unknown-outcome wording', () => {
  expect(ADS_ERROR_MESSAGES['unknown-outcome']).toMatch(/don't know whether/);
});

describe('dates in words', () => {
  const now = new Date(2026, 10, 19, 15, 30); // Thu 19 Nov 2026, local
  it('writes a day with its weekday, and the year only when it is not this one', async () => {
    const { dateWords } = await import('./words.ts');
    expect(dateWords('2026-11-17', now)).toBe('Tue 17 Nov');
    expect(dateWords('2026-11-17T09:00:00Z', now)).toBe('Tue 17 Nov');
    expect(dateWords('2027-01-04', now)).toBe('Mon 4 Jan 2027');
    expect(dateWords('', now)).toBe('');
    expect(dateWords('2026-13-40', now)).toBe('');
  });
  it('counts local calendar days, not 24-hour blocks', async () => {
    const { daysFromNow, relativeWords } = await import('./words.ts');
    expect(daysFromNow('2026-11-19', now)).toBe(0);
    expect(daysFromNow('2026-11-22', now)).toBe(3);
    expect(daysFromNow('2026-11-18', new Date(2026, 10, 19, 0, 5))).toBe(-1);
    expect(daysFromNow(null, now)).toBeNull();
    expect(relativeWords('2026-11-19', now)).toBe('today');
    expect(relativeWords('2026-11-20', now)).toBe('tomorrow');
    expect(relativeWords('2026-11-18', now)).toBe('yesterday');
    expect(relativeWords('2026-11-22', now)).toBe('in 3 days');
    expect(relativeWords('2026-11-14', now)).toBe('5 days ago');
  });
  it('says Today, Yesterday or Tomorrow near now, else the date', async () => {
    const { whenWords } = await import('./words.ts');
    expect(whenWords('2026-11-19', now)).toBe('Today');
    expect(whenWords('2026-11-18', now)).toBe('Yesterday');
    expect(whenWords('2026-11-20', now)).toBe('Tomorrow');
    expect(whenWords('2026-11-24', now)).toBe('Tue 24 Nov');
  });
  it('names the next step of an approved proposal', async () => {
    const { nextStepWords } = await import('./words.ts');
    const p = (over: Record<string, unknown>, flags: Record<string, boolean> = {}) =>
      ({ fm: { status: 'approved', ...over }, flags }) as never;
    expect(nextStepWords(p({ dry_run: 'passed' })).text).toBe('Dry run passed');
    expect(nextStepWords(p({}, { canClientDraft: true })).text).toBe('Draft the email');
    expect(nextStepWords(p({}, { canDryRun: true })).text).toBe('Dry run first');
    expect(nextStepWords(p({}, { canApply: true })).text).toBe('Ready to apply');
    expect(nextStepWords(p({}, { inflight: true, canApply: true })).text).toBe('Apply outcome unknown');
    expect(nextStepWords(p({}, { canRecordDecision: true })).text).toBe('Record the decision');
    expect(nextStepWords(p({})).text).toBe('Waiting on someone else');
  });
});

describe('Release 2 words', () => {
  const now = new Date(2026, 10, 19);
  it('writes a totals range in words', () => {
    expect(shortDate('2026-11-08', now)).toBe('8 Nov');
    expect(shortDate('2025-12-30', now)).toBe('30 Dec 2025');
    expect(rangeWords('2026-10-10', '2026-11-08', now)).toBe('10 Oct to 8 Nov');
  });
  it('formats totals figures, with n/a for nothing to divide', () => {
    expect(totalsValue('spend', 1204, 'GBP')).toBe('£1,204');
    expect(totalsValue('cpa', 12.5, 'GBP')).toBe('£12.50');
    expect(totalsValue('roas', 3, 'GBP')).toBe('3.00x');
    expect(totalsValue('roas', null, 'GBP')).toBe('n/a');
    expect(totalsValue('conversions', 10, 'GBP')).toBe('10');
  });
  it('compares with the period before', () => {
    expect(totalsChange('spend', 1348, { value: 1204 }, 'GBP').text).toBe('+12% vs £1,204');
    expect(totalsChange('spend', 90, { value: 100 }, 'GBP').text).toBe('−10% vs £100');
    expect(totalsChange('spend', 90, { value: 0 }, 'GBP').text).toBe('vs £0');
    expect(totalsChange('spend', 90, null, 'GBP').text).toBe('No earlier data to compare');
    // Better is good, worse is bad, spend is neither, and a lower CPA is better.
    expect(totalsChange('roas', 4.4, { value: 4 }, 'GBP')).toMatchObject({
      tone: 'good',
      hidden: ', better',
    });
    expect(totalsChange('conversions', 8, { value: 10 }, 'GBP')).toMatchObject({
      tone: 'bad',
      hidden: ', worse',
    });
    expect(totalsChange('cpa', 8, { value: 10 }, 'GBP')).toMatchObject({ tone: 'good', hidden: ', better' });
    expect(totalsChange('cpa', 12, { value: 10 }, 'GBP')).toMatchObject({ tone: 'bad' });
    expect(totalsChange('spend', 150, { value: 100 }, 'GBP')).toMatchObject({ tone: 'neutral', hidden: '' });
    expect(totalsChange('roas', 4, { value: 4 }, 'GBP').tone).toBe('neutral');
  });
  it('words a past month and a triage row', () => {
    const m = { signed: false, stale: false, partial: false, reviewedBy: null, reviewedAt: null };
    expect(earlierMonthWords(m)).toBe('Not signed off');
    expect(earlierMonthWords({ ...m, partial: true })).toBe('Month-to-date draft');
    expect(earlierMonthWords({ ...m, signed: false, stale: true })).toBe(
      'Changed after sign-off, sign again',
    );
    expect(earlierMonthWords({ ...m, signed: true, reviewedBy: 'Pete', reviewedAt: '2026-11-03' })).toMatch(
      /^Signed off by Pete on 3 Nov/,
    );
    expect(triageWords({ hasStandup: false, verdict: null })).toBe('No standup set up');
    expect(triageWords({ hasStandup: true, verdict: null })).toBe('Not run yet');
  });
});

describe('proposalFacts', () => {
  const now = new Date(2026, 10, 18);
  const p = {
    id: '20261026-04-water',
    file: 'x.md',
    warnings: [],
    flags: {},
    fm: {
      id: '20261026-04-water',
      client: 'x',
      type: 'decision',
      tier: 2,
      status: 'changes-requested',
      title: 'Water',
      framework_section: '4',
      campaigns: ['A', 'B'],
      expires: '2026-11-21',
      created_by: 'ian',
      created_at: '2026-11-17',
    },
  } as unknown as Parameters<typeof proposalFacts>[0];
  it('reads in order, in words, with the id last', () => {
    const facts = proposalFacts(p, now);
    expect(facts.map(([k]) => k)).toEqual([
      'Status',
      'Tier',
      'Campaigns',
      'Section',
      'Type',
      'Expires',
      'Proposed',
      'Proposal ID',
    ]);
    const get = (k: string) => facts.find(([n]) => n === k)?.[1];
    expect(get('Status')).toBe('Changes requested');
    expect(get('Campaigns')).toBe('A, B');
    expect(get('Expires')).toBe('Sat 21 Nov, in 3 days');
    expect(get('Proposed')).toBe('ian, Tue 17 Nov');
  });
  it('names people from the roster when the bridge sends `people`, else as written', () => {
    const q = {
      ...p,
      fm: { ...p.fm, created_by: 'pete-tyler', approved_by: 'rita', approved_at: '2026-11-18' },
    } as typeof p;
    const people = { 'pete-tyler': 'Pete Tyler' };
    const get = (k: string) => proposalFacts(q, now, people).find(([n]) => n === k)?.[1];
    expect(get('Proposed')).toBe('Pete Tyler, Tue 17 Nov');
    expect(get('Approved')).toBe('rita, Wed 18 Nov');
  });
  it('leaves out an expiry the data does not have', () => {
    const { expires: _e, ...rest } = p.fm;
    const q = { ...p, fm: rest } as typeof p;
    expect(proposalFacts(q, now).some(([k]) => k === 'Expires')).toBe(false);
  });
});

describe('datesInWords and stale months', () => {
  it('turns ISO dates into words', () => {
    expect(datesInWords('Due 2026-11-09 and 2026-11-10', new Date(2026, 10, 18))).toBe(
      'Due Mon 9 Nov and Tue 10 Nov',
    );
  });
  it('a stale month shows the bridge reason when there is one', () => {
    const m = { signed: false, stale: true, partial: false, reviewedBy: null, reviewedAt: null };
    expect(earlierMonthWords({ ...m, reason: 'The report was edited after sign-off.' })).toBe(
      'The report was edited after sign-off, sign again',
    );
  });
});

describe('personName', () => {
  const people = { 'pete-tyler': 'Pete Tyler', owner: 'Pete Tyler', ian: '  ' };
  it('maps a slug to its roster name, any case, and leaves anything else as written', () => {
    expect(personName('pete-tyler', people)).toBe('Pete Tyler');
    expect(personName('Pete-Tyler', people)).toBe('Pete Tyler');
    expect(personName('owner', people)).toBe('Pete Tyler');
    expect(personName('simon', people)).toBe('simon');
    expect(personName('pete-tyler', undefined)).toBe('pete-tyler');
    expect(personName(null, people)).toBe('');
    // A blank name in the map doesn't blank the person out.
    expect(personName('ian', people)).toBe('ian');
  });
  it('never picks up an inherited property for slugs like constructor', () => {
    expect(personName('constructor', people)).toBe('constructor');
    expect(personName('__proto__', people)).toBe('__proto__');
    expect(personName('toString', {})).toBe('toString');
  });
  it('names the decider in Recent decisions', () => {
    const fm = { status: 'approved', approved_by: 'pete-tyler', approved_at: '2026-11-17' } as never;
    expect(decisionWords(fm, people).by).toBe('Pete Tyler');
    expect(decisionWords(fm).by).toBe('pete-tyler');
  });
});
