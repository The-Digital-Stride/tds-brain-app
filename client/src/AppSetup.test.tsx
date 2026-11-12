// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('./store.tsx', () => ({
  StoreProvider: ({ children }: { children: unknown }) => children,
  useStore: () => store.value,
}));
vi.mock('./api.ts', () => ({
  api: {
    getSetupCandidates: () =>
      Promise.resolve({ candidates: [], current: null, openChats: 0, envOverride: false }),
  },
}));
vi.mock('./components/Attachments.tsx', () => ({ useBlockStrayDrops: () => {} }));

const { App } = await import('./App.tsx');

afterEach(cleanup);

describe('App', () => {
  it('shows the Setup page when boot says setup, before anything else', () => {
    store.value = {
      gate: 'ready',
      retry: vi.fn(),
      setupOpen: false,
      setSetupOpen: vi.fn(),
      boot: {
        appState: { kind: 'setup', tried: null, source: null, reason: null },
        brain: { ok: false, path: '/x', problems: [] },
        engine: { ok: true },
        service: { underService: true },
      },
    };
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Choose your brain folder' })).toBeTruthy();
  });

  it('shows the Setup page with Cancel when opened from elsewhere, and Cancel closes it', () => {
    const setSetupOpen = vi.fn();
    store.value = {
      gate: 'ready',
      retry: vi.fn(),
      setupOpen: true,
      setSetupOpen,
      boot: {
        appState: { kind: 'ready' },
        brain: { ok: true, path: '/brain', problems: [] },
        engine: { ok: true },
        service: { underService: true },
      },
    };
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Choose your brain folder' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(setSetupOpen).toHaveBeenCalledWith(false);
  });

  it('BootProblem offers a different folder when the brain is found but unhealthy', () => {
    const setSetupOpen = vi.fn();
    store.value = {
      gate: 'ready',
      retry: vi.fn(),
      setupOpen: false,
      setSetupOpen,
      boot: {
        appState: { kind: 'ready' },
        brain: { ok: false, path: '/brain', problems: ['No team list found'] },
        engine: { ok: true },
        service: { underService: true },
      },
    };
    render(<App />);
    expect(screen.getByRole('heading', { name: "There's a problem with your brain folder" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different folder' }));
    expect(setSetupOpen).toHaveBeenCalledWith(true);
  });
});
