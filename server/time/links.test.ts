import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type DraftEntry,
  type EntryValues,
  TIME_LINKS_FILE,
  type WireWorkItem,
} from '../../shared/time-contract.ts';
import { emptyDraft } from './day-store.ts';
import { applyRemember, assign, createLinksStore, emptyLinks, parseLinks } from './links.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-links-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const WEB = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const RETAINER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ADMIN = 'cccccccccccccccccccccccc';
const KEYED = 'dddddddddddddddddddddddd';
const ITEMS: WireWorkItem[] = [
  { id: WEB, name: 'Acme web', kind: 'project', cortexKey: null, clientId: null },
  { id: RETAINER, name: 'Acme retainer', kind: 'retainer', cortexKey: null, clientId: null },
  { id: ADMIN, name: 'Admin', kind: 'internal', cortexKey: null, clientId: null },
  { id: KEYED, name: 'Beta app', kind: 'project', cortexKey: 'beta/app', clientId: null },
];

describe('assign', () => {
  const links = {
    version: 1 as const,
    projects: { 'acme/web': WEB },
    clients: { acme: RETAINER, tds: ADMIN },
  };

  it('a project link is certain', () => {
    expect(assign({ client: 'acme', project: 'acme/web' }, links, ITEMS)).toEqual({
      workItemId: WEB,
      certainty: 'certain',
      billable: true,
    });
  });
  it('a work item whose cortexKey is the project is certain', () => {
    expect(assign({ client: 'beta', project: 'beta/app' }, emptyLinks(), ITEMS)).toEqual({
      workItemId: KEYED,
      certainty: 'certain',
      billable: true,
    });
  });
  it('a client-only chat uses the client link, strong', () => {
    expect(assign({ client: 'acme', project: null }, links, ITEMS)).toEqual({
      workItemId: RETAINER,
      certainty: 'strong',
      billable: true,
    });
    expect(assign({ client: 'tds', project: null }, links, ITEMS)).toEqual({
      workItemId: ADMIN,
      certainty: 'strong',
      billable: false,
    });
  });
  it('a project with no link falls back to its client link as a suggestion', () => {
    expect(assign({ client: 'acme', project: 'acme/other' }, links, ITEMS)).toEqual({
      workItemId: RETAINER,
      certainty: 'suggested',
      billable: true,
    });
  });
  it('otherwise unassigned and not billable', () => {
    const none = { workItemId: null, certainty: 'unassigned', billable: false };
    expect(assign(null, links, ITEMS)).toEqual(none);
    expect(assign({ client: null, project: null }, links, ITEMS)).toEqual(none);
    expect(assign({ client: 'zed', project: null }, links, ITEMS)).toEqual(none);
  });
  it('a link to a work item no longer listed is not used', () => {
    expect(assign({ client: 'acme', project: 'acme/web' }, links, ITEMS.slice(1))).toMatchObject({
      workItemId: RETAINER,
      certainty: 'suggested',
    });
  });
});

describe('parseLinks', () => {
  it('keeps only well-formed links', () => {
    expect(
      parseLinks({
        version: 1,
        projects: { 'acme/web': WEB, 'bad key': WEB, 'acme/x': 'nope' },
        clients: { acme: RETAINER, 'Bad Client': RETAINER },
      }),
    ).toEqual({ version: 1, projects: { 'acme/web': WEB }, clients: { acme: RETAINER } });
    expect(parseLinks('x')).toEqual(emptyLinks());
  });
});

