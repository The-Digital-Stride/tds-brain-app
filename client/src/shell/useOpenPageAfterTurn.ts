import { useEffect, useRef } from 'react';
import type { SessionState } from '../../../shared/contract.ts';
import type { ChatPage } from '../../../shared/pages-contract.ts';
import { writeMark } from './PageStage.tsx';

/** Each page's last write, by key. */
export type PageMarks = Map<string, string>;

export function pageMarks(pages: readonly ChatPage[]): PageMarks {
  return new Map(pages.map((p) => [p.key, writeMark(p)]));
}

/** The newest page that is new, or written again, since `before`; null when none is. */
export function pageWrittenSince(before: PageMarks, pages: readonly ChatPage[]): string | null {
  let best: ChatPage | null = null;
  for (const p of pages) {
    const mark = writeMark(p);
    if (mark === '' || before.get(p.key) === mark) continue;
    if (!best || p.order > best.order) best = p;
  }
  return best?.key ?? null;
}

/**
 * Opens the page Claude made or changed once its turn ends, so the person sees it in the app (not
 * in a browser Claude opened). Only at the end of a turn that finished well, never for pages a
 * reopened chat reads back from its history, and never over something already open in the viewer.
 */
export function useOpenPageAfterTurn(
  sessionId: string | null,
  state: SessionState | null,
  pages: readonly ChatPage[],
  viewerOpen: boolean,
  open: (key: string) => void,
): void {
  const inTurn = state === 'working' || state === 'waiting';
  const base = useRef<{
    id: string | null;
    marks: PageMarks;
    inTurn: boolean;
    /** The turn has ended but its file list may not be in yet: the next new list is still compared. */
    waitingFor: readonly ChatPage[] | null;
  }>({ id: null, marks: new Map(), inTurn: false, waitingFor: null });
  useEffect(() => {
    const b = base.current;
    if (b.id !== sessionId) {
      base.current = { id: sessionId, marks: pageMarks(pages), inTurn, waitingFor: null };
      return;
    }
    const ended = b.inTurn && !inTurn;
    b.inTurn = inTurn;
    // During a turn the marks stay as they were when it started.
    if (inTurn) {
      b.waitingFor = null;
      return;
    }
    let key: string | null = null;
    if (ended && state === 'idle') {
      key = pageWrittenSince(b.marks, pages);
      // The list is sent after the turn's end is: give the next one a chance before moving on.
      if (key === null) {
        b.waitingFor = pages;
        return;
      }
    } else if (b.waitingFor !== null) {
      if (pages === b.waitingFor && state === 'idle') return;
      key = state === 'idle' ? pageWrittenSince(b.marks, pages) : null;
    }
    b.waitingFor = null;
    b.marks = pageMarks(pages);
    if (key !== null && !viewerOpen) open(key);
  }, [sessionId, state, inTurn, pages, viewerOpen, open]);
}
