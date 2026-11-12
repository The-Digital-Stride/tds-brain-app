// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, StreamFrame } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

class FakeEventSource {
  static last: FakeEventSource | null = null;
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { StoreProvider, useStore } = await import('./store.tsx');

function Probe() {
  const { libraryVersion } = useStore();
  return <p>version {libraryVersion}</p>;
}

const boot = {
  appVersion: '0',
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};

function send(event: AppEvent) {
  const frame: StreamFrame = { kind: 'app', event };
  act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(frame) }));
}

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

describe('libraryVersion', () => {
  const start = async () => {
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await screen.findByText('version 0');
  };

  it('counts up on a library change without reloading the bootstrap', async () => {
    await start();
    const loads = api.bootstrap.mock.calls.length;
    send({ type: 'brain-changed', area: 'library' });
    await screen.findByText('version 1');
    expect(api.bootstrap).toHaveBeenCalledTimes(loads);
  });

  it('still reloads the bootstrap for other areas, and leaves the count alone', async () => {
    await start();
    const loads = api.bootstrap.mock.calls.length;
    send({ type: 'brain-changed', area: 'clients' });
    await waitFor(() => expect(api.bootstrap.mock.calls.length).toBe(loads + 1));
    expect(screen.getByText('version 0')).toBeTruthy();
  });

  it('counts up when a hello shows the server restarted, not when it is the same server', async () => {
    await start();
    send({ type: 'hello', serverStartedAt: 'T1' });
    expect(screen.getByText('version 0')).toBeTruthy();
    send({ type: 'hello', serverStartedAt: 'T1' });
    expect(screen.getByText('version 0')).toBeTruthy();
    send({ type: 'hello', serverStartedAt: 'T2' });
    await screen.findByText('version 1');
  });
});
