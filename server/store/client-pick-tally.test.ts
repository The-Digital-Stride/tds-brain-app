import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClientPickTally, guessOutcome, TALLY_FILE } from './client-pick-tally.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'tally-'));

describe('createClientPickTally', () => {
  it('counts outcomes by local month and keeps them in the data folder', async () => {
    const d = dir();
    let now = new Date(2026, 10, 30, 23, 0);
    const tally = createClientPickTally(d, () => now);
    tally.record('named');
    tally.record('named');
    tally.record('ask-cancelled');
    now = new Date(2026, 11, 1, 9, 0);
    tally.record('jev');
    expect(await tally.read()).toEqual({
      version: 1,
      months: { '2026-11': { named: 2, 'ask-cancelled': 1 }, '2026-12': { jev: 1 } },
    });
    const onDisk = JSON.parse(readFileSync(join(d, TALLY_FILE), 'utf8'));
    expect(onDisk.months['2026-11'].named).toBe(2);
    // A new copy (a restart) carries on from the file.
    const again = createClientPickTally(d, () => now);
    again.record('jev');
    expect((await again.read()).months['2026-12']).toEqual({ jev: 2 });
  });

  it('starts again from nothing when the file is unreadable, and keeps 24 months', async () => {
    const d = dir();
    writeFileSync(join(d, TALLY_FILE), '{not json');
    const months: Record<string, Record<string, number>> = {};
    for (let i = 1; i <= 30; i++) months[`2020-${String(i).padStart(2, '0')}`] = { named: 1 };
    let tally = createClientPickTally(d, () => new Date(2026, 0, 5));
    tally.record('asked');
    expect(await tally.read()).toEqual({ version: 1, months: { '2026-01': { asked: 1 } } });

    writeFileSync(join(d, TALLY_FILE), JSON.stringify({ version: 1, months }));
    tally = createClientPickTally(d, () => new Date(2026, 0, 5));
    tally.record('asked');
    expect(Object.keys((await tally.read()).months)).toHaveLength(24);
  });

  it('ignores junk counts in the file', async () => {
    const d = dir();
    writeFileSync(
      join(d, TALLY_FILE),
      JSON.stringify({
        version: 1,
        months: { '2026-01': { named: 'x', jev: -2, asked: 3 }, nonsense: { a: 1 } },
      }),
    );
    const tally = createClientPickTally(d, () => new Date(2026, 0, 5));
    expect(await tally.read()).toEqual({ version: 1, months: { '2026-01': { asked: 3 } } });
  });

  it('keeps counts in memory with no data folder', async () => {
    const tally = createClientPickTally(null, () => new Date(2026, 0, 5));
    tally.record('preset');
    expect(await tally.read()).toEqual({ version: 1, months: { '2026-01': { preset: 1 } } });
  });
});

describe('guessOutcome', () => {
  it('names each guess', () => {
    expect(guessOutcome({ kind: 'sure', client: 'a', how: 'named' })).toBe('named');
    expect(guessOutcome({ kind: 'sure', client: 'a', how: 'jev' })).toBe('jev');
    expect(guessOutcome({ kind: 'none' })).toBe('not-client');
    expect(guessOutcome({ kind: 'ask', options: ['a'] })).toBe('asked');
    expect(guessOutcome({ kind: 'ask', options: [] })).toBe('asked-blank');
  });
});
