import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientInfo } from '../../shared/contract.ts';
import { MEETINGS_CACHE_PATH } from '../../shared/project-meetings-contract.ts';
import { ProjectsError } from '../../shared/projects-contract.ts';
import { createMeetingHistoryStore } from '../store/meeting-history.ts';
import { createProjectMeetings } from './project-meetings.ts';
import { buildRefIndex } from './project-refs.ts';
import type { ProjectsIndex } from './projects.ts';

const KEY = 'skyseal/seo';
const NOW = new Date('2026-11-23T12:00:00Z');
const clients: ClientInfo[] = [{ slug: 'skyseal', name: 'Skyseal' }];
const cards = [
  {
    key: KEY,
    client: 'skyseal',
    title: 'SEO retainer',
    status: 'active',
    archived: false,
    slug: 'seo',
    folder: 'clients/skyseal/projects/seo',
    space: 'client',
  },
  {
    key: 'skyseal/old',
    client: 'skyseal',
    title: 'Old',
    status: 'done',
    archived: true,
    slug: 'old',
    folder: 'clients/skyseal/projects-archive/old',
    space: 'client',
  },
];
const index = (list = cards) =>
  ({ cards: list, byKey: (k: string) => list.find((c) => c.key === k) ?? null }) as unknown as ProjectsIndex;

const mtg = (id: string, start: string, mins = 30, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Skyseal SEO check-in',
  start,
  end: new Date(Date.parse(start) + mins * 60_000).toISOString(),
  allDay: false,
  location: 'Room 4, secret road',
  attendees: [
    { name: 'Me', email: 'me@tds.co.uk' },
    { name: 'Jo Smith', email: 'jo@skyseal.com' },
    { name: 'a@b.com', email: 'a@b.com' },
    { name: 'Sam Lee', email: 'sam@skyseal.com' },
    { name: null, email: 'kim@skyseal.com' },
    { name: 'Pat', email: 'pat@skyseal.com' },
  ],
  ...extra,
});

let root: string;
let now = NOW;
let ignoredAnswer: Set<string> | null;
const writeCache = (meetings: unknown[], generated = '2026-11-23T08:00:00Z') =>
  fs.writeFile(join(root, MEETINGS_CACHE_PATH), JSON.stringify({ generated, source: 'test', meetings }));

function service(
  opts: { notes?: (c: unknown, s: string) => Promise<{ id: string; path: string } | null> } = {},
) {
  const store = createMeetingHistoryStore(null);
  const svc = createProjectMeetings({
    root,
    index: async () => index(),
    clients: async () => clients,
    store,
    selfEmail: async () => 'me@tds.co.uk',
    ignored: async () => ignoredAnswer,
    notes: (opts.notes ?? (async () => null)) as never,
    now: () => now,
  });
  return { svc, store };
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'project-meetings-'));
  await fs.mkdir(join(root, 'briefing'), { recursive: true });
  await fs.mkdir(join(root, 'clients', 'skyseal'), { recursive: true });
  await fs.writeFile(
    join(root, 'clients', 'skyseal', 'profile.md'),
    '# Skyseal\n\n**Website:** https://www.skyseal.com\n',
  );
  await fs.mkdir(join(root, '.team-config'), { recursive: true });
  await fs.writeFile(
    join(root, '.team-config', 'roles.json'),
    JSON.stringify({ members: [{ email: 'me@tds.co.uk' }] }),
  );
  now = NOW;
  ignoredAnswer = new Set([MEETINGS_CACHE_PATH]);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const NONE = { cache: 'none', checked: null, last: null, next: null };

