import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type KeptMeeting,
  MEETING_HISTORY_FILE,
  MEETING_HISTORY_MAX,
} from '../../shared/project-meetings-contract.ts';
import { createMeetingHistoryStore } from './meeting-history.ts';

const NOW = new Date('2026-11-23T12:00:00Z');
const KEY = 'acme-heating/web';
const kept = (id: string, start: string, extra: Partial<KeptMeeting> = {}): KeptMeeting => ({
  id,
  key: KEY,
  match: 'title',
  title: 'Weekly',
  start,
  end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  people: ['Jo Smith'],
  others: 1,
  ...extra,
});

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'meeting-history-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('meeting history store', () => {
  it('keeps only meetings that have ended', async () => {
    const s = createMeetingHistoryStore(dir);
    await s.merge([kept('a', '2026-11-22T10:00:00Z'), kept('b', '2026-11-24T10:00:00Z')], NOW);
    expect((await s.all()).map((m) => m.id)).toEqual(['a']);
    // in progress: not ended yet
    await s.merge([kept('c', '2026-11-23T11:45:00Z')], NOW);
    expect((await s.all()).map((m) => m.id)).toEqual(['a']);
  });

  it('keys by id and start together, and refreshes a repeat', async () => {
    const s = createMeetingHistoryStore(dir);
    await s.merge([kept('series', '2026-11-16T10:00:00Z'), kept('series', '2026-11-09T10:00:00Z')], NOW);
    await s.merge([kept('series', '2026-11-16T10:00:00Z', { title: 'Renamed' })], NOW);
    const all = await s.all();
    expect(all).toHaveLength(2);
    expect(all.find((m) => m.start === '2026-11-16T10:00:00Z')?.title).toBe('Renamed');
  });

  it('drops meetings older than 90 days and cuts to the cap, oldest first', async () => {
    const s = createMeetingHistoryStore(dir);
    await s.merge([kept('old', '2026-08-01T10:00:00Z'), kept('ok', '2026-09-01T10:00:00Z')], NOW);
    expect((await s.all()).map((m) => m.id)).toEqual(['ok']);
    const many = Array.from({ length: MEETING_HISTORY_MAX + 20 }, (_, i) =>
      kept(`m${i}`, new Date(NOW.getTime() - (i + 1) * 60 * 60_000).toISOString()),
    );
    await s.merge(many, NOW);
    const all = await s.all();
    expect(all).toHaveLength(MEETING_HISTORY_MAX);
    expect(all.some((m) => m.id === `m${MEETING_HISTORY_MAX + 19}`)).toBe(false);
    expect(all.some((m) => m.id === 'm0')).toBe(true);
  });

  it('never writes an email: names holding an @ are dropped, and the file has none', async () => {
    const s = createMeetingHistoryStore(dir);
    await s.merge(
      [kept('a', '2026-11-22T10:00:00Z', { people: ['Jo Smith', 'jo@acme.com'], others: 2 })],
      NOW,
    );
    const text = await fs.readFile(join(dir, MEETING_HISTORY_FILE), 'utf8');
    expect(text).not.toContain('@');
    expect(JSON.parse(text).meetings[0].people).toEqual(['Jo Smith']);
  });

  it('survives a restart, and a bad file is copied aside and starts empty', async () => {
    await createMeetingHistoryStore(dir).merge([kept('a', '2026-11-22T10:00:00Z')], NOW);
    expect((await createMeetingHistoryStore(dir).all()).map((m) => m.id)).toEqual(['a']);
    await fs.writeFile(join(dir, MEETING_HISTORY_FILE), '{not json');
    const lines: string[] = [];
    const s = createMeetingHistoryStore(dir, (l) => lines.push(l));
    expect(await s.all()).toEqual([]);
    expect(await fs.readFile(`${join(dir, MEETING_HISTORY_FILE)}.broken`, 'utf8')).toBe('{not json');
    expect(lines).toHaveLength(1);
  });

  it('a file that cannot be read is never overwritten', async () => {
    await fs.mkdir(join(dir, MEETING_HISTORY_FILE)); // reading a directory fails with EISDIR, not ENOENT
    const lines: string[] = [];
    const s = createMeetingHistoryStore(dir, (l) => lines.push(l));
    await s.merge([kept('a', '2026-11-22T10:00:00Z')], NOW);
    expect(await s.all()).toEqual([]);
    expect((await fs.stat(join(dir, MEETING_HISTORY_FILE))).isDirectory()).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('with no data folder it keeps meetings in memory', async () => {
    const s = createMeetingHistoryStore(null);
    await s.merge([kept('a', '2026-11-22T10:00:00Z')], NOW);
    expect((await s.all()).map((m) => m.id)).toEqual(['a']);
  });
});
