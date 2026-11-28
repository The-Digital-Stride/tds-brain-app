/**
 * My day (plan decisions 10 and 21): the person's saves on a draft and the change list they leave.
 * Pure. One `LocalChange` per changed field per save, plus create and delete, values in Toolbox's
 * encodings. Changes are kept only while the day has never been confirmed (revision 0); after that
 * Toolbox logs the differences itself. "Private" removes the wording from this change and every earlier
 * one for the same entry and field, and is refused once the day has a revision.
 */
import { randomUUID } from 'node:crypto';
import {
  type DayDraft,
  type DayStatus,
  type DraftEntry,
  type EntryPatchRequest,
  type EntryValues,
  LOGGED_FIELDS,
  type LocalChange,
  type LoggedField,
  MINUTES_PER_DAY,
  type WireWorkItem,
} from '../../shared/time-contract.ts';
import { londonDate, parseInstant } from './day-store.ts';

export const MSG_ENTRY_NOT_FOUND = "That entry isn't in this day any more.";
export const MSG_PRIVATE_TOO_LATE =
  "Toolbox already holds the earlier wording, so it can't be removed here. An admin can remove it later.";
export const MSG_PRIVATE_PENDING =
  "A send is waiting with the earlier wording, so it can't be removed here. An admin can remove it from Toolbox later.";

/**
 * Private removal is honest only while nothing holding the wording has left or is waiting to leave: the day
 * was never confirmed AND no send is pending (a pending body is resent unchanged, decision 19).
 */
export function privateAllowed(draft: DayDraft): boolean {
  return draft.revision === 0 && draft.pending === null;
}

function privateRefusal(draft: DayDraft): EditResult | null {
  if (draft.revision !== 0) return refuse('bad-request', MSG_PRIVATE_TOO_LATE);
  if (draft.pending !== null) return refuse('bad-request', MSG_PRIVATE_PENDING);
  return null;
}
const MSG_MINUTES = `Minutes must be a whole number from 1 to ${MINUTES_PER_DAY}.`;
const MSG_START = 'The start time must be a time on this day (UK time), or empty.';
const MSG_WORK_ITEM = "That work item isn't one Toolbox would know.";
const MSG_DESCRIPTION = 'The description must be text.';
const MSG_BILLABLE = 'Billable must be yes or no.';

const WORK_ITEM_ID = /^[0-9a-f]{24}$/;

export type EditResult =
  | { ok: true; draft: DayDraft; entry: DraftEntry }
  | { ok: false; code: 'bad-request' | 'not-found'; message: string };

const refuse = (code: 'bad-request' | 'not-found', message: string): EditResult => ({
  ok: false,
  code,
  message,
});

// ─── Values ────────────────────────────────────────────────────────────────────────────────────────────

/** Toolbox's one encoding of a logged value: digits, `toISOString()`, `true`/`false`, the id, trimmed text. */
export function encodeValue(field: LoggedField, v: EntryValues): string | null {
  switch (field) {
    case 'description':
      return v.description.trim();
    case 'workItemId':
      return v.workItemId;
    case 'startAt':
      return v.startAt === null ? null : new Date(v.startAt).toISOString();
    case 'minutes':
      return String(v.minutes);
    case 'billable':
      return v.billable ? 'true' : 'false';
  }
}

export function changedFields(before: EntryValues, after: EntryValues): LoggedField[] {
  return LOGGED_FIELDS.filter((f) => encodeValue(f, before) !== encodeValue(f, after));
}

export const sameValues = (a: EntryValues, b: EntryValues): boolean => changedFields(a, b).length === 0;

/** Billable by default for retainer and project items; internal, unknown and unassigned are not. */
export function defaultBillable(workItemId: string | null, workItems: readonly WireWorkItem[]): boolean {
  if (workItemId === null) return false;
  const kind = workItems.find((w) => w.id === workItemId)?.kind;
  return kind === 'retainer' || kind === 'project';
}

/** The values checked and normalised (trimmed text, `toISOString()` start), or a plain message. */
export function checkValues(raw: EntryValues, workDate: string): EntryValues | string {
  if (typeof raw.description !== 'string') return MSG_DESCRIPTION;
  if (!Number.isSafeInteger(raw.minutes) || raw.minutes < 1 || raw.minutes > MINUTES_PER_DAY)
    return MSG_MINUTES;
  let startAt: string | null = null;
  if (raw.startAt !== null) {
    const at = parseInstant(raw.startAt);
    if (!at || londonDate(at) !== workDate) return MSG_START;
    startAt = at.toISOString();
  }
  if (raw.workItemId !== null && !(typeof raw.workItemId === 'string' && WORK_ITEM_ID.test(raw.workItemId))) {
    return MSG_WORK_ITEM;
  }
  if (typeof raw.billable !== 'boolean') return MSG_BILLABLE;
  return {
    startAt,
    minutes: raw.minutes,
    workItemId: raw.workItemId,
    description: raw.description.trim(),
    billable: raw.billable,
  };
}

