import { describe, expect, it } from 'vitest';
import {
  type DayDraft,
  type DayResult,
  type DraftEntry,
  type EntryValues,
  type LocalChange,
  MAX_CHANGES_PER_SUBMISSION,
  type StoredDay,
  type StoredEntry,
  type ToolboxCall,
} from '../../shared/time-contract.ts';
import { emptyDraft } from './day-store.ts';
import {
  adoptStoredDay,
  applyResult,
  buildSubmission,
  markPending,
  SUBMISSION_BYTE_LIMIT,
} from './submit.ts';

const NOW = new Date('2026-11-20T18:00:00.000Z');
const DATE = '2026-11-20';
const SUB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUB2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WI = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const values = (over: Partial<EntryValues> = {}): EntryValues => ({
  startAt: '2026-11-20T09:00:00.000Z',
  minutes: 30,
  workItemId: null,
  description: 'Planning',
  billable: false,
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

function captured(n: number, v: EntryValues, over: Partial<DraftEntry> = {}): DraftEntry {
  return entry(n, {
    source: 'cortex-chat',
    certainty: 'unassigned',
    values: v,
    captured: {
      ...v,
      chatId: 'chat-a',
      captureKey: 'k',
      endAt: '2026-11-20T09:30:00.000Z',
      claudeMinutes: 3,
      prompts: 2,
    },
    place: { client: 'acme', project: null },
    ...over,
  });
}

const day = (entries: DraftEntry[], over: Partial<DayDraft> = {}): DayDraft => ({
  ...emptyDraft(DATE, NOW),
  entries,
  ...over,
});

const change = (entryId: string, over: Partial<LocalChange> = {}): LocalChange => ({
  entryId,
  at: '2026-11-20T10:00:00.000Z',
  action: 'create',
  field: null,
  oldValue: null,
  newValue: null,
  redacted: false,
  ...over,
});

function storedEntry(n: number, v: EntryValues, over: Partial<StoredEntry> = {}): StoredEntry {
  return {
    id: id(n),
    ...v,
    source: 'manual',
    certainty: 'manual',
    personId: 'p',
    workDate: DATE,
    deleted: false,
    ...over,
  };
}
const storedDay = (revision: number, entries: StoredEntry[]): StoredDay => ({
  personId: 'p',
  workDate: DATE,
  revision,
  entries,
});

const okCall = (value: DayResult): ToolboxCall<DayResult> => ({ ok: true, value });

describe('buildSubmission', () => {
  it('sends live entries with their changes while never confirmed', () => {
    const d = day(
      [
        entry(1, { values: values({ description: '  Planning ', startAt: '2026-11-20T09:00:00+00:00' }) }),
        entry(2, { deleted: true }),
      ],
      { changes: [change(id(1)), change(id(2)), change(id(2), { action: 'delete' })] },
    );
    const body = buildSubmission(d, () => SUB, NOW);
    expect(body).toEqual({
      version: 1,
      submissionId: SUB,
      workDate: DATE,
      baseRevision: 0,
      entries: [
        {
          id: id(1),
          startAt: '2026-11-20T09:00:00.000Z',
          minutes: 30,
          workItemId: null,
          description: 'Planning',
          billable: false,
          source: 'manual',
          certainty: 'manual',
        },
      ],
      changes: d.changes,
    });
  });

  it('sends no changes once the day has a revision', () => {
    const d = day([entry(1)], { revision: 4, changes: [change(id(1))] });
    const body = buildSubmission(d, () => SUB, NOW);
    expect(body.baseRevision).toBe(4);
    expect(body.changes).toEqual([]);
  });

  it('a pending body is sent again unchanged', () => {
    const pendingBody = buildSubmission(day([entry(1)]), () => SUB, NOW);
    const d = markPending(day([entry(1, { values: values({ minutes: 99 }) })]), pendingBody, NOW);
    expect(d.pending).toEqual({ submissionId: SUB, body: pendingBody });
    expect(buildSubmission(d, () => SUB2, NOW)).toBe(pendingBody);
  });

  it('drops changes more than 60 days old or ahead of the clock', () => {
    const old = change(id(1), { at: '2026-09-20T10:00:00.000Z' });
    const ahead = change(id(1), { at: '2026-11-20T18:30:00.000Z', action: 'delete' });
    const fine = change(id(1), { at: '2026-10-01T10:00:00.000Z' });
    const body = buildSubmission(day([entry(1)], { changes: [old, fine, ahead] }), () => SUB, NOW);
    expect(body.changes).toEqual([fine]);
  });

  it('collapses changes to fit the count limit', () => {
    const many: LocalChange[] = [];
    for (let i = 0; i < MAX_CHANGES_PER_SUBMISSION + 500; i++) {
      many.push(
        change(id(1), {
          action: 'update',
          field: 'minutes',
          oldValue: String((i % 1000) + 1),
          newValue: String(((i + 1) % 1000) + 1),
        }),
      );
    }
    const body = buildSubmission(day([entry(1)], { changes: many }), () => SUB, NOW);
    expect(body.changes.length).toBeLessThanOrEqual(MAX_CHANGES_PER_SUBMISSION);
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({ oldValue: '1', newValue: String((2500 % 1000) + 1) });
  });

  it('keeps the body under 900 KB', () => {
    const long = 'x'.repeat(1000);
    const many: LocalChange[] = [];
    for (let i = 0; i < 1500; i++) {
      many.push(
        change(id(i % 200), {
          action: 'update',
          field: 'description',
          oldValue: `${long}${i}`,
          newValue: `${long}${i + 1}`,
        }),
      );
    }
    const entries = Array.from({ length: 200 }, (_, i) =>
      entry(i, { values: values({ description: long }) }),
    );
    const body = buildSubmission(day(entries, { changes: many }), () => SUB, NOW);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(SUBMISSION_BYTE_LIMIT);
    expect(body.changes.length).toBeGreaterThan(0);
  });
});

describe('applyResult', () => {
  const sent = (d: DayDraft) => {
    const body = buildSubmission(d, () => SUB, NOW);
    return { body, draft: markPending(d, body, NOW) };
  };

  it('ok: revision set, snapshots taken, changes and pending cleared, confirmed', () => {
    const { body, draft } = sent(day([entry(1), entry(2, { deleted: true })], { changes: [change(id(1))] }));
    const out = applyResult(draft, body, okCall({ ok: true, revision: 1, repeated: false }), null, NOW);
    expect(out.revision).toBe(1);
    expect(out.status).toBe('confirmed');
    expect(out.changes).toEqual([]);
    expect(out.pending).toBeNull();
    expect(out.problems).toEqual([]);
    expect(out.entries[0]?.confirmed).toEqual(values());
    expect(out.entries[1]).toMatchObject({ deleted: true, confirmed: null });
  });

  it('ok after a repeat is the same', () => {
    const { body, draft } = sent(day([entry(1)]));
    const out = applyResult(draft, body, okCall({ ok: true, revision: 2, repeated: true }), null, NOW);
    expect(out).toMatchObject({ revision: 2, status: 'confirmed', pending: null });
  });

  it('ok with edits made since the body was built: changed', () => {
    const { body, draft } = sent(day([entry(1), entry(3)]));
    const edited: DayDraft = {
      ...draft,
      entries: [
        { ...(draft.entries[0] as DraftEntry), values: values({ minutes: 45 }) },
        { ...(draft.entries[1] as DraftEntry), deleted: true },
        entry(2),
      ],
    };
    const out = applyResult(edited, body, okCall({ ok: true, revision: 1, repeated: false }), null, NOW);
    expect(out.status).toBe('changed');
    expect(out.entries[0]?.confirmed).toEqual(values());
    expect(out.entries[1]?.confirmed).toEqual(values());
    expect(out.entries[2]?.confirmed).toBeNull();
  });

  it('invalid: problems mapped to entries through the body, pending cleared', () => {
    const { body, draft } = sent(day([entry(1), entry(2)]));
    const out = applyResult(
      draft,
      body,
      okCall({
        ok: false,
        code: 'invalid',
        problems: [
          { path: 'entries[1].billable', message: 'Billable time needs a client or project.' },
          { path: 'changes[0].at', message: 'The change time is ahead of the server’s clock.' },
        ],
      }),
      null,
      NOW,
    );
    expect(out.pending).toBeNull();
    expect(out.status).toBe('not-confirmed');
    expect(out.problems).toEqual([
      { entryId: id(2), message: 'Billable time needs a client or project.' },
      { entryId: '', message: 'The change time is ahead of the server’s clock.' },
    ]);
  });

  it('locked and forbidden: a day problem, pending cleared', () => {
    for (const code of ['locked', 'forbidden'] as const) {
      const { body, draft } = sent(day([entry(1)]));
      const out = applyResult(draft, body, okCall({ ok: false, code, problems: [] }), null, NOW);
      expect(out.pending).toBeNull();
      expect(out.problems).toHaveLength(1);
      expect(out.problems[0]?.entryId).toBe('');
    }
  });

  it('401, network, server, rate limit and tool off keep the exact body and say not sent', () => {
    for (const kind of ['unauthorised', 'network', 'server', 'rate-limited', 'off'] as const) {
      const { body, draft } = sent(day([entry(1)]));
      const out = applyResult(draft, body, { ok: false, kind }, null, NOW);
      expect(out.pending).toEqual({ submissionId: SUB, body });
      expect(out.status).toBe('not-sent');
      expect(out.problems).toHaveLength(1);
      expect(buildSubmission(out, () => SUB2, NOW)).toBe(body);
    }
  });

  it('too large or refused outright: pending cleared so the next confirm rebuilds', () => {
    const calls: ToolboxCall<DayResult>[] = [
      { ok: false, kind: 'too-large' },
      { ok: false, kind: 'error', code: 'invalid_request', status: 400 },
    ];
    for (const call of calls) {
      const { body, draft } = sent(day([entry(1)]));
      const out = applyResult(draft, body, call, null, NOW);
      expect(out.pending).toBeNull();
      expect(out.status).toBe('not-sent');
    }
  });

  describe('conflict', () => {
    const conflict = okCall({ ok: false, code: 'conflict', problems: [] });

    it('unions with the stored day: stored-only entries join from Toolbox', () => {
      const { body, draft } = sent(day([entry(1)], { changes: [change(id(1))] }));
      const stored = storedDay(3, [
        storedEntry(9, values({ startAt: '2026-11-20T14:00:00.000Z', minutes: 60 })),
      ]);
      const out = applyResult(draft, body, conflict, stored, NOW);
      expect(out.revision).toBe(3);
      expect(out.changes).toEqual([]);
      expect(out.pending).toBeNull();
      expect(out.status).toBe('conflict');
      expect(out.problems[0]?.entryId).toBe('');
      expect(out.entries.map((e) => e.id)).toEqual([id(1), id(9)]);
      expect(out.entries[1]).toMatchObject({
        fromToolbox: true,
        confirmed: values({ startAt: '2026-11-20T14:00:00.000Z', minutes: 60 }),
      });
    });

    it('where both hold an entry, local values win only if changed since confirmed', () => {
      const d = day(
        [
          entry(1, { confirmed: values(), values: values({ minutes: 45 }) }),
          entry(2, { confirmed: values() }),
          entry(3, { confirmed: values(), deleted: true }),
        ],
        { revision: 1 },
      );
      const { body, draft } = sent(d);
      const elsewhere = values({ description: 'From the other Mac' });
      const stored = storedDay(2, [
        storedEntry(1, elsewhere),
        storedEntry(2, elsewhere),
        storedEntry(3, elsewhere),
      ]);
      const out = applyResult(draft, body, conflict, stored, NOW);
      expect(out.entries[0]).toMatchObject({ values: values({ minutes: 45 }), confirmed: elsewhere });
      expect(out.entries[1]).toMatchObject({ values: elsewhere, confirmed: elsewhere });
      expect(out.entries[2]).toMatchObject({ deleted: true, confirmed: elsewhere });
    });

    it('an untouched captured entry with the same start and length as a stored one is replaced by it', () => {
      const v = values({ startAt: '2026-11-20T09:00:00.000Z', minutes: 30, description: '' });
      const { body, draft } = sent(day([captured(1, v)]));
      const stored = storedDay(1, [
        storedEntry(
          7,
          values({ startAt: '2026-11-20T09:00:00+00:00', minutes: 30, description: 'Acme call' }),
          {
            source: 'cortex-chat',
          },
        ),
      ]);
      const out = applyResult(draft, body, conflict, stored, NOW);
      expect(out.entries).toHaveLength(1);
      expect(out.entries[0]).toMatchObject({
        id: id(7),
        fromToolbox: true,
        values: values({ minutes: 30, description: 'Acme call' }),
        edited: ['description'],
      });
      expect(out.entries[0]?.captured?.chatId).toBe('chat-a');
    });

    it('a touched captured entry is not replaced', () => {
      const v = values({ description: '' });
      const { body, draft } = sent(day([captured(1, v, { edited: ['description'] })]));
      const stored = storedDay(1, [storedEntry(7, values())]);
      const out = applyResult(draft, body, conflict, stored, NOW);
      expect(out.entries.map((e) => e.id)).toEqual([id(1), id(7)]);
    });

    it('a confirmed entry Toolbox no longer holds: removed if untouched, kept if changed', () => {
      const d = day(
        [
          entry(1, { confirmed: values() }),
          entry(2, { confirmed: values(), values: values({ minutes: 50 }) }),
        ],
        { revision: 1 },
      );
      const { body, draft } = sent(d);
      const out = applyResult(
        draft,
        body,
        conflict,
        storedDay(2, [storedEntry(5, values(), { deleted: true })]),
        NOW,
      );
      expect(out.entries[0]).toMatchObject({ deleted: true, confirmed: null });
      expect(out.entries[1]).toMatchObject({
        deleted: false,
        confirmed: null,
        values: values({ minutes: 50 }),
      });
      expect(out.entries).toHaveLength(2);
    });

    it('without the stored day it says so and clears the pending body', () => {
      const { body, draft } = sent(day([entry(1)]));
      const out = applyResult(draft, body, conflict, null, NOW);
      expect(out.status).toBe('conflict');
      expect(out.pending).toBeNull();
      expect(out.revision).toBe(0);
    });
  });
});

describe('adoptStoredDay', () => {
  it('a never-confirmed stored day only notes the read', () => {
    const d = day([entry(1)], { changes: [change(id(1))] });
    const out = adoptStoredDay(d, storedDay(0, []), NOW);
    expect(out).toEqual({ ...d, storedReadAt: NOW.toISOString() });
  });

  it('at local revision 0 a confirmed stored day is merged in (a lost draft gets no duplicates)', () => {
    const v = values({ description: '' });
    const d = day([captured(1, v), entry(2)], { changes: [change(id(1)), change(id(2))] });
    const stored = storedDay(2, [
      storedEntry(7, values({ description: 'Acme call' })),
      storedEntry(8, values({ minutes: 5 })),
    ]);
    const out = adoptStoredDay(d, stored, NOW);
    expect(out.revision).toBe(2);
    expect(out.changes).toEqual([]);
    expect(out.entries.map((e) => e.id)).toEqual([id(7), id(2), id(8)]);
    expect(out.status).toBe('changed');
    expect(out.storedReadAt).toBe(NOW.toISOString());
  });

  it('ignores a stored day for another date', () => {
    const d = day([entry(1)]);
    expect(adoptStoredDay(d, { ...storedDay(3, []), workDate: '2026-11-19' }, NOW)).toBe(d);
  });

  it('a work item edited elsewhere comes through on an untouched entry', () => {
    const d = day([entry(1, { confirmed: values() })], { revision: 1, status: 'confirmed' });
    const out = adoptStoredDay(
      d,
      storedDay(2, [storedEntry(1, values({ workItemId: WI, billable: true }))]),
      NOW,
    );
    expect(out.entries[0]?.values).toEqual(values({ workItemId: WI, billable: true }));
    expect(out.status).toBe('confirmed');
  });
});
