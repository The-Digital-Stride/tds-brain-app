/**
 * What the palette shows: the sources' hits as groups, and the server-backed sources' answers merged in.
 * Sources: `client/src/shell/search-sources.ts`. Contract: `SearchSource` in `client/src/shell/contract.ts`.
 */
import { useEffect, useState } from 'react';
import type { SearchContext, SearchHit, SearchResults, SearchSource } from '../shell/contract.ts';

/** Async sources wait this long after the last keystroke, and only search for this many characters or more. */
export const ASYNC_DEBOUNCE_MS = 150;
export const ASYNC_MIN_CHARS = 2;
/** A source that says `partial` is asked again every second, up to five more times. */
export const ASYNC_RETRY_MS = 1000;
export const ASYNC_RETRIES = 5;

export interface SearchGroup {
  source: SearchSource;
  hits: SearchHit[];
  /** How many matched in all; more than `hits.length` shows "6 of N". 0 when idle. */
  total: number;
  /** An async group whose source is still building some folders' lists: "Still looking…". */
  looking: boolean;
  /** A quiet note after the heading when the source could not search everything; null otherwise. */
  note: string | null;
}

/** Said beside a files group that answered only in part, or not at all, while other groups have results. */
export const NOTE_UNFINISHED = "Some folders weren't searched";
export const NOTE_FAILED = "Couldn't search";
/** Said instead of "Nothing matches" when nothing else matched and the server search did not finish. */
export const SEARCH_TROUBLE = "Couldn't search files just now";

/** The id the palette gives an option (and its DOM id): unique across groups. */
export const optionKey = (g: SearchGroup, h: SearchHit): string => `${g.source.id}:${h.id}`;

/** The group heading's count: "6 of 23" when the group is cut short, else nothing. */
export function groupCount(g: SearchGroup): string | null {
  return g.total > g.hits.length ? `${g.hits.length} of ${g.total}` : null;
}

/** One async source's latest answer, for the query that asked it. */
export interface AsyncSlot {
  query: string;
  results: SearchResults | null;
  /** True while a partial answer is being retried. */
  looking: boolean;
}

/** The slot of an async source for exactly this query, or null (none yet, or a stale one). */
const slotFor = (
  source: SearchSource,
  query: string,
  slots: Readonly<Record<string, AsyncSlot>>,
): AsyncSlot | null => {
  const slot = slots[source.id];
  return slot && slot.query === query ? slot : null;
};

/** A slot that is over but incomplete: the search failed, or was still partial after the last retry. */
const troubled = (slot: AsyncSlot): string | null =>
  slot.results === null
    ? NOTE_FAILED
    : slot.results.partial === true && !slot.looking
      ? NOTE_UNFINISHED
      : null;

/**
 * Every group to show for `query` (already trimmed), in source order. Empty query: each source's `idle`
 * hits. Async groups come from `slots`, only for this exact query (an older one is stale and dropped).
 * Empty groups are left out, except an async group that could not finish its search while others have
 * results: it keeps its heading, with a note saying so.
 */
export function paletteGroups(
  sources: readonly SearchSource[],
  query: string,
  ctx: SearchContext,
  slots: Readonly<Record<string, AsyncSlot>> = {},
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const source of sources) {
    if (query === '') {
      const hits = source.idle?.(ctx) ?? [];
      if (hits.length > 0) groups.push({ source, hits, total: hits.length, looking: false, note: null });
    } else if (source.search) {
      const { hits, total } = source.search(query, ctx);
      if (hits.length > 0) groups.push({ source, hits, total, looking: false, note: null });
    } else if (source.searchAsync) {
      const slot = slotFor(source, query, slots);
      if (!slot) continue;
      const hits = slot.results?.hits ?? [];
      const note = troubled(slot);
      if (hits.length > 0 || note) {
        groups.push({ source, hits, total: slot.results?.total ?? 0, looking: slot.looking, note });
      }
    }
  }
  // With nothing to show, a heading alone says nothing: the palette's own line does.
  return groups.some((g) => g.hits.length > 0) ? groups : [];
}

/** Whether any server-backed source is still asking again for more (partial answer, retries left). */
export function asyncLooking(
  sources: readonly SearchSource[],
  query: string,
  slots: Readonly<Record<string, AsyncSlot>>,
): boolean {
  return sources.some((s) => s.searchAsync && slotFor(s, query, slots)?.looking === true);
}

/** Whether a server-backed source failed, or ended partial, for this query. */
export function asyncTrouble(
  sources: readonly SearchSource[],
  query: string,
  slots: Readonly<Record<string, AsyncSlot>>,
): boolean {
  return sources.some((s) => {
    const slot = s.searchAsync ? slotFor(s, query, slots) : null;
    return slot !== null && troubled(slot) !== null;
  });
}

/** Whether a server-backed source has not answered for `query` yet (so "Nothing matches" would be early). */
export function asyncPending(
  sources: readonly SearchSource[],
  query: string,
  slots: Readonly<Record<string, AsyncSlot>>,
): boolean {
  if (query.length < ASYNC_MIN_CHARS) return false;
  return sources.some((s) => s.searchAsync && slots[s.id]?.query !== query);
}

/**
 * Runs the server-backed sources for `query` (trimmed): debounced, aborted when the query changes, and a
 * `partial` answer asked again every second, up to five times. Answers are kept per source with the query
 * that asked, so `paletteGroups` can drop any that is no longer current.
 */
export function useAsyncSearch(sources: readonly SearchSource[], query: string): Record<string, AsyncSlot> {
  const [slots, setSlots] = useState<Record<string, AsyncSlot>>({});

  useEffect(() => {
    if (query.length < ASYNC_MIN_CHARS) return;
    const asking = sources.filter((s) => s.searchAsync);
    if (asking.length === 0) return;
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const put = (id: string, slot: AsyncSlot) => setSlots((prev) => ({ ...prev, [id]: slot }));

    const attempt = (source: SearchSource, retried: number) => {
      // Async, so even a source that throws at once is just a failed search.
      const ask = async (): Promise<SearchResults> =>
        (await source.searchAsync?.(query, controller.signal)) ?? { hits: [], total: 0 };
      ask().then(
        (results) => {
          if (controller.signal.aborted) return;
          const again = results.partial === true && retried < ASYNC_RETRIES;
          put(source.id, { query, results, looking: again });
          if (again) timers.add(setTimeout(() => attempt(source, retried + 1), ASYNC_RETRY_MS));
        },
        () => {
          // A failed search is simply no answer: the rest of the palette still works.
          if (!controller.signal.aborted) put(source.id, { query, results: null, looking: false });
        },
      );
    };
    timers.add(
      setTimeout(() => {
        for (const source of asking) attempt(source, 0);
      }, ASYNC_DEBOUNCE_MS),
    );
    return () => {
      controller.abort();
      for (const t of timers) clearTimeout(t);
    };
  }, [sources, query]);

  return slots;
}