describe('the cache is read only when it is safe and well formed', () => {
  it('no cache file: none', async () => {
    expect(await service().svc.read(KEY)).toEqual(NONE);
  });
  it('not git-ignored, or git cannot say: none', async () => {
    await writeCache([mtg('a', '2026-11-22T10:00:00Z')]);
    ignoredAnswer = new Set();
    expect(await service().svc.read(KEY)).toEqual(NONE);
    ignoredAnswer = null;
    expect(await service().svc.read(KEY)).toEqual(NONE);
  });
  it('bad JSON or no generated time: none', async () => {
    await fs.writeFile(join(root, MEETINGS_CACHE_PATH), '{oops');
    expect(await service().svc.read(KEY)).toEqual(NONE);
    await fs.writeFile(join(root, MEETINGS_CACHE_PATH), JSON.stringify({ meetings: [] }));
    expect(await service().svc.read(KEY)).toEqual(NONE);
  });
  it('bad entries are skipped, good ones kept', async () => {
    await writeCache([null, 5, { id: 1 }, { id: 'x', start: 'nope' }, mtg('a', '2026-11-22T10:00:00Z')]);
    expect((await service().svc.read(KEY)).last?.id).toBe('a');
  });
  it('fresh, then stale after three days', async () => {
    await writeCache([]);
    expect((await service().svc.read(KEY)).cache).toBe('fresh');
    now = new Date('2026-11-27T12:00:00Z');
    const r = await service().svc.read(KEY);
    expect(r.cache).toBe('stale');
    expect(r.checked).toBe('2026-11-23T08:00:00Z');
  });
  it('an unknown project is not found', async () => {
    await expect(service().svc.read('skyseal/none')).rejects.toBeInstanceOf(ProjectsError);
  });
});

describe('project codes', () => {
  const withRefs = (): ProjectsIndex =>
    ({
      ...index(),
      refs: buildRefIndex(
        cards.map((c) => ({
          key: c.key,
          space: 'client' as const,
          client: c.client,
          ref: c.key === KEY ? 'SKY4K7' : null,
        })),
        new Map([['skyseal', 'SKY']]),
      ).index,
    }) as unknown as ProjectsIndex;
  const svc = () => {
    const store = createMeetingHistoryStore(null);
    return {
      store,
      svc: createProjectMeetings({
        root,
        index: async () => withRefs(),
        clients: async () => clients,
        store,
        selfEmail: async () => 'me@tds.co.uk',
        ignored: async () => ignoredAnswer,
        notes: (async () => null) as never,
        now: () => now,
      }),
    };
  };

  it('matches a meeting by a code in the cached refs and keeps it as a ref match', async () => {
    await writeCache([
      mtg('code', '2026-11-22T10:00:00Z', 30, {
        title: 'Quick call',
        attendees: [],
        refs: ['sky4k7', 'junk', 7],
      }),
    ]);
    const { svc: s, store } = svc();
    const r = await s.read(KEY);
    expect(r.last?.id).toBe('code');
    expect(r.last?.match).toBe('ref');
    expect((await store.all()).map((m) => m.match)).toEqual(['ref']);
  });

  it('a cache with no refs, or refs that are not an array, behaves as before', async () => {
    await writeCache([
      mtg('a', '2026-11-22T10:00:00Z', 30, { title: 'Quick call', attendees: [] }),
      mtg('b', '2026-11-21T10:00:00Z', 30, { title: 'Quick call', attendees: [], refs: 'SKY4K7' }),
    ]);
    expect((await svc().svc.read(KEY)).last).toBeNull();
  });
});

