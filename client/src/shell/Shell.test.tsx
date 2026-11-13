// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, LiveSession, StreamFrame } from '../../../shared/contract.ts';
import type { AppSlot } from './contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  close: vi.fn(),
  interrupt: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));

const apps = vi.hoisted(() => [] as AppSlot[]);
vi.mock('./apps.ts', () => ({ APPS: apps }));

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

const { App } = await import('../App.tsx');
const { Fold } = await import('./Fold.tsx');
const { useShell } = await import('./ShellProvider.tsx');
const { useStore } = await import('../store.tsx');

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: {
    name: 'Sam Example',
    slug: 'sam-example',
    email: null,
    role: 'scout',
    knownMember: true,
  },
  profile: { title: 'Head of Search', departments: ['SEO', 'Content'], owns: 'Runs search delivery.' },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};

const liveChat: LiveSession = {
  id: 's1',
  sdkSessionId: null,
  title: 'Report check',
  client: null,
  todoId: null,
  state: 'idle',
  startedAt: '',
  lastActivityAt: '',
};

function chatEvent(seq: number, event: ChatEvent) {
  const frame: StreamFrame = {
    kind: 'chat',
    sessionId: 's1',
    item: { seq, at: new Date().toISOString(), event },
  };
  act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(frame) }));
}

const drawerDock = () => document.getElementById('drawer') as HTMLElement;
const panelDock = () => document.getElementById('panel') as HTMLElement;
const railButton = (name: string | RegExp) => screen.getByRole('button', { name });

async function renderHome() {
  const view = render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  // Let Home's message box take its first focus before a test moves focus anywhere.
  const box = screen.getByRole('textbox', { name: 'Message to Claude' });
  await waitFor(() => expect(document.activeElement).toBe(box));
  return view;
}

function openWithClick(button: HTMLElement) {
  // A real click focuses the button first; jsdom's fireEvent.click doesn't.
  button.focus();
  fireEvent.click(button);
}

function press(key: string, target: Element = document.activeElement ?? document.body, repeat = false) {
  fireEvent.keyDown(target, { key, repeat });
}

async function renderLiveChat() {
  sessionStorage.setItem('tds-brain-open-chat', 's1');
  api.sessions.mockResolvedValue({ live: [liveChat], past: [] });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Report check' });
  (document.activeElement as HTMLElement | null)?.blur();
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.close.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  apps.length = 0;
  vi.clearAllMocks();
});

describe('the rail', () => {
  it('the person at the foot opens their Profile, with their title, departments and day-to-day work from the brain', async () => {
    await renderHome();
    const me = railButton('Sam Example, Scout: your profile');
    fireEvent.click(me);
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
    expect(me.getAttribute('aria-current')).toBe('page');
    expect(railButton('Home').hasAttribute('aria-current')).toBe(false);
    const depts = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(depts).toEqual(['SEO', 'Content']);
    expect(screen.getByText('Head of Search')).toBeTruthy();
    expect(screen.getByText('Runs search delivery.')).toBeTruthy();
  });

  it('starts as icons with names in aria-label, and the toggle shows the names', async () => {
    await renderHome();
    const home = railButton('Home');
    expect(home.getAttribute('aria-label')).toBe('Home');
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Main' }).getAttribute('data-wide')).toBe('false');

    fireEvent.click(railButton('Show names'));
    expect(screen.getByRole('navigation', { name: 'Main' }).getAttribute('data-wide')).toBe('true');
    expect(railButton('Home').hasAttribute('aria-label')).toBe(false);
    expect(railButton('Home').textContent).toBe('Home');
    expect(railButton('Settings').hasAttribute('aria-label')).toBe(false);

    fireEvent.click(railButton('Icons only'));
    expect(railButton('Show names')).toBeTruthy();
    expect(railButton('Home').getAttribute('aria-label')).toBe('Home');
  });

  it('keeps the names toggle an icon at the top of the rail, with no visible words', async () => {
    await renderHome();
    const toggle = railButton('Show names');
    expect(toggle.closest('.rail-brand')).toBeTruthy();
    expect(toggle.textContent).toBe('');
  });

  it('shows no Apps group while there are no apps', async () => {
    await renderHome();
    expect(screen.queryByText('Apps')).toBeNull();
  });

  it('names the Chats button with how many are open and need an answer', async () => {
    sessionStorage.setItem('tds-brain-open-chat', 's1');
    api.sessions.mockResolvedValue({
      live: [liveChat, { ...liveChat, id: 's2', title: 'Other', state: 'waiting' }],
      past: [],
    });
    render(<App />);
    await screen.findByRole('button', { name: 'Chats, 2 open, 1 needs your answer' });
  });
});

