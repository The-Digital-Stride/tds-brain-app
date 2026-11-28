/**
 * My day (plan decisions 9, 18, 28): refreshing capture into the draft. Pure.
 *
 * Blocks are matched to entries by chat and overlap of the captured interval, never by `captureKey`.
 * - An entry whose times the person hasn't changed (no `startAt` or `minutes` edit, not deleted) follows the
 *   overlapping block: it takes the block's times and place, and capture's work item and billable flag for
 *   the fields the person hasn't edited (a picked work item keeps its billable flag too). Its `captured`
 *   snapshot is always what capture proposed, and a times update from capture records no change (decision 32).
 * - An entry with a time edit, or a deleted one, is frozen: new blocks of its chat are cut around its captured
 *   interval (and around the person's own times), so corrected time is never counted twice or brought back.
 * - Blocks left over become new `cortex-chat` entries (a create change while the day has never been confirmed).
 * - An entry following capture that capture no longer finds is kept and marked `missing`, never removed
 *   silently, except that a chat since marked personal loses its untouched (never edited) entries Toolbox has
 *   never held.
 * The caller decides when to refresh: a confirmed day is never refreshed automatically (`canAutoRefresh`).
 */
import { randomUUID } from 'node:crypto';
import {
  CHAT_TIME,
  type ChatBlock,
  type ChatPlace,
  type DayDraft,
  type DraftEntry,
} from '../../shared/time-contract.ts';
import { recordSave, statusAfterEdit } from './changes.ts';
import type { Assignment } from './links.ts';

const MIN = 60_000;

/** A block with its chat's place (from chat-places.json). */
export type CaptureBlock = ChatBlock & { place: ChatPlace | null };
export type AssignFn = (place: ChatPlace | null) => Assignment;

export interface MergeOptions {
  /** Chats now personal (chat-kinds, or a personal project): their untouched, never-confirmed entries go. */
  personalChatIds?: ReadonlySet<string>;
  newId?: () => string;
}

/** Only a day never confirmed, with no send waiting and no conflict being reviewed. */
export function canAutoRefresh(draft: DayDraft): boolean {
  return draft.revision === 0 && draft.pending === null && draft.status !== 'conflict';
}

/** Nothing edited and not deleted: what a chat since marked personal may lose. */
const untouched = (e: DraftEntry) => !e.deleted && e.edited.length === 0;

/**
 * Follows capture for its times: only a `startAt` or `minutes` edit (or a delete) freezes an entry
 * (decision 32.5). A description, work item or billable edit is kept, and the times still follow.
 */
const followsCapture = (e: DraftEntry) =>
  !e.deleted && !e.edited.includes('startAt') && !e.edited.includes('minutes');

type Span = [number, number];

const toMin = (iso: string) => Math.round(Date.parse(iso) / MIN);

/** The minute spans an entry holds on to: its captured interval and, when it has a start, the person's times. */
function frozenSpans(e: DraftEntry): Span[] {
  const spans: Span[] = [];
  if (e.captured?.startAt) spans.push([toMin(e.captured.startAt), toMin(e.captured.endAt)]);
  if (e.values.startAt) {
    const s = toMin(e.values.startAt);
    spans.push([s, s + e.values.minutes]);
  }
  return spans;
}

