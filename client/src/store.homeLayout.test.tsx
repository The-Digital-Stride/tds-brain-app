// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppPrefs, type Bootstrap, DEFAULT_PREFS, type HomeShortcut } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  updatePrefs: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

const streams: FakeEventSource[] = [];
class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    streams.push(this);
  }
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { StoreProvider, useStore } = await import('./store.tsx');

let store: ReturnType<typeof useStore> | null = null;
function Probe() {
  store = useStore();
  const s = store;
  const list = (l: readonly unknown[] | undefined) =>
    l === undefined
      ? 'unknown'
      : l.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') || 'none';
  return (
    <>
      <p>
        hidden {s.boot ? list(s.homeHidden) : 'loading'}
        {s.actionError ? `, error ${s.actionError}` : ''}
      </p>
      <p>shortcuts {s.boot ? (s.homeShortcuts?.length ?? 'unknown') : 'loading'}</p>
      <p>favs {s.boot ? (s.boot.prefs.favouriteChats ?? []).join(' ') || 'none' : 'loading'}</p>
    </>
  );
}

const prefs: AppPrefs = { ...DEFAULT_PREFS };
const boot = (p: Partial<AppPrefs> = {}) =>
  ({
    appVersion: '0',
    appState: { kind: 'ready' as const },
    service: { underService: true },
    identity: { name: 'Sam', slug: 'sam', email: null, role: 'team', knownMember: true },
    brain: { ok: true, path: '/brain', problems: [] },
    engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
    skills: [],
    clients: [],
    usedOften: [],
    prefs: { ...prefs, ...p },
  }) as unknown as Bootstrap;

/** The server's answer to a save: what it holds after the patch. */
const echo = async (patch: Partial<AppPrefs>) => ({ ...DEFAULT_PREFS, ...patch });

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot());
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  streams.length = 0;
  store = null;
});

async function start() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(screen.getByText('hidden none')).toBeTruthy());
  await waitFor(() => expect(streams.length).toBeGreaterThan(0));
}

/** The brain changed: the store reloads the bootstrap. Answers it only when the test says. */
function brainChanged(): (b: Bootstrap) => Promise<void> {
  let answer: (b: Bootstrap) => void = () => {};
  api.bootstrap.mockImplementationOnce(() => new Promise<Bootstrap>((r) => (answer = r)));
  act(() => {
    streams.at(-1)?.onmessage?.({
      data: JSON.stringify({ kind: 'app', event: { type: 'brain-changed', area: 'skills' } }),
    });
  });
  expect(api.bootstrap).toHaveBeenCalledTimes(2);
  return async (b) => {
    await act(async () => answer(b));
  };
}

const skill = (name: string): HomeShortcut => ({ kind: 'skill', name });

describe('setHomeItemShown', () => {
  it('hides at once, before the save returns', async () => {
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>(() => {}));
    await start();
    act(() => store?.setHomeItemShown('files', false));
    expect(screen.getByText('hidden files')).toBeTruthy();
    expect(api.updatePrefs).toHaveBeenCalledWith({ homeHidden: ['files'] });
  });

  it('keeps the newest choice when a quick hide and show are answered out of order', async () => {
    const replies: ((p: AppPrefs) => void)[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((r) => replies.push(r)));
    await start();
    act(() => {
      store?.setHomeItemShown('files', false);
      store?.setHomeItemShown('files', true);
    });
    expect(screen.getByText('hidden none')).toBeTruthy();
    expect(api.updatePrefs.mock.calls.map((c) => c[0])).toEqual([
      { homeHidden: ['files'] },
      { homeHidden: [] },
    ]);
    await act(async () => replies[1]?.({ ...DEFAULT_PREFS, homeHidden: [] }));
    await act(async () => replies[0]?.({ ...DEFAULT_PREFS, homeHidden: ['files'] }));
    expect(screen.getByText('hidden none')).toBeTruthy();
  });

  it('sends nothing when the item is already as asked', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    act(() => store?.setHomeItemShown('files', true));
    expect(api.updatePrefs).not.toHaveBeenCalled();
  });

  it('puts back the saved list and shows the error when the save fails', async () => {
    api.updatePrefs.mockImplementationOnce(echo);
    await start();
    await act(async () => store?.setHomeItemShown('meetings', false));
    expect(screen.getByText('hidden meetings')).toBeTruthy();
    api.updatePrefs.mockRejectedValueOnce(new Error('Could not save.'));
    await act(async () => store?.setHomeItemShown('files', false));
    expect(screen.getByText(/^hidden meetings, error/)).toBeTruthy();
  });

  it("keeps a hide that is still saving when another setting's reply lands", async () => {
    const replies: ((p: AppPrefs) => void)[] = [];
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>((r) => replies.push(r)));
    await start();
    await act(async () => {
      void store?.togglePin('gm');
      store?.setHomeItemShown('files', false);
    });
    await act(async () => replies[0]?.({ ...DEFAULT_PREFS, pins: ['gm'] }));
    expect(screen.getByText('hidden files')).toBeTruthy();
  });
});

