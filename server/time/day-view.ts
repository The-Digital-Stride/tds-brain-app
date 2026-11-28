/**
 * My day (contract §4, decisions 12, 21, 26): the day as the screen shows it. Pure.
 * Evidence says "Cortex chat: <project title or client name>", never a chat's title or id.
 */
import {
  type ChatPlace,
  type DayDraft,
  type DayEntryView,
  type DayView,
  type DraftEntry,
  MAX_DESCRIPTION_LENGTH,
  MAX_ENTRIES_PER_DAY,
  MINUTES_PER_DAY,
  type WireWorkItem,
} from '../../shared/time-contract.ts';
import { londonDate, londonDayBounds } from './day-store.ts';

const MIN = 60_000;
/** Gaps longer than this between entries are shown. */
export const GAP_MINUTES = 15;

export const BLOCK_NOT_CONNECTED = 'Connect to Toolbox to confirm this day.';
export const BLOCK_FUTURE = "You can't confirm a day that hasn't happened yet.";
export const BLOCK_TOO_MANY = `A day can have at most ${MAX_ENTRIES_PER_DAY} entries. Remove some, then confirm.`;
export const BLOCK_BILLABLE = 'Billable time needs a client or project. Check the marked entries.';
export const BLOCK_CLOSED = "An entry uses a work item that's closed in Toolbox. Pick another for it.";
export const BLOCK_DESCRIPTION = `A description is longer than ${MAX_DESCRIPTION_LENGTH} characters. Shorten it, then confirm.`;
export const BLOCK_CROSSES = 'An entry runs past midnight. Shorten it so it ends on this day.';
export const BLOCK_TOO_LONG = 'The day adds up to more than 24 hours. Check the times.';

const P_BILLABLE = 'Billable time needs a client or project.';
const P_CLOSED = 'This work item is closed in Toolbox. Pick another.';
const P_DESCRIPTION = `The description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`;
const P_CROSSES = 'This entry runs past midnight. Shorten it so it ends on this day.';
const P_MISSING = 'Your chats no longer show this time. Check it before you confirm.';
const missingNote = (n: number) =>
  n === 1
    ? '1 entry is no longer found in your chats. Check it before you confirm.'
    : `${n} entries are no longer found in your chats. Check them before you confirm.`;

export interface DayViewOptions {
  connected: boolean;
  /** From capture (transcript-times), passed through. */
  captureNotes?: string[];
  /** Whether `workItems` is a real list (fetched or cached). Defaults to "it has items". */
  workItemsKnown?: boolean;
}

export type LabelFor = (place: ChatPlace) => string | null;

const startMs = (e: DraftEntry) => (e.values.startAt === null ? null : Date.parse(e.values.startAt));

function byTime(a: DraftEntry, b: DraftEntry): number {
  const sa = startMs(a);
  const sb = startMs(b);
  if (sa === null || sb === null) return sa === sb ? 0 : sa === null ? 1 : -1;
  return sa - sb;
}

