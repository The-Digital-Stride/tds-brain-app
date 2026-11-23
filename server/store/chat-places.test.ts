import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_PLACES_FILE, CHAT_PLACES_MAX } from '../../shared/chat-places-contract.ts';
import { createChatPlaceStore } from './chat-places.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-cp-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, CHAT_PLACES_FILE), 0o600);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

const saved = (dir: string) => JSON.parse(readFileSync(join(dir, CHAT_PLACES_FILE), 'utf8'));

describe('chat place store', () => {
  it('saves and reads a place, and survives a restart', async () => {
    const dir = tmp();
    const a = createChatPlaceStore(dir);
    await a.set('s1', { client: 'acme', project: 'acme/web' });
    await a.set('s2', { client: null, project: 'personal/garden' });
    await a.set('s3', { client: 'acme', project: null });
    expect(await a.placeOf('s1')).toEqual({ client: 'acme', project: 'acme/web' });
    expect(await a.placeOf('other')).toBeNull();
    const b = createChatPlaceStore(dir);
    expect(await b.placeOf('s2')).toEqual({ client: null, project: 'personal/garden' });
    expect([...(await b.all())]).toEqual([
      ['s1', { client: 'acme', project: 'acme/web' }],
      ['s2', { client: null, project: 'personal/garden' }],
      ['s3', { client: 'acme', project: null }],
    ]);
    expect(saved(dir).version).toBe(1);
    expect(saved(dir).chats.s1.savedAt).toBeTypeOf('string');
  });

  it('a place with neither client nor project removes the entry, and remove deletes it', async () => {
    const dir = tmp();
    const s = createChatPlaceStore(dir);
    await s.set('s1', { client: 'acme', project: null });
    await s.set('s2', { client: 'acme', project: 'acme/web' });
    await s.set('s1', { client: null, project: null });
    expect(await s.placeOf('s1')).toBeNull();
    await s.remove('s2');
    await s.remove('never-saved');
    expect(await s.placeOf('s2')).toBeNull();
    expect(saved(dir).chats).toEqual({});
  });

  it('all() is a fresh copy', async () => {
    const s = createChatPlaceStore(null);
    await s.set('s1', { client: 'acme', project: null });
    const copy = await s.all();
    copy.set('s9', { client: 'x', project: null });
    (copy.get('s1') as { client: string | null }).client = 'changed';
    expect([...(await s.all())]).toEqual([['s1', { client: 'acme', project: null }]]);
  });

  it('copies broken JSON to .broken once and reads empty', async () => {
    const dir = tmp();
    writeFileSync(join(dir, CHAT_PLACES_FILE), '{nope');
    const lines: string[] = [];
    const s = createChatPlaceStore(dir, (l) => lines.push(l));
    expect((await s.all()).size).toBe(0);
    expect(readFileSync(join(dir, `${CHAT_PLACES_FILE}.broken`), 'utf8')).toBe('{nope');
    await s.set('s1', { client: 'acme', project: null });
    expect(lines).toHaveLength(1);
    expect(saved(dir).chats.s1.client).toBe('acme');
  });

  it('drops bad entries one by one', async () => {
    const dir = tmp();
    const at = '2026-01-01T00:00:00.000Z';
    writeFileSync(
      join(dir, CHAT_PLACES_FILE),
      JSON.stringify({
        version: 1,
        chats: {
          good: { client: 'acme', project: 'acme/web', savedAt: at },
          personal: { client: null, project: 'personal/garden', savedAt: at },
          neither: { client: null, project: null, savedAt: at },
          badDate: { client: 'acme', project: null, savedAt: 'not a date' },
          badKey: { client: 'acme', project: '../../etc', savedAt: at },
          badClient: { client: '../etc', project: null, savedAt: at },
          numberClient: { client: 5, project: null, savedAt: at },
          notObject: 'acme',
          [`${'x'.repeat(201)}`]: { client: 'acme', project: null, savedAt: at },
        },
      }),
    );
    expect([...(await createChatPlaceStore(dir).all()).keys()]).toEqual(['good', 'personal']);
  });

  it('a read error other than a missing file does not overwrite the file, and reads as nothing saved', async () => {
    const dir = tmp();
    const path = join(dir, CHAT_PLACES_FILE);
    const original = JSON.stringify({
      version: 1,
      chats: { keep: { client: 'acme', project: null, savedAt: '2026-01-01T00:00:00.000Z' } },
    });
    writeFileSync(path, original);
    chmodSync(path, 0o000);
    const lines: string[] = [];
    const s = createChatPlaceStore(dir, (l) => lines.push(l));
    await s.set('new', { client: 'acme', project: null });
    await s.remove('keep');
    // Never rejects: a failed read is nothing saved.
    expect(await s.placeOf('keep')).toBeNull();
    expect((await s.all()).size).toBe(0);
    chmodSync(path, 0o600);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(lines).toHaveLength(2);
    // Not cached: once readable, it reads the saved places.
    expect(await s.placeOf('keep')).toEqual({ client: 'acme', project: null });
  });

  it(`caps at ${CHAT_PLACES_MAX} entries, dropping the oldest`, async () => {
    const dir = tmp();
    let t = Date.UTC(2026, 0, 1);
    const s = createChatPlaceStore(dir, undefined, () => {
      t += 1000;
      return new Date(t);
    });
    const chats: Record<string, unknown> = {};
    for (let i = 0; i < CHAT_PLACES_MAX; i++)
      chats[`id-${i}`] = {
        client: 'acme',
        project: null,
        savedAt: new Date(Date.UTC(2025, 0, 1) + i * 1000).toISOString(),
      };
    writeFileSync(join(dir, CHAT_PLACES_FILE), JSON.stringify({ version: 1, chats }));
    await s.set('id-new-a', { client: 'acme', project: null });
    await s.set('id-new-b', { client: 'acme', project: null });
    const all = await s.all();
    expect(all.size).toBe(CHAT_PLACES_MAX);
    expect(all.has('id-0')).toBe(false);
    expect(all.has('id-1')).toBe(false);
    expect(all.has('id-2')).toBe(true);
    expect(all.has('id-new-b')).toBe(true);
  });

  it('never loses a place when a first read and a save overlap', async () => {
    for (let run = 0; run < 25; run++) {
      const dir = tmp();
      writeFileSync(join(dir, CHAT_PLACES_FILE), JSON.stringify({ version: 1, chats: {} }));
      const s = createChatPlaceStore(dir);
      await Promise.all([s.all(), s.set('first', { client: 'acme', project: null })]);
      await s.set('second', { client: 'acme', project: null });
      expect(Object.keys(saved(dir).chats).sort()).toEqual(['first', 'second']);
    }
  });

  it('is memory only with a null folder, and ignores bad ids and bad places', async () => {
    const s = createChatPlaceStore(null);
    await s.set('a', { client: 'acme', project: null });
    await s.set('', { client: 'acme', project: null });
    await s.set('x'.repeat(201), { client: 'acme', project: null });
    await s.set('b', { client: 'acme', project: 'not a key' });
    await s.set('c', { client: '../etc', project: null });
    await s.set('d', null as never);
    expect([...(await s.all()).keys()]).toEqual(['a']);
    expect(existsSync(join(tmpdir(), CHAT_PLACES_FILE))).toBe(false);
  });
});
