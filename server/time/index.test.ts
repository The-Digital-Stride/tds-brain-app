import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatScope } from '../../shared/chat-places-contract.ts';
import type { DaySubmission, StoredDay, TokenStore, WireWorkItem } from '../../shared/time-contract.ts';
import { writeConnectionFile } from './connection.ts';
import { createTimeService, type TimeServiceDeps } from './index.ts';
import type { TranscriptTimes } from './transcript-times.ts';

const ORIGIN = 'http://localhost:3000';
const TOKEN = `tds_time_${'a'.repeat(64)}`;
// 28 Nov 2026 is GMT, so London time equals UTC.
const NOW = new Date('2026-11-28T17:00:00.000Z');
const DAY = '2026-11-28';
const ITEM: WireWorkItem = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Rubber4Roofs: SEO',
  kind: 'retainer',
  cortexKey: null,
  clientId: null,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A pretend Toolbox: answers by route, records every call. */
function fakeToolbox(opts: {
  submit?: (body: DaySubmission, n: number) => { status: number; json: unknown } | 'network';
  stored?: () => StoredDay | null;
}) {
  const calls: Call[] = [];
  let submits = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, body });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/time/work-items') return json(200, { items: [ITEM] });
    if (url.pathname.startsWith('/api/time/days/') && method === 'GET') {
      const stored = opts.stored?.() ?? null;
      // Toolbox answers `{ ok: true, day }` (apps/portal/lib/time/store.ts ReadDayResult).
      const day = stored ?? { personId: 'p', workDate: DAY, revision: 0, entries: [] };
      return json(200, { ok: true, day });
    }
    if (url.pathname === '/api/time/days' && method === 'POST') {
      submits += 1;
      const answer = opts.submit?.(body as DaySubmission, submits) ?? {
        status: 200,
        json: { ok: true, revision: 1, repeated: false },
      };
      if (answer === 'network') throw new TypeError('fetch failed');
      return json(answer.status, answer.json);
    }
    return json(404, { error: 'not_found' });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const tokens: TokenStore = {
  read: async () => TOKEN,
  save: async () => {},
  remove: async () => {},
};

/** Two prompts in one chat, 10:00 and 10:05, each answered a minute later. */
function oneChat(chatId = 'chat-1'): TranscriptTimes {
  return {
    chats: [
      {
        chatId,
        marks: [
          { at: '2026-11-28T10:00:00.000Z', kind: 'prompt' },
          { at: '2026-11-28T10:01:00.000Z', kind: 'answer' },
          { at: '2026-11-28T10:05:00.000Z', kind: 'prompt' },
          { at: '2026-11-28T10:06:00.000Z', kind: 'answer' },
        ],
      },
    ],
    notes: [],
  };
}

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'time-service-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function service(over: Partial<TimeServiceDeps> & { connected?: boolean } = {}) {
  const { connected = true, ...rest } = over;
  if (connected) {
    writeConnectionFile(dataDir, {
      version: 1,
      origin: ORIGIN,
      connectionId: 'c1',
      expiresAt: '2027-02-20T00:00:00.000Z',
      connectedAt: '2026-11-20T00:00:00.000Z',
    });
  }
  let ids = 0;
  const places = new Map<string, ChatScope>([['chat-1', { client: 'rubber4roofs', project: null }]]);
  return createTimeService({
    dataDir,
    brainRoot: '/brain',
    env: { TDS_TOOLBOX_URL: ORIGIN },
    port: 3877,
    personName: async () => 'Ian Hancock',
    readSettings: () => ({}),
    mergeSettings: () => {},
    chatPlaces: { all: async () => places },
    chatKinds: { personal: async () => new Set() },
    projectTitle: async () => null,
    clientNames: async () => new Map([['rubber4roofs', 'Rubber4Roofs']]),
    openBrowser: () => {},
    tokens,
    readTranscripts: async () => oneChat(),
    now: () => NOW,
    newId: () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
    },
    ...rest,
  });
}

