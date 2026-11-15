// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_CHANGE_MESSAGES, filesDeletedNotice } from '../../shared/files-contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  deleteLibraryFile: vi.fn(),
  close: vi.fn(async () => undefined),
  sync: vi.fn(async () => ({ lastSync: null })),
}));
class FakeFailure extends Error {
  code: string;
  constructor(code: string, message = 'server text') {
    super(message);
    this.code = code;
  }
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

const { StoreProvider, useStore, TODO_UNDO_MS, FILE_DELETE_GUARD_MS } = await import('./store.tsx');
type Store = ReturnType<typeof useStore>;

let current: Store | null = null;
function Probe() {
  const store = useStore();
  current = store;
  return (
    <p>
      hidden [{[...store.hiddenFileIds].join(' ')}] stars [
      {(store.boot?.prefs.favouriteFiles ?? []).join(' ')}]{store.notice ? ` notice ${store.notice}` : ''}
      {store.fileNotice ? ` filenotice ${store.fileNotice}` : ''}
      {store.actionError ? ` error ${store.actionError}` : ''}
      {store.fileDeleteBusy ? ' busy' : ''}
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
  prefs: {
    pins: [],
    lastClient: null,
    todoPanelOpen: false,
    directWrites: false,
    favouriteFiles: ['f1', 'f2'],
  },
};
const file = { id: 'f1', title: 'Acme logo', version: 'v1' };

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
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
  await waitFor(() => expect(screen.getByText(/stars \[f1 f2\]/)).toBeTruthy());
  vi.useFakeTimers();
}

describe('deleteFile', () => {
  it('takes the file out of the lists and the starred files at once, and sends nothing yet', async () => {
    await start();
    act(() => current?.deleteFile(file));
    expect(screen.getByText(/hidden \[f1\] stars \[f2\]/)).toBeTruthy();
    expect(current?.heldFiles).toEqual([{ id: 'f1', title: 'Acme logo', phase: 'waiting' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS - 1);
    });
    expect(api.deleteLibraryFile).not.toHaveBeenCalled();
  });

  it('Undo brings it back and no request is ever sent', async () => {
    await start();
    act(() => current?.deleteFile(file));
    act(() => current?.undoDeleteFile('f1'));
    expect(screen.getByText(/hidden \[\] stars \[f1 f2\]/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS * 3);
    });
    expect(api.deleteLibraryFile).not.toHaveBeenCalled();
  });

  it('sends once the time is up, with the version it saw, and says the file is kept for 30 days', async () => {
    api.deleteLibraryFile.mockResolvedValue(undefined);
    await start();
    act(() => current?.deleteFile(file));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS);
    });
    expect(api.deleteLibraryFile).toHaveBeenCalledExactlyOnceWith('f1', 'v1', undefined);
    expect(screen.getByText(new RegExp(`notice ${filesDeletedNotice(file.title)}`))).toBeTruthy();
    expect(screen.getByText(/hidden \[f1\] stars \[f2\]/)).toBeTruthy();
    // Too late for Undo.
    act(() => current?.undoDeleteFile('f1'));
    expect(screen.getByText(/hidden \[f1\]/)).toBeTruthy();
  });

  it('keeps the file out of the lists while a refresh runs during the hold', async () => {
    await start();
    act(() => current?.deleteFile(file));
    await act(async () => {
      current?.retry();
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(current?.hiddenFileIds.has('f1')).toBe(true);
    expect(api.deleteLibraryFile).not.toHaveBeenCalled();
  });

  it('brings the file back with the app’s own message when the delete fails', async () => {
    api.deleteLibraryFile.mockRejectedValue(new FakeFailure('changed', 'raw server words'));
    await start();
    act(() => current?.deleteFile(file));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS);
    });
    expect(screen.getByText(/hidden \[\] stars \[f1 f2\]/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`error ${FILES_CHANGE_MESSAGES.changed}`))).toBeTruthy();
    expect(screen.queryByText(/notice/)).toBeNull();
  });

  it('is busy while the request is on its way, so the bins are disabled', async () => {
    let finish: () => void = () => {};
    api.deleteLibraryFile.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await start();
    act(() => current?.deleteFile(file));
    expect(current?.fileDeleteBusy).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS);
    });
    expect(screen.getByText(/busy/)).toBeTruthy();
    await act(async () => finish());
    expect(screen.queryByText(/busy/)).toBeNull();
  });

  it('sends a held delete at once when the page closes', async () => {
    api.deleteLibraryFile.mockResolvedValue(undefined);
    await start();
    act(() => current?.deleteFile(file));
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.deleteLibraryFile).toHaveBeenCalledExactlyOnceWith('f1', 'v1', { keepalive: true });
  });

  it('uses the name the person saw in the held entry and the success notice', async () => {
    api.deleteLibraryFile.mockResolvedValue(undefined);
    await start();
    act(() => current?.deleteFile(file, 'acme-logo.png'));
    expect(current?.heldFiles).toEqual([{ id: 'f1', title: 'acme-logo.png', phase: 'waiting' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS);
    });
    expect(screen.getByText(new RegExp(`notice ${filesDeletedNotice('acme-logo.png')}`))).toBeTruthy();
    expect(current?.fileNotice).toBe(filesDeletedNotice('acme-logo.png'));
  });

  it('holds the clock while the line is pointed at or focused, then runs it again in full', async () => {
    api.deleteLibraryFile.mockResolvedValue(undefined);
    await start();
    act(() => current?.deleteFile(file));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS - 1000);
    });
    act(() => current?.pauseFileDelete('f1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS * 5);
    });
    expect(api.deleteLibraryFile).not.toHaveBeenCalled();
    // Undo still works while paused.
    expect(current?.heldFiles).toHaveLength(1);
    act(() => current?.resumeFileDelete('f1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS - 1);
    });
    expect(api.deleteLibraryFile).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.deleteLibraryFile).toHaveBeenCalledExactlyOnceWith('f1', 'v1', undefined);
  });

  it('Undo and closing the page both still work while paused', async () => {
    api.deleteLibraryFile.mockResolvedValue(undefined);
    await start();
    act(() => current?.deleteFile(file));
    act(() => current?.pauseFileDelete('f1'));
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.deleteLibraryFile).toHaveBeenCalledExactlyOnceWith('f1', 'v1', { keepalive: true });
  });

  it('a chat closed after a delete clears the file notice too, so it is never spoken again later', async () => {
    api.deleteLibraryFile.mockResolvedValue(undefined);
    await start();
    act(() => current?.deleteFile(file));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS);
    });
    expect(screen.getByText(/filenotice /)).toBeTruthy();
    await act(async () => {
      await current?.closeChat('chat-1');
    });
    // Closing a chat replaces the shared notice timer, the one that would have cleared it.
    expect(screen.queryByText(/filenotice /)).toBeNull();
  });

  it('ignores a second bin press straight after a delete (a double-click or a held Enter), then allows it', async () => {
    await start();
    const other = { id: 'f2', title: 'Old audit', version: 'v2' };
    act(() => current?.deleteFile(file));
    act(() => current?.deleteFile(other));
    // Only the first file is held: the second press landed on a bin that slid under the pointer.
    expect(screen.getByText(/hidden \[f1\] /)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_DELETE_GUARD_MS);
    });
    act(() => current?.deleteFile(other));
    expect(screen.getByText(/hidden \[f1 f2\] /)).toBeTruthy();
  });
});