// ─── Status ────────────────────────────────────────────────────────────────────────────────────────────

/** Differs from what Toolbox last accepted (a live entry never confirmed counts; a removed one never sent doesn't). */
export function changedSinceConfirmed(e: DraftEntry): boolean {
  if (e.deleted) return e.confirmed !== null;
  return e.confirmed === null || !sameValues(e.values, e.confirmed);
}

/** Status from the entries alone: never confirmed, confirmed, or changed since confirmed. */
export function deriveStatus(draft: DayDraft): DayStatus {
  if (draft.revision === 0) return 'not-confirmed';
  return draft.entries.some(changedSinceConfirmed) ? 'changed' : 'confirmed';
}

/** After an edit: "Not sent" and "Conflict" stay until the next confirm answers; otherwise derived. */
export function statusAfterEdit(draft: DayDraft): DayStatus {
  return draft.status === 'not-sent' || draft.status === 'conflict' ? draft.status : deriveStatus(draft);
}

// ─── Changes ───────────────────────────────────────────────────────────────────────────────────────────

export interface SaveInput {
  entryId: string;
  /** Null for a create. */
  before: EntryValues | null;
  /** Null for a delete. */
  after: EntryValues | null;
  at: Date;
  /** "This removes private detail" (description) or "Remove as private" (delete). */
  private?: boolean;
}

const change = (
  entryId: string,
  at: Date,
  action: LocalChange['action'],
  field: LoggedField | null = null,
  oldValue: string | null = null,
  newValue: string | null = null,
  redacted = false,
): LocalChange => ({ entryId, at: at.toISOString(), action, field, oldValue, newValue, redacted });

/** The changes one save makes. A private edit redacts the description change; a private delete is redacted. */
export function changesForSave(input: SaveInput): LocalChange[] {
  const { entryId, before, after, at } = input;
  const priv = input.private === true;
  if (before === null) return after === null ? [] : [change(entryId, at, 'create')];
  if (after === null) return [change(entryId, at, 'delete', null, null, null, priv)];
  return changedFields(before, after).map((field) =>
    priv && field === 'description'
      ? change(entryId, at, 'update', field, null, null, true)
      : change(entryId, at, 'update', field, encodeValue(field, before), encodeValue(field, after)),
  );
}

/** Earlier changes of an entry (one field, or all of them for `null`) with their wording removed. */
function scrub(changes: readonly LocalChange[], entryId: string, field: LoggedField | null): LocalChange[] {
  return changes.map((c) =>
    c.entryId === entryId && (field === null || c.field === field)
      ? { ...c, oldValue: null, newValue: null, redacted: true }
      : c,
  );
}

/** The draft's change list after a save: unchanged once the day has a revision. */
export function recordSave(draft: DayDraft, input: SaveInput): LocalChange[] {
  if (draft.revision !== 0) return draft.changes;
  let list = draft.changes;
  if (input.private) list = scrub(list, input.entryId, input.after === null ? null : 'description');
  return [...list, ...changesForSave(input)];
}

const groupKey = (c: LocalChange) => `${c.entryId}\u0000${c.field}`;

/**
 * Shrinks the list until `fits` says yes (decision 10): updates to the same entry and field collapse, oldest
 * group first, into one change with the first old value and the last new value at the last change's time
 * and place in the list; redacted wins; a collapse that ends where it began is dropped. If it still doesn't
 * fit, the oldest changes go.
 */
export function collapseChanges(
  changes: readonly LocalChange[],
  fits: (list: LocalChange[]) => boolean,
): LocalChange[] {
  let list: Array<LocalChange | null> = [...changes];
  const current = () => list.filter((c): c is LocalChange => c !== null);
  if (fits(current())) return current();

  const groups = new Map<string, number[]>();
  list.forEach((c, i) => {
    if (c?.action !== 'update') return;
    const key = groupKey(c);
    const at = groups.get(key);
    if (at) at.push(i);
    else groups.set(key, [i]);
  });
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const members = indexes.map((i) => list[i] as LocalChange);
    const first = members[0] as LocalChange;
    const last = members[members.length - 1] as LocalChange;
    const redacted = members.some((c) => c.redacted);
    const merged: LocalChange = {
      ...last,
      oldValue: redacted ? null : first.oldValue,
      newValue: redacted ? null : last.newValue,
      redacted,
    };
    const keep = redacted || merged.oldValue !== merged.newValue;
    list = list.map((c, i) => (indexes.includes(i) ? null : c));
    if (keep) list[indexes[indexes.length - 1] as number] = merged;
    if (fits(current())) return current();
  }
  const rest = current();
  while (rest.length > 0 && !fits(rest)) rest.shift();
  return rest;
}

