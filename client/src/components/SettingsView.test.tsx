// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt } from '../installPrompt.ts';

const boot = {
  appVersion: '1.0.0',
  service: { underService: true },
  prefs: { directWrites: false },
  identity: { name: 'Sam', role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', permissionMode: 'default' },
};
const live = { streamUp: true, lastSync: new Date().toISOString() as string | null | undefined };
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    boot,
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

const { SettingsView } = await import('./SettingsView.tsx');

const standalone = (on: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: on }) as MediaQueryList);
const chromeEvent = (type: string, extra: object = {}) =>
  act(async () => {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), extra));
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  live.streamUp = true;
  live.lastSync = new Date().toISOString();
});

describe('health panel', () => {
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
