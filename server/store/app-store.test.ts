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
      'effort',
      'favouriteChats',
      'favouriteFiles',
      'favouriteTodos',
      'lastClient',
      'levelMode',
      'model',
      'pins',
      'todoPanelOpen',
      'todoSeen',
    ]);
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['z'], extra: true }));
    expect(await store.get()).toEqual({ ...DEFAULT_PREFS, pins: ['z'] });
  });

  it('keeps favourite chats: an old file reads as none; bad ids and repeats are dropped; the newest 200 stay', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['a'] }));
    const store = createAppStore(dir);
    expect((await store.get()).favouriteChats).toEqual([]);
    const a = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const b = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect((await store.update({ favouriteChats: [a, 'x', a, 3, b] as never })).favouriteChats).toEqual([
      a,
      b,
    ]);
    expect((await store.update({ favouriteChats: 'nope' as never })).favouriteChats).toEqual([a, b]);
    expect((await createAppStore(dir).get()).favouriteChats).toEqual([a, b]);
    const many = Array.from(
      { length: 205 },
      (_, i) => `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`,
    );
    expect((await store.update({ favouriteChats: many })).favouriteChats).toEqual(many.slice(5));
  });

  it('keeps favourite to-dos: an old file reads as none; empty, long and repeated keys are dropped; the newest 200 stay', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['a'] }));
    const store = createAppStore(dir);
    expect((await store.get()).favouriteTodos).toEqual([]);
    const long = 'x'.repeat(301);
    expect(
      (await store.update({ favouriteTodos: ['a1', '', 'a1', 3, long, 'personal/b2'] as never }))
        .favouriteTodos,
    ).toEqual(['a1', 'personal/b2']);
    expect((await store.update({ favouriteTodos: 'nope' as never })).favouriteTodos).toEqual([
      'a1',
      'personal/b2',
    ]);
    expect((await createAppStore(dir).get()).favouriteTodos).toEqual(['a1', 'personal/b2']);
    const many = Array.from({ length: 205 }, (_, i) => `t${i}`);
    expect((await store.update({ favouriteTodos: many })).favouriteTodos).toEqual(many.slice(5));
    // A chat star save leaves the to-do stars alone.
    expect((await store.update({ favouriteChats: [] })).favouriteTodos).toEqual(many.slice(5));
  });

  it('keeps starred files: an old file reads as none; empty, long and repeated ids are dropped; the newest 100 stay', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['a'] }));
    const store = createAppStore(dir);
    expect((await store.get()).favouriteFiles).toEqual([]);
    const long = 'x'.repeat(401);
    expect(
      (await store.update({ favouriteFiles: ['f1', '', 'f1', 3, long, 'f2'] as never })).favouriteFiles,
    ).toEqual(['f1', 'f2']);
    expect((await store.update({ favouriteFiles: 'nope' as never })).favouriteFiles).toEqual(['f1', 'f2']);
    expect((await createAppStore(dir).get()).favouriteFiles).toEqual(['f1', 'f2']);
    const many = Array.from({ length: 105 }, (_, i) => `f${i}`);
    expect((await store.update({ favouriteFiles: many })).favouriteFiles).toEqual(many.slice(5));
    // A chat star save leaves the file stars alone.
    expect((await store.update({ favouriteChats: [] })).favouriteFiles).toEqual(many.slice(5));
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
      model: null,
      effort: null,
      levelMode: 'auto',
      favouriteChats: [],
      favouriteTodos: [],
      favouriteFiles: [],
    });
  });

  describe('levelMode', () => {
    const seed = (dir: string, prefs: object) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prefs.json'), JSON.stringify(prefs));
    };

    it('is auto for a new install and for an old file with no model or effort', async () => {
      expect((await createAppStore(fresh()).get()).levelMode).toBe('auto');
      const dir = fresh();
      seed(dir, { pins: ['a'], model: null, effort: null });
      expect((await createAppStore(dir).get()).levelMode).toBe('auto');
    });

    it('reads an old file as manual when a model or an effort was chosen', async () => {
      for (const prefs of [{ model: 'opus' }, { effort: 'high' }, { model: 'sonnet', effort: 'low' }]) {
        const dir = fresh();
        seed(dir, prefs);
        const p = await createAppStore(dir).get();
        expect(p.levelMode).toBe('manual');
        expect(p).toMatchObject(prefs);
      }
    });

    it('treats an invalid levelMode like a missing one', async () => {
      const a = fresh();
      seed(a, { levelMode: 'turbo', model: 'opus' });
      expect((await createAppStore(a).get()).levelMode).toBe('manual');
      const b = fresh();
      seed(b, { levelMode: 7 });
      expect((await createAppStore(b).get()).levelMode).toBe('auto');
    });

    it('keeps a saved levelMode, even beside a model', async () => {
      const dir = fresh();
      seed(dir, { levelMode: 'auto', model: 'opus' });
      expect((await createAppStore(dir).get()).levelMode).toBe('auto');
      seed(dir, { levelMode: 'manual' });
      expect((await createAppStore(dir).get()).levelMode).toBe('manual');
    });

    it('a patch without levelMode keeps the current one, and a bad one is ignored', async () => {
      const dir = fresh();
      seed(dir, { model: 'opus' }); // reads as manual
      const store = createAppStore(dir);
      expect((await store.update({ pins: ['x'] })).levelMode).toBe('manual');
      expect((await store.update({ levelMode: 'nope' as never })).levelMode).toBe('manual');
      expect((await store.update({ levelMode: 'auto' })).levelMode).toBe('auto');
      expect((await store.update({ model: 'haiku' })).levelMode).toBe('auto');
      expect((await createAppStore(dir).get()).levelMode).toBe('auto');
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

  it('reads an older prefs file as no model and no effort', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ pins: ['a'], directWrites: true }));
    const p = await createAppStore(dir).get();
    expect(p.model).toBeNull();
    expect(p.effort).toBeNull();
  });

  it('keeps a valid model and effort, and falls back for bad stored values', async () => {
    const dir = fresh();
    const store = createAppStore(dir);
    expect(await store.update({ model: 'opus', effort: 'max' })).toMatchObject({
      model: 'opus',
      effort: 'max',
    });
    expect(await createAppStore(dir).get()).toMatchObject({ model: 'opus', effort: 'max' });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ model: 'bad model!', effort: 'turbo' }));
    expect(await store.get()).toMatchObject({ model: null, effort: null });
    writeFileSync(join(dir, 'prefs.json'), JSON.stringify({ model: 'x'.repeat(101), effort: 5 }));
    expect(await store.get()).toMatchObject({ model: null, effort: null });
    await store.update({ model: 'sonnet', effort: 'low' });
    // A bad patch keeps what was saved; null clears.
    expect(await store.update({ model: '--bad', effort: 'nope' } as never)).toMatchObject({
      model: 'sonnet',
      effort: 'low',
    });
    expect(await store.update({ model: null, effort: null })).toMatchObject({ model: null, effort: null });
  });
});
