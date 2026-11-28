import { describe, expect, it } from 'vitest';
import type {
  DayDraft,
  DraftEntry,
  EntryValues,
  LocalChange,
  WireWorkItem,
} from '../../shared/time-contract.ts';
import {
  addEntry,
  changedFields,
  changesForSave,
  collapseChanges,
  defaultBillable,
  deleteEntry,
  deriveStatus,
  editEntry,
  encodeValue,
} from './changes.ts';
import { emptyDraft } from './day-store.ts';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const LATER = new Date('2026-11-20T11:00:00.000Z');
const DATE = '2026-11-20';
const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const WI_PROJECT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const WI_INTERNAL = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ITEMS: WireWorkItem[] = [
  { id: WI_PROJECT, name: 'Acme web', kind: 'project', cortexKey: 'acme/web', clientId: null },
  { id: WI_INTERNAL, name: 'Admin', kind: 'internal', cortexKey: null, clientId: null },
];

const values = (over: Partial<EntryValues> = {}): EntryValues => ({
  startAt: '2026-11-20T09:00:00.000Z',
  minutes: 30,
  workItemId: null,
  description: 'Planning',
  billable: false,
  ...over,
});

function entry(over: Partial<DraftEntry> = {}): DraftEntry {
  return {
    id: E1,
    source: 'manual',
    certainty: 'unassigned',
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

function day(entries: DraftEntry[] = [entry()], over: Partial<DayDraft> = {}): DayDraft {
  return { ...emptyDraft(DATE, NOW), entries, ...over };
}

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('encodeValue', () => {
  it('uses Toolbox encodings', () => {
    const v = values({
      startAt: '2026-11-20T10:00:00+01:00',
      minutes: 45,
      workItemId: WI_PROJECT,
      billable: true,
    });
    expect(encodeValue('startAt', v)).toBe('2026-11-20T09:00:00.000Z');
    expect(encodeValue('minutes', v)).toBe('45');
    expect(encodeValue('billable', v)).toBe('true');
    expect(encodeValue('workItemId', v)).toBe(WI_PROJECT);
    expect(encodeValue('description', values({ description: '  Hi  ' }))).toBe('Hi');
    expect(encodeValue('startAt', values({ startAt: null }))).toBeNull();
    expect(encodeValue('workItemId', values())).toBeNull();
  });
  it('changedFields compares encodings, not spellings', () => {
    expect(changedFields(values({ startAt: '2026-11-20T09:00:00Z' }), values())).toEqual([]);
    expect(changedFields(values(), values({ minutes: 31, billable: true }))).toEqual(['minutes', 'billable']);
  });
});

describe('changesForSave', () => {
  it('one update per changed field, in field order, with the Mac time', () => {
    const out = changesForSave({
      entryId: E1,
      before: values(),
      after: values({ description: 'Build', minutes: 40 }),
      at: NOW,
    });
    expect(out).toEqual([
      {
        entryId: E1,
        at: NOW.toISOString(),
        action: 'update',
        field: 'description',
        oldValue: 'Planning',
        newValue: 'Build',
        redacted: false,
      },
      {
        entryId: E1,
        at: NOW.toISOString(),
        action: 'update',
        field: 'minutes',
        oldValue: '30',
        newValue: '40',
        redacted: false,
      },
    ]);
  });
  it('create and delete carry no field or values', () => {
    expect(changesForSave({ entryId: E1, before: null, after: values(), at: NOW })).toEqual([
      {
        entryId: E1,
        at: NOW.toISOString(),
        action: 'create',
        field: null,
        oldValue: null,
        newValue: null,
        redacted: false,
      },
    ]);
    expect(changesForSave({ entryId: E1, before: values(), after: null, at: NOW, private: true })).toEqual([
      {
        entryId: E1,
        at: NOW.toISOString(),
        action: 'delete',
        field: null,
        oldValue: null,
        newValue: null,
        redacted: true,
      },
    ]);
  });
  it('a private edit redacts the description change only', () => {
    const out = changesForSave({
      entryId: E1,
      before: values(),
      after: values({ description: 'Tidy', minutes: 20 }),
      at: NOW,
      private: true,
    });
    expect(out[0]).toMatchObject({ field: 'description', oldValue: null, newValue: null, redacted: true });
    expect(out[1]).toMatchObject({ field: 'minutes', oldValue: '30', newValue: '20', redacted: false });
  });
  it('nothing changed records nothing', () => {
    expect(
      changesForSave({ entryId: E1, before: values(), after: values({ description: 'Planning ' }), at: NOW }),
    ).toEqual([]);
  });
});

describe('addEntry', () => {
  it('adds a manual entry with a create change while never confirmed', () => {
    const r = ok(addEntry(day([]), values({ workItemId: WI_PROJECT }), NOW, () => E2));
    expect(r.entry).toMatchObject({
      id: E2,
      source: 'manual',
      certainty: 'manual',
      fromToolbox: false,
      deleted: false,
    });
    expect(r.draft.changes).toEqual([
      {
        entryId: E2,
        at: NOW.toISOString(),
        action: 'create',
        field: null,
        oldValue: null,
        newValue: null,
        redacted: false,
      },
    ]);
    expect(r.draft.updatedAt).toBe(NOW.toISOString());
  });
  it('an entry with no work item is unassigned', () => {
    expect(ok(addEntry(day([]), values(), NOW, () => E2)).entry.certainty).toBe('unassigned');
  });
  it('records no changes once the day has a revision, and marks it changed', () => {
    const confirmed = day([entry({ confirmed: values() })], { revision: 3, status: 'confirmed' });
    const r = ok(addEntry(confirmed, values(), NOW, () => E2));
    expect(r.draft.changes).toEqual([]);
    expect(r.draft.status).toBe('changed');
  });
  it('refuses bad values', () => {
    const bad = [
      values({ minutes: 0 }),
      values({ minutes: 1441 }),
      values({ minutes: 1.5 }),
      values({ startAt: '2026-11-21T09:00:00.000Z' }),
      values({ startAt: '2026-11-20 09:00' }),
      values({ workItemId: 'nope' }),
      { ...values(), billable: 'yes' } as unknown as EntryValues,
      { ...values(), description: 3 } as unknown as EntryValues,
    ];
    for (const v of bad) {
      const r = addEntry(day([]), v, NOW, () => E2);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad-request');
    }
  });
  it('a start just after London midnight in summer is that day', () => {
    const d = { ...emptyDraft('2026-07-01', NOW) };
    expect(addEntry(d, values({ startAt: '2026-06-30T23:30:00.000Z' }), NOW, () => E2).ok).toBe(true);
    expect(addEntry(d, values({ startAt: '2026-07-01T23:30:00.000Z' }), NOW, () => E2).ok).toBe(false);
  });
  it('trims the description and normalises the start', () => {
    const r = ok(
      addEntry(day([]), values({ description: '  x ', startAt: '2026-11-20T09:00:00Z' }), NOW, () => E2),
    );
    expect(r.entry.values.description).toBe('x');
    expect(r.entry.values.startAt).toBe('2026-11-20T09:00:00.000Z');
  });
});

describe('editEntry', () => {
  it('changes only the given fields, marks them edited and records them', () => {
    const r = ok(editEntry(day(), E1, { description: 'Build', minutes: 45 }, ITEMS, NOW));
    const e = r.draft.entries[0] as DraftEntry;
    expect(e.values).toEqual(values({ description: 'Build', minutes: 45 }));
    expect(e.edited).toEqual(['description', 'minutes']);
    expect(r.draft.changes.map((c) => c.field)).toEqual(['description', 'minutes']);
  });
  it('picking a work item makes it manual and sets billable from its kind', () => {
    const r = ok(editEntry(day(), E1, { workItemId: WI_PROJECT }, ITEMS, NOW));
    const e = r.draft.entries[0] as DraftEntry;
    expect(e.certainty).toBe('manual');
    expect(e.values.billable).toBe(true);
    expect(e.edited).toEqual(['workItemId', 'billable']);
    const r2 = ok(editEntry(r.draft, E1, { workItemId: WI_INTERNAL }, ITEMS, LATER));
    expect((r2.draft.entries[0] as DraftEntry).values.billable).toBe(false);
  });
  it('an explicit billable wins over the default', () => {
    const r = ok(editEntry(day(), E1, { workItemId: WI_PROJECT, billable: false }, ITEMS, NOW));
    expect((r.draft.entries[0] as DraftEntry).values.billable).toBe(false);
  });
  it('a private edit at revision 0 redacts this and every earlier description change of the entry', () => {
    const r1 = ok(editEntry(day(), E1, { description: 'Lunch with Sam', minutes: 40 }, ITEMS, NOW));
    const r2 = ok(editEntry(r1.draft, E1, { description: 'Meeting', privateEdit: true }, ITEMS, LATER));
    const desc = r2.draft.changes.filter((c) => c.field === 'description');
    expect(desc).toHaveLength(2);
    for (const c of desc) expect(c).toMatchObject({ oldValue: null, newValue: null, redacted: true });
    expect(r2.draft.changes.find((c) => c.field === 'minutes')).toMatchObject({
      oldValue: '30',
      newValue: '40',
    });
    expect(JSON.stringify(r2.draft.changes)).not.toContain('Sam');
  });
  it('refuses a private edit once the day has a revision', () => {
    const d = day([entry({ confirmed: values() })], { revision: 2, status: 'confirmed' });
    const r = editEntry(d, E1, { description: 'x', privateEdit: true }, ITEMS, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad-request');
  });
  it('unknown or deleted entries are not found', () => {
    const r = editEntry(day([entry({ deleted: true })]), E1, { minutes: 5 }, ITEMS, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
    const r2 = editEntry(day(), E2, { minutes: 5 }, ITEMS, NOW);
    expect(r2.ok).toBe(false);
  });
  it('editing a confirmed day marks it changed, and putting it back marks it confirmed', () => {
    const d = day([entry({ confirmed: values() })], { revision: 2, status: 'confirmed' });
    const r = ok(editEntry(d, E1, { minutes: 50 }, ITEMS, NOW));
    expect(r.draft.status).toBe('changed');
    expect(r.draft.changes).toEqual([]);
    const back = ok(editEntry(r.draft, E1, { minutes: 30 }, ITEMS, NOW));
    expect(back.draft.status).toBe('confirmed');
  });
  it('a not-sent or conflict day keeps its status through edits', () => {
    for (const status of ['not-sent', 'conflict'] as const) {
      const r = ok(editEntry(day([entry()], { status }), E1, { minutes: 50 }, ITEMS, NOW));
      expect(r.draft.status).toBe(status);
    }
  });
});

describe('deleteEntry', () => {
  it('marks the entry deleted and records a delete', () => {
    const r = ok(deleteEntry(day(), E1, { private: false }, NOW));
    expect((r.draft.entries[0] as DraftEntry).deleted).toBe(true);
    expect(r.draft.changes).toEqual([
      {
        entryId: E1,
        at: NOW.toISOString(),
        action: 'delete',
        field: null,
        oldValue: null,
        newValue: null,
        redacted: false,
      },
    ]);
  });
  it('Remove as private scrubs the entry wording and every earlier change of it', () => {
    const captured = {
      ...values({ description: 'Secret' }),
      chatId: 'c',
      captureKey: 'k',
      endAt: 'x',
      claudeMinutes: 1,
      prompts: 1,
    };
    const d1 = ok(
      editEntry(day([entry({ captured })]), E1, { description: 'Secret plan', minutes: 9 }, ITEMS, NOW),
    ).draft;
    const r = ok(deleteEntry(d1, E1, { private: true }, LATER));
    const e = r.draft.entries[0] as DraftEntry;
    expect(e.values.description).toBe('');
    expect(e.captured?.description).toBe('');
    for (const c of r.draft.changes)
      expect(c).toMatchObject({ oldValue: null, newValue: null, redacted: true });
    expect(JSON.stringify(r.draft)).not.toContain('Secret');
  });
  it('refuses a private delete once the day has a revision', () => {
    const r = deleteEntry(day([entry()], { revision: 1 }), E1, { private: true }, NOW);
    expect(r.ok).toBe(false);
  });
});

describe('deriveStatus', () => {
  it('follows the confirmed snapshots', () => {
    expect(deriveStatus(day())).toBe('not-confirmed');
    expect(deriveStatus(day([entry({ confirmed: values() })], { revision: 1 }))).toBe('confirmed');
    expect(deriveStatus(day([entry({ confirmed: values(), deleted: true })], { revision: 1 }))).toBe(
      'changed',
    );
    expect(deriveStatus(day([entry({ confirmed: null, deleted: true })], { revision: 1 }))).toBe('confirmed');
    expect(deriveStatus(day([entry({ confirmed: null })], { revision: 1 }))).toBe('changed');
  });
});

describe('defaultBillable', () => {
  it('is true for retainers and projects only', () => {
    expect(defaultBillable(WI_PROJECT, ITEMS)).toBe(true);
    expect(defaultBillable(WI_INTERNAL, ITEMS)).toBe(false);
    expect(defaultBillable(null, ITEMS)).toBe(false);
    expect(defaultBillable('cccccccccccccccccccccccc', ITEMS)).toBe(false);
  });
});

describe('collapseChanges', () => {
  const upd = (
    entryId: string,
    field: LocalChange['field'],
    oldValue: string,
    newValue: string,
    minute: number,
  ) => ({
    entryId,
    at: new Date(Date.UTC(2026, 10, 20, 9, minute)).toISOString(),
    action: 'update' as const,
    field,
    oldValue,
    newValue,
    redacted: false,
  });

  it('leaves a list that fits alone', () => {
    const list = [upd(E1, 'minutes', '1', '2', 0), upd(E1, 'minutes', '2', '3', 1)];
    expect(collapseChanges(list, () => true)).toEqual(list);
  });

  it('collapses older changes to the same entry and field: first old, last new', () => {
    const list = [
      upd(E1, 'minutes', '1', '2', 0),
      upd(E2, 'minutes', '5', '6', 1),
      upd(E1, 'minutes', '2', '3', 2),
      upd(E1, 'minutes', '3', '4', 3),
    ];
    const out = collapseChanges(list, (c) => c.length <= 2);
    expect(out).toEqual([upd(E2, 'minutes', '5', '6', 1), upd(E1, 'minutes', '1', '4', 3)]);
  });

  it('collapses the oldest groups first and stops once it fits', () => {
    const list = [
      upd(E1, 'minutes', '1', '2', 0),
      upd(E1, 'minutes', '2', '3', 1),
      upd(E2, 'minutes', '5', '6', 2),
      upd(E2, 'minutes', '6', '7', 3),
    ];
    const out = collapseChanges(list, (c) => c.length <= 3);
    expect(out).toEqual([
      upd(E1, 'minutes', '1', '3', 1),
      upd(E2, 'minutes', '5', '6', 2),
      upd(E2, 'minutes', '6', '7', 3),
    ]);
  });

  it('redacted wins in a collapse', () => {
    const list = [
      upd(E1, 'description', 'a', 'b', 0),
      { ...upd(E1, 'description', 'x', 'y', 1), oldValue: null, newValue: null, redacted: true },
      upd(E1, 'description', 'c', 'd', 2),
    ];
    const out = collapseChanges(list, (c) => c.length <= 1);
    expect(out).toEqual([
      { ...upd(E1, 'description', '', '', 2), oldValue: null, newValue: null, redacted: true },
    ]);
  });

  it('drops a collapse that comes back to where it started', () => {
    const list = [
      upd(E1, 'minutes', '1', '2', 0),
      upd(E1, 'minutes', '2', '1', 1),
      upd(E2, 'minutes', '1', '2', 2),
    ];
    expect(collapseChanges(list, (c) => c.length <= 2)).toEqual([upd(E2, 'minutes', '1', '2', 2)]);
  });

  it('drops the oldest changes as a last resort', () => {
    const list = [0, 1, 2, 3].map((i) => ({
      entryId: `0000000${i}-0000-4000-8000-000000000000`,
      at: new Date(Date.UTC(2026, 10, 20, 9, i)).toISOString(),
      action: 'create' as const,
      field: null,
      oldValue: null,
      newValue: null,
      redacted: false,
    }));
    expect(collapseChanges(list, (c) => c.length <= 2)).toEqual(list.slice(2));
  });
});