describe('last and next', () => {
  it('last is the latest ended meeting, next the soonest not ended', async () => {
    await writeCache([
      mtg('old', '2026-11-20T10:00:00Z'),
      mtg('recent', '2026-11-22T10:00:00Z'),
      mtg('soon', '2026-11-24T10:00:00Z'),
      mtg('later', '2026-11-30T10:00:00Z'),
    ]);
    const r = await service().svc.read(KEY);
    expect(r.last?.id).toBe('recent');
    expect(r.next?.id).toBe('soon');
    expect(r.next?.notes).toBeNull();
  });
  it('an in-progress meeting is next', async () => {
    await writeCache([mtg('now', '2026-11-23T11:45:00Z', 60)]);
    const r = await service().svc.read(KEY);
    expect(r.next?.id).toBe('now');
    expect(r.last).toBeNull();
  });
  it('last survives the cache moving on, from the history', async () => {
    await writeCache([mtg('recent', '2026-11-22T10:00:00Z')]);
    const { svc } = service();
    expect((await svc.read(KEY)).last?.id).toBe('recent');
    await writeCache([mtg('future', '2026-11-25T10:00:00Z')]);
    const r = await svc.read(KEY);
    expect(r.last?.id).toBe('recent');
    expect(r.next?.id).toBe('future');
  });
  it('a cancelled future meeting is gone on the next read', async () => {
    await writeCache([mtg('soon', '2026-11-24T10:00:00Z')]);
    const { svc } = service();
    expect((await svc.read(KEY)).next?.id).toBe('soon');
    await writeCache([]);
    const r = await svc.read(KEY);
    expect(r.next).toBeNull();
    now = new Date('2026-11-24T12:00:00Z'); // it would have ended by now, but was never kept
    expect((await svc.read(KEY)).last).toBeNull();
  });
  it('merge() keeps ended meetings without anyone reading', async () => {
    await writeCache([mtg('recent', '2026-11-22T10:00:00Z')]);
    const { svc, store } = service();
    await svc.merge();
    expect((await store.all()).map((m) => m.id)).toEqual(['recent']);
  });
  it('recurring instances with one id stay apart', async () => {
    await writeCache([mtg('series', '2026-11-16T10:00:00Z'), mtg('series', '2026-11-22T10:00:00Z')]);
    const { svc, store } = service();
    const r = await svc.read(KEY);
    expect(r.last?.start).toBe('2026-11-22T10:00:00Z');
    expect(await store.all()).toHaveLength(2);
  });
  it('a meeting for another project, or all-day, never shows', async () => {
    await writeCache([
      mtg('a', '2026-11-22T10:00:00Z', 30, { title: 'Lunch', attendees: [] }),
      mtg('b', '2026-11-22T10:00:00Z', 30, { allDay: true }),
    ]);
    expect(await service().svc.read(KEY)).toMatchObject({ cache: 'fresh', last: null, next: null });
  });
  it('an archived project reads the cache but shows nothing', async () => {
    await writeCache([mtg('a', '2026-11-22T10:00:00Z')]);
    expect(await service().svc.read('skyseal/old')).toEqual({
      cache: 'fresh',
      checked: '2026-11-23T08:00:00Z',
      last: null,
      next: null,
    });
  });
  it('looks for the filed note for the last meeting only', async () => {
    await writeCache([mtg('recent', '2026-11-22T10:00:00Z'), mtg('soon', '2026-11-24T10:00:00Z')]);
    const asked: string[] = [];
    const r = await service({
      notes: async (_c, s) => {
        asked.push(s);
        return { id: 'client:skyseal.abc', path: 'clients/skyseal/call-notes/x.md' };
      },
    }).svc.read(KEY);
    expect(asked).toEqual(['2026-11-22T10:00:00Z']);
    expect(r.last?.notes).toEqual({ id: 'client:skyseal.abc', path: 'clients/skyseal/call-notes/x.md' });
    expect(r.next?.notes).toBeNull();
  });
});

describe('privacy', () => {
  it('the response and the history hold no email or location, and show at most three names', async () => {
    await writeCache([mtg('recent', '2026-11-22T10:00:00Z'), mtg('soon', '2026-11-24T10:00:00Z')]);
    const { svc, store } = service();
    const r = await svc.read(KEY);
    const json = JSON.stringify(r);
    expect(json).not.toContain('@');
    expect(json).not.toContain('secret road');
    expect(JSON.stringify(await store.all())).not.toContain('@');
    expect(r.last?.people).toEqual(['Jo Smith', 'Sam Lee', 'Pat']);
    expect(r.last?.others).toBe(5);
  });
});

describe('invite links (home meetings plan decisions 2-4)', () => {
  const EVENT = 'https://www.google.com/calendar/event?eid=abc123&ctz=Europe/London';
  it('next carries the event link and call link; last keeps the event link through the history', async () => {
    await writeCache([
      mtg('recent', '2026-11-22T10:00:00Z', 30, { link: EVENT, join: 'https://meet.google.com/x' }),
      mtg('soon', '2026-11-24T10:00:00Z', 30, { link: EVENT, join: 'https://meet.google.com/abc-defg-hij' }),
    ]);
    const { svc, store } = service();
    const r = await svc.read(KEY);
    expect(r.next).toMatchObject({
      calendar: EVENT,
      calendarKind: 'event',
      join: 'https://meet.google.com/abc-defg-hij',
    });
    expect(r.last).toMatchObject({ calendar: EVENT, calendarKind: 'event', join: null });
    expect((await store.all())[0]?.link).toBe(EVENT);
    await writeCache([]);
    expect((await svc.read(KEY)).last?.calendar).toBe(EVENT);
  });
  it("a recurring series sharing one id: next takes its own instance's call link", async () => {
    await writeCache([
      mtg('series', '2026-11-30T10:00:00Z', 30, { join: 'https://meet.google.com/later-one' }),
      mtg('series', '2026-11-24T10:00:00Z', 30, { join: 'https://meet.google.com/soon-one' }),
    ]);
    const r = await service().svc.read(KEY);
    expect(r.next?.start).toBe('2026-11-24T10:00:00Z');
    expect(r.next?.join).toBe('https://meet.google.com/soon-one');
  });
  it('a missing or unsafe link falls back to the day view; an unsafe call link is dropped', async () => {
    await writeCache([
      mtg('soon', '2026-11-24T10:00:00Z', 30, {
        link: 'javascript:alert(1)',
        join: 'https://evil.example/j',
      }),
    ]);
    const { svc, store } = service();
    const r = await svc.read(KEY);
    expect(r.next).toMatchObject({
      calendar: 'https://calendar.google.com/calendar/r/day/2026/11/24',
      calendarKind: 'day',
      join: null,
    });
    now = new Date('2026-11-25T12:00:00Z');
    await svc.read(KEY);
    expect((await store.all())[0]?.link).toBeUndefined();
  });
});

