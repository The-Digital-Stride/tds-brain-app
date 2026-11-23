// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Deleting an earlier chat is held for the Undo time in the browser, as files are (plan 2026-11-22-ux-consistency,
// decision 12 and R2). These replace the old tests of an immediate `deletePastChat`, which no longer exists.
const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  deletePastChat: vi.fn(),
  startSession: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
}));
class FakeFailure extends Error {
  code = 'already-open';
}
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: FakeFailure }));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { StoreProvider, useStore, FILE_DELETE_GUARD_MS } = await import('./store.tsx');
const { UNDO_MS } = await import('./shell/UndoLine.tsx');
type Store = ReturnType<typeof useStore>;

let current: Store | null = null;
function Probe() {
  const store = useStore();
  current = store;
  return (
    <p>
      past {store.sessions?.past.map((p) => p.sdkSessionId).join(' ') ?? 'loading'}
      {store.notice ? `, notice ${store.notice}` : ''}
      {store.actionError ? `, error ${store.actionError}` : ''}
    </p>
  );
}

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};
const past = (id: string) => ({
  sdkSessionId: id,
  title: `Chat ${id}`,
  lastModified: '2026-11-01T10:00:00Z',
  kind: 'tds',
});

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [past('p1'), past('p2')] });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  current = null;
});

async function start() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(screen.getByText(/past p1 p2/)).toBeTruthy());
  vi.useFakeTimers();
}
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('holdDeletePastChat', () => {
  it('takes the chat out of the past list everywhere at once, and sends nothing yet', async () => {
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    // `sessions` is what the drawer, Home and search all read.
    expect(screen.getByText(/^past p2$/)).toBeTruthy();
    expect(current?.heldChats).toEqual([
      { sdkSessionId: 'p1', title: 'Chat p1', phase: 'waiting', session: past('p1') },
    ]);
    await wait(UNDO_MS - 1);
    expect(api.deletePastChat).not.toHaveBeenCalled();
  });

  it('sends exactly once after the Undo time, then stays out through the reload', async () => {
    api.deletePastChat.mockResolvedValue({});
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    api.sessions.mockResolvedValue({ live: [], past: [past('p2')] });
    await wait(UNDO_MS);
    expect(api.deletePastChat).toHaveBeenCalledExactlyOnceWith('p1');
    expect(
      screen.getByText(/past p2, notice “Chat p1” moved to the Bin. You can put it back from there./),
    ).toBeTruthy();
    expect(current?.chatNotice).toBe('“Chat p1” moved to the Bin. You can put it back from there.');
    expect(current?.heldChats).toEqual([]);
    // Too late for Undo, and nothing more is ever sent.
    act(() => current?.undoDeletePastChat('p1'));
    await wait(UNDO_MS * 3);
    window.dispatchEvent(new Event('pagehide'));
    expect(api.deletePastChat).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^past p2/)).toBeTruthy();
  });

  it('shows "sending" once the time is up, while the request is on its way', async () => {
    let finish: () => void = () => {};
    api.deletePastChat.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    await wait(UNDO_MS);
    expect(current?.heldChats[0]?.phase).toBe('sending');
    act(() => current?.undoDeletePastChat('p1'));
    expect(current?.heldChats).toHaveLength(1);
    await act(async () => finish());
  });

  it('Undo brings it back and no request is ever sent', async () => {
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    act(() => current?.undoDeletePastChat('p1'));
    expect(screen.getByText(/^past p1 p2$/)).toBeTruthy();
    await wait(UNDO_MS * 3);
    window.dispatchEvent(new Event('pagehide'));
    expect(api.deletePastChat).not.toHaveBeenCalled();
  });

  it('pausing holds the clock; resuming runs the full time again', async () => {
    api.deletePastChat.mockResolvedValue({});
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    await wait(UNDO_MS - 1000);
    act(() => current?.pauseChatDelete('p1'));
    await wait(UNDO_MS * 5);
    expect(api.deletePastChat).not.toHaveBeenCalled();
    act(() => current?.resumeChatDelete('p1'));
    await wait(UNDO_MS - 1);
    expect(api.deletePastChat).not.toHaveBeenCalled();
    await wait(1);
    expect(api.deletePastChat).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('openPast ignores a held chat', async () => {
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    let opened = true;
    await act(async () => {
      opened = (await current?.openPast('p1')) ?? true;
    });
    expect(opened).toBe(false);
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('brings the chat back with the reason when the delete fails, and says it could not be deleted', async () => {
    api.deletePastChat.mockRejectedValue(
      new FakeFailure('That chat is open. Close it first, then delete it.'),
    );
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    await wait(UNDO_MS);
    expect(screen.getByText(/^past p1 p2, error That chat is open/)).toBeTruthy();
    expect(current?.heldChats).toEqual([]);
    expect(current?.chatNotice).toBe("“Chat p1” couldn't be deleted.");
    expect(screen.queryByText(/notice/)).toBeNull();
  });

  it('closing the page sends a held delete at once, and only once', async () => {
    api.deletePastChat.mockResolvedValue({});
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    act(() => current?.pauseChatDelete('p1'));
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.deletePastChat).toHaveBeenCalledExactlyOnceWith('p1');
    act(() => current?.resumeChatDelete('p1'));
    await wait(UNDO_MS * 2);
    expect(api.deletePastChat).toHaveBeenCalledTimes(1);
  });

  it('closing the page sends one still queued behind another, once each', async () => {
    let finish: () => void = () => {};
    api.deletePastChat.mockReturnValueOnce(new Promise<void>((r) => (finish = r))).mockResolvedValue({});
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    await wait(FILE_DELETE_GUARD_MS);
    act(() => current?.holdDeletePastChat('p2', 'Chat p2'));
    await wait(UNDO_MS);
    // p1 is on its way; p2's time is up too, and it waits behind p1.
    expect(api.deletePastChat).toHaveBeenCalledExactlyOnceWith('p1');
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.deletePastChat).toHaveBeenCalledTimes(2);
    expect(api.deletePastChat).toHaveBeenLastCalledWith('p2');
    await act(async () => finish());
    await wait(UNDO_MS);
    expect(api.deletePastChat).toHaveBeenCalledTimes(2);
  });

  it('ignores a second bin press straight after a delete (a double-click), then allows it', async () => {
    await start();
    act(() => current?.holdDeletePastChat('p1', 'Chat p1'));
    act(() => current?.holdDeletePastChat('p2', 'Chat p2'));
    expect(current?.heldChats.map((h) => h.sdkSessionId)).toEqual(['p1']);
    await wait(FILE_DELETE_GUARD_MS);
    act(() => current?.holdDeletePastChat('p2', 'Chat p2'));
    expect(current?.heldChats.map((h) => h.sdkSessionId)).toEqual(['p1', 'p2']);
    expect(screen.getByText(/^past$/)).toBeTruthy();
  });
});
