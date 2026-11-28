/**
 * My day (plan decisions 11, 19, 20 and 26): the submission for a draft, and the draft after Toolbox
 * answers it. Pure. A failed send keeps the exact body (`pending`) so a retry is a repeat; a conflict
 * merges Toolbox's stored day by entry id and never sends anything by itself.
 */
import {
  type ApplyResultFn,
  type BuildSubmissionFn,
  type DayDraft,
  type DayProblem,
  type DayResult,
  type DaySubmission,
  type DraftEntry,
  type EntryInput,
  type EntryValues,
  LOGGED_FIELDS,
  type LocalChange,
  MAX_CHANGES_PER_SUBMISSION,
  type StoredDay,
  SUBMISSION_VERSION,
  type ToolboxCall,
} from '../../shared/time-contract.ts';
import { changedFields, collapseChanges, deriveStatus, sameValues } from './changes.ts';

/** Toolbox takes 1 MB; Cortex stays under this (decision 10). */
export const SUBMISSION_BYTE_LIMIT = 900 * 1024;
/** Changes older than this are dropped when building (decision 31; Toolbox refuses past 62 days). */
export const CHANGE_MAX_AGE_DAYS = 60;
/** A change time this far ahead of the Mac's clock (the clock was moved back) would be refused: dropped. */
const CHANGE_AHEAD_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export const MSG_CONFLICT =
  'This day was changed somewhere else. Check the entries from Toolbox, then confirm again.';
export const MSG_CONFLICT_UNREAD =
  "This day was changed somewhere else, and Toolbox's copy couldn't be read. Open the day again to see it.";
export const MSG_LOCKED = "This month is closed in Toolbox, so its time can't be changed.";
export const MSG_FORBIDDEN = "Toolbox didn't let this account confirm time.";
const MSG_REFUSED = 'Toolbox refused the day. Check it, then confirm again.';
const NOT_SENT: Record<string, string> = {
  unauthorised: 'The connection to Toolbox has ended. Connect again, then confirm the day.',
  off: "Toolbox isn't taking time just now, so the day wasn't sent. Try again later.",
  'rate-limited': 'Toolbox is busy, so the day wasn’t sent. Try again in a minute.',
  server: 'Toolbox had a problem, so the day wasn’t sent. It’s kept here; try again.',
  network: 'Toolbox couldn’t be reached, so the day wasn’t sent. It’s kept here; try again.',
  'too-large': 'This day is too large for Toolbox to take. Remove some entries, then confirm again.',
  forbidden: MSG_FORBIDDEN,
};

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export function valuesOf(
  e: Pick<EntryInput, 'startAt' | 'minutes' | 'workItemId' | 'description' | 'billable'>,
): EntryValues {
  return {
    startAt: e.startAt === null ? null : new Date(e.startAt).toISOString(),
    minutes: e.minutes,
    workItemId: e.workItemId,
    description: e.description,
    billable: e.billable,
  };
}

function toInput(e: DraftEntry): EntryInput {
  const v = valuesOf(e.values);
  return { id: e.id, ...v, description: v.description.trim(), source: e.source, certainty: e.certainty };
}

/** Changes that fit the limits, given the size of the rest of the body. */
function fitChanges(changes: readonly LocalChange[], restBytes: number): LocalChange[] {
  const size = new Map<LocalChange, number>();
  const sizeOf = (c: LocalChange) => {
    let n = size.get(c);
    if (n === undefined) {
      n = bytes(c) + 1;
      size.set(c, n);
    }
    return n;
  };
  return collapseChanges(changes, (list) => {
    if (list.length > MAX_CHANGES_PER_SUBMISSION) return false;
    let total = restBytes;
    for (const c of list) total += sizeOf(c);
    return total <= SUBMISSION_BYTE_LIMIT;
  });
}