describe('the left dock', () => {
  it('is inert and hidden while closed; the right one too', async () => {
    await renderHome();
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    expect(drawerDock().getAttribute('aria-hidden')).toBe('true');
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(panelDock().getAttribute('aria-hidden')).toBe('true');
  });

  it('a drawer button sets aria-expanded, moves focus in, and Esc returns focus to it', async () => {
    await renderHome();
    const todos = railButton('To-dos');
    expect(todos.getAttribute('aria-expanded')).toBe('false');
    expect(todos.getAttribute('aria-controls')).toBe('drawer');

    openWithClick(todos);
    expect(todos.getAttribute('aria-expanded')).toBe('true');
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    expect(drawerDock().getAttribute('aria-label')).toBe('To-dos');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'To-dos' }));

    press('Escape');
    expect(todos.getAttribute('aria-expanded')).toBe('false');
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(todos);
  });

  it('opening another drawer swaps it, and the rail button closes its own', async () => {
    await renderHome();
    openWithClick(railButton('Chats'));
    expect(drawerDock().getAttribute('aria-label')).toBe('Chats');
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
    openWithClick(railButton('Skills'));
    expect(drawerDock().getAttribute('aria-label')).toBe('Skills');
    expect(railButton('Chats').getAttribute('aria-expanded')).toBe('false');
    openWithClick(railButton('Skills'));
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(railButton('Skills'));
  });

  it('an Esc already handled (the close confirm) leaves the drawer open; the next Esc closes it', async () => {
    sessionStorage.setItem('tds-brain-open-chat', 's1');
    api.sessions.mockResolvedValue({ live: [liveChat], past: [] });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Report check' });
    chatEvent(1, { type: 'state', state: 'working' });

    const chats = railButton(/^Chats/);
    openWithClick(chats);
    expect(chats.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    const keep = screen.getByRole('button', { name: 'Keep open' });
    press('Escape', keep);
    expect(screen.queryByText(/Close anyway/)).toBeNull();
    expect(chats.getAttribute('aria-expanded')).toBe('true');
    expect(api.close).not.toHaveBeenCalled();

    press('Escape', document.body);
    expect(chats.getAttribute('aria-expanded')).toBe('false');
  });

  it('a synthetic Esc that something else prevented is ignored', async () => {
    await renderHome();
    openWithClick(railButton('To-dos'));
    const heading = screen.getByRole('heading', { level: 2, name: 'To-dos' });
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      heading.dispatchEvent(handled);
    });
    expect(drawerDock().hasAttribute('inert')).toBe(false);
  });

  it('floats with a veil on a narrow window, making the rest of the desk inert', async () => {
    vi.stubGlobal('innerWidth', 800);
    await renderHome();
    openWithClick(railButton('To-dos'));
    const dock = drawerDock().parentElement as HTMLElement;
    expect(dock.getAttribute('data-overlay')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Main', hidden: true }).hasAttribute('inert')).toBe(true);
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(true);

    const veil = dock.querySelector('.veil') as HTMLElement;
    fireEvent.click(veil);
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(false);
  });
});

