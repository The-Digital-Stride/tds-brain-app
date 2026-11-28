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
 * - Entries the person has touched (any edit) or Toolbox holds are paired with capture first, so their
 *   description stays on the time. One left without a piece holds its own time: its chat's blocks are cut
 *   around it and paired again, until stable, so blocks that join never count the same minutes twice.
 * - Blocks left over become new `cortex-chat` entries (a create change while the day has never been confirmed).
 * - An entry following capture that capture no longer finds is kept and marked `missing`, never removed
 *   silently, except an untouched (never edited) entry Toolbox has never held when its chat was marked
 *   personal, or when other entries of its chat already count all of its time (blocks that joined).
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

const capturedSpan = (e: DraftEntry): Span => [
  toMin(e.captured?.startAt ?? ''),
  toMin(e.captured?.endAt ?? ''),
];
const blockSpan = (b: ChatBlock): Span => [toMin(b.startAt), toMin(b.endAt)];

/** The minutes an entry counts in the day: its own start and minutes. */
function valueSpans(e: DraftEntry): Span[] {
  if (!e.values.startAt) return [];
  const s = toMin(e.values.startAt);
  return [[s, s + e.values.minutes]];
}

/**
 * Never dropped by a refresh: the person touched it (any edit), or Toolbox holds it. Such an entry is paired
 * first, and one left without a piece of capture holds its own time.
 */
const keeps = (e: DraftEntry) => e.edited.length > 0 || e.confirmed !== null || e.fromToolbox;

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
  // Untouched entries whose time other entries of their chat now count (blocks that joined).
  const gone = new Set<string>();

  // Live entries capture didn't make (added by the person, or from Toolbox after a lost draft) already
  // account for their time: chat time is cut around them so it is never counted twice (review, 2026-11-28).
  const uncaptured = entries.filter((e) => e.captured === null && !e.deleted).flatMap(frozenSpans);

  for (const chatId of [...chatIds].sort()) {
    const mine = entries.filter((e) => e.captured?.chatId === chatId);
    const chatBlocks = dayBlocks.filter((b) => b.chatId === chatId);
    const fixedFrozen = [...mine.filter((e) => !followsCapture(e)).flatMap(frozenSpans), ...uncaptured];

    // Pair entries that follow capture with pieces, one to one: an entry the person has touched (or Toolbox
    // holds) first, so their description stays on the time, then largest overlap. Such an entry left without a
    // piece holds its own time instead: the chat's pieces are cut around it and paired again, until stable.
    const held = new Set<string>();
    let pieces: CaptureBlock[] = [];
    let usedPieces = new Set<number>();
    let matched = new Map<string, CaptureBlock>();
    for (let round = 0; round <= mine.length; round++) {
      const frozen = [...fixedFrozen, ...mine.filter((e) => held.has(e.id)).flatMap(frozenSpans)];
      pieces = chatBlocks.flatMap((b) =>
        cut([toMin(b.startAt), toMin(b.endAt)], frozen)
          .filter(([s, e]) => e - s >= CHAT_TIME.minBlockMinutes)
          .map((span) => piece(b, span)),
      );
      const pairs: Array<{ entry: DraftEntry; p: number; size: number; keep: number }> = [];
      for (const entry of mine) {
        if (!followsCapture(entry) || held.has(entry.id)) continue;
        const span = capturedSpan(entry);
        pieces.forEach((pc, p) => {
          const size = overlap(span, [toMin(pc.startAt), toMin(pc.endAt)]);
          if (size > 0) pairs.push({ entry, p, size, keep: keeps(entry) ? 1 : 0 });
        });
      }
      pairs.sort((a, b) => b.keep - a.keep || b.size - a.size || a.p - b.p);
      usedPieces = new Set<number>();
      matched = new Map<string, CaptureBlock>();
      for (const { entry, p } of pairs) {
        if (usedPieces.has(p) || matched.has(entry.id)) continue;
        usedPieces.add(p);
        matched.set(entry.id, pieces[p] as CaptureBlock);
      }
      const losers = mine.filter(
        (e) => followsCapture(e) && keeps(e) && !held.has(e.id) && !matched.has(e.id),
      );
      if (losers.length === 0) break;
      for (const e of losers) held.add(e.id);
    }

    const counted: Span[] = [];
    for (const entry of mine) {
      const pc = matched.get(entry.id);
      if (pc) {
        updated.set(entry.id, fromBlock(entry, pc, assignFn));
        counted.push([toMin(pc.startAt), toMin(pc.endAt)]);
      } else if (held.has(entry.id)) {
        // Still in the chat's time, so not missing: it just keeps its own times.
        const missing = !chatBlocks.some((b) => overlap(capturedSpan(entry), blockSpan(b)) > 0);
        if (entry.missing !== missing) updated.set(entry.id, { ...entry, missing });
        counted.push(...valueSpans(entry));
      } else if (!entry.deleted && !followsCapture(entry)) {
        counted.push(...valueSpans(entry));
      }
    }
    for (const entry of mine) {
      if (!followsCapture(entry) || matched.has(entry.id) || held.has(entry.id)) continue;
      // Untouched and never in Toolbox: when other entries of its chat already count all its time, it goes.
      const own = valueSpans(entry);
      if (own.length > 0 && own.every((sp) => cut(sp, counted).length === 0)) gone.add(entry.id);
      else if (!entry.missing) updated.set(entry.id, { ...entry, missing: true });
    }
    pieces.forEach((pc, p) => {
      if (!usedPieces.has(p)) created.push(pc);
    });
  }

  if (gone.size > 0) {
    entries = entries.filter((e) => !gone.has(e.id));
    changes = changes.filter((c) => !gone.has(c.entryId));
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
