// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, ApiFailure } = vi.hoisted(() => {
  class ApiFailure extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
    get notSignedIn() {
      return false;
    }
  }
  return {
    ApiFailure,
    api: {
      bootstrap: vi.fn(),
      todos: vi.fn(),
      sessions: vi.fn(),
      // The rail's last-sync stamp asks for this.
      sync: vi.fn(async () => ({ lastSync: null })),
      startSession: vi.fn(),
      sendMessage: vi.fn(),
      updatePrefs: vi.fn(),
    },
  };
});
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure }));

class FakeEventSource {
  static last: FakeEventSource | null = null;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  static CLOSED = 2;
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener() {}
  close() {}
}

const { StoreProvider, useStore } = await import('./store.tsx');

const results: boolean[] = [];
function Probe({ text, ids }: { text: string; ids: string[] }) {
  const { send } = useStore();
  return (
    <button type="button" onClick={() => void send(text, null, ids).then((ok) => results.push(ok))}>
      go
    </button>
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

beforeEach(() => {
  results.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.startSession.mockResolvedValue({ session: { id: 's9' } });
  api.sendMessage.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function go(text: string, ids: string[]) {
  render(
    <StoreProvider>
      <Probe text={text} ids={ids} />
    </StoreProvider>,
  );
  await waitFor(() => expect(api.sessions).toHaveBeenCalled());
  await act(async () => {});
  fireEvent.click(await screen.findByText('go'));
}

describe('send with files', () => {
  it('starts a new chat from files alone', async () => {
    await go('', ['u1']);
    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({ prompt: '', client: null, attachments: ['u1'] }),
    );
    expect(results).toEqual([true]);
  });

  it('sends files alone into a live chat', async () => {
    sessionStorage.setItem('tds-brain-open-chat', 's1');
    api.sessions.mockResolvedValue({
      live: [
        {
          id: 's1',
          sdkSessionId: null,
          title: 'Report check',
          client: null,
          todoId: null,
          state: 'idle',
          startedAt: '',
          lastActivityAt: '',
        },
      ],
      past: [],
    });
    await go('', ['u1', 'u2']);
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith('s1', '', ['u1', 'u2']));
  });

  it('still refuses an empty message with no files', async () => {
    await go('  ', []);
    await waitFor(() => expect(results).toEqual([false]));
    expect(api.startSession).not.toHaveBeenCalled();
  });
});

const liveS1 = {
  id: 's1',
  sdkSessionId: 'sdk-1',
  title: 'Report check',
  client: null,
  todoId: null,
  state: 'idle',
  startedAt: '',
  lastActivityAt: '',
};

/** Tells the open page that chat s1 has ended, as the server's stream does. */
function endS1() {
  const es = FakeEventSource.last;
  if (!es?.onmessage) throw new Error('no stream');
  es.onmessage({
    data: JSON.stringify({
      kind: 'chat',
      sessionId: 's1',
      item: { seq: 1, at: '2026-11-23T10:00:00Z', event: { type: 'state', state: 'closed' } },
    }),
  });
}

describe('send into a chat that has ended', () => {
  beforeEach(() => {
    sessionStorage.setItem('tds-brain-open-chat', 's1');
    // The first list has the chat open; every later one shows it gone.
    api.sessions.mockResolvedValueOnce({ live: [liveS1], past: [] });
  });

  it('reopens a chat the page knows has ended, with the message and files', async () => {
    render(
      <StoreProvider>
        <Probe text=" carry on " ids={['u1']} />
      </StoreProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem('tds-brain-open-chat')).toBe('s1'));
    await waitFor(() => expect(api.sessions).toHaveBeenCalled());
    await act(async () => {});
    await act(async () => endS1());
    fireEvent.click(await screen.findByText('go'));
    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({
        resume: 'sdk-1',
        prompt: 'carry on',
        attachments: ['u1'],
      }),
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(results).toEqual([true]));
    // The page follows the reopened chat.
    await waitFor(() => expect(sessionStorage.getItem('tds-brain-open-chat')).toBe('s9'));
  });

  it('reopens a chat the server has lost when the page had not heard (the app restarted)', async () => {
    api.sendMessage.mockRejectedValueOnce(new ApiFailure('not-found', 'That chat could not be found.'));
    await go('carry on', []);
    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({ resume: 'sdk-1', prompt: 'carry on' }),
    );
    expect(api.sendMessage).toHaveBeenCalledWith('s1', 'carry on', []);
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('reopens a chat refused as closed', async () => {
    api.sendMessage.mockRejectedValueOnce(new ApiFailure('session-closed', 'That chat has been closed.'));
    await go('carry on', []);
    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({ resume: 'sdk-1', prompt: 'carry on' }),
    );
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('sends to the copy another tab has already reopened', async () => {
    api.sendMessage.mockRejectedValueOnce(new ApiFailure('session-closed', 'That chat has been closed.'));
    api.startSession.mockRejectedValueOnce(new ApiFailure('already-open', 'That chat is already open.'));
    await go('carry on', []);
    // The lookup after already-open finds the other tab's copy.
    api.sessions.mockResolvedValue({ live: [{ ...liveS1, id: 's7' }], past: [] });
    await waitFor(() => expect(api.sendMessage).toHaveBeenLastCalledWith('s7', 'carry on', []));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('does not reopen when not-found is about something else and the chat is still open', async () => {
    api.sessions.mockReset();
    api.sessions.mockResolvedValue({ live: [liveS1], past: [] });
    api.sendMessage.mockRejectedValueOnce(new ApiFailure('not-found', 'That file could not be found.'));
    await go('carry on', ['u1']);
    await waitFor(() => expect(results).toEqual([false]));
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('leaves a chat being deleted alone', async () => {
    api.sendMessage.mockRejectedValueOnce(new ApiFailure('session-closed', 'That chat has been closed.'));
    api.startSession.mockRejectedValueOnce(new ApiFailure('already-open', 'That chat is being deleted.'));
    await go('carry on', []);
    await waitFor(() => expect(results).toEqual([false]));
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