describe('keys and memory', () => {
  it('t, c and s open drawers when not typing, but not while typing in the message box', async () => {
    await renderHome();
    const box = screen.getByRole('textbox', { name: 'Message to Claude' });
    box.focus();
    press('t', box);
    expect(drawerDock().hasAttribute('inert')).toBe(true);

    box.blur();
    press('t', document.body);
    expect(drawerDock().getAttribute('aria-label')).toBe('To-dos');
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    press('s', document.body);
    expect(drawerDock().getAttribute('aria-label')).toBe('Skills');
  });

  it('remembers the open drawer, and reopens it on load without moving focus', async () => {
    const first = await renderHome();
    openWithClick(railButton('Skills'));
    expect(JSON.parse(localStorage.getItem('tds-brain-shell') ?? '{}').drawer).toBe('skills');
    first.unmount();

    await renderHome();
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    expect(drawerDock().getAttribute('aria-label')).toBe('Skills');
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 2, name: 'Skills' }));
  });

  it('does not reopen a saved drawer that would float', async () => {
    localStorage.setItem('tds-brain-shell', JSON.stringify({ drawer: 'skills' }));
    vi.stubGlobal('innerWidth', 800);
    await renderHome();
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(false);
  });

  it('survives storage that throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await renderHome();
      openWithClick(railButton('To-dos'));
      expect(drawerDock().hasAttribute('inert')).toBe(false);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

function AdsSheet() {
  return <p>The ads app</p>;
}

describe('app slots', () => {
  it('a registered app shows on the rail and opens its sheet; an unknown app id shows Home', async () => {
    apps.push({ id: 'ads', title: 'Ads', icon: 'skills', Sheet: AdsSheet, search: null });
    const view = await renderHome();
    expect(screen.getByText('Apps')).toBeTruthy();

    fireEvent.click(railButton('Ads'));
    await screen.findByRole('heading', { level: 1, name: 'Ads' });
    expect(screen.getByText('The ads app')).toBeTruthy();
    expect(railButton('Ads').getAttribute('aria-current')).toBe('page');
    expect(railButton('Home').hasAttribute('aria-current')).toBe(false);

    // The view is still app:ads, but no app has that id any more.
    apps.length = 0;
    view.rerender(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy());
    expect(screen.queryByText('The ads app')).toBeNull();
    expect(railButton('Home').getAttribute('aria-current')).toBe('page');
  });
});

function AdsPanel() {
  return <p>The ads panel</p>;
}
/** A sheet-bar button that shows or hides the panel, as an app's own would. */
function ToggleBar() {
  const { dispatch } = useShell();
  return (
    <button type="button" onClick={() => dispatch({ type: 'toggle-panel' })}>
      Ad details
    </button>
  );
}
/** A panel with a way out of the app: it starts a new chat. */
function LeavingPanel() {
  const { newChat } = useStore();
  return (
    <button type="button" onClick={() => newChat()}>
      Ask about it
    </button>
  );
}
function AdsBar() {
  return <button type="button">Ads action</button>;
}

describe('an app with a panel of its own', () => {
  it('fills the right dock under its own heading, adds its bar buttons and holds the rail', async () => {
    vi.stubGlobal('innerWidth', 1280);
    apps.push({
      id: 'ads',
      title: 'Ads',
      icon: 'skills',
      Sheet: AdsSheet,
      search: null,
      Panel: AdsPanel,
      panelLabel: 'Ad details',
      BarActions: AdsBar,
    });
    localStorage.setItem('tds-brain-shell', JSON.stringify({ panelOpen: true, railWide: true }));
    await renderHome();
    // Home has nothing for the panel to show, so it stays shut and the rail keeps its names.
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.desk')?.getAttribute('data-rail')).toBe('wide');

    fireEvent.click(railButton('Ads'));
    await screen.findByText('The ads panel');
    expect(panelDock().hasAttribute('inert')).toBe(false);
    expect(panelDock().getAttribute('aria-label')).toBe('Ad details');
    expect(screen.getByRole('button', { name: 'Ads action' })).toBeTruthy();
    expect(document.querySelector('.desk')?.getAttribute('data-rail')).toBe('icons');
  });

  it('under 1100px, coming back to the app with its panel still open moves focus into the floating panel', async () => {
    vi.stubGlobal('innerWidth', 1000);
    apps.push({
      id: 'ads',
      title: 'Ads',
      icon: 'skills',
      Sheet: AdsSheet,
      search: null,
      Panel: LeavingPanel,
      BarActions: ToggleBar,
    });
    await renderHome();
    fireEvent.click(railButton('Ads'));
    openWithClick(await screen.findByRole('button', { name: 'Ad details' }));
    expect(panelDock().hasAttribute('inert')).toBe(false);

    // Leaving from inside the panel keeps the choice "panel open"; Home has nothing to show in it.
    fireEvent.click(screen.getByRole('button', { name: 'Ask about it' }));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(panelDock().hasAttribute('inert')).toBe(true);

    const rail = railButton('Ads');
    rail.focus();
    fireEvent.click(rail);
    await waitFor(() => expect(panelDock().hasAttribute('inert')).toBe(false));
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(true);
    expect(panelDock().contains(document.activeElement)).toBe(true);
  });

  it('an app without one leaves the panel shut', async () => {
    vi.stubGlobal('innerWidth', 1280);
    apps.push({ id: 'ads', title: 'Ads', icon: 'skills', Sheet: AdsSheet, search: null });
    localStorage.setItem('tds-brain-shell', JSON.stringify({ panelOpen: true }));
    await renderHome();
    fireEvent.click(railButton('Ads'));
    await screen.findByText('The ads app');
    expect(panelDock().hasAttribute('inert')).toBe(true);
  });
});

describe('the two docks give way to each other', () => {
  it('at 1280px, opening a drawer with the panel open swaps them instead of making the desk inert', async () => {
    vi.stubGlobal('innerWidth', 1280);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ panelOpen: true }));
    await renderLiveChat();
    expect(panelDock().hasAttribute('inert')).toBe(false);

    press('t', document.body);
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    expect(drawerDock().getAttribute('aria-label')).toBe('To-dos');
    expect(screen.getByRole('navigation', { name: 'Main' }).hasAttribute('inert')).toBe(false);
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(false);
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(JSON.parse(localStorage.getItem('tds-brain-shell') ?? '{}').panelOpen).toBe(false);
  });

  it('at 1280px, opening the panel with a drawer open closes the drawer', async () => {
    vi.stubGlobal('innerWidth', 1280);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ drawer: 'chats' }));
    await renderLiveChat();
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(panelDock().hasAttribute('inert')).toBe(false);
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(false);
  });

  it('a floating panel closes on Esc and focus returns to its toggle', async () => {
    vi.stubGlobal('innerWidth', 1000);
    await renderLiveChat();
    const toggle = screen.getByRole('button', { name: 'Steps and details' });
    openWithClick(toggle);
    expect(panelDock().hasAttribute('inert')).toBe(false);
    expect((panelDock().parentElement as HTMLElement).getAttribute('data-overlay')).toBe('true');
    const heading = screen.getByRole('heading', { level: 2, name: 'This chat' });
    expect(document.activeElement).toBe(heading);

    press('Escape', heading);
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(document.getElementById('main')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Steps and details' }));
  });
});

