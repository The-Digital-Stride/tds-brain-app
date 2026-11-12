// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt } from '../installPrompt.ts';

const boot = {
  appVersion: '1.0.0',
  prefs: { directWrites: false },
  identity: { name: 'Sam', role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', permissionMode: 'default' },
};
vi.mock('../store.tsx', () => ({ useStore: () => ({ boot, updatePrefs: vi.fn() }) }));
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
