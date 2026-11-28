import { describe, expect, it } from 'vitest';
import type { ChatPlace, DayDraft, DraftEntry } from '../../shared/time-contract.ts';
import { editEntry } from './changes.ts';
import { emptyDraft } from './day-store.ts';
import type { Assignment } from './links.ts';
import { type CaptureBlock, canAutoRefresh, mergeCapture } from './merge-capture.ts';

const DAY = '2026-11-20';
const NOW = new Date('2026-11-20T18:00:00.000Z');
const WI = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ACME: ChatPlace = { client: 'acme', project: 'acme/web' };
const t = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function block(chatId: string, from: string, to: string, over: Partial<CaptureBlock> = {}): CaptureBlock {
  const minutes = (Date.parse(t(to)) - Date.parse(t(from))) / 60_000;
  return {
    chatId,
    captureKey: `${chatId}@${t(from)}`,
    workDate: DAY,
    startAt: t(from),
    endAt: t(to),
    minutes,
    claudeMinutes: 2,
    prompts: 1,
    place: ACME,
    ...over,
  };
}

const assignFn = (place: ChatPlace | null): Assignment =>
  place?.project === 'acme/web'
    ? { workItemId: WI, certainty: 'certain', billable: true }
    : { workItemId: null, certainty: 'unassigned', billable: false };

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const span = (e: DraftEntry) =>
  `${e.captured?.chatId} ${e.values.startAt?.slice(11, 16)} ${e.values.minutes}${e.missing ? ' missing' : ''}${e.deleted ? ' deleted' : ''}`;

const fresh = (over: Partial<DayDraft> = {}): DayDraft => ({ ...emptyDraft(DAY, NOW), ...over });

describe('mergeCapture: new blocks', () => {
  it('makes chat entries with work items and a create change each while never confirmed', () => {
    const out = mergeCapture(
      fresh(),
      [block('c1', '09:00', '09:30'), block('c2', '10:00', '10:20', { place: null })],
      assignFn,
      NOW,
      {
        newId,
      },
    );
    expect(out.entries.map(span)).toEqual(['c1 09:00 30', 'c2 10:00 20']);
    const [a, b] = out.entries as [DraftEntry, DraftEntry];
    expect(a).toMatchObject({
      source: 'cortex-chat',
      certainty: 'certain',
      values: { workItemId: WI, billable: true, description: '' },
      place: ACME,
      edited: [],
      missing: false,
      fromToolbox: false,
      confirmed: null,
      deleted: false,
    });
    expect(a.captured).toMatchObject({
      chatId: 'c1',
      endAt: t('09:30'),
      claudeMinutes: 2,
      prompts: 1,
      startAt: t('09:00'),
    });
    expect(b).toMatchObject({ certainty: 'unassigned', values: { workItemId: null, billable: false } });
    expect(out.changes.map((c) => [c.entryId, c.action])).toEqual([
      [a.id, 'create'],
      [b.id, 'create'],
    ]);
    expect(out.updatedAt).toBe(NOW.toISOString());
  });

  it('uses random lower-case UUIDs by default', () => {
    const out = mergeCapture(fresh(), [block('c1', '09:00', '09:30')], assignFn, NOW);
    expect(out.entries[0]?.id).toMatch(UUID);
  });

  it('records no changes once the day has a revision', () => {
    const out = mergeCapture(fresh({ revision: 2 }), [block('c1', '09:00', '09:30')], assignFn, NOW, {
      newId,
    });
    expect(out.changes).toEqual([]);
    expect(out.status).toBe('changed');
  });

  it('ignores blocks for another day', () => {
    const out = mergeCapture(
      fresh(),
      [block('c1', '09:00', '09:30', { workDate: '2026-11-21' })],
      assignFn,
      NOW,
    );
    expect(out.entries).toEqual([]);
  });
});

