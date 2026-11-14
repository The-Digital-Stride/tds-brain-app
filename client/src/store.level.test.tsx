// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  setChatLevel: vi.fn(),
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

let pick: (tier: 'quick' | null) => Promise<void> = async () => {};
function Probe() {
  const { setChatLevel, chats } = useStore();
  pick = (tier) => setChatLevel('s1', tier);
  return <p data-testid="tier">{chats.s1?.level?.tier ?? 'none'}</p>;
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
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(api.sessions).toHaveBeenCalled());
  await act(async () => {});
}

describe('setChatLevel', () => {
  it('updates the level line from a real answer', async () => {
    await mount();
    api.setChatLevel.mockResolvedValue({ level: { tier: 'quick', source: { kind: 'chat' } } });
    await act(async () => pick('quick'));
    expect(screen.getByTestId('tier').textContent).toBe('quick');
  });

  it.each([[{}], [undefined], [null], [{ level: 'x' }], [{ level: {} }]])(
    'ignores a malformed answer (%j) without crashing or changing the line',
    async (answer) => {
      await mount();
      api.setChatLevel.mockResolvedValueOnce({ level: { tier: 'quick', source: { kind: 'chat' } } });
      await act(async () => pick('quick'));
      api.setChatLevel.mockResolvedValueOnce(answer);
      await act(async () => pick(null));
      expect(screen.getByTestId('tier').textContent).toBe('quick');
    },
  );
});