describe('home (home meetings plan decisions 6-7)', () => {
  it('lists every upcoming meeting, project or not, soonest first, and drops ended and far-off ones', async () => {
    await writeCache([
      mtg('later', '2026-11-30T10:00:00Z'),
      mtg('ended', '2026-11-23T09:00:00Z'),
      mtg('now', '2026-11-23T11:45:00Z', 60),
      mtg('far', '2026-12-09T10:00:00Z'),
      { ...mtg('lunch', '2026-11-24T12:00:00Z'), title: 'Lunch with Alex', attendees: [] },
    ]);
    const r = await service().svc.home();
    expect(r.cache).toBe('fresh');
    expect(r.meetings.map((m) => m.id)).toEqual(['now', 'lunch', 'later']);
    const lunch = r.meetings[1];
    expect(lunch?.project).toBeNull();
    expect(lunch?.client).toBeNull();
    expect(r.meetings[0]?.project).toEqual({ key: KEY, title: 'SEO retainer', ref: null });
    expect(r.meetings[0]?.client).toEqual({ slug: 'skyseal', name: 'Skyseal' });
  });
  it('an all-day meeting shows with its client but no project', async () => {
    await writeCache([
      { ...mtg('day', '2026-11-25T00:00:00Z', 24 * 60), allDay: true, title: 'Skyseal site visit' },
    ]);
    const [m] = (await service().svc.home()).meetings;
    expect(m?.allDay).toBe(true);
    expect(m?.project).toBeNull();
    expect(m?.client?.slug).toBe('skyseal');
  });
  it('a meeting matching only an archived project shows no project', async () => {
    const archivedOnly = [{ ...(cards[1] as (typeof cards)[number]) }];
    const store = createMeetingHistoryStore(null);
    const svc = createProjectMeetings({
      root,
      index: async () => index(archivedOnly),
      clients: async () => clients,
      store,
      selfEmail: async () => 'me@tds.co.uk',
      ignored: async () => ignoredAnswer,
      now: () => now,
    });
    await writeCache([{ ...mtg('soon', '2026-11-24T10:00:00Z'), title: 'Skyseal Old review' }]);
    const [m] = (await svc.home()).meetings;
    expect(m?.project).toBeNull();
  });
  it('carries links, keeps emails and locations out, and shows at most three names', async () => {
    const EVENT = 'https://www.google.com/calendar/event?eid=abc';
    await writeCache([mtg('soon', '2026-11-24T10:00:00Z', 30, { link: EVENT, join: 'https://zoom.us/j/1' })]);
    const r = await service().svc.home();
    expect(r.meetings[0]).toMatchObject({
      calendar: EVENT,
      calendarKind: 'event',
      join: 'https://zoom.us/j/1',
    });
    expect(r.meetings[0]?.people).toEqual(['Jo Smith', 'Sam Lee', 'Pat']);
    expect(r.meetings[0]?.others).toBe(5);
    const json = JSON.stringify(r);
    expect(json).not.toContain('@');
    expect(json).not.toContain('secret road');
  });
  it('the same guards as a project read: no cache or not ignored is none; stale after three days', async () => {
    expect(await service().svc.home()).toEqual({ cache: 'none', checked: null, meetings: [] });
    await writeCache([mtg('soon', '2026-11-24T10:00:00Z')]);
    ignoredAnswer = new Set();
    expect((await service().svc.home()).cache).toBe('none');
    ignoredAnswer = new Set([MEETINGS_CACHE_PATH]);
    await writeCache([mtg('soon', '2026-11-24T10:00:00Z')], '2026-11-19T08:00:00Z');
    expect((await service().svc.home()).cache).toBe('stale');
  });
  it('the same instance listed twice shows once', async () => {
    await writeCache([mtg('dup', '2026-11-24T10:00:00Z'), mtg('dup', '2026-11-24T10:00:00Z')]);
    expect((await service().svc.home()).meetings).toHaveLength(1);
  });
});