describe('TimeService: a day', () => {
  it('builds the day from chat time and shows the client as evidence, never sending anything', async () => {
    const toolbox = fakeToolbox({});
    const time = service({ fetch: toolbox.fetchFn });
    const day = await time.day(DAY);
    expect(day.entries).toHaveLength(1);
    const [entry] = day.entries;
    // 09:58 (2 minutes before the first prompt) to 10:08 (2 minutes after the last answer).
    expect(entry?.values.startAt).toBe('2026-11-28T09:58:00.000Z');
    expect(entry?.values.minutes).toBe(10);
    expect(entry?.evidence).toContain('Rubber4Roofs');
    expect(toolbox.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('leaves out personal chats', async () => {
    const time = service({
      fetch: fakeToolbox({}).fetchFn,
      chatKinds: { personal: async () => new Set(['chat-1']) },
    });
    expect((await time.day(DAY)).entries).toHaveLength(0);
  });

  it('refuses a future day and one more than 62 days back', async () => {
    const time = service({ fetch: fakeToolbox({}).fetchFn });
    await expect(time.day('2026-11-29')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(time.day('2026-09-26')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(time.day('not-a-day')).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('keeps an edit through a refresh', async () => {
    const time = service({ fetch: fakeToolbox({}).fetchFn });
    const day = await time.day(DAY);
    const id = day.entries[0]?.id as string;
    await time.changeEntry(DAY, id, { description: 'Keyword research', minutes: 25 });
    const after = await time.refresh(DAY);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]?.values).toMatchObject({ description: 'Keyword research', minutes: 25 });
  });

  it('remembers a work item for the place and applies it', async () => {
    const time = service({ fetch: fakeToolbox({}).fetchFn });
    const day = await time.day(DAY);
    const id = day.entries[0]?.id as string;
    const after = await time.changeEntry(DAY, id, { workItemId: ITEM.id });
    expect(after.entries[0]?.values.workItemId).toBe(ITEM.id);
    expect(after.entries[0]?.values.billable).toBe(true);
  });
});

describe('TimeService: confirm', () => {
  it('says to connect first when not connected, and sends nothing', async () => {
    const toolbox = fakeToolbox({});
    const time = service({ connected: false, fetch: toolbox.fetchFn });
    const answer = await time.confirm(DAY);
    expect(answer.outcome).toBe('not-connected');
    expect(toolbox.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('sends the whole day with its changes and marks it confirmed', async () => {
    const toolbox = fakeToolbox({});
    const time = service({ fetch: toolbox.fetchFn });
    const id = (await time.day(DAY)).entries[0]?.id as string;
    await time.changeEntry(DAY, id, { description: 'Audit', workItemId: ITEM.id });
    const answer = await time.confirm(DAY);
    expect(answer.outcome).toBe('confirmed');
    expect(answer.day.status).toBe('confirmed');
    expect(answer.day.revision).toBe(1);
    const sent = toolbox.calls.find((c) => c.method === 'POST')?.body as DaySubmission;
    expect(sent.baseRevision).toBe(0);
    expect(sent.workDate).toBe(DAY);
    expect(sent.entries).toHaveLength(1);
    expect(sent.changes.length).toBeGreaterThan(0);
  });

  it('keeps a day that failed to send and resends the identical body', async () => {
    const toolbox = fakeToolbox({
      submit: (_body, n) =>
        n === 1 ? 'network' : { status: 200, json: { ok: true, revision: 1, repeated: true } },
    });
    const time = service({ fetch: toolbox.fetchFn });
    const id = (await time.day(DAY)).entries[0]?.id as string;
    await time.changeEntry(DAY, id, { description: 'Audit', workItemId: ITEM.id });

    const first = await time.confirm(DAY);
    expect(first.outcome).toBe('not-sent');
    expect(first.day.status).toBe('not-sent');

    // An edit after the failed send must not change what is resent.
    await time.changeEntry(DAY, id, { description: 'Audit and fixes' });
    const second = await time.confirm(DAY);
    expect(second.outcome).toBe('confirmed');
    const posts = toolbox.calls.filter((c) => c.method === 'POST').map((c) => c.body as DaySubmission);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    // The later edit is still on the day and shows as changed since confirmed.
    expect(second.day.entries[0]?.values.description).toBe('Audit and fixes');
    expect(second.day.status).toBe('changed');
  });

  it('on a conflict, reads Toolbox and keeps the entries it holds', async () => {
    const stored: StoredDay = {
      personId: 'p',
      workDate: DAY,
      revision: 2,
      entries: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          personId: 'p',
          workDate: DAY,
          startAt: '2026-11-28T14:00:00.000Z',
          minutes: 30,
          workItemId: ITEM.id,
          description: 'From the other Mac',
          billable: true,
          source: 'manual',
          certainty: 'manual',
          deleted: false,
        },
      ],
    };
    let readCount = 0;
    const toolbox = fakeToolbox({
      submit: () => ({ status: 409, json: { ok: false, code: 'conflict', problems: [] } }),
      // The first read (opening the day) finds nothing; the read after the conflict finds the other Mac's day.
      stored: () => {
        readCount += 1;
        return readCount === 1 ? null : stored;
      },
    });
    const time = service({ fetch: toolbox.fetchFn });
    const id = (await time.day(DAY)).entries[0]?.id as string;
    await time.changeEntry(DAY, id, { description: 'Audit', workItemId: ITEM.id });
    const answer = await time.confirm(DAY);
    expect(answer.outcome).toBe('conflict');
    const descriptions = answer.day.entries.map((e) => e.values.description);
    expect(descriptions).toContain('From the other Mac');
    expect(descriptions).toContain('Audit');
    expect(answer.day.revision).toBe(2);
  });
});

describe('TimeService: review follow-ups', () => {
  const otherMac: StoredDay = {
    personId: 'p',
    workDate: DAY,
    revision: 3,
    entries: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        personId: 'p',
        workDate: DAY,
        startAt: '2026-11-28T10:00:00.000Z',
        minutes: 10,
        workItemId: ITEM.id,
        description: 'Confirmed on the other Mac',
        billable: true,
        source: 'cortex-chat',
        certainty: 'certain',
        deleted: false,
      },
    ],
  };

  it("opens a day this Mac never confirmed from Toolbox's copy, without counting its chat time twice", async () => {
    const time = service({ fetch: fakeToolbox({ stored: () => otherMac }).fetchFn });
    const day = await time.day(DAY);
    expect(day.revision).toBe(3);
    expect(day.entries.map((e) => e.values.description)).toContain('Confirmed on the other Mac');
    const after = await time.refresh(DAY);
    // The chat (09:58-10:08) overlaps the stored 10:00-10:10 entry: only the 2 minutes outside it are new.
    expect(after.totalMinutes).toBe(12);
  });

  it('treats a 401 from Toolbox as a lost connection', async () => {
    const toolbox = fakeToolbox({ submit: () => ({ status: 401, json: { error: 'unauthorised' } }) });
    const time = service({ fetch: toolbox.fetchFn });
    const id = (await time.day(DAY)).entries[0]?.id as string;
    await time.changeEntry(DAY, id, { workItemId: ITEM.id });
    const answer = await time.confirm(DAY);
    expect(answer.outcome).toBe('not-connected');
    expect((await time.status()).connection.state).toBe('lost');
  });

  it('never offers a saved job list from a different Toolbox', async () => {
    const first = service({ fetch: fakeToolbox({}).fetchFn });
    expect((await first.workItems(true)).items).toHaveLength(1);
    // Same data folder, a new address, not connected to it: the old list must not come back.
    const second = service({ connected: false, env: { TDS_TOOLBOX_URL: 'https://toolbox.example.com' } });
    expect((await second.workItems(false)).items).toEqual([]);
  });
});
