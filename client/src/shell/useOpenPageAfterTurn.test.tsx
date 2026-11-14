// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../../shared/contract.ts';
import type { ChatPage } from '../../../shared/pages-contract.ts';
import { pageMarks, pageWrittenSince, useOpenPageAfterTurn } from './useOpenPageAfterTurn.ts';

const page = (key: string, ids: string[], order = 1): ChatPage => ({
  key,
  title: key,
  url: null,
  versions: [],
  draft: true,
  fileKey: null,
  live: false,
  multiFile: false,
  toolUseIds: ids,
  order,
});

describe('pageWrittenSince', () => {
  it('finds the newest page that is new or written again, and nothing when none is', () => {
    const before = pageMarks([page('a', ['w1'], 1), page('b', ['w2'], 2)]);
    expect(pageWrittenSince(before, [page('a', ['w1'], 1), page('b', ['w2'], 2)])).toBeNull();
    expect(pageWrittenSince(before, [page('a', ['w1', 'w3'], 1), page('b', ['w2'], 2)])).toBe('a');
    expect(
      pageWrittenSince(before, [page('a', ['w1', 'w3'], 1), page('b', ['w2'], 2), page('c', ['w4'], 3)]),
    ).toBe('c');
    // A published page with no write of its own in this chat is not "made" here.
    expect(pageWrittenSince(before, [page('d', [], 4)])).toBeNull();
  });
});

describe('useOpenPageAfterTurn', () => {
  type P = { id: string | null; state: SessionState | null; pages: ChatPage[]; viewerOpen: boolean };
  const setup = (initial: P) => {
    const open = vi.fn();
    const view = renderHook(
      ({ id, state, pages, viewerOpen }: P) => useOpenPageAfterTurn(id, state, pages, viewerOpen, open),
      { initialProps: initial },
    );
    return { open, rerender: view.rerender };
  };

  it('opens the page made during a turn once the turn ends', () => {
    const { open, rerender } = setup({ id: 's', state: 'idle', pages: [], viewerOpen: false });
    rerender({ id: 's', state: 'working', pages: [], viewerOpen: false });
    rerender({ id: 's', state: 'working', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(open).not.toHaveBeenCalled();
    rerender({ id: 's', state: 'idle', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(open).toHaveBeenCalledExactlyOnceWith('a');
    // Nothing new next turn: nothing opens.
    rerender({ id: 's', state: 'working', pages: [page('a', ['w1'])], viewerOpen: false });
    rerender({ id: 's', state: 'idle', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens a page changed during a turn, through a question in the middle of it', () => {
    const { open, rerender } = setup({
      id: 's',
      state: 'idle',
      pages: [page('a', ['w1'])],
      viewerOpen: false,
    });
    rerender({ id: 's', state: 'working', pages: [page('a', ['w1'])], viewerOpen: false });
    rerender({ id: 's', state: 'waiting', pages: [page('a', ['w1'])], viewerOpen: false });
    rerender({ id: 's', state: 'working', pages: [page('a', ['w1', 'w2'])], viewerOpen: false });
    rerender({ id: 's', state: 'idle', pages: [page('a', ['w1', 'w2'])], viewerOpen: false });
    expect(open).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('still opens the page when its file list arrives just after the turn ends, and only for that list', () => {
    const { open, rerender } = setup({ id: 's', state: 'idle', pages: [], viewerOpen: false });
    rerender({ id: 's', state: 'working', pages: [], viewerOpen: false });
    // The turn ends before the list carrying the page has been worked out.
    rerender({ id: 's', state: 'idle', pages: [], viewerOpen: false });
    expect(open).not.toHaveBeenCalled();
    rerender({ id: 's', state: 'idle', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(open).toHaveBeenCalledExactlyOnceWith('a');
    // A later list (no turn in between) opens nothing more.
    rerender({ id: 's', state: 'idle', pages: [page('a', ['w1']), page('b', ['w2'], 2)], viewerOpen: false });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('never opens for pages a reopened chat reads back, over an open viewer, or after an error', () => {
    // Reopened: pages arrive from history while the chat sits idle.
    const a = setup({ id: 's', state: 'starting', pages: [], viewerOpen: false });
    a.rerender({ id: 's', state: 'idle', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(a.open).not.toHaveBeenCalled();

    const b = setup({ id: 's', state: 'idle', pages: [], viewerOpen: true });
    b.rerender({ id: 's', state: 'working', pages: [page('a', ['w1'])], viewerOpen: true });
    b.rerender({ id: 's', state: 'idle', pages: [page('a', ['w1'])], viewerOpen: true });
    expect(b.open).not.toHaveBeenCalled();

    const c = setup({ id: 's', state: 'idle', pages: [], viewerOpen: false });
    c.rerender({ id: 's', state: 'working', pages: [page('a', ['w1'])], viewerOpen: false });
    c.rerender({ id: 's', state: 'error', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(c.open).not.toHaveBeenCalled();
  });

  it('does not open a page from a chat that finished while the person was in another one', () => {
    const { open, rerender } = setup({ id: 's', state: 'working', pages: [], viewerOpen: false });
    rerender({ id: 't', state: 'idle', pages: [], viewerOpen: false });
    rerender({ id: 's', state: 'idle', pages: [page('a', ['w1'])], viewerOpen: false });
    expect(open).not.toHaveBeenCalled();
  });
});