// ─── The person's saves ────────────────────────────────────────────────────────────────────────────────

function withEntries(draft: DayDraft, entries: DraftEntry[], changes: LocalChange[], now: Date): DayDraft {
  const next = { ...draft, entries, changes, updatedAt: now.toISOString() };
  return { ...next, status: statusAfterEdit(next) };
}

/** Add entry: a manual entry with a new lower-case UUID. */
export function addEntry(
  draft: DayDraft,
  raw: EntryValues,
  now: Date,
  newId: () => string = randomUUID,
): EditResult {
  const checked = checkValues(raw, draft.workDate);
  if (typeof checked === 'string') return refuse('bad-request', checked);
  const entry: DraftEntry = {
    id: newId().toLowerCase(),
    source: 'manual',
    certainty: checked.workItemId === null ? 'unassigned' : 'manual',
    values: checked,
    captured: null,
    edited: [],
    place: null,
    missing: false,
    fromToolbox: false,
    confirmed: null,
    deleted: false,
  };
  const changes = recordSave(draft, { entryId: entry.id, before: null, after: checked, at: now });
  return { ok: true, draft: withEntries(draft, [...draft.entries, entry], changes, now), entry };
}

/**
 * Change an entry: only the fields given. Picking a work item makes it `manual` and, unless billable is
 * given too, sets billable from the item's kind. `remember` is the caller's (links.ts).
 */
export function editEntry(
  draft: DayDraft,
  id: string,
  patch: EntryPatchRequest,
  workItems: readonly WireWorkItem[],
  now: Date,
): EditResult {
  const index = draft.entries.findIndex((e) => e.id === id && !e.deleted);
  const current = draft.entries[index];
  if (!current) return refuse('not-found', MSG_ENTRY_NOT_FOUND);
  if (patch.privateEdit) {
    const refused = privateRefusal(draft);
    if (refused) return refused;
  }

  const pickedItem = patch.workItemId !== undefined && patch.workItemId !== current.values.workItemId;
  const raw: EntryValues = {
    startAt: patch.startAt !== undefined ? patch.startAt : current.values.startAt,
    minutes: patch.minutes !== undefined ? patch.minutes : current.values.minutes,
    workItemId: patch.workItemId !== undefined ? patch.workItemId : current.values.workItemId,
    description: patch.description !== undefined ? patch.description : current.values.description,
    billable:
      patch.billable !== undefined
        ? patch.billable
        : pickedItem
          ? defaultBillable(patch.workItemId ?? null, workItems)
          : current.values.billable,
  };
  const checked = checkValues(raw, draft.workDate);
  if (typeof checked === 'string') return refuse('bad-request', checked);

  const fields = changedFields(current.values, checked);
  const entry: DraftEntry = {
    ...current,
    values: checked,
    certainty: pickedItem ? 'manual' : current.certainty,
    edited: LOGGED_FIELDS.filter((f) => current.edited.includes(f) || fields.includes(f)),
  };
  const changes = recordSave(draft, {
    entryId: id,
    before: current.values,
    after: checked,
    at: now,
    private: patch.privateEdit === true,
  });
  const entries = draft.entries.map((e, i) => (i === index ? entry : e));
  return { ok: true, draft: withEntries(draft, entries, changes, now), entry };
}

/**
 * Remove an entry. It stays in the draft (`deleted`), so capture never brings it back and Toolbox is told.
 * "Remove as private" also clears its wording here and in every earlier change.
 */
export function deleteEntry(draft: DayDraft, id: string, opts: { private?: boolean }, now: Date): EditResult {
  const index = draft.entries.findIndex((e) => e.id === id && !e.deleted);
  const current = draft.entries[index];
  if (!current) return refuse('not-found', MSG_ENTRY_NOT_FOUND);
  const priv = opts.private === true;
  if (priv) {
    const refused = privateRefusal(draft);
    if (refused) return refused;
  }

  const entry: DraftEntry = priv
    ? {
        ...current,
        deleted: true,
        values: { ...current.values, description: '' },
        captured: current.captured ? { ...current.captured, description: '' } : null,
        confirmed: current.confirmed ? { ...current.confirmed, description: '' } : null,
      }
    : { ...current, deleted: true };
  const changes = recordSave(draft, {
    entryId: id,
    before: current.values,
    after: null,
    at: now,
    private: priv,
  });
  const entries = draft.entries.map((e, i) => (i === index ? entry : e));
  return { ok: true, draft: withEntries(draft, entries, changes, now), entry };
}
