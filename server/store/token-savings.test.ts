import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN_SAVINGS_FILE, TOKEN_SAVINGS_LIMITS } from '../../shared/kits-contract.ts';
import { createTokenSavingsStore } from './token-savings.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-ts-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, TOKEN_SAVINGS_FILE), 0o600);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

const add = (day: string, tokens: number, dedupeKey: string | null = null) => ({
  day,
  source: 'summary' as const,
  measure: 'compacted' as const,
  tokens,
  dedupeKey,
});

describe('token savings store', () => {
  it('adds per day and survives a restart', async () => {
    const dir = tmp();
    const a = createTokenSavingsStore(dir);
    expect(await a.add(add('2026-11-15', 100))).toBe(true);
    expect(await a.add(add('2026-11-15', 50))).toBe(true);
    const b = createTokenSavingsStore(dir);
    expect((await b.read())?.days['2026-11-15']).toEqual({ 'summary/compacted': 150 });
  });

  it('counts a dedupe key once, across restarts', async () => {
    const dir = tmp();
    const a = createTokenSavingsStore(dir);
    expect(await a.add(add('2026-11-15', 100, 'c:u1'))).toBe(true);
    expect(await a.add(add('2026-11-15', 100, 'c:u1'))).toBe(false);
    const b = createTokenSavingsStore(dir);
    expect(await b.add(add('2026-11-16', 100, 'c:u1'))).toBe(false);
    expect((await b.read())?.days).toEqual({ '2026-11-15': { 'summary/compacted': 100 } });
  });

  it('rejects bad input', async () => {
    const s = createTokenSavingsStore(tmp());
    expect(await s.add(add('15-11-2026', 10))).toBe(false);
    expect(await s.add(add('2026-11-15', 0))).toBe(false);
    expect(await s.add(add('2026-11-15', Number.NaN))).toBe(false);
    expect(await s.add({ ...add('2026-11-15', 5), source: 'nope' as never })).toBe(false);
  });

  it('keeps only the newest dedupe keys', async () => {
    const s = createTokenSavingsStore(null);
    for (let i = 0; i < TOKEN_SAVINGS_LIMITS.maxKeys + 3; i++) await s.add(add('2026-11-15', 1, `c:${i}`));
    const data = await s.read();
    expect(data?.keys).toHaveLength(TOKEN_SAVINGS_LIMITS.maxKeys);
    expect(data?.keys[0]).toBe('c:3');
  });

  it('copies broken JSON to .broken once and starts empty', async () => {
    const dir = tmp();
    writeFileSync(join(dir, TOKEN_SAVINGS_FILE), '{nope');
    const lines: string[] = [];
    const s = createTokenSavingsStore(dir, (l) => lines.push(l));
    expect((await s.read())?.days).toEqual({});
    expect(readFileSync(join(dir, `${TOKEN_SAVINGS_FILE}.broken`), 'utf8')).toBe('{nope');
    expect(lines).toHaveLength(1);
  });

  it('drops bad rows one by one', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, TOKEN_SAVINGS_FILE),
      JSON.stringify({
        version: 1,
        days: {
          '2026-11-15': { 'summary/compacted': 7, 'x/y': 9, 'cache/reused': -1 },
          bad: { 'cache/reused': 3 },
        },
        keys: ['c:a', 5, ''],
      }),
    );
    const data = await createTokenSavingsStore(dir).read();
    expect(data?.days).toEqual({ '2026-11-15': { 'summary/compacted': 7 } });
    expect(data?.keys).toEqual(['c:a']);
  });

  it('an unreadable file is not cached, skips the write and never wipes the totals', async () => {
    const dir = tmp();
    const path = join(dir, TOKEN_SAVINGS_FILE);
    writeFileSync(
      path,
      JSON.stringify({ version: 1, days: { '2026-11-15': { 'summary/compacted': 9 } }, keys: [] }),
    );
    chmodSync(path, 0o000);
    const lines: string[] = [];
    const s = createTokenSavingsStore(dir, (l) => lines.push(l));
    if (process.getuid?.() === 0) return; // root can read anything
    expect(await s.add(add('2026-11-15', 5))).toBe(false);
    expect(await s.read()).toBeNull();
    chmodSync(path, 0o600);
    expect(await s.add(add('2026-11-15', 5))).toBe(true);
    expect((await s.read())?.days['2026-11-15']).toEqual({ 'summary/compacted': 14 });
    expect(lines.length).toBeGreaterThan(0);
  });
});