/** `span` minus every span in `cuts`. */
function cut(span: Span, cuts: readonly Span[]): Span[] {
  let pieces: Span[] = [span];
  for (const [cs, ce] of cuts) {
    pieces = pieces.flatMap(([s, e]): Span[] => {
      if (ce <= s || cs >= e) return [[s, e]];
      const out: Span[] = [];
      if (cs > s) out.push([s, cs]);
      if (ce < e) out.push([ce, e]);
      return out;
    });
  }
  return pieces;
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** A piece of a block, with its evidence shared out by length. */
function piece(block: CaptureBlock, [s, e]: Span): CaptureBlock {
  if (s === toMin(block.startAt) && e === toMin(block.endAt)) return block;
  const share = (e - s) / block.minutes;
  const startAt = new Date(s * MIN).toISOString();
  return {
    ...block,
    captureKey: `${block.chatId}@${startAt}`,
    startAt,
    endAt: new Date(e * MIN).toISOString(),
    minutes: e - s,
    claudeMinutes: Math.round(block.claudeMinutes * share),
    prompts: Math.round(block.prompts * share),
  };
}

function fromBlock(e: DraftEntry, b: CaptureBlock, assignFn: AssignFn): DraftEntry {
  const a = assignFn(b.place);
  // What capture proposes, kept apart from the person's values (its description is capture's: always '').
  const proposed = {
    startAt: b.startAt,
    minutes: b.minutes,
    workItemId: a.workItemId,
    description: e.captured?.description ?? '',
    billable: a.billable,
  };
  const ownItem = e.edited.includes('workItemId');
  const values = {
    ...e.values,
    startAt: b.startAt,
    minutes: b.minutes,
    workItemId: ownItem ? e.values.workItemId : a.workItemId,
    // A picked work item brought its own billable default, so it keeps it.
    billable: ownItem || e.edited.includes('billable') ? e.values.billable : a.billable,
  };
  return {
    ...e,
    certainty: ownItem ? e.certainty : a.certainty,
    values,
    captured: {
      ...proposed,
      chatId: b.chatId,
      captureKey: b.captureKey,
      endAt: b.endAt,
      claudeMinutes: b.claudeMinutes,
      prompts: b.prompts,
    },
    place: b.place,
    missing: false,
  };
}

function newEntry(id: string, b: CaptureBlock, assignFn: AssignFn): DraftEntry {
  const a = assignFn(b.place);
  const values = {
    startAt: b.startAt,
    minutes: b.minutes,
    workItemId: a.workItemId,
    description: '',
    billable: a.billable,
  };
  return {
    id,
    source: 'cortex-chat',
    certainty: a.certainty,
    values,
    captured: {
      ...values,
      chatId: b.chatId,
      captureKey: b.captureKey,
      endAt: b.endAt,
      claudeMinutes: b.claudeMinutes,
      prompts: b.prompts,
    },
    edited: [],
    place: b.place,
    missing: false,
    fromToolbox: false,
    confirmed: null,
    deleted: false,
  };
}

export function mergeCapture(
  draft: DayDraft,
  blocks: readonly CaptureBlock[],
  assignFn: AssignFn,
  now: Date,
  opts: MergeOptions = {},
): DayDraft {
  const newId = opts.newId ?? randomUUID;
  const personal = opts.personalChatIds ?? new Set<string>();

  // A chat since marked personal: its untouched entries Toolbox has never held go, with their changes.
  const dropped = new Set(
    draft.entries
      .filter((e) => e.captured && personal.has(e.captured.chatId) && untouched(e) && e.confirmed === null)
      .map((e) => e.id),
  );
  let entries = draft.entries.filter((e) => !dropped.has(e.id));
  let changes = draft.changes.filter((c) => !dropped.has(c.entryId));

  const dayBlocks = blocks
    .filter((b) => b.workDate === draft.workDate && !personal.has(b.chatId))
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.chatId.localeCompare(b.chatId));
  const chatIds = new Set(dayBlocks.map((b) => b.chatId));
  for (const e of entries) if (e.captured) chatIds.add(e.captured.chatId);

  const updated = new Map<string, DraftEntry>();
  const created: CaptureBlock[] = [];

  // Live entries capture didn't make (added by the person, or from Toolbox after a lost draft) already
  // account for their time: chat time is cut around them so it is never counted twice (review, 2026-11-28).
  const uncaptured = entries.filter((e) => e.captured === null && !e.deleted).flatMap(frozenSpans);

  for (const chatId of [...chatIds].sort()) {
    const mine = entries.filter((e) => e.captured?.chatId === chatId);
    const frozen = [...mine.filter((e) => !followsCapture(e)).flatMap(frozenSpans), ...uncaptured];
    const pieces = dayBlocks
      .filter((b) => b.chatId === chatId)
      .flatMap((b) =>
        cut([toMin(b.startAt), toMin(b.endAt)], frozen)
          .filter(([s, e]) => e - s >= CHAT_TIME.minBlockMinutes)
          .map((span) => piece(b, span)),
      );

    // Pair entries that follow capture with pieces, largest overlap first, one to one.
    const live = mine.filter(followsCapture);
    const pairs: Array<{ entry: DraftEntry; p: number; size: number }> = [];
    for (const entry of live) {
      const span: Span = [toMin(entry.captured?.startAt ?? ''), toMin(entry.captured?.endAt ?? '')];
      pieces.forEach((pc, p) => {
        const size = overlap(span, [toMin(pc.startAt), toMin(pc.endAt)]);
        if (size > 0) pairs.push({ entry, p, size });
      });
    }
    pairs.sort((a, b) => b.size - a.size || a.p - b.p);
    const usedPieces = new Set<number>();
    const matched = new Set<string>();
    for (const { entry, p } of pairs) {
      if (usedPieces.has(p) || matched.has(entry.id)) continue;
      usedPieces.add(p);
      matched.add(entry.id);
      updated.set(entry.id, fromBlock(entry, pieces[p] as CaptureBlock, assignFn));
    }
    for (const entry of live) {
      if (!matched.has(entry.id) && !entry.missing) updated.set(entry.id, { ...entry, missing: true });
    }
    pieces.forEach((pc, p) => {
      if (!usedPieces.has(p)) created.push(pc);
    });
  }

  entries = entries.map((e) => updated.get(e.id) ?? e);
  const base: DayDraft = { ...draft, entries, changes };
  created.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.chatId.localeCompare(b.chatId));
  for (const b of created) {
    const entry = newEntry(newId().toLowerCase(), b, assignFn);
    changes = recordSave(
      { ...base, changes },
      { entryId: entry.id, before: null, after: entry.values, at: now },
    );
    entries = [...entries, entry];
  }

  const next: DayDraft = { ...draft, entries, changes, updatedAt: now.toISOString() };
  return { ...next, status: statusAfterEdit(next) };
}
