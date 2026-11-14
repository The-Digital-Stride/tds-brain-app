import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHAT_LEVELS_MAX, type ChatLevelRecord } from '../../shared/levels-contract.ts';
import { createChatLevelStore } from './chat-levels.ts';

const roots: string[] = [];
afterAll(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'tba-chat-levels-'));
  roots.push(root);
  return join(root, 'nested', 'data');
};
const rec = (n = 0, over: Partial<ChatLevelRecord> = {}): ChatLevelRecord => ({
  tier: 'deep',
  source: 'auto',
  at: new Date(Date.UTC(2026, 10, 14, 0, 0, n)).toISOString(),
  ...over,
});

describe('chat level store', () => {
  it('remembers a record by sdkSessionId, across stores, and creates the folder', async () => {
    const dir = fresh();
    const a = createChatLevelStore(dir);
    expect(await a.get('s1')).toBeNull();
    await a.set('s1', rec(1, { tier: 'quick', source: 'chat' }));
    await a.set('s2', rec(2));
    expect(await createChatLevelStore(dir).get('s1')).toEqual(rec(1, { tier: 'quick', source: 'chat' }));
    expect(await a.get('s2')).toEqual(rec(2));
    expect(await a.get('nope')).toBeNull();
  });

  it('replaces the record of the same chat', async () => {
    const store = createChatLevelStore(fresh());
    await store.set('s1', rec(1));
    await store.set('s1', rec(2, { tier: 'standard', source: 'chat' }));
    expect(await store.get('s1')).toEqual(rec(2, { tier: 'standard', source: 'chat' }));
  });

  it('keeps at most CHAT_LEVELS_MAX, pruning the oldest first', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    const seeded: Record<string, ChatLevelRecord> = {};
    for (let i = 0; i < CHAT_LEVELS_MAX; i++) seeded[`old-${i}`] = rec(i);
    writeFileSync(join(dir, 'chat-levels.json'), JSON.stringify(seeded));
    const store = createChatLevelStore(dir);
    await store.set('newest', rec(CHAT_LEVELS_MAX + 10));
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'chat-levels.json'), 'utf8')))).toHaveLength(
      CHAT_LEVELS_MAX,
    );
    expect(await store.get('old-0')).toBeNull();
    expect(await store.get('old-1')).not.toBeNull();
    expect(await store.get('newest')).not.toBeNull();
  });

  it('ignores a junk file and junk rows, and a junk record', async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'chat-levels.json'), '{ nope');
    const store = createChatLevelStore(dir);
    expect(await store.get('s1')).toBeNull();
    await store.set('s1', rec(1));
    expect(await store.get('s1')).toEqual(rec(1));
    writeFileSync(
      join(dir, 'chat-levels.json'),
      JSON.stringify({
        a: rec(1),
        b: { tier: 'huge', source: 'auto', at: 'x' },
        c: 5,
        d: { ...rec(1), source: 'who' },
      }),
    );
    expect(await store.get('a')).toEqual(rec(1));
    for (const k of ['b', 'c', 'd']) expect(await store.get(k)).toBeNull();
    writeFileSync(join(dir, 'chat-levels.json'), '[1,2]');
    expect(await store.get('a')).toBeNull();
    await store.set('x', { tier: 'nope' } as never);
    expect(await store.get('x')).toBeNull();
  });

  it('serialises concurrent sets without losing any, and leaves no temporary file', async () => {
    const dir = fresh();
    const store = createChatLevelStore(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`s${i}`, rec(i))));
    for (let i = 0; i < 20; i++) expect(await store.get(`s${i}`)).toEqual(rec(i));
    expect(readdirSync(dir)).toEqual(['chat-levels.json']);
  });

  it('never throws when the data folder cannot be written', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tba-chat-levels-'));
    roots.push(root);
    writeFileSync(join(root, 'file'), 'x');
    const store = createChatLevelStore(join(root, 'file', 'sub'));
    await expect(store.set('s1', rec(1))).resolves.toBeUndefined();
    expect(await store.get('s1')).toBeNull();
  });

  it('treats an id such as __proto__ as an ordinary key', async () => {
    const store = createChatLevelStore(fresh());
    await store.set('__proto__', rec(1));
    expect(await store.get('__proto__')).toEqual(rec(1));
    expect(await store.get('toString')).toBeNull();
  });
});
