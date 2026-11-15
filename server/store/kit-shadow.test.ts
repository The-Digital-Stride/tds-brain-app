import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KIT_SHADOW_FILE, KIT_SHADOW_LIMITS, type KitShadowRecord } from '../../shared/kits-contract.ts';
import { cleanRecord, createKitShadowStore } from './kit-shadow.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-ks-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, KIT_SHADOW_FILE), 0o600);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

const NOW = Date.parse('2026-11-15T12:00:00Z');
const rec = (over: Partial<KitShadowRecord> = {}): KitShadowRecord => ({
  v: 1,
  day: '2026-11-15',
  kind: 'tds',
  seq: 1,
  handedOffSeq: null,
  turns: 1,
  compacted: 0,
  cacheRead: 0,
  work: {
    kit: 'core',
    how: 'auto',
    fits: ['core', 'ads', 'web', 'full'],
    tier: 'quick',
    startup: null,
    wouldSave: { sure: 100, approx: 150 },
    used: { skills: ['x'], connectors: ['claudeaigmail'] },
    peakPercent: 12,
    summaries: 0,
  },
  ...over,
});
const open = (dir: string | null, log: (l: string) => void = () => {}) =>
  createKitShadowStore(dir, log, () => NOW);

describe('kit shadow store', () => {
  it('round trips and survives a restart', async () => {
    const dir = tmp();
    await open(dir).put('s1', rec());
    expect(await open(dir).get('s1')).toEqual(rec());
    expect(await open(dir).get('nope')).toBeNull();
  });

  it('re-keys a record and marks it unsent under the new key', async () => {
    const s = open(tmp());
    await s.put('a', rec({ seq: 2 }));
    await s.markHandedOff('a', 2);
    await s.rekey('a', 'b');
    expect(await s.get('a')).toBeNull();
    expect((await s.get('b'))?.handedOffSeq).toBeNull();
    expect((await s.get('b'))?.seq).toBe(2);
  });

  it('keeps handedOffSeq the store holds when a newer record is put, and ignores an older seq', async () => {
    const s = open(null);
    await s.put('a', rec({ seq: 1 }));
    await s.markHandedOff('a', 1);
    await s.put('a', rec({ seq: 2 }));
    const r = await s.get('a');
    expect(r?.seq).toBe(2);
    expect(r?.handedOffSeq).toBe(1);
    expect((await s.pending()).map((p) => p.id)).toEqual(['a']);
    await s.put('a', rec({ seq: 1, turns: 99 }));
    expect((await s.get('a'))?.turns).toBe(1);
  });

  it('marks handed off only up to the stored seq and never lowers it', async () => {
    const s = open(null);
    await s.put('a', rec({ seq: 3 }));
    await s.markHandedOff('a', 9);
    expect((await s.get('a'))?.handedOffSeq).toBe(3);
    await s.markHandedOff('a', 1);
    expect((await s.get('a'))?.handedOffSeq).toBe(3);
    expect(await s.pending()).toEqual([]);
  });

  it('caps the chats, dropping the oldest day first', async () => {
    const s = open(null);
    await s.put('old', rec({ day: '2026-11-01' }));
    for (let i = 0; i < KIT_SHADOW_LIMITS.maxChats; i++) await s.put(`c${i}`, rec());
    expect(await s.get('old')).toBeNull();
    expect(await s.get('c0')).not.toBeNull();
    expect((await s.pending()).length).toBe(KIT_SHADOW_LIMITS.maxChats);
  });

  it('trims records older than 35 days on write', async () => {
    const s = open(null);
    await s.put('stale', rec({ day: '2026-10-10' })); // 36 days before
    expect(await s.get('stale')).toBeNull();
    await s.put('edge', rec({ day: '2026-10-11' })); // 35 days before: kept
    expect(await s.get('edge')).not.toBeNull();
  });

  it('never holds work on a personal record', async () => {
    const s = open(tmp());
    await s.put('p', rec({ kind: 'personal' }));
    expect((await s.get('p'))?.work).toBeUndefined();
    expect(cleanRecord({ ...rec({ kind: 'personal' }) })?.work).toBeUndefined();
  });

  it('drops bad rows and a record with unknown parts one by one', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, KIT_SHADOW_FILE),
      JSON.stringify({
        version: 1,
        chats: {
          ok: rec(),
          bad1: { v: 2 },
          bad2: { ...rec(), day: 'yesterday' },
          odd: { ...rec(), work: { kit: 'nope', how: 'auto' } },
        },
      }),
    );
    const s = open(dir);
    expect(await s.get('ok')).not.toBeNull();
    expect(await s.get('bad1')).toBeNull();
    expect(await s.get('bad2')).toBeNull();
    expect((await s.get('odd'))?.work).toBeUndefined();
  });

  it('copies broken JSON to .broken once and starts empty', async () => {
    const dir = tmp();
    writeFileSync(join(dir, KIT_SHADOW_FILE), '{nope');
    const lines: string[] = [];
    const s = open(dir, (l) => lines.push(l));
    expect(await s.get('a')).toBeNull();
    expect(readFileSync(join(dir, `${KIT_SHADOW_FILE}.broken`), 'utf8')).toBe('{nope');
    await s.put('a', rec());
    expect(lines).toHaveLength(1);
    expect(await s.get('a')).not.toBeNull();
  });

  it('an unreadable file is not cached, skips the write and never wipes the records', async () => {
    if (process.getuid?.() === 0) return;
    const dir = tmp();
    const path = join(dir, KIT_SHADOW_FILE);
    writeFileSync(path, JSON.stringify({ version: 1, chats: { keep: rec() } }));
    chmodSync(path, 0o000);
    const s = open(dir);
    await s.put('new', rec());
    expect(await s.pending()).toEqual([]);
    chmodSync(path, 0o600);
    expect(await s.get('keep')).not.toBeNull();
    expect(await s.get('new')).toBeNull();
  });
});