describe('links store', () => {
  it('reads empty, remembers a project and a client link, 0600', async () => {
    const dir = tmp();
    const store = createLinksStore(dir);
    expect(await store.read()).toEqual(emptyLinks());
    await store.remember({ client: 'acme', project: 'acme/web' }, WEB);
    await store.remember({ client: 'acme', project: null }, RETAINER);
    const file = join(dir, TIME_LINKS_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'time')).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      projects: { 'acme/web': WEB },
      clients: { acme: RETAINER },
    });
    expect(await createLinksStore(dir).read()).toEqual({
      version: 1,
      projects: { 'acme/web': WEB },
      clients: { acme: RETAINER },
    });
  });

  it('remembering null forgets, and a place with neither does nothing', async () => {
    const dir = tmp();
    const store = createLinksStore(dir);
    await store.remember({ client: 'acme', project: 'acme/web' }, WEB);
    await store.remember({ client: 'acme', project: 'acme/web' }, null);
    expect((await store.read()).projects).toEqual({});
    await store.remember({ client: null, project: null }, WEB);
    expect(await store.read()).toEqual(emptyLinks());
  });

  it('runs remembers one at a time', async () => {
    const store = createLinksStore(tmp());
    await Promise.all([
      store.remember({ client: 'a', project: null }, WEB),
      store.remember({ client: 'b', project: null }, ADMIN),
      store.remember({ client: 'c', project: null }, RETAINER),
    ]);
    expect(Object.keys((await store.read()).clients).sort()).toEqual(['a', 'b', 'c']);
  });

  it('a broken file is kept aside and the links start empty', async () => {
    const dir = tmp();
    const store = createLinksStore(dir);
    await store.remember({ client: 'acme', project: null }, WEB);
    writeFileSync(join(dir, TIME_LINKS_FILE), '{oops');
    const again = createLinksStore(dir);
    expect(await again.read()).toEqual(emptyLinks());
    expect(readdirSync(join(dir, 'time')).some((n) => n.startsWith('links.json.bad-'))).toBe(true);
  });
});

describe('applyRemember', () => {
  const v = (over: Partial<EntryValues> = {}): EntryValues => ({
    startAt: '2026-11-20T09:00:00.000Z',
    minutes: 30,
    workItemId: null,
    description: '',
    billable: false,
    ...over,
  });
  const e = (n: number, over: Partial<DraftEntry> = {}): DraftEntry => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    source: 'cortex-chat',
    certainty: 'unassigned',
    values: v(),
    captured: { ...v(), chatId: `c${n}`, captureKey: 'k', endAt: 'x', claudeMinutes: 0, prompts: 1 },
    edited: [],
    place: { client: 'acme', project: 'acme/web' },
    missing: false,
    fromToolbox: false,
    confirmed: null,
    deleted: false,
    ...over,
  });

  it("assigns the day's other untouched entries with the same place", () => {
    const draft = {
      ...emptyDraft('2026-11-20', new Date()),
      entries: [
        e(1, { edited: ['workItemId'], certainty: 'manual', values: v({ workItemId: WEB, billable: true }) }),
        e(2),
        e(3, { place: { client: 'acme', project: null } }),
        e(4, { edited: ['workItemId'], certainty: 'manual', values: v({ workItemId: ADMIN }) }),
        e(5, { deleted: true }),
        e(6, { edited: ['billable'], values: v({ billable: false }) }),
      ],
    };
    const out = applyRemember(draft, { client: 'acme', project: 'acme/web' }, WEB, ITEMS);
    const by = (n: number) => out.entries[n - 1] as DraftEntry;
    expect(by(2)).toMatchObject({
      certainty: 'certain',
      values: v({ workItemId: WEB, billable: true }),
      edited: [],
    });
    expect(by(2).captured).toMatchObject({ workItemId: WEB, billable: true });
    expect(by(3).values.workItemId).toBeNull();
    expect(by(4).values.workItemId).toBe(ADMIN);
    expect(by(5).values.workItemId).toBeNull();
    expect(by(6).values).toEqual(v({ workItemId: WEB, billable: false }));
    expect(out.changes).toEqual([]);
  });

  it('a client place assigns as strong', () => {
    const draft = {
      ...emptyDraft('2026-11-20', new Date()),
      entries: [e(1, { place: { client: 'acme', project: null } })],
    };
    const out = applyRemember(draft, { client: 'acme', project: null }, RETAINER, ITEMS);
    expect(out.entries[0]).toMatchObject({
      certainty: 'strong',
      values: { workItemId: RETAINER, billable: true },
    });
  });
});
