// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The whole app with the real store and a fake server: what the Settings tabs do to the sheet.
const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(),
  changelog: vi.fn(async () => ({ versions: [] })),
  updatePrefs: vi.fn(),
  engineChoices: vi.fn(async () => ({ models: [], claudeCode: { model: null } })),
  usageSavings: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));
vi.mock('../tools/ad-manager/use-ads-due.ts', () => ({ useAdsDue: () => {} }));

interface StoreCalls {
  openView: (v: string) => void;
  requestSettingsFocus: (id?: string) => void;
  openSettings: (tab?: string, focusId?: string) => void;
}

// Home hands out the real store, so a test can make the same calls the chat's "Change" button and the to-dos link make.
const grab = vi.hoisted(() => ({ store: null as null | StoreCalls }));
const store = () => grab.store as StoreCalls;
vi.mock('../shell/Home.tsx', async () => {
  const { useStore } = await import('../store.tsx');
  const { SheetBar } = await import('../shell/SheetBar.tsx');
  return {
    Home: () => {
      grab.store = useStore() as unknown as typeof grab.store;
      return <SheetBar title="Home" />;
    },
  };
});

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

const { App } = await import('../App.tsx');

const boot = (over: Record<string, unknown> = {}, prefs: Record<string, unknown> = {}) => ({
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false, tourSeen: 1, ...prefs },
  ...over,
});

const z = { saved: 0, reused: 0, bySource: {} };
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot());
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.sync.mockResolvedValue({ lastSync: null });
  api.usageSavings.mockResolvedValue({
    since: null,
    today: z,
    last7: z,
    last30: z,
    all: z,
    kitsMode: 'off',
    team: null,
  });
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  grab.store = null;
});

const tabs = () => screen.getByRole('navigation', { name: 'Settings sections' });
const tab = (name: string | RegExp) => {
  const nav = tabs();
  return Array.from(nav.querySelectorAll('button')).find((b) =>
    typeof name === 'string' ? b.textContent?.startsWith(name) : name.test(b.textContent ?? ''),
  ) as HTMLButtonElement;
};

async function openSettings() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  fireEvent.click(await screen.findByRole('button', { name: /^Settings/ }));
  await screen.findByRole('navigation', { name: 'Settings sections' });
}
const heading = (level: number) => screen.getByRole('heading', { level });

describe('Settings tabs, in the real app', () => {
  it('opens on General, with the tab name hidden in the title', async () => {
    await openSettings();
    expect(tab('General').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Claude in chats' })).toBeNull();
    expect(heading(1).textContent).toBe('Settings: General');
  });

  it('puts ": Claude" in the hidden title and keeps focus on the pressed tab', async () => {
    await openSettings();
    const claude = tab('Claude');
    claude.focus();
    fireEvent.click(claude);
    await screen.findByRole('heading', { name: 'Claude in chats' });
    expect(heading(1).textContent).toBe('Settings: Claude');
    expect(heading(1).querySelector('.visually-hidden')?.textContent).toBe(': Claude');
    expect(document.activeElement).toBe(tab('Claude'));
  });

  it('remembers the tab after leaving Settings and coming back', async () => {
    await openSettings();
    fireEvent.click(tab('About'));
    await screen.findByRole('heading', { name: /^About TDS Cortex/ });
    act(() => store().openView('chat'));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    fireEvent.click(await screen.findByRole('button', { name: /^Settings/ }));
    await screen.findByRole('heading', { name: /^About TDS Cortex/ });
    expect(tab('About').getAttribute('aria-current')).toBe('page');
  });

  it('lands the chat "Change" button on the Claude tab with Model focused', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    act(() => {
      store().requestSettingsFocus();
      store().openView('settings');
    });
    await screen.findByRole('heading', { name: 'Claude in chats' });
    await waitFor(() => expect(document.activeElement?.id).toBe('set-model'));
  });

  it('lands on the chosen Level option when the level is automatic (no Model box)', async () => {
    api.bootstrap.mockResolvedValue(boot({}, { levelMode: 'auto' }));
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    act(() => {
      store().requestSettingsFocus();
      store().openView('settings');
    });
    await screen.findByRole('heading', { name: 'Claude in chats' });
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Automatic (recommended)'),
    );
  });

  it('lands the to-dos link on General with the switch focused', async () => {
    await openSettings();
    fireEvent.click(tab('About'));
    await screen.findByRole('heading', { name: /^About TDS Cortex/ });
    act(() => store().openSettings('general', 'set-direct'));
    await screen.findByRole('heading', { name: 'Preferences' });
    await waitFor(() => expect(document.activeElement?.id).toBe('set-direct'));
    expect(tab('General').getAttribute('aria-current')).toBe('page');
  });

  it('waits for an inert sheet (a closing drawer or panel) before focusing the switch', async () => {
    await openSettings();
    fireEvent.click(tab('About'));
    await screen.findByRole('heading', { name: /^About TDS Cortex/ });
    const main = document.querySelector('main') as HTMLElement;
    main.setAttribute('inert', '');
    act(() => store().openSettings('general', 'set-direct'));
    await screen.findByRole('heading', { name: 'Preferences' });
    // focus() inside an inert page does nothing in a browser; jsdom would allow it, so this proves the wait.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement?.id).not.toBe('set-direct');
    main.removeAttribute('inert');
    await waitFor(() => expect(document.activeElement?.id).toBe('set-direct'));
  });

  it('clears a focus request for an element on another tab, so it never steals focus later', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    act(() => store().openSettings('claude', 'set-direct'));
    await screen.findByRole('heading', { name: 'Claude in chats' });
    await waitFor(() => expect(document.activeElement?.id).not.toBe('set-direct'));
    const general = tab('General');
    general.focus();
    fireEvent.click(general);
    await screen.findByRole('heading', { name: 'Preferences' });
    expect(document.activeElement).toBe(tab('General'));
  });

  it('shows the Health dot from another tab, and survives a tab switch without another sync call', async () => {
    await openSettings();
    const health = await waitFor(() => {
      const b = tab('Health');
      expect(b.getAttribute('aria-label')).toMatch(/^Health, .*need.*attention/);
      return b;
    });
    expect(health.querySelector('.health-dot[data-state="problem"]')).toBeTruthy();
    expect(health.querySelector('.count')).toBeNull();
    const calls = api.sync.mock.calls.length;
    fireEvent.click(tab('Claude'));
    await screen.findByRole('heading', { name: 'Claude in chats' });
    fireEvent.click(tab('About'));
    await screen.findByRole('heading', { name: /^About TDS Cortex/ });
    expect(tab('Health').querySelector('.health-dot[data-state="problem"]')).toBeTruthy();
    expect(api.sync.mock.calls.length).toBe(calls);
  });

  it('hides the Skill levels tab without levels, and shows it with them', async () => {
    await openSettings();
    expect(tab('Skill levels')).toBeUndefined();
    cleanup();
    api.bootstrap.mockResolvedValue(boot({ skillLevels: { levels: {}, canSet: false, writable: true } }));
    await openSettings();
    expect(tab('Skill levels')).toBeTruthy();
  });
});
