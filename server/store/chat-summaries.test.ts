import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_SUMMARIES_FILE } from '../../shared/chat-summary-contract.ts';
import { createChatSummaryStore } from './chat-summaries.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-cs-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, CHAT_SUMMARIES_FILE), 0o600);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

const AT = '2026-11-24T10:00:00.000Z';
const saved = (dir: string) => JSON.parse(readFileSync(join(dir, CHAT_SUMMARIES_FILE), 'utf8'));

describe('chat summary store', () => {
  it('keeps one record per chat and project, and survives a restart', async () => {
    const dir = tmp();
    const a = createChatSummaryStore(dir);
    await a.record('c1', 'acme/web', { savedAt: AT, messages: 4 });
    await a.record('c1', 'personal/garden', { savedAt: AT, messages: 6 });
    await a.record('c1', 'acme/web', { savedAt: AT, messages: 9 });
    const b = createChatSummaryStore(dir);
    expect(await b.get('c1', 'acme/web')).toEqual({ savedAt: AT, messages: 9 });
    expect(await b.get('c1', 'acme/other')).toBeNull();
    expect(await b.get('c2', 'acme/web')).toBeNull();
    expect([...(await b.forChat('c1')).keys()]).toEqual(['acme/web', 'personal/garden']);
    expect(saved(dir).version).toBe(1);
  });

  it('refuses bad records and keys', async () => {
    const s = createChatSummaryStore(null);
    await s.record('c1', '../etc', { savedAt: AT, messages: 1 });
    await s.record('c1', 'acme/web', { savedAt: 'nope', messages: 1 });
    await s.record('c1', 'acme/web', { savedAt: AT, messages: -1 });
    await s.record('', 'acme/web', { savedAt: AT, messages: 1 });
    expect((await s.forChat('c1')).size).toBe(0);
  });

  it('queued writes all land', async () => {
    const dir = tmp();
    const s = createChatSummaryStore(dir);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => s.record(`c${i}`, 'acme/web', { savedAt: AT, messages: i })),
    );
    expect(Object.keys(saved(dir).chats)).toHaveLength(10);
  });

  it('copies broken JSON aside and reads empty', async () => {
    const dir = tmp();
    writeFileSync(join(dir, CHAT_SUMMARIES_FILE), '{nope');
    const lines: string[] = [];
    const s = createChatSummaryStore(dir, (l) => lines.push(l));
    expect(await s.get('c1', 'acme/web')).toBeNull();
    expect(existsSync(join(dir, `${CHAT_SUMMARIES_FILE}.broken`))).toBe(true);
    await s.record('c1', 'acme/web', { savedAt: AT, messages: 2 });
    expect(lines).toHaveLength(1);
    expect(saved(dir).chats.c1['acme/web'].messages).toBe(2);
  });

  it('drops bad entries one by one', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, CHAT_SUMMARIES_FILE),
      JSON.stringify({
        version: 1,
        chats: {
          good: { 'acme/web': { savedAt: AT, messages: 3 }, '../x': { savedAt: AT, messages: 1 } },
          badCount: { 'acme/web': { savedAt: AT, messages: 'three' } },
          notObject: 5,
        },
      }),
    );
    const s = createChatSummaryStore(dir);
    expect([...(await s.forChat('good')).keys()]).toEqual(['acme/web']);
    expect((await s.forChat('badCount')).size).toBe(0);
  });

  it('a read error other than a missing file never overwrites the file', async () => {
    const dir = tmp();
    const path = join(dir, CHAT_SUMMARIES_FILE);
    const original = JSON.stringify({
      version: 1,
      chats: { keep: { 'acme/web': { savedAt: AT, messages: 1 } } },
    });
    writeFileSync(path, original);
    chmodSync(path, 0o000);
    const lines: string[] = [];
    const s = createChatSummaryStore(dir, (l) => lines.push(l));
    await s.record('new', 'acme/web', { savedAt: AT, messages: 1 });
    expect(await s.get('keep', 'acme/web')).toBeNull();
    chmodSync(path, 0o600);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(lines).toHaveLength(1);
  });
});
