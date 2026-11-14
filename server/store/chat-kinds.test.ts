import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_KINDS_FILE, createChatKindStore } from './chat-kinds.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-ck-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, CHAT_KINDS_FILE), 0o600);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

describe('chat kind store', () => {
  it('saves and reads personal chats, and survives a restart', async () => {
    const dir = tmp();
    const a = createChatKindStore(dir);
    await a.set('s1', 'personal');
    expect(await a.kindOf('s1')).toBe('personal');
    expect(await a.kindOf('other')).toBe('tds');
    const b = createChatKindStore(dir);
    expect([...(await b.personal())]).toEqual(['s1']);
  });

  it("'tds' removes the entry", async () => {
    const dir = tmp();
    const s = createChatKindStore(dir);
    await s.set('s1', 'personal');
    await s.set('s1', 'tds');
    expect((await s.personal()).size).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, CHAT_KINDS_FILE), 'utf8')).personal).toEqual({});
  });

  it('copies broken JSON to .broken once and reads empty', async () => {
    const dir = tmp();
    writeFileSync(join(dir, CHAT_KINDS_FILE), '{nope');
    const lines: string[] = [];
    const s = createChatKindStore(dir, (l) => lines.push(l));
    expect((await s.personal()).size).toBe(0);
    expect(readFileSync(join(dir, `${CHAT_KINDS_FILE}.broken`), 'utf8')).toBe('{nope');
    await s.set('s1', 'personal');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, CHAT_KINDS_FILE), 'utf8')).personal.s1).toBeTypeOf('string');
  });

  it('drops bad entries one by one', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, CHAT_KINDS_FILE),
      JSON.stringify({
        version: 1,
        personal: {
          good: '2026-01-01T00:00:00.000Z',
          bad: 5,
          worse: 'not a date',
          [`${'x'.repeat(201)}`]: '2026-01-01T00:00:00.000Z',
        },
      }),
    );
    expect([...(await createChatKindStore(dir).personal())]).toEqual(['good']);
  });

  it('a read error other than a missing file does not overwrite the file', async () => {
    const dir = tmp();
    const path = join(dir, CHAT_KINDS_FILE);
    const original = JSON.stringify({ version: 1, personal: { keep: '2026-01-01T00:00:00.000Z' } });
    writeFileSync(path, original);
    chmodSync(path, 0o000);
    const lines: string[] = [];
    const s = createChatKindStore(dir, (l) => lines.push(l));
    await s.set('new', 'personal');
    chmodSync(path, 0o600);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(lines).toHaveLength(1);
    // Not cached: once readable, it reads the saved marks.
    expect([...(await s.personal())]).toEqual(['keep']);
  });

  it('caps at 2,000 entries, dropping the oldest', async () => {
    const dir = tmp();
    let t = Date.UTC(2026, 0, 1);
    const s = createChatKindStore(dir, undefined, () => {
      t += 1000;
      return new Date(t);
    });
    // Start from a full file (2,000 marks, id-0 oldest), then add two: the two oldest go.
    const personal: Record<string, string> = {};
    for (let i = 0; i < 2000; i++)
      personal[`id-${i}`] = new Date(Date.UTC(2025, 0, 1) + i * 1000).toISOString();
    writeFileSync(join(dir, CHAT_KINDS_FILE), JSON.stringify({ version: 1, personal }));
    await s.set('id-2000', 'personal');
    await s.set('id-2001', 'personal');
    const p = await s.personal();
    expect(p.size).toBe(2000);
    expect(p.has('id-0')).toBe(false);
    expect(p.has('id-1')).toBe(false);
    expect(p.has('id-2')).toBe(true);
    expect(p.has('id-2001')).toBe(true);
  });

  it('never loses a mark when a first read and a save overlap', async () => {
    for (let run = 0; run < 25; run++) {
      const dir = tmp();
      writeFileSync(join(dir, CHAT_KINDS_FILE), JSON.stringify({ version: 1, personal: {} }));
      const s = createChatKindStore(dir);
      await Promise.all([s.personal(), s.set('first', 'personal')]);
      await s.set('second', 'personal');
      const saved = JSON.parse(readFileSync(join(dir, CHAT_KINDS_FILE), 'utf8'));
      expect(Object.keys(saved.personal).sort()).toEqual(['first', 'second']);
    }
  });

  it('is memory only with a null folder, and ignores bad ids', async () => {
    const s = createChatKindStore(null);
    await s.set('a', 'personal');
    await s.set('', 'personal');
    await s.set('x'.repeat(201), 'personal');
    expect([...(await s.personal())]).toEqual(['a']);
    expect(existsSync(join(tmpdir(), CHAT_KINDS_FILE))).toBe(false);
  });
});
