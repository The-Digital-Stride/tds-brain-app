import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextEvent } from '../../shared/context-contract.ts';
import { CONTEXT_READINGS_MAX, createContextReadingStore } from './context-readings.ts';

const roots: string[] = [];
afterAll(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'tba-context-readings-'));
  roots.push(root);
  return join(root, 'nested', 'data');
};
const reading = (n = 0, over: Partial<ContextEvent> = {}): ContextEvent => ({
  type: 'context',
  usedTokens: 40_000 + n,
  limitTokens: 167_000,
  windowTokens: 200_000,
  percent: 24,
  autoCompact: true,
  source: 'engine',
  at: Date.UTC(2026, 10, 15, 0, 0, n),
  ...over,
});
const FILE = 'context-readings.json';

describe('context reading store (decision 7)', () => {
  it('round-trips the newest reading per chat, across stores, and creates the folder', async () => {
    const dir = fresh();
    const a = createContextReadingStore(dir);
    expect(await a.get('s1')).toBeNull();
    await a.set('s1', reading(1));
    await a.set('s1', reading(2, { source: 'usage' }));
    await a.set('s2', reading(3));
    expect(await createContextReadingStore(dir).get('s1')).toEqual(reading(2, { source: 'usage' }));
    expect(await a.get('s2')).toEqual(reading(3));
    expect(readdirSync(dir)).toEqual([FILE]);
  });

  it('ignores a bad file and bad rows, and never stores a bad reading', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, FILE), '{ nope');
    const store = createContextReadingStore(dir);
    expect(await store.get('s1')).toBeNull();
    writeFileSync(
      join(dir, FILE),
      JSON.stringify({
        ok: reading(1),
        a: { ...reading(1), usedTokens: 'x' },
        b: { ...reading(1), source: 'who' },
        c: 5,
        d: { ...reading(1), limitTokens: 0 },
      }),
    );
    expect(await store.get('ok')).toEqual(reading(1));
    for (const k of ['a', 'b', 'c', 'd']) expect(await store.get(k)).toBeNull();
    writeFileSync(join(dir, FILE), '[1]');
    expect(await store.get('ok')).toBeNull();
    await store.set('x', { type: 'context' } as never);
    expect(await store.get('x')).toBeNull();
  });

  it('keeps at most CONTEXT_READINGS_MAX, pruning the oldest first', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    const seeded: Record<string, ContextEvent> = {};
    for (let i = 0; i < CONTEXT_READINGS_MAX; i++) seeded[`old-${i}`] = reading(i);
    writeFileSync(join(dir, FILE), JSON.stringify(seeded));
    const store = createContextReadingStore(dir);
    await store.set('newest', reading(CONTEXT_READINGS_MAX + 10));
    expect(Object.keys(JSON.parse(readFileSync(join(dir, FILE), 'utf8')))).toHaveLength(CONTEXT_READINGS_MAX);
    expect(await store.get('old-0')).toBeNull();
    expect(await store.get('newest')).not.toBeNull();
  });

  it('never throws when the folder cannot be written, and treats __proto__ as a key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tba-context-readings-'));
    roots.push(root);
    writeFileSync(join(root, 'file'), 'x');
    const broken = createContextReadingStore(join(root, 'file', 'sub'));
    await expect(broken.set('s1', reading(1))).resolves.toBeUndefined();
    const store = createContextReadingStore(fresh());
    await store.set('__proto__', reading(1));
    expect(await store.get('__proto__')).toEqual(reading(1));
    expect(await store.get('toString')).toBeNull();
  });
});
