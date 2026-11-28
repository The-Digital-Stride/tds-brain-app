import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type DayDraft, TIME_DAYS_DIR } from '../../shared/time-contract.ts';
import {
  createDayStore,
  emptyDraft,
  isWorkDate,
  londonDate,
  londonDayBounds,
  parseDraft,
  parseInstant,
} from './day-store.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-day-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = new Date('2026-11-20T10:00:00.000Z');
const ID = '11111111-1111-4111-8111-111111111111';

function sample(workDate = '2026-11-20'): DayDraft {
  const d = emptyDraft(workDate, NOW);
  d.entries.push({
    id: ID,
    source: 'manual',
    certainty: 'manual',
    values: { startAt: null, minutes: 30, workItemId: null, description: 'Planning', billable: false },
    captured: null,
    edited: [],
    place: null,
    missing: false,
    fromToolbox: false,
    confirmed: null,
    deleted: false,
  });
  return d;
}

describe('isWorkDate', () => {
  it('takes real YYYY-MM-DD dates only', () => {
    expect(isWorkDate('2026-11-20')).toBe(true);
    expect(isWorkDate('2024-02-29')).toBe(true);
    expect(isWorkDate('2026-02-29')).toBe(false);
    expect(isWorkDate('2026-13-01')).toBe(false);
    expect(isWorkDate('2026-1-01')).toBe(false);
    expect(isWorkDate('../2026-11-20')).toBe(false);
    expect(isWorkDate('2026-11-20.json')).toBe(false);
    expect(isWorkDate(20261120)).toBe(false);
  });
});