export const buildSubmission: BuildSubmissionFn = (draft, newSubmissionId, now) => {
  if (draft.pending) return draft.pending.body;
  const body: DaySubmission = {
    version: SUBMISSION_VERSION,
    submissionId: newSubmissionId(),
    workDate: draft.workDate,
    baseRevision: draft.revision,
    entries: draft.entries.filter((e) => !e.deleted).map(toInput),
    changes: [],
  };
  if (draft.revision !== 0) return body;
  const oldest = now.getTime() - CHANGE_MAX_AGE_DAYS * DAY_MS;
  const newest = now.getTime() + CHANGE_AHEAD_MS;
  const recent = draft.changes.filter((c) => {
    const at = Date.parse(c.at);
    return at >= oldest && at <= newest;
  });
  return { ...body, changes: fitChanges(recent, bytes(body)) };
};

/** The draft once `body` is about to be sent: kept until Toolbox answers it. */
export function markPending(draft: DayDraft, body: DaySubmission, now: Date): DayDraft {
  return { ...draft, pending: { submissionId: body.submissionId, body }, updatedAt: now.toISOString() };
}

// ─── Merging Toolbox's stored day (decision 20) ────────────────────────────────────────────────────────

const sameSlot = (a: EntryValues, b: EntryValues) =>
  a.startAt !== null && a.startAt === b.startAt && a.minutes === b.minutes;

const untouchedCapture = (e: DraftEntry) =>
  e.captured !== null && !e.deleted && e.edited.length === 0 && e.confirmed === null;

/** Fields where `stored` differs from what capture proposed: the person (or another Mac) changed those. */
function editedAgainst(e: DraftEntry, stored: EntryValues): DraftEntry['edited'] {
  const fromCapture = e.captured ? changedFields(e.captured, stored) : [];
  return LOGGED_FIELDS.filter((f) => e.edited.includes(f) || fromCapture.includes(f));
}

/** The draft's entries joined with the stored day's, by id (union; nothing Toolbox holds disappears). */
function mergeEntries(entries: readonly DraftEntry[], stored: StoredDay): DraftEntry[] {
  const live = stored.entries.filter((s) => !s.deleted);
  const byId = new Map(live.map((s) => [s.id, s]));
  const out: DraftEntry[] = entries.map((e) => {
    const s = byId.get(e.id);
    if (s) {
      const sv = valuesOf(s);
      const localChanged = e.deleted || !sameValues(e.values, e.confirmed ?? sv);
      if (localChanged) return { ...e, confirmed: sv };
      return {
        ...e,
        values: sv,
        source: s.source,
        certainty: s.certainty,
        confirmed: sv,
        edited: editedAgainst(e, sv),
      };
    }
    if (e.confirmed === null) return e;
    // Toolbox held it once and doesn't now: removed elsewhere, unless this Mac has changed it since.
    if (e.deleted || sameValues(e.values, e.confirmed)) return { ...e, deleted: true, confirmed: null };
    return { ...e, confirmed: null };
  });

  const known = new Set(entries.map((e) => e.id));
  for (const s of live) {
    if (known.has(s.id)) continue;
    const sv = valuesOf(s);
    const twin = out.findIndex(
      (e) => untouchedCapture(e) && !byId.has(e.id) && sameSlot(valuesOf(e.values), sv),
    );
    const local = twin >= 0 ? (out[twin] as DraftEntry) : null;
    const joined: DraftEntry = {
      id: s.id,
      source: s.source,
      certainty: s.certainty,
      values: sv,
      captured: local?.captured ?? null,
      edited: local ? editedAgainst(local, sv) : [],
      place: local?.place ?? null,
      missing: false,
      fromToolbox: true,
      confirmed: sv,
      deleted: false,
    };
    if (local) out[twin] = joined;
    else out.push(joined);
  }
  return out;
}

/**
 * Opening a day while connected: Toolbox's stored day is read first and merged in when it is newer than
 * the draft (same rules as a conflict; the change list is dropped once the day has a revision).
 */
export function adoptStoredDay(draft: DayDraft, stored: StoredDay, now: Date): DayDraft {
  if (stored.workDate !== draft.workDate) return draft;
  const at = now.toISOString();
  if (stored.revision <= draft.revision) return { ...draft, storedReadAt: at };
  const next: DayDraft = {
    ...draft,
    entries: mergeEntries(draft.entries, stored),
    revision: stored.revision,
    changes: [],
    storedReadAt: at,
    updatedAt: at,
  };
  return { ...next, status: next.pending ? 'not-sent' : deriveStatus(next) };
}