describe('mergeCapture: refresh', () => {
  const first = () => mergeCapture(fresh(), [block('c1', '09:00', '09:30')], assignFn, NOW, { newId });

  it('the same blocks again change nothing', () => {
    const d = first();
    const again = mergeCapture(d, [block('c1', '09:00', '09:30')], assignFn, NOW, { newId });
    expect(again.entries).toEqual(d.entries);
    expect(again.changes).toEqual(d.changes);
  });

  it('an untouched entry takes the new times of the overlapping block of its chat', () => {
    const d = first();
    const out = mergeCapture(
      d,
      [block('c1', '08:50', '09:45', { claudeMinutes: 7, prompts: 4 })],
      assignFn,
      NOW,
    );
    expect(out.entries.map(span)).toEqual(['c1 08:50 55']);
    expect(out.entries[0]?.id).toBe(d.entries[0]?.id);
    expect(out.entries[0]?.captured).toMatchObject({
      startAt: t('08:50'),
      endAt: t('09:45'),
      claudeMinutes: 7,
      prompts: 4,
    });
    expect(out.changes).toEqual(d.changes);
  });

  it('a block of another chat at the same time is a new entry, not a match', () => {
    const out = mergeCapture(
      first(),
      [block('c1', '09:00', '09:30'), block('c2', '09:30', '09:40')],
      assignFn,
      NOW,
      {
        newId,
      },
    );
    expect(out.entries.map(span)).toEqual(['c1 09:00 30', 'c2 09:30 10']);
  });

  it("never undoes the person's edits, and cuts new time around the entry they touched", () => {
    const d = first();
    const e = d.entries[0] as DraftEntry;
    const touched: DayDraft = {
      ...d,
      entries: [
        {
          ...e,
          values: { ...e.values, minutes: 20, description: 'Homepage' },
          edited: ['minutes', 'description'],
        },
      ],
    };
    const out = mergeCapture(touched, [block('c1', '08:45', '09:40')], assignFn, NOW, { newId });
    expect(out.entries.map(span)).toEqual(['c1 09:00 20', 'c1 08:45 15', 'c1 09:30 10']);
    expect(out.entries[0]?.values.description).toBe('Homepage');
    expect(out.entries[0]?.captured?.endAt).toBe(t('09:30'));
  });

  it('a deleted entry is never brought back', () => {
    const d = first();
    const gone: DayDraft = { ...d, entries: [{ ...(d.entries[0] as DraftEntry), deleted: true }] };
    const out = mergeCapture(gone, [block('c1', '09:00', '09:30')], assignFn, NOW, { newId });
    expect(out.entries.map(span)).toEqual(['c1 09:00 30 deleted']);
    const longer = mergeCapture(gone, [block('c1', '09:00', '09:50')], assignFn, NOW, { newId });
    expect(longer.entries.map(span)).toEqual(['c1 09:00 30 deleted', 'c1 09:30 20']);
  });

  it("an entry the person moved also keeps new blocks off the person's times", () => {
    const d = first();
    const e = d.entries[0] as DraftEntry;
    const moved: DayDraft = {
      ...d,
      entries: [{ ...e, values: { ...e.values, startAt: t('11:00'), minutes: 30 }, edited: ['startAt'] }],
    };
    const out = mergeCapture(
      moved,
      [block('c1', '09:00', '09:30'), block('c1', '11:10', '11:50')],
      assignFn,
      NOW,
      {
        newId,
      },
    );
    expect(out.entries.map(span)).toEqual(['c1 11:00 30', 'c1 11:30 20']);
  });

  it('a vanished untouched entry is kept and marked missing, and found again later', () => {
    const d = first();
    const out = mergeCapture(d, [], assignFn, NOW);
    expect(out.entries.map(span)).toEqual(['c1 09:00 30 missing']);
    const back = mergeCapture(out, [block('c1', '09:05', '09:30')], assignFn, NOW);
    expect(back.entries.map(span)).toEqual(['c1 09:05 25']);
  });

  it("a chat's new place reassigns its untouched entries", () => {
    const d = first();
    const out = mergeCapture(
      d,
      [block('c1', '09:00', '09:30', { place: { client: 'zed', project: null } })],
      assignFn,
      NOW,
    );
    expect(out.entries[0]).toMatchObject({
      place: { client: 'zed', project: null },
      certainty: 'unassigned',
      values: { workItemId: null, billable: false },
    });
  });

  it('a chat since marked personal loses its untouched unconfirmed entries and their changes', () => {
    const d = mergeCapture(
      fresh(),
      [block('c1', '09:00', '09:30'), block('c1', '11:00', '11:30'), block('c2', '10:00', '10:10')],
      assignFn,
      NOW,
      {
        newId,
      },
    );
    // Created in time order: c1 09:00, c2 10:00, c1 11:00.
    const [a, c, b] = d.entries as [DraftEntry, DraftEntry, DraftEntry];
    const mixed: DayDraft = {
      ...d,
      entries: [{ ...a, edited: ['description'], values: { ...a.values, description: 'Kept' } }, c, b],
    };
    const out = mergeCapture(mixed, [block('c2', '10:00', '10:10')], assignFn, NOW, {
      personalChatIds: new Set(['c1']),
    });
    expect(out.entries.map((e) => e.id)).toEqual([a.id, c.id]);
    expect(out.changes.some((ch) => ch.entryId === b.id)).toBe(false);
  });

  it('a confirmed entry of a chat since marked personal is kept (and marked missing)', () => {
    const d = first();
    const e = d.entries[0] as DraftEntry;
    const confirmed: DayDraft = { ...d, revision: 1, changes: [], entries: [{ ...e, confirmed: e.values }] };
    const out = mergeCapture(confirmed, [], assignFn, NOW, { personalChatIds: new Set(['c1']) });
    expect(out.entries.map(span)).toEqual(['c1 09:00 30 missing']);
  });
});