describe('a bootstrap begun before a save', () => {
  it('does not undo a Home choice when it lands after the save', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    const answer = brainChanged();
    await act(async () => store?.setHomeItemShown('files', false));
    expect(screen.getByText('hidden files')).toBeTruthy();
    // The reload was read before the save reached the server.
    await answer(boot({ homeHidden: [] }));
    expect(screen.getByText('hidden files')).toBeTruthy();
  });

  it('does not undo a Home choice whose save is still on its way', async () => {
    api.updatePrefs.mockImplementation(() => new Promise<AppPrefs>(() => {}));
    await start();
    const answer = brainChanged();
    act(() => store?.setHomeItemShown('files', false));
    await answer(boot({ homeHidden: [] }));
    expect(screen.getByText('hidden files')).toBeTruthy();
  });

  it('does not undo a favourite star either', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    const answer = brainChanged();
    await act(async () => store?.toggleFavouriteChat('a'));
    expect(screen.getByText('favs a')).toBeTruthy();
    await answer(boot({ favouriteChats: [] }));
    expect(screen.getByText('favs a')).toBeTruthy();
  });

  it('a bootstrap begun after the save is taken as it is', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    await act(async () => store?.setHomeItemShown('files', false));
    // Another tab showed it again: this reload began after the save, so it is the truth.
    const answer = brainChanged();
    await answer(boot({ homeHidden: [], favouriteChats: ['z'] }));
    expect(screen.getByText('hidden none')).toBeTruthy();
    expect(screen.getByText('favs z')).toBeTruthy();
  });
});

describe('Home shortcuts', () => {
  it('adds in order, ignores a repeat and anything past six', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) await act(async () => store?.addHomeShortcut(skill(n)));
    expect(screen.getByText('shortcuts 6')).toBeTruthy();
    expect(api.updatePrefs).toHaveBeenCalledTimes(6);
    await act(async () => store?.addHomeShortcut(skill('a')));
    await act(async () => store?.addHomeShortcut(skill('g')));
    expect(api.updatePrefs).toHaveBeenCalledTimes(6);
    expect(store?.homeShortcuts?.map((s) => (s.kind === 'skill' ? s.name : s.tool))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('ignores a repeat by key, tools included', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    await act(async () => store?.addHomeShortcut({ kind: 'tool', section: 'workbench', tool: 'ads' }));
    await act(async () => store?.addHomeShortcut({ kind: 'tool', section: 'workbench', tool: 'ads' }));
    expect(api.updatePrefs).toHaveBeenCalledTimes(1);
    expect(screen.getByText('shortcuts 1')).toBeTruthy();
  });

  it('removes one by its key', async () => {
    api.updatePrefs.mockImplementation(echo);
    await start();
    await act(async () => store?.addHomeShortcut(skill('a')));
    await act(async () => store?.addHomeShortcut({ kind: 'tool', section: 'workbench', tool: 'ads' }));
    await act(async () => store?.removeHomeShortcut('tool:workbench/ads'));
    expect(api.updatePrefs).toHaveBeenLastCalledWith({ homeShortcuts: [skill('a')] });
    expect(screen.getByText('shortcuts 1')).toBeTruthy();
  });

  it('showAllHomeItems clears the hidden list only and leaves shortcuts alone', async () => {
    api.updatePrefs.mockImplementation(echo);
    api.bootstrap.mockResolvedValue(boot({ homeHidden: ['files', 'ads'], homeShortcuts: [skill('a')] }));
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getByText('hidden files ads')).toBeTruthy());
    await act(async () => store?.showAllHomeItems());
    expect(api.updatePrefs).toHaveBeenCalledTimes(1);
    expect(api.updatePrefs).toHaveBeenCalledWith({ homeHidden: [] });
    expect(screen.getByText('hidden none')).toBeTruthy();
    expect(screen.getByText('shortcuts 1')).toBeTruthy();
  });
});

describe('an older server', () => {
  it('sends no Home fields, which reads as unknown', async () => {
    const { homeHidden: _h, homeShortcuts: _s, ...old } = DEFAULT_PREFS;
    api.bootstrap.mockResolvedValue({ ...boot(), prefs: old });
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getByText('hidden unknown')).toBeTruthy());
    expect(screen.getByText('shortcuts unknown')).toBeTruthy();
  });
});