describe('home: all-day, kinds and the agency (overseer pre-review)', () => {
  const allDay = (id: string, start: string, end: string | null, title = 'Leave') => ({
    ...mtg(id, `${start}T00:00:00Z`),
    title,
    attendees: [],
    allDay: true,
    start,
    end,
  });
  it('a running multi-day all-day event sits under today, before timed ones, with its last day', async () => {
    // NOW is Mon 23 Nov 12:00Z. Leave from Sat 21 to Fri 27 (end exclusive 28).
    await writeCache([mtg('call', '2026-11-23T14:00:00Z'), allDay('leave', '2026-11-21', '2026-11-28')]);
    const r = await service().svc.home();
    expect(r.meetings.map((m) => m.id)).toEqual(['leave', 'call']);
    expect(r.meetings[0]).toMatchObject({
      day: '2026-11-23',
      lastDay: '2026-11-27',
      start: '2026-11-21',
      end: '2026-11-28',
    });
    expect(r.meetings[1]).toMatchObject({ day: '2026-11-23', lastDay: null });
  });
  it('a one-day all-day event with no end lasts the whole day, then goes', async () => {
    await writeCache([allDay('today', '2026-11-23', null)]);
    now = new Date(2026, 10, 23, 23, 30);
    expect((await service().svc.home()).meetings[0]).toMatchObject({
      day: '2026-11-23',
      lastDay: null,
      end: '2026-11-24',
    });
    now = new Date(2026, 10, 24, 0, 5);
    expect((await service().svc.home()).meetings).toEqual([]);
  });
  it('uses the local date outside the UK too', async () => {
    const was = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      now = new Date('2026-11-24T06:00:00Z'); // 22:00 on 23 Nov in Los Angeles
      await writeCache([allDay('a', '2026-11-23', '2026-11-24'), allDay('b', '2026-11-24', '2026-11-25')]);
      const r = await service().svc.home();
      expect(r.meetings.map((m) => [m.id, m.day])).toEqual([
        ['a', '2026-11-23'],
        ['b', '2026-11-24'],
      ]);
    } finally {
      process.env.TZ = was;
    }
  });
  it('drops focus time, out of office, birthdays and working-location markers; a missing kind shows', async () => {
    await writeCache([
      mtg('focus', '2026-11-24T09:00:00Z', 60, { kind: 'focusTime' }),
      mtg('ooo', '2026-11-24T10:00:00Z', 60, { kind: 'outOfOffice' }),
      mtg('bday', '2026-11-24T11:00:00Z', 60, { kind: 'birthday' }),
      mtg('where', '2026-11-24T12:00:00Z', 60, { kind: 'workingLocation' }),
      mtg('real', '2026-11-24T13:00:00Z', 60, { kind: 'default' }),
      mtg('old', '2026-11-24T14:00:00Z'),
    ]);
    expect((await service().svc.home()).meetings.map((m) => m.id)).toEqual(['real', 'old']);
    expect((await service().svc.read(KEY)).next?.id).toBe('real');
  });
  it("the agency's own client is never shown as the client", async () => {
    const tds = createProjectMeetings({
      root,
      index: async () => index([]),
      clients: async () => [{ slug: 'the-digital-stride', name: 'The Digital Stride' }],
      store: createMeetingHistoryStore(null),
      selfEmail: async () => 'me@tds.co.uk',
      ignored: async () => ignoredAnswer,
      now: () => now,
    });
    await writeCache([
      { ...mtg('team', '2026-11-24T10:00:00Z'), title: 'The Digital Stride team meeting', attendees: [] },
    ]);
    expect((await tds.home()).meetings[0]?.client).toBeNull();
  });
});