describe('canAutoRefresh', () => {
  it('only a day never confirmed, with nothing waiting to send and no conflict', () => {
    expect(canAutoRefresh(fresh())).toBe(true);
    expect(canAutoRefresh(fresh({ revision: 1, status: 'confirmed' }))).toBe(false);
    expect(canAutoRefresh(fresh({ status: 'conflict' }))).toBe(false);
    const pending = fresh();
    expect(
      canAutoRefresh({
        ...pending,
        status: 'not-sent',
        pending: {
          submissionId: 's',
          body: { version: 1, submissionId: 's', workDate: DAY, baseRevision: 0, entries: [], changes: [] },
        },
      }),
    ).toBe(false);
  });
});

describe('mergeCapture: entries capture did not make', () => {
  it('never counts chat time again over an entry from Toolbox or one the person added', () => {
    // A lost draft rebuilt from Toolbox: the stored entry has no captured interval.
    const stored: DraftEntry = {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'cortex-chat',
      certainty: 'certain',
      values: { startAt: t('09:00'), minutes: 30, workItemId: WI, description: 'Audit', billable: true },
      captured: null,
      edited: [],
      place: null,
      missing: false,
      fromToolbox: true,
      confirmed: { startAt: t('09:00'), minutes: 30, workItemId: WI, description: 'Audit', billable: true },
      deleted: false,
    };
    const out = mergeCapture(
      fresh({ entries: [stored], revision: 1, status: 'confirmed' }),
      [block('c1', '09:00', '09:30'), block('c1', '09:40', '09:50')],
      assignFn,
      NOW,
      { newId },
    );
    const live = out.entries.filter((e) => !e.deleted);
    expect(live.reduce((sum, e) => sum + e.values.minutes, 0)).toBe(40);
    expect(live.map(span)).toEqual(['undefined 09:00 30', 'c1 09:40 10']);
  });
});

