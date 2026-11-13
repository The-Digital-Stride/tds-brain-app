import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../../shared/contract.ts';
import { createAppStore } from './app-store.ts';

const roots: string[] = [];
afterAll(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'tba-store-'));
  roots.push(root);
  return join(root, 'nested', 'data');
};

describe('app store', () => {
  it('gives defaults when nothing is saved, with directWrites off', async () => {
    const p = await createAppStore(fresh()).get();
    expect(p).toEqual(DEFAULT_PREFS);
    expect(p.directWrites).toBe(false);
  });

  it('persists pins across stores and creates the folder', async () => {
    const dir = fresh();
    await createAppStore(dir).update({ pins: ['gm', 'standup'], lastClient: 'acme-heating' });
    const again = await createAppStore(dir).get();
    expect(again.pins).toEqual(['gm', 'standup']);
    expect(again.lastClient).toBe('acme-heating');
    expect(readdirSync(dir)).toEqual(['prefs.json']);
  });

  it('treats a corrupt file as defaults and recovers on the next update', async () => {
    const dir = fresh();
    const store = createAppStore(dir);
    await store.update({ todoPanelOpen: false });
    writeFileSync(join(dir, 'prefs.json'), '{not json');
    expect(await store.get()).toEqual(DEFAULT_PREFS);
    expect((await store.update({ pins: ['a'] })).pins).toEqual(['a']);
  });

  it('drops unknown keys, on read and on write', async () => {
    const dir = fresh();
    const store = createAppStore(dir);
    await store.update({ pins: ['a'], evil: 1 } as never);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'prefs.json'), 'utf8'))).sort()).toEqual([
      'directWrites',
      'lastClient',
      'pins',
      'todoPanelOpen',
      'todoSeen',
    ]);
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['z'], extra: true }));
    expect(await store.get()).toEqual({ ...DEFAULT_PREFS, pins: ['z'] });
  });

  it('validates types: pins unique strings, max 100; booleans are booleans', async () => {
    const store = createAppStore(fresh());
    const many = Array.from({ length: 150 }, (_, i) => `s${i}`);
    expect((await store.update({ pins: [...many, 's0'] })).pins).toEqual(many.slice(0, 100));
    expect((await store.update({ pins: ['a', 'a', 3, '', null] as never })).pins).toEqual(['a']);
    expect((await store.update({ pins: 'nope' as never })).pins).toEqual(['a']);
    expect((await store.update({ directWrites: 'yes' as never })).directWrites).toBe(false);
    expect((await store.update({ directWrites: true })).directWrites).toBe(true);
    expect((await store.update({ todoPanelOpen: 0 as never })).todoPanelOpen).toBe(true);
    expect((await store.update({ lastClient: 5 as never })).lastClient).toBeNull();
    expect((await store.update({ lastClient: null })).lastClient).toBeNull();
  });

  it('serialises concurrent updates without losing any', async () => {
    const store = createAppStore(fresh());
    await Promise.all([
      store.update({ pins: ['a'] }),
      store.update({ lastClient: 'x' }),
      store.update({ todoPanelOpen: false }),
      store.update({ directWrites: true }),
    ]);
    expect(await store.get()).toEqual({
      pins: ['a'],
      lastClient: 'x',
      todoPanelOpen: false,
      directWrites: true,
      todoSeen: {},
    });
  });

  it('loads an old prefs file without todoSeen, with an empty map', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['a'], directWrites: true }));
    const p = await createAppStore(dir).get();
    expect(p.todoSeen).toEqual({});
    expect(p.pins).toEqual(['a']);
  });

  it('prunes seen markers older than a week or unparseable on every write, and keeps recent ones', async () => {
    const dir = fresh();
    const store = createAppStore(dir, () => new Date('2026-11-13T12:00:00Z'));
    const next = await store.update({
      todoSeen: {
        fresh: '2026-11-12T09:00:00+00:00',
        edge: '2026-11-06T12:00:00Z',
        old: '2026-11-05T09:00:00+00:00',
        junk: 'yesterday-ish',
        'personal/x.md': '2026-11-13T08:00:00+00:00',
      },
    });
    expect(Object.keys(next.todoSeen).sort()).toEqual(['edge', 'fresh', 'personal/x.md']);
    // an unrelated write prunes too
    const later = createAppStore(dir, () => new Date('2026-11-19T12:00:00Z'));
    expect(Object.keys((await later.update({ pins: ['b'] })).todoSeen)).toEqual(['personal/x.md']);
  });

  it('caps todoSeen at 500 entries and ignores bad entries', async () => {
    const store = createAppStore(fresh(), () => new Date('2026-11-13T12:00:00Z'));
    const big: Record<string, string> = {};
    for (let i = 0; i < 600; i++) big[`k${i}`] = '2026-11-13T08:00:00Z';
    expect(Object.keys((await store.update({ todoSeen: big })).todoSeen)).toHaveLength(500);
    const mixed = { ok: '2026-11-13T08:00:00Z', long: 'x'.repeat(41), n: 5 } as never;
    expect(Object.keys((await store.update({ todoSeen: mixed })).todoSeen)).toEqual(['ok']);
  });
});