describe('London dates', () => {
  it('londonDate follows BST', () => {
    expect(londonDate(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
    expect(londonDate(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01');
  });
  it('day bounds are London midnights, 23 and 25 hours on change days', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const winter = londonDayBounds('2026-11-20');
    expect([iso(winter.start), iso(winter.end)]).toEqual([
      '2026-11-20T00:00:00.000Z',
      '2026-11-21T00:00:00.000Z',
    ]);
    const summer = londonDayBounds('2026-07-01');
    expect([iso(summer.start), iso(summer.end)]).toEqual([
      '2026-06-30T23:00:00.000Z',
      '2026-07-01T23:00:00.000Z',
    ]);
    const spring = londonDayBounds('2026-03-29');
    expect((spring.end - spring.start) / 3_600_000).toBe(23);
    const autumn = londonDayBounds('2026-10-25');
    expect((autumn.end - autumn.start) / 3_600_000).toBe(25);
  });
  it('parseInstant is strict', () => {
    expect(parseInstant('2026-11-20T09:00:00+01:00')?.toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(parseInstant('2026-11-20T09:00Z')?.toISOString()).toBe('2026-11-20T09:00:00.000Z');
    expect(parseInstant('2026-02-30T09:00:00Z')).toBeNull();
    expect(parseInstant('2026-11-20T24:00:00Z')).toBeNull();
    expect(parseInstant('2026-11-20T09:00:00')).toBeNull();
    expect(parseInstant(5)).toBeNull();
  });
});

describe('emptyDraft', () => {
  it('starts a never-confirmed day', () => {
    expect(emptyDraft('2026-11-20', NOW)).toEqual({
      version: 1,
      workDate: '2026-11-20',
      entries: [],
      changes: [],
      revision: 0,
      pending: null,
      storedReadAt: null,
      status: 'not-confirmed',
      problems: [],
      updatedAt: NOW.toISOString(),
    });
  });
});

describe('parseDraft', () => {
  it('accepts what emptyDraft and sample make', () => {
    expect(parseDraft(JSON.parse(JSON.stringify(sample())), '2026-11-20')).toEqual(sample());
  });
  it('refuses a draft for another date or with a broken entry', () => {
    expect(parseDraft(sample('2026-11-19'), '2026-11-20')).toBeNull();
    const bad = sample() as unknown as { entries: Array<{ values: { minutes: unknown } }> };
    (bad.entries[0] as { values: { minutes: unknown } }).values.minutes = '30';
    expect(parseDraft(bad, '2026-11-20')).toBeNull();
    expect(parseDraft({ ...sample(), status: 'nearly' }, '2026-11-20')).toBeNull();
    expect(parseDraft(null, '2026-11-20')).toBeNull();
    expect(parseDraft([], '2026-11-20')).toBeNull();
  });
});

describe('day store', () => {
  it('reads nothing for a day never saved', async () => {
    const store = createDayStore(tmp());
    expect(await store.read('2026-11-20')).toEqual({ draft: null, note: null });
  });

  it('writes atomically with private permissions and reads it back', async () => {
    const dir = tmp();
    const store = createDayStore(dir);
    await store.write(sample());
    const daysDir = join(dir, TIME_DAYS_DIR);
    expect(statSync(daysDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'time')).mode & 0o777).toBe(0o700);
    expect(statSync(join(daysDir, '2026-11-20.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(daysDir)).toEqual(['2026-11-20.json']);
    expect((await createDayStore(dir).read('2026-11-20')).draft).toEqual(sample());
  });

  it('refuses a bad date before touching the disk', async () => {
    const dir = tmp();
    const store = createDayStore(dir);
    await expect(store.read('../../etc')).rejects.toThrow();
    await expect(store.write({ ...sample(), workDate: '2026-11-31' })).rejects.toThrow();
    await expect(store.update('x', () => null)).rejects.toThrow();
  });

  it('keeps a draft that fails to read aside rather than overwriting it', async () => {
    const dir = tmp();
    const store = createDayStore(dir, { now: () => NOW });
    await store.write(sample());
    const file = join(dir, TIME_DAYS_DIR, '2026-11-20.json');
    writeFileSync(file, '{ not json');
    const lines: string[] = [];
    const again = createDayStore(dir, { now: () => NOW, log: (l) => lines.push(l) });
    const read = await again.read('2026-11-20');
    expect(read.draft).toBeNull();
    expect(read.note).toMatch(/couldn.t be read/);
    const names = readdirSync(join(dir, TIME_DAYS_DIR));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^2026-11-20\.json\.bad-\d+$/);
    expect(readFileSync(join(dir, TIME_DAYS_DIR, names[0] as string), 'utf8')).toBe('{ not json');
    expect(lines.join('\n')).not.toContain('Planning');
    // A fresh write after that starts a new file and leaves the kept copy alone.
    await again.write(sample());
    expect(readdirSync(join(dir, TIME_DAYS_DIR)).sort()).toEqual(['2026-11-20.json', names[0]]);
  });

  it('a draft of the wrong shape is kept aside too', async () => {
    const dir = tmp();
    const store = createDayStore(dir, { now: () => NOW });
    await store.write(sample());
    writeFileSync(join(dir, TIME_DAYS_DIR, '2026-11-20.json'), JSON.stringify({ version: 2 }));
    expect((await store.read('2026-11-20')).draft).toBeNull();
    expect(readdirSync(join(dir, TIME_DAYS_DIR)).some((n) => n.includes('.bad-'))).toBe(true);
  });

  it('runs updates to one day one at a time, each on the last saved draft', async () => {
    const dir = tmp();
    const store = createDayStore(dir);
    await store.write(emptyDraft('2026-11-20', NOW));
    const add = (n: number) =>
      store.update('2026-11-20', (d) => {
        const draft = d ?? emptyDraft('2026-11-20', NOW);
        return { ...draft, problems: [...draft.problems, { entryId: '', message: String(n) }] };
      });
    await Promise.all([add(1), add(2), add(3), add(4)]);
    const read = (await store.read('2026-11-20')).draft;
    expect(read?.problems.map((p) => p.message)).toEqual(['1', '2', '3', '4']);
  });

  it('update with null writes nothing, and a failing update leaves the queue working', async () => {
    const dir = tmp();
    const store = createDayStore(dir);
    expect(await store.update('2026-11-20', () => null)).toBeNull();
    expect((await store.read('2026-11-20')).draft).toBeNull();
    await expect(
      store.update('2026-11-20', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await store.update('2026-11-20', () => sample());
    expect(after).toEqual(sample());
  });

  it('update refuses to save a draft for another date', async () => {
    const store = createDayStore(tmp());
    await expect(store.update('2026-11-20', () => sample('2026-11-19'))).rejects.toThrow();
  });
});
