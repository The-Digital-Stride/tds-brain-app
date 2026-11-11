import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../../shared/contract.ts';
import { createAppStore } from './app-store.ts';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'tba-store-')), 'nested', 'data');

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
    });
  });
});
