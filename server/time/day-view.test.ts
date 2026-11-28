import { describe, expect, it } from 'vitest';
import type {
  ChatPlace,
  DayDraft,
  DraftEntry,
  EntryValues,
  WireWorkItem,
} from '../../shared/time-contract.ts';
import { emptyDraft } from './day-store.ts';
import { dayView } from './day-view.ts';

const DAY = '2026-11-20';
const NOW = new Date('2026-11-20T18:00:00.000Z');
const WEB = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ADMIN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const CLOSED = 'cccccccccccccccccccccccc';
const ITEMS: WireWorkItem[] = [
  { id: WEB, name: 'Acme web', kind: 'project', cortexKey: null, clientId: null },
  { id: ADMIN, name: 'Admin', kind: 'internal', cortexKey: null, clientId: null },
];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const t = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;
const labelFor = (place: ChatPlace) =>
  place.project === 'acme/web' ? 'Acme website' : place.client ? 'Acme' : null;
const opts = { connected: true };

const values = (over: Partial<EntryValues> = {}): EntryValues => ({
  startAt: t('09:00'),
  minutes: 30,
  workItemId: WEB,
  description: 'Build',
  billable: true,
  ...over,
});
function entry(n: number, over: Partial<DraftEntry> = {}): DraftEntry {
  return {
    id: id(n),
    source: 'manual',
    certainty: 'manual',
    values: values(),
    captured: null,
    edited: [],
    place: null,
    missing: false,
    fromToolbox: false,
    confirmed: null,
    deleted: false,
    ...over,
  };
}
const day = (entries: DraftEntry[], over: Partial<DayDraft> = {}): DayDraft => ({
  ...emptyDraft(DAY, NOW),
  entries,
  ...over,
});

describe('dayView', () => {
  it('lists live entries in time order with end times, totals and gaps', () => {
    const d = day([
      entry(1, { values: values({ startAt: t('11:00'), minutes: 60, workItemId: ADMIN, billable: false }) }),
      entry(2),
      entry(3, { values: values({ startAt: t('09:20'), minutes: 20 }) }),
      entry(4, { deleted: true }),
      entry(5, { values: values({ startAt: null, minutes: 15 }) }),
    ]);
    const v = dayView(d, ITEMS, labelFor, NOW, opts);
    expect(v.entries.map((e) => e.id)).toEqual([id(2), id(3), id(1), id(5)]);
    expect(v.entries[0]?.endAt).toBe(t('09:30'));
    expect(v.entries[3]?.endAt).toBeNull();
    expect(v.totalMinutes).toBe(125);
    expect(v.totals).toEqual([
      { workItemId: WEB, minutes: 65, billableMinutes: 65 },
      { workItemId: ADMIN, minutes: 60, billableMinutes: 0 },
    ]);
    expect(v.gaps).toEqual([{ startAt: t('09:40'), minutes: 80 }]);
    expect(v).toMatchObject({
      workDate: DAY,
      status: 'not-confirmed',
      revision: 0,
      confirmBlocked: null,
      privateAllowed: true,
    });
  });

  it('gaps of 15 minutes or less are not shown', () => {
    const d = day([entry(1), entry(2, { values: values({ startAt: t('09:45') }) })]);
    expect(dayView(d, ITEMS, labelFor, NOW, opts).gaps).toEqual([]);
  });

  it('evidence names the place, never the chat', () => {
    const captured = {
      ...values(),
      chatId: 'chat-xyz',
      captureKey: 'k',
      endAt: t('09:30'),
      claudeMinutes: 4,
      prompts: 2,
    };
    const d = day([
      entry(1, { source: 'cortex-chat', captured, place: { client: 'acme', project: 'acme/web' } }),
      entry(2, { source: 'cortex-chat', captured, place: null }),
    ]);
    const v = dayView(d, ITEMS, labelFor, NOW, opts);
    expect(v.entries[0]).toMatchObject({
      evidence: 'Cortex chat: Acme website',
      claudeMinutes: 4,
      placeLabel: 'Acme website',
    });
    expect(v.entries[1]).toMatchObject({ evidence: 'Cortex chat', placeLabel: null });
    expect(JSON.stringify(v)).not.toContain('chat-xyz');
  });

  it('privateAllowed only before the first confirmation', () => {
    const v = dayView(day([], { revision: 2, status: 'confirmed' }), ITEMS, labelFor, NOW, opts);
    expect(v.privateAllowed).toBe(false);
  });

  it('passes capture notes through', () => {
    const v = dayView(day([]), ITEMS, labelFor, NOW, {
      connected: true,
      captureNotes: ['No chat history is kept this far back.'],
    });
    expect(v.captureNotes).toEqual(['No chat history is kept this far back.']);
  });
});