describe('single keys', () => {
  it('a held key (auto-repeat) does nothing', async () => {
    await renderHome();
    (document.activeElement as HTMLElement).blur();
    press('t', document.body, true);
    expect(drawerDock().hasAttribute('inert')).toBe(true);
    press('t', document.body);
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    press('t', document.body, true);
    expect(drawerDock().hasAttribute('inert')).toBe(false);
  });

  it('the rail advertises them only while they are switched on', async () => {
    const on = await renderHome();
    expect(railButton('To-dos').getAttribute('aria-keyshortcuts')).toBe('t');
    const jump = () => screen.getByRole('button', { name: 'Search or jump to' });
    expect(jump().getAttribute('aria-keyshortcuts')).toMatch(/ \/$/);
    on.unmount();
    localStorage.setItem('tds-brain-shell', JSON.stringify({ singleKeys: false, railWide: true }));
    await renderHome();
    expect(railButton('To-dos').hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Search or jump to' }).getAttribute('aria-keyshortcuts'),
    ).not.toContain('/');
    expect(railButton('Icons only').hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(railButton('Icons only').querySelector('kbd')).toBeNull();
  });
});

describe('Fold', () => {
  it('a shut fold hides its rows with the hidden attribute', () => {
    render(
      <Fold title="All skills" count={2} defaultOpen={false}>
        <p>Row one</p>
      </Fold>,
    );
    const button = screen.getByRole('button', { name: /All skills/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const rows = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(rows.hasAttribute('hidden')).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(rows.hasAttribute('hidden')).toBe(false);
  });
});

describe('the panel holds the rail to icons', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Main' });
  const saved = () => JSON.parse(localStorage.getItem('tds-brain-shell') ?? '{}');

  it('collapses while the panel shows, keeps railWide, and comes back when it closes', async () => {
    vi.stubGlobal('innerWidth', 1500);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ railWide: true }));
    await renderLiveChat();
    expect(nav().getAttribute('data-wide')).toBe('true');

    const toggle = screen.getByRole('button', { name: 'Steps and details' });
    openWithClick(toggle);
    expect(panelDock().hasAttribute('inert')).toBe(false);
    expect(nav().getAttribute('data-wide')).toBe('false');
    expect(saved().railWide).toBe(true);
    expect(railButton('Home').getAttribute('aria-label')).toBe('Home');

    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(nav().getAttribute('data-wide')).toBe('true');
    expect(saved().railWide).toBe(true);
  });

  it('the toggle shows names while held without changing railWide; the hold returns with the panel', async () => {
    vi.stubGlobal('innerWidth', 1500);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ railWide: true, panelOpen: true }));
    await renderLiveChat();
    expect(nav().getAttribute('data-wide')).toBe('false');

    fireEvent.click(railButton('Show names'));
    expect(nav().getAttribute('data-wide')).toBe('true');
    expect(saved().railWide).toBe(true);
    press('[', document.body);
    expect(nav().getAttribute('data-wide')).toBe('false');
    expect(saved().railWide).toBe(true);
    press('[', document.body);
    expect(nav().getAttribute('data-wide')).toBe('true');

    // Closing the panel ends the override; opening it again holds the rail again.
    const toggle = screen.getByRole('button', { name: 'Steps and details' });
    openWithClick(toggle);
    expect(nav().getAttribute('data-wide')).toBe('true');
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(nav().getAttribute('data-wide')).toBe('false');
  });

  it('opening a left drawer does not collapse the rail', async () => {
    vi.stubGlobal('innerWidth', 1500);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ railWide: true }));
    await renderLiveChat();
    press('c', document.body);
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    expect(nav().getAttribute('data-wide')).toBe('true');
  });
});