// ─── Toolbox's answer ──────────────────────────────────────────────────────────────────────────────────

function accepted(draft: DayDraft, body: DaySubmission, revision: number, at: string): DayDraft {
  const sent = new Map(body.entries.map((e) => [e.id, e]));
  const entries = draft.entries.map((e) => {
    const s = sent.get(e.id);
    if (s) return { ...e, confirmed: valuesOf(s) };
    return e.deleted ? { ...e, confirmed: null } : e;
  });
  const next: DayDraft = {
    ...draft,
    entries,
    revision,
    changes: [],
    pending: null,
    problems: [],
    updatedAt: at,
  };
  return { ...next, status: deriveStatus(next) };
}

const ENTRY_PATH = /^entries\[(\d+)\]/;

function mapProblems(body: DaySubmission, problems: readonly DayProblem[], fallback: string) {
  const out: DayDraft['problems'] = [];
  for (const p of problems) {
    const m = ENTRY_PATH.exec(p.path);
    const entryId = m ? (body.entries[Number(m[1])]?.id ?? '') : '';
    const message = typeof p.message === 'string' && p.message.trim() ? p.message.trim() : fallback;
    if (!out.some((o) => o.entryId === entryId && o.message === message)) out.push({ entryId, message });
  }
  return out.length > 0 ? out : [{ entryId: '', message: fallback }];
}

function refused(
  draft: DayDraft,
  body: DaySubmission,
  answer: Extract<DayResult, { ok: false }>,
  at: string,
) {
  const fallback =
    answer.code === 'locked' ? MSG_LOCKED : answer.code === 'forbidden' ? MSG_FORBIDDEN : MSG_REFUSED;
  const problems =
    answer.code === 'locked' || answer.code === 'forbidden'
      ? [{ entryId: '', message: fallback }]
      : mapProblems(body, answer.problems ?? [], fallback);
  const next: DayDraft = { ...draft, pending: null, problems, updatedAt: at };
  return { ...next, status: deriveStatus(next) };
}

function conflicted(draft: DayDraft, stored: StoredDay | null, at: string): DayDraft {
  if (!stored || stored.workDate !== draft.workDate) {
    return {
      ...draft,
      pending: null,
      status: 'conflict',
      problems: [{ entryId: '', message: MSG_CONFLICT_UNREAD }],
      updatedAt: at,
    };
  }
  return {
    ...draft,
    entries: mergeEntries(draft.entries, stored),
    revision: stored.revision,
    changes: [],
    pending: null,
    storedReadAt: at,
    status: 'conflict',
    problems: [{ entryId: '', message: MSG_CONFLICT }],
    updatedAt: at,
  };
}

/** Calls that may have reached Toolbox or will work later keep the exact body for a repeat. */
function keepsBody(result: Extract<ToolboxCall<DayResult>, { ok: false }>): boolean {
  if (result.kind === 'error') return result.code === 'rate_limited' || result.code === 'server_error';
  return result.kind !== 'too-large' && result.kind !== 'forbidden';
}

export const applyResult: ApplyResultFn = (draft, body, result, stored, now) => {
  const at = now.toISOString();
  if (!result.ok) {
    const keep = keepsBody(result);
    const kind = result.kind === 'error' && result.code === 'too_large' ? 'too-large' : result.kind;
    return {
      ...draft,
      pending: keep ? { submissionId: body.submissionId, body } : null,
      status: 'not-sent',
      problems: [{ entryId: '', message: NOT_SENT[kind] ?? MSG_REFUSED }],
      updatedAt: at,
    };
  }
  const answer = result.value;
  if (answer.ok) return accepted(draft, body, answer.revision, at);
  if (answer.code === 'conflict') return conflicted(draft, stored, at);
  return refused(draft, body, answer, at);
};
