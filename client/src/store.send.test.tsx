// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  sendMessage: vi.fn(),
  updatePrefs: vi.fn(),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

class FakeEventSource {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  static CLOSED = 2;
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

function ProjectProbe({ todoChat }: { todoChat: boolean }) {
  const { send, newChat } = useStore();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          newChat({ client: 'acme', project: 'acme/site', ...(todoChat ? { todoId: 't1.md' } : {}) })
        }
      >
        open
      </button>
      <button type="button" onClick={() => void send('Hello', 'acme', [], 'acme/site')}>
        go
      </button>
    </>
  );
}
async function run(todoChat: boolean) {
  render(
    <StoreProvider>
      <ProjectProbe todoChat={todoChat} />
    </StoreProvider>,
  );
  await waitFor(() => expect(api.sessions).toHaveBeenCalled());
  await act(async () => {});
  fireEvent.click(await screen.findByText('open'));
  fireEvent.click(await screen.findByText('go'));
}

describe('send with a project', () => {
  it('sends the project with a new chat', async () => {
    await run(false);
    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({
        prompt: 'Hello',
        client: 'acme',
        project: 'acme/site',
      }),
    );
  });

  it("drops the to-do's project with its link when the message no longer names the to-do", async () => {
    await run(true);
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello', client: 'acme' });
  });
});