describe('mergeCapture: only time edits freeze an entry (decision 32.5)', () => {
  const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const ITEMS = [
    { id: WI, name: 'Acme web', kind: 'project' as const, cortexKey: null, clientId: null },
    { id: OTHER, name: 'Admin', kind: 'internal' as const, cortexKey: null, clientId: null },
  ];
  const first = () => mergeCapture(fresh(), [block('c1', '09:00', '09:30')], assignFn, NOW, { newId });
  const edit = (d: DayDraft, patch: Parameters<typeof editEntry>[2]) => {
    const r = editEntry(d, (d.entries[0] as DraftEntry).id, patch, ITEMS, NOW);
    if (!r.ok) throw new Error(r.message);
    return r.draft;
  };

  it('a description edit keeps following capture for its times, and keeps the description', () => {
    const d = edit(first(), { description: 'Homepage' });
    const out = mergeCapture(d, [block('c1', '08:50', '09:45', { claudeMinutes: 7 })], assignFn, NOW, {
      newId,
    });
    expect(out.entries.map(span)).toEqual(['c1 08:50 55']);
    const e = out.entries[0] as DraftEntry;
    expect(e.id).toBe(d.entries[0]?.id);
    expect(e.values).toMatchObject({ description: 'Homepage', workItemId: WI, billable: true });
    expect(e.edited).toEqual(['description']);
    // The captured snapshot is what capture proposed, never the person's wording.
    expect(e.captured).toMatchObject({
      startAt: t('08:50'),
      endAt: t('09:45'),
      minutes: 55,
      description: '',
    });
    expect(e.captured?.claudeMinutes).toBe(7);
    // A times update from capture is not the person's change: the change list is as the edit left it.
    expect(out.changes).toEqual(d.changes);
  });

  it("keeps the person's work item (and the billable that came with it) and certainty", () => {
    const d = edit(first(), { workItemId: OTHER });
    expect(d.entries[0]?.values).toMatchObject({ workItemId: OTHER, billable: false });
    const out = mergeCapture(d, [block('c1', '09:00', '09:40')], assignFn, NOW, { newId });
    const e = out.entries[0] as DraftEntry;
    expect(out.entries.map(span)).toEqual(['c1 09:00 40']);
    expect(e.values).toMatchObject({ workItemId: OTHER, billable: false });
    expect(e.certainty).toBe('manual');
    expect(e.captured).toMatchObject({ workItemId: WI, billable: true, minutes: 40 });
    expect(out.changes).toEqual(d.changes);
  });

  it("keeps the person's work item when its billable flag happened not to change", () => {
    const e0 = first().entries[0] as DraftEntry;
    const d: DayDraft = {
      ...first(),
      entries: [
        { ...e0, certainty: 'manual', values: { ...e0.values, workItemId: OTHER }, edited: ['workItemId'] },
      ],
    };
    const out = mergeCapture(d, [block('c1', '09:00', '09:40')], assignFn, NOW, { newId });
    expect(out.entries[0]?.values).toMatchObject({ workItemId: OTHER, billable: true, minutes: 40 });
    expect(out.entries[0]?.certainty).toBe('manual');
  });

  it("keeps the person's billable flag and takes capture's work item", () => {
    const d = edit(first(), { billable: false });
    const out = mergeCapture(
      d,
      [block('c1', '09:00', '09:40', { place: { client: 'zed', project: null } })],
      assignFn,
      NOW,
      { newId },
    );
    expect(out.entries[0]?.values).toMatchObject({ workItemId: null, billable: false, minutes: 40 });
    expect(out.entries[0]?.certainty).toBe('unassigned');
  });

  it('a start or minutes edit still freezes the times', () => {
    const d = edit(first(), { minutes: 20 });
    const out = mergeCapture(d, [block('c1', '08:50', '09:45')], assignFn, NOW, { newId });
    expect(out.entries.map(span)).toEqual(['c1 09:00 20', 'c1 08:50 10', 'c1 09:30 15']);
  });

  it('a described entry whose time vanishes is kept and marked missing', () => {
    const d = edit(first(), { description: 'Homepage' });
    const out = mergeCapture(d, [], assignFn, NOW);
    expect(out.entries.map(span)).toEqual(['c1 09:00 30 missing']);
    expect(out.entries[0]?.values.description).toBe('Homepage');
  });
});