describe('dayView: why Confirm is blocked', () => {
  const blocked = (d: DayDraft, o: Parameters<typeof dayView>[4] = opts, items = ITEMS) =>
    dayView(d, items, labelFor, NOW, o).confirmBlocked;

  it('not connected', () => {
    expect(blocked(day([entry(1)]), { connected: false })).toMatch(/Connect to Toolbox/);
  });

  it('unassigned billable time, with the entry marked', () => {
    const d = day([entry(1, { values: values({ workItemId: null, billable: true }) })]);
    expect(blocked(d)).toMatch(/Billable time needs/);
    expect(dayView(d, ITEMS, labelFor, NOW, opts).entries[0]?.problems).toContain(
      'Billable time needs a client or project.',
    );
  });

  it('a closed work item only when it is new or changed since confirmed', () => {
    const v = values({ workItemId: CLOSED });
    expect(blocked(day([entry(1, { values: v })]))).toMatch(/closed in Toolbox/);
    const view = dayView(day([entry(1, { values: v })]), ITEMS, labelFor, NOW, opts);
    expect(view.entries[0]?.workItemClosed).toBe(true);
    const kept = day([entry(1, { values: { ...v, minutes: 45 }, confirmed: v })], { revision: 1 });
    expect(blocked(kept)).toBeNull();
    expect(dayView(kept, ITEMS, labelFor, NOW, opts).entries[0]?.workItemClosed).toBe(true);
  });

  it('an unknown work item list marks nothing closed', () => {
    const v = dayView(day([entry(1, { values: values({ workItemId: CLOSED }) })]), [], labelFor, NOW, {
      connected: false,
    });
    expect(v.entries[0]?.workItemClosed).toBe(false);
  });

  it('a description over 1000 characters', () => {
    expect(blocked(day([entry(1, { values: values({ description: 'x'.repeat(1001) }) })]))).toMatch(
      /1000 characters/,
    );
    expect(blocked(day([entry(1, { values: values({ description: ` ${'x'.repeat(1000)} ` }) })]))).toBeNull();
  });

  it('an entry crossing into the next day', () => {
    const d = day([entry(1, { values: values({ startAt: t('23:30'), minutes: 45 }) })]);
    expect(blocked(d)).toMatch(/midnight/);
    expect(blocked(day([entry(1, { values: values({ startAt: t('23:30'), minutes: 30 }) })]))).toBeNull();
  });

  it('more than 200 entries', () => {
    const many = Array.from({ length: 201 }, (_, i) =>
      entry(i, { values: values({ startAt: null, minutes: 1, billable: false, workItemId: null }) }),
    );
    expect(blocked(day(many))).toMatch(/200 entries/);
  });

  it('more than 24 hours', () => {
    const d = day([
      entry(1, { values: values({ startAt: null, minutes: 1000 }) }),
      entry(2, { values: values({ startAt: null, minutes: 500 }) }),
    ]);
    expect(blocked(d)).toMatch(/24 hours/);
  });

  it('a future day', () => {
    expect(blocked({ ...emptyDraft('2026-11-21', NOW), entries: [] })).toMatch(/hasn.t happened/);
  });

  it('a pending send is blocked only by the connection', () => {
    const d = day([entry(1, { values: values({ workItemId: null, billable: true }) })], {
      status: 'not-sent',
      pending: {
        submissionId: 's',
        body: { version: 1, submissionId: 's', workDate: DAY, baseRevision: 0, entries: [], changes: [] },
      },
    });
    expect(blocked(d)).toBeNull();
    expect(blocked(d, { connected: false })).toMatch(/Connect/);
  });
});

