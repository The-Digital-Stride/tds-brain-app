// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppPrefs, DEFAULT_PREFS } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  updatePrefs: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

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

const { StoreProvider, useStore } = await import('./store.tsx');

let toggle: ((id: string) => Promise<void>) | null = null;
let pin: ((name: string) => Promise<void>) | null = null;
function Probe() {
  const store = useStore();
  toggle = store.toggleFavouriteChat;
  pin = store.togglePin;
  return (
    <p>
      favs {store.boot ? (store.boot.prefs.favouriteChats ?? []).join(' ') || 'none' : 'loading'}
      {store.actionError ? `, error ${store.actionError}` : ''}
    </p>
  );
}

const prefs = { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false };
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
  // No favouriteChats: an older server sends none, which reads as none.
  prefs,
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
  toggle = null;
});

async function start() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(screen.getByText('favs none')).toBeTruthy());
}

describe('toggleFavouriteChat', () => {
  it('stars at once, and two quick taps each build on the one before', async () => {
    const replies: ((p: AppPrefs) => void)[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((r) => replies.push(r)));
    await start();
    await act(async () => {
      void toggle?.('a');
      void toggle?.('b');
    });
    expect(screen.getByText('favs a b')).toBeTruthy();
    expect(api.updatePrefs.mock.calls.map((c) => c[0])).toEqual([
      { favouriteChats: ['a'] },
      { favouriteChats: ['a', 'b'] },
    ]);
    // The newer reply lands first; the older one arriving late must not undo it.
    await act(async () => replies[1]?.({ ...DEFAULT_PREFS, favouriteChats: ['a', 'b'] }));
    await act(async () => replies[0]?.({ ...DEFAULT_PREFS, favouriteChats: ['a'] }));
    expect(screen.getByText('favs a b')).toBeTruthy();
  });

  it('puts the list back and shows the error when the save fails', async () => {
    api.updatePrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, favouriteChats: ['a'] });
    await start();
    await act(async () => toggle?.('a'));
    expect(screen.getByText('favs a')).toBeTruthy();
    api.updatePrefs.mockRejectedValueOnce(new Error('Could not save.'));
    await act(async () => toggle?.('b'));
    expect(screen.getByText(/favs a, error/)).toBeTruthy();
  });

  it('shows only what was saved when two quick saves both fail', async () => {
    const fails: ((e: Error) => void)[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((_, no) => fails.push(no)));
    await start();
    await act(async () => {
      void toggle?.('a');
      void toggle?.('b');
    });
    expect(screen.getByText('favs a b')).toBeTruthy();
    await act(async () => fails[0]?.(new Error('Could not save.')));
    await act(async () => fails[1]?.(new Error('Could not save.')));
    expect(screen.getByText(/favs none, error/)).toBeTruthy();
  });

  it("keeps a star that is still saving when another setting's reply lands", async () => {
    const replies: ((p: AppPrefs) => void)[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((r) => replies.push(r)));
    await start();
    await act(async () => {
      void pin?.('gm');
      void toggle?.('a');
    });
    // The pin's reply was made before the star reached the server, so it has no stars.
    await act(async () => replies[0]?.({ ...DEFAULT_PREFS, pins: ['gm'] }));
    expect(screen.getByText('favs a')).toBeTruthy();
    await act(async () => {
      void toggle?.('b');
    });
    expect(api.updatePrefs.mock.calls.at(-1)?.[0]).toEqual({ favouriteChats: ['a', 'b'] });
  });

  it('shows a star that an older tap saved after the newer tap failed', async () => {
    const calls: { ok: (p: AppPrefs) => void; no: (e: Error) => void }[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((ok, no) => calls.push({ ok, no })));
    await start();
    await act(async () => {
      void toggle?.('a');
      void toggle?.('b');
    });
    await act(async () => calls[1]?.no(new Error('Could not save.')));
    await act(async () => calls[0]?.ok({ ...DEFAULT_PREFS, favouriteChats: ['a'] }));
    expect(screen.getByText(/favs a, error/)).toBeTruthy();
  });

  it('does not let a late reply to an older tap stand in for the newer saved list', async () => {
    const calls: { ok: (p: AppPrefs) => void; no: (e: Error) => void }[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((ok, no) => calls.push({ ok, no })));
    await start();
    await act(async () => {
      void toggle?.('a');
      void toggle?.('b');
    });
    await act(async () => calls[1]?.ok({ ...DEFAULT_PREFS, favouriteChats: ['a', 'b'] }));
    await act(async () => calls[0]?.ok({ ...DEFAULT_PREFS, favouriteChats: ['a'] }));
    await act(async () => {
      void toggle?.('c');
    });
    await act(async () => calls[2]?.no(new Error('Could not save.')));
    expect(screen.getByText(/favs a b, error/)).toBeTruthy();
  });
});