describe('sign-off fixes', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Main' });

  it('at 1240px with icons chosen and the panel showing, the rail toggle shows and hides the names', async () => {
    vi.stubGlobal('innerWidth', 1240);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ railWide: false, panelOpen: true }));
    await renderLiveChat();
    expect(panelDock().hasAttribute('inert')).toBe(false);
    expect(nav().getAttribute('data-wide')).toBe('false');

    fireEvent.click(railButton('Show names'));
    expect(nav().getAttribute('data-wide')).toBe('true');
    fireEvent.click(railButton('Icons only'));
    expect(nav().getAttribute('data-wide')).toBe('false');
    press('[', document.body);
    expect(nav().getAttribute('data-wide')).toBe('true');

    // Closing the panel clears the override: open it again and the hold is back.
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(nav().getAttribute('data-wide')).toBe('true');
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(nav().getAttribute('data-wide')).toBe('false');
  });

  it('Esc closes a floating panel wherever focus is', async () => {
    vi.stubGlobal('innerWidth', 1000);
    await renderLiveChat();
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(panelDock().hasAttribute('inert')).toBe(false);
    (document.activeElement as HTMLElement).blur();
    press('Escape', document.body);
    expect(panelDock().hasAttribute('inert')).toBe(true);
  });

  it('Esc leaves a pushing panel open', async () => {
    vi.stubGlobal('innerWidth', 1500);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ panelOpen: true }));
    await renderLiveChat();
    press('Escape', document.body);
    expect(panelDock().hasAttribute('inert')).toBe(false);
  });

  it('Esc closes a floating panel before a pushing drawer behind it', async () => {
    vi.stubGlobal('innerWidth', 1000);
    localStorage.setItem('tds-brain-shell', JSON.stringify({ drawer: 'chats' }));
    await renderLiveChat();
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(panelDock().hasAttribute('inert')).toBe(false);
    press('Escape', document.body);
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(drawerDock().hasAttribute('inert')).toBe(false);
    press('Escape', document.body);
    expect(drawerDock().hasAttribute('inert')).toBe(true);
  });

  it('when the dock closes and its opener has gone, focus lands on the sheet', async () => {
    vi.stubGlobal('innerWidth', 1500);
    await renderLiveChat();
    openWithClick(screen.getByRole('button', { name: 'Steps and details' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'This chat' }));
    // Leaving the chat unmounts the panel toggle and hides the panel.
    fireEvent.click(railButton('Settings'));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(panelDock().hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
});
