import { describe, expect, it } from 'vitest';
import type { SavingsEntry } from '../../shared/kits-contract.ts';
import { createTokenSavingsStore } from '../store/token-savings.ts';
import { createSavings, emptySummary, utcDay } from './savings.ts';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const DAY = 86_400_000;
const summary = (tokens: number, key: string | null = null, at?: number): SavingsEntry => ({
  source: 'summary',
  measure: 'compacted',
  tokens,
  kind: 'tds',
  dedupeKey: key,
  at,
});
const cache = (tokens: number, at?: number): SavingsEntry => ({
  source: 'cache',
  measure: 'reused',
  tokens,
  kind: 'tds',
  dedupeKey: null,
  at,
});

function make() {
  const store = createTokenSavingsStore(null);
  return createSavings({ store, now: () => NOW });
}

describe('savings ledger', () => {
  it('starts empty with the shadow mode and no team', async () => {
    const s = await make().summary();
    expect(s).toEqual(emptySummary());
    expect(s.team).toBeNull();
    expect(s.kitsMode).toBe('shadow');
    expect(s.since).toBeNull();
  });

  it('counts a boundary once by key', async () => {
    const l = make();
    expect(await l.record(summary(900, 'c:u1'))).toBe(true);
    expect(await l.record(summary(900, 'c:u1'))).toBe(false);
    expect((await l.summary()).all.saved).toBe(900);
  });

  it('keeps cache out of saved', async () => {
    const l = make();
    await l.record(summary(100, 'c:a'));
    await l.record(cache(5_000));
    const s = await l.summary();
    expect(s.today.saved).toBe(100);
    expect(s.today.reused).toBe(5_000);
    expect(s.today.bySource).toEqual({ summary: 100, cache: 5_000 });
  });

  it('buckets by UTC day and windows', async () => {
    const l = make();
    await l.record(summary(1, 'c:1', NOW)); // today
    await l.record(summary(10, 'c:2', NOW - 6 * DAY)); // inside 7
    await l.record(summary(100, 'c:3', NOW - 7 * DAY)); // outside 7, inside 30
    await l.record(summary(1000, 'c:4', NOW - 29 * DAY)); // inside 30
    await l.record(summary(10000, 'c:5', NOW - 30 * DAY)); // all only
    const s = await l.summary();
    expect(s.today.saved).toBe(1);
    expect(s.last7.saved).toBe(11);
    expect(s.last30.saved).toBe(1111);
    expect(s.all.saved).toBe(11111);
    expect(s.since).toBe(utcDay(NOW - 30 * DAY));
  });

  it('puts a late-evening UTC time on its own UTC day', () => {
    expect(utcDay(Date.parse('2026-11-15T23:59:59Z'))).toBe('2026-11-15');
    expect(utcDay(Date.parse('2026-11-16T00:00:00Z'))).toBe('2026-11-16');
  });

  it('ignores a measure that does not match its source, and bad numbers', async () => {
    const l = make();
    expect(await l.record({ ...summary(10, 'c:x'), measure: 'reused' })).toBe(false);
    expect(await l.record(summary(0, 'c:y'))).toBe(false);
    expect(await l.record(summary(-5, 'c:z'))).toBe(false);
    expect((await l.summary()).all.saved).toBe(0);
  });

  it('gives an empty summary when the store cannot be read', async () => {
    const bad = { add: async () => false, read: async () => null };
    expect(await createSavings({ store: bad, now: () => NOW }).summary()).toEqual(emptySummary());
  });
});