export function dayView(
  draft: DayDraft,
  workItems: readonly WireWorkItem[],
  labelFor: LabelFor,
  now: Date,
  opts: DayViewOptions,
): DayView {
  const known = opts.workItemsKnown ?? workItems.length > 0;
  const listed = new Set(workItems.map((w) => w.id));
  const dayEnd = londonDayBounds(draft.workDate).end;
  const live = draft.entries.filter((e) => !e.deleted).sort(byTime);

  const flags = { billable: false, closed: false, description: false, crosses: false };
  let missing = 0;
  const ids = new Set(live.map((e) => e.id));

  const entries = live.map((e): DayEntryView => {
    const v = e.values;
    const start = startMs(e);
    const end = start === null ? null : start + v.minutes * MIN;
    const closed = known && v.workItemId !== null && !listed.has(v.workItemId);
    // Toolbox lets confirmed time keep an archived item (decision 26).
    const closedBlocks = closed && (e.confirmed === null || e.confirmed.workItemId !== v.workItemId);
    const problems = draft.problems.filter((p) => p.entryId === e.id).map((p) => p.message);
    const add = (message: string) => {
      if (!problems.includes(message)) problems.push(message);
    };
    if (v.billable && v.workItemId === null) {
      flags.billable = true;
      add(P_BILLABLE);
    }
    if (closedBlocks) {
      flags.closed = true;
      add(P_CLOSED);
    }
    if (v.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      flags.description = true;
      add(P_DESCRIPTION);
    }
    if (end !== null && end > dayEnd) {
      flags.crosses = true;
      add(P_CROSSES);
    }
    if (e.missing) {
      missing++;
      add(P_MISSING);
    }
    const placeLabel = e.place ? labelFor(e.place) : null;
    const fromChat = e.source === 'cortex-chat' || e.captured !== null;
    return {
      id: e.id,
      source: e.source,
      certainty: e.certainty,
      values: v,
      endAt: end === null ? null : new Date(end).toISOString(),
      edited: e.edited,
      evidence: fromChat ? (placeLabel ? `Cortex chat: ${placeLabel}` : 'Cortex chat') : null,
      claudeMinutes: e.captured ? e.captured.claudeMinutes : null,
      missing: e.missing,
      fromToolbox: e.fromToolbox,
      placeLabel,
      workItemClosed: closed,
      problems,
    };
  });

  const totalsMap = new Map<
    string | null,
    { workItemId: string | null; minutes: number; billableMinutes: number }
  >();
  let totalMinutes = 0;
  for (const e of live) {
    const key = e.values.workItemId;
    const row = totalsMap.get(key) ?? { workItemId: key, minutes: 0, billableMinutes: 0 };
    row.minutes += e.values.minutes;
    if (e.values.billable) row.billableMinutes += e.values.minutes;
    totalsMap.set(key, row);
    totalMinutes += e.values.minutes;
  }
  const totals = [...totalsMap.values()].sort(
    (a, b) => b.minutes - a.minutes || (a.workItemId ?? '￿').localeCompare(b.workItemId ?? '￿'),
  );

  const gaps: DayView['gaps'] = [];
  let reach: number | null = null;
  for (const e of live) {
    const start = startMs(e);
    if (start === null) continue;
    if (reach !== null && start - reach > GAP_MINUTES * MIN) {
      gaps.push({ startAt: new Date(reach).toISOString(), minutes: Math.round((start - reach) / MIN) });
    }
    const end = start + e.values.minutes * MIN;
    reach = reach === null ? end : Math.max(reach, end);
  }

  const dayProblems = draft.problems
    .filter((p) => p.entryId === '' || !ids.has(p.entryId))
    .map((p) => p.message);
  if (missing > 0) dayProblems.push(missingNote(missing));

  let confirmBlocked: string | null = null;
  if (!opts.connected) confirmBlocked = BLOCK_NOT_CONNECTED;
  else if (draft.workDate > londonDate(now)) confirmBlocked = BLOCK_FUTURE;
  else if (!draft.pending) {
    // A waiting send goes again exactly as it was, so only the connection can stop it.
    if (live.length > MAX_ENTRIES_PER_DAY) confirmBlocked = BLOCK_TOO_MANY;
    else if (flags.billable) confirmBlocked = BLOCK_BILLABLE;
    else if (flags.closed) confirmBlocked = BLOCK_CLOSED;
    else if (flags.description) confirmBlocked = BLOCK_DESCRIPTION;
    else if (flags.crosses) confirmBlocked = BLOCK_CROSSES;
    else if (totalMinutes > MINUTES_PER_DAY) confirmBlocked = BLOCK_TOO_LONG;
  }

  return {
    workDate: draft.workDate,
    status: draft.status,
    revision: draft.revision,
    entries,
    totalMinutes,
    totals,
    gaps,
    dayProblems,
    confirmBlocked,
    captureNotes: opts.captureNotes ?? [],
    privateAllowed: draft.revision === 0,
  };
}