describe('dayView: problems', () => {
  it('maps refused problems to entries and the day, and flags missing captures beside Confirm', () => {
    const d = day([entry(1, { missing: true }), entry(2)], {
      problems: [
        { entryId: id(2), message: 'This client or project doesn’t exist.' },
        { entryId: '', message: 'Toolbox refused the day.' },
        { entryId: id(9), message: 'Gone entry problem.' },
      ],
    });
    const v = dayView(d, ITEMS, labelFor, NOW, opts);
    expect(v.entries[1]?.problems).toEqual(['This client or project doesn’t exist.']);
    expect(v.entries[0]?.problems).toEqual([
      'Your chats no longer show this time. Check it before you confirm.',
    ]);
    expect(v.dayProblems).toEqual([
      'Toolbox refused the day.',
      'Gone entry problem.',
      '1 entry is no longer found in your chats. Check it before you confirm.',
    ]);
    expect(v.confirmBlocked).toBeNull();
  });
});

describe('dayView: chat titles and the chat link (decisions 32 and A)', () => {
  const chatEntry = (n: number, chatId: string, place: ChatPlace | null) =>
    entry(n, {
      source: 'cortex-chat',
      place,
      captured: {
        ...values({ description: '' }),
        chatId,
        captureKey: `${chatId}@${t('09:00')}`,
        endAt: t('09:30'),
        claudeMinutes: 3,
        prompts: 2,
      },
    });
  const chats = new Map([
    ['c-real', { customTitle: 'Homepage audit' }],
    ['c-prompt', { summary: 'fix the footer', firstPrompt: 'fix the footer' }],
  ]);

  it('joins the title by captured chat id, and the id only while Cortex still lists the chat', () => {
    const d = day([
      chatEntry(1, 'c-real', { client: 'acme', project: 'acme/web' }),
      chatEntry(2, 'c-prompt', null),
      chatEntry(3, 'c-gone', null),
      entry(4),
    ]);
    const v = dayView(d, ITEMS, labelFor, NOW, { ...opts, chats, restricted: () => false });
    const byId = new Map(v.entries.map((e) => [e.id, e]));
    expect(byId.get(id(1))).toMatchObject({
      titleHint: 'Homepage audit',
      hintAcceptable: true,
      chatId: 'c-real',
    });
    // Titled only by its first prompt: no hint, but it can still be opened.
    expect(byId.get(id(2))).toMatchObject({ titleHint: null, hintAcceptable: false, chatId: 'c-prompt' });
    expect(byId.get(id(3))).toMatchObject({ titleHint: null, hintAcceptable: false, chatId: null });
    expect(byId.get(id(4))).toMatchObject({ titleHint: null, hintAcceptable: false, chatId: null });
    // The evidence line never carries the title.
    expect(byId.get(id(1))?.evidence).toBe('Cortex chat: Acme website');
  });

  it('a restricted project shows the hint but offers no one-click use', () => {
    const place: ChatPlace = { client: 'acme', project: 'acme/web' };
    const d = day([chatEntry(1, 'c-real', place)]);
    const v = dayView(d, ITEMS, labelFor, NOW, {
      ...opts,
      chats,
      restricted: (p) => p.project === 'acme/web',
    });
    expect(v.entries[0]).toMatchObject({ titleHint: 'Homepage audit', hintAcceptable: false });
  });

  it('without chats known there are no hints or links', () => {
    const v = dayView(day([chatEntry(1, 'c-real', null)]), ITEMS, labelFor, NOW, opts);
    expect(v.entries[0]).toMatchObject({ titleHint: null, hintAcceptable: false, chatId: null });
  });
});
