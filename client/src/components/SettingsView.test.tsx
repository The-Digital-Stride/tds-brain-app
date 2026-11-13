// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt } from '../installPrompt.ts';

const boot = {
  appVersion: '1.0.0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  prefs: { directWrites: false },
  identity: { name: 'Sam', role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', permissionMode: 'default' },
};
const setSetupOpen = vi.fn();
const live = { streamUp: true, lastSync: new Date().toISOString() as string | null | undefined };
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    boot,
    setSetupOpen,
    updatePrefs: vi.fn(),
    streamUp: live.streamUp,
    lists: { todos: 'loaded', chats: 'loaded' },
  }),
}));
vi.mock('../shell/useLastSync.ts', () => ({
  useLastSync: () => ({ lastSync: live.lastSync, now: Date.now() }),
}));
vi.mock('../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: { singleKeys: true }, dispatch: vi.fn() }),
}));

const upd = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../state/update.ts', () => ({ useUpdate: () => upd.current }));

vi.mock('./VersionHistory.tsx', () => ({ VersionHistory: () => <p>History</p> }));

const { SettingsView } = await import('./SettingsView.tsx');

const standalone = (on: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: on }) as MediaQueryList);
const chromeEvent = (type: string, extra: object = {}) =>
  act(async () => {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), extra));
  });

const updStatus = (over: Record<string, unknown> = {}) => ({
  current: '1.0.0',
  latest: '1.0.0',
  available: false,
  blocked: null,
  checkedAt: null,
  checkFailed: false,
  unfinished: false,
  phase: 'idle',
  error: null,
  notes: [],
  openChats: 0,
  ...over,
});
const setUpd = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  upd.current = {
    status: updStatus(over),
    stalled: false,
    checking: false,
    dismissed: false,
    check: vi.fn(),
    start: vi.fn(),
    later: vi.fn(),
    ...extra,
  };
  return upd.current as { check: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
};

afterEach(() => {
  setUpd();
  cleanup();
  vi.unstubAllGlobals();
  live.streamUp = true;
  live.lastSync = new Date().toISOString();
});

describe('health panel', () => {
  it('opens the brain folder page from the Change button', () => {
    standalone(false);
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Change brain folder' }));
    expect(setSetupOpen).toHaveBeenCalledWith(true);
  });

  it('says everything is connected when it is', () => {
    standalone(false);
    render(<SettingsView />);
    expect(screen.getByRole('status').textContent).toBe('Everything is connected and working.');
    expect(screen.getByText('/brain')).toBeTruthy();
  });

  it('names each problem and counts them in the announced summary', () => {
    standalone(false);
    live.streamUp = false;
    live.lastSync = null;
    render(<SettingsView />);
    expect(screen.getByRole('status').textContent).toBe(
      '2 things need attention: Connection and Brain sync.',
    );
    expect(screen.getByText(/^Lost the live connection/)).toBeTruthy();
    // The state is in words too, not only the dot's colour.
    expect(screen.getAllByText('Needs attention')).toHaveLength(2);
    expect(screen.getByText(/has not seen the brain sync yet/)).toBeTruthy();
  });
});

describe('Dock app row', () => {
  it('says installed when running as the installed app', () => {
    standalone(true);
    render(<SettingsView />);
    expect(screen.getByText('Installed. TDS Brain is in your Dock.')).toBeTruthy();
  });

  it('walks manual, button, dismissed, then added', async () => {
    standalone(false);
    captureInstallPrompt();
    render(<SettingsView />);
    expect(screen.getByText(/If TDS Brain isn't in your Dock yet/)).toBeTruthy();
    const prompt = vi.fn().mockResolvedValue(undefined);
    await chromeEvent('beforeinstallprompt', {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add TDS Brain to your Dock' }));
    });
    expect(prompt).toHaveBeenCalled();
    expect(screen.getByText("Not added. You can add it later from Chrome's menu.")).toBeTruthy();
    await chromeEvent('appinstalled');
    expect(screen.getByText('Added. TDS Brain is in your Dock.')).toBeTruthy();
  });
});

describe("what's changed", () => {
  it('is shown to owners and scouts only', () => {
    standalone(false);
    for (const role of ['team', 'unknown']) {
      boot.identity.role = role;
      render(<SettingsView />);
      expect(screen.queryByRole('heading', { name: "What's changed" })).toBeNull();
      cleanup();
    }
    for (const role of ['owner', 'scout']) {
      boot.identity.role = role;
      render(<SettingsView />);
      expect(screen.getByRole('heading', { name: "What's changed" })).toBeTruthy();
      cleanup();
    }
    boot.identity.role = 'team';
  });
});

describe('check for updates', () => {
  it('shows phase words while running, and the error with Try again when failed', () => {
    standalone(false);
    setUpd({ available: true, phase: 'building' });
    const { unmount } = render(<SettingsView />);
    expect(screen.getByText('Building the update…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull();
    unmount();
    const h = setUpd({ available: true, phase: 'failed', error: "The update couldn't be built." });
    render(<SettingsView />);
    expect(screen.getByText(/couldn't be built/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('checks by hand and shows Checking… while it runs', () => {
    standalone(false);
    const h = setUpd();
    const { unmount } = render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(h.check).toHaveBeenCalledTimes(1);
    unmount();
    setUpd({}, { checking: true });
    render(<SettingsView />);
    const busy = screen.getByRole('button', { name: 'Checking…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(busy);
    expect(upd.current.check).not.toHaveBeenCalled();
  });

  it('says you have the newest version, with the time of the last check', () => {
    standalone(false);
    setUpd({ checkedAt: '2026-11-13T14:05:00' });
    render(<SettingsView />);
    expect(screen.getByText(/You have the newest version\./)).toBeTruthy();
    expect(screen.getByText(/Last checked 14:05/)).toBeTruthy();
  });

  it('offers the update when a newer version is ready', () => {
    standalone(false);
    const h = setUpd({ available: true, latest: '1.1.0', checkedAt: '2026-11-13T14:05:00' });
    render(<SettingsView />);
    expect(screen.getByText(/1\.1\.0 is available\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('says why this copy cannot update itself', () => {
    standalone(false);
    setUpd({ blocked: 'not-git' });
    render(<SettingsView />);
    expect(screen.getByText(/wasn't installed from GitHub/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull();
  });

  it('says when GitHub could not be reached', () => {
    standalone(false);
    setUpd({ checkFailed: true });
    render(<SettingsView />);
    expect(screen.getByText(/Couldn't check for updates/)).toBeTruthy();
  });
});
