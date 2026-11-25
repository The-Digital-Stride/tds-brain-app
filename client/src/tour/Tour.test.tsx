// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  updatePrefs: vi.fn(),
  libraryItems: vi.fn(),
  clientGuess: vi.fn(),
  close: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));

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

const { App } = await import('../App.tsx');
const { startTour } = await import('./index.ts');
const { TOUR_STEPS, TOUR_VERSION } = await import('./steps.ts');
/** Steps that show only for some people: Working on once the brain has projects, the Workbench for Ads users. */
const SOMETIMES = new Set(['working-on', 'workbench']);
const ALWAYS = TOUR_STEPS.filter((s) => !SOMETIMES.has(s.id));

const prefs = {
  pins: [],
  lastClient: null,
  todoPanelOpen: false,
  directWrites: false,
  favouriteTodos: [],
  favouriteChats: [],
  favouriteFiles: [],
  homeHidden: [],
  homeShortcuts: [],
  tourSeen: null as number | null,
};
const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam Example', slug: 'sam-example', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [{ slug: 'acme', name: 'Acme Heating' }],
  usedOften: [],
  prefs,
};
const pastChat = {
  id: 'p1',
  sdkSessionId: '11111111-1111-4111-8111-111111111111',
  title: 'Earlier chat',
  client: null,
  todoId: null,
  startedAt: '',
  lastActivityAt: '2026-11-01T10:00:00.000Z',
  kind: 'tds',
};

function setup(over: Partial<typeof prefs> = {}, past: unknown[] = []) {
  api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...prefs, ...over } });
  api.sessions.mockResolvedValue({ live: [], past });
}
const dialog = () => screen.findByRole('dialog');
const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Next|Done)$/ }));
const title = () => within(screen.getByRole('dialog')).getByRole('heading').textContent;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.libraryItems.mockResolvedValue({ files: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...prefs, ...patch }));
  setup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('when the tour starts', () => {
  it('starts for someone who has never seen it, with the new-user welcome', async () => {
    render(<App />);
    const d = await dialog();
    expect(d.getAttribute('aria-labelledby')).toBeTruthy();
    expect(title()).toBe('Welcome to TDS Cortex');
    expect(d.textContent).toContain('where you work with Claude');
    expect(d.textContent).not.toContain('TDS Brain');
  });

  it('tells someone with earlier chats that Cortex has grown, and no longer mentions the rename', async () => {
    setup({}, [pastChat]);
    render(<App />);
    const d = await dialog();
    expect(title()).toBe('Welcome to TDS Cortex');
    expect(d.textContent).toContain('has grown since you last looked round');
    expect(d.textContent).not.toContain('TDS Brain');
  });

  it('shows again to someone who saw an older version', async () => {
    setup({ tourSeen: TOUR_VERSION - 1 }, [pastChat]);
    render(<App />);
    await dialog();
  });

  it('starts when tourSeen is below the current version', async () => {
    setup({ tourSeen: 0 });
    render(<App />);
    await dialog();
  });

  it('does not start once seen, in prefs or in the fallback', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    setup();
    localStorage.setItem('tds-brain-tour-seen', '1');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('steps aside while the palette is open and comes back when it closes', async () => {
    render(<App />);
    await dialog();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Welcome/ })).toBeNull());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await screen.findByRole('dialog', { name: /Welcome/ });
  });
});

describe('after the tour', () => {
  it('counts the notes so far as read for someone new, but not for someone with earlier chats', async () => {
    api.bootstrap.mockResolvedValue({ ...boot, appVersion: '0.40.0', prefs });
    render(<App />);
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() =>
      expect(api.updatePrefs).toHaveBeenCalledWith({ tourSeen: TOUR_VERSION, whatsNewSeen: '0.40.0' }),
    );
    cleanup();
    vi.clearAllMocks();
    api.bootstrap.mockResolvedValue({ ...boot, appVersion: '0.40.0', prefs });
    api.sessions.mockResolvedValue({ live: [], past: [pastChat] });
    render(<App />);
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(api.updatePrefs).toHaveBeenCalledWith({ tourSeen: TOUR_VERSION }));
  });

  it('moves to Home first when it starts on another view', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    fireEvent.click(
      document.querySelector('.rail [aria-label="Settings"], .rail [data-tip="Settings"]') as HTMLElement,
    );
    await screen.findByRole('heading', { level: 1, name: /^Settings/ });
    act(() => startTour());
    await dialog();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('a replay that the palette interrupts comes back when it closes', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    act(() => startTour());
    await dialog();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Welcome/ })).toBeNull());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await screen.findByRole('dialog', { name: /Welcome/ });
  });
});

describe('walking through', () => {
  it('visits every step in order and ends with Done', async () => {
    render(<App />);
    await dialog();
    const seen = [title()];
    while (screen.queryByRole('button', { name: 'Next' })) {
      next();
      seen.push(title());
    }
    expect(seen).toEqual(['Welcome to TDS Cortex', ...ALWAYS.map((s) => s.title)]);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    next();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updatePrefs).toHaveBeenCalledWith({ tourSeen: TOUR_VERSION });
  });

  it('skips a step whose anchor is hidden', async () => {
    render(<App />);
    await dialog();
    (document.querySelector('.sheet-bar button.jump') as HTMLElement).hidden = true;
    const seen = [title()];
    while (screen.queryByRole('button', { name: 'Next' })) {
      next();
      seen.push(title());
    }
    expect(seen).not.toContain('Find anything fast');
    expect(seen).toContain('Your tasks');
  });

  it('goes back', async () => {
    render(<App />);
    await dialog();
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(title()).toBe('Welcome to TDS Cortex');
  });
});

describe('accessibility', () => {
  it('keeps Back focusable but inert on step 1, so focus stays on the card', async () => {
    render(<App />);
    await dialog();
    const back = screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    expect(back.getAttribute('aria-disabled')).toBe('true');
    back.focus();
    fireEvent.click(back);
    expect(title()).toBe('Welcome to TDS Cortex');
    expect(document.activeElement).toBe(back);
    next();
    expect(back.getAttribute('aria-disabled')).toBeNull();
  });

  it('announces each step in a polite live region and is modal over an inert desk', async () => {
    render(<App />);
    const d = await dialog();
    expect(d.getAttribute('aria-modal')).toBe('true');
    const live = d.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toMatch(/^Step 1 of \d+: Welcome to TDS Cortex$/);
    next();
    expect(live.textContent).toMatch(/^Step 2 of \d+: /);
    expect(live.textContent).toContain(title() as string);
    expect(document.querySelector('.desk')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.skip-link')?.hasAttribute('inert')).toBe(true);
  });

  it('puts focus on the main area after Skip when nothing had focus before', async () => {
    const focused: Element[] = [];
    const real = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o) {
      focused.push(this);
      real.call(this, o);
    });
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    (document.activeElement as HTMLElement | null)?.blur();
    focused.length = 0;
    act(() => startTour());
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(focused).toContain(document.getElementById('main')));
  });

  it('also blocks the [ shortcut while it shows', async () => {
    render(<App />);
    await dialog();
    const ev = new KeyboardEvent('keydown', { key: '[', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('moves the spotlight when its anchor changes size or place', async () => {
    const watchers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          watchers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<App />);
    await dialog();
    next();
    const spot = document.querySelector('.tour-spot') as HTMLElement;
    const before = spot.style.left;
    const anchor = document.querySelector(TOUR_STEPS[0]?.anchor ?? 'body') as HTMLElement;
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      top: 40,
      width: 100,
      height: 30,
      right: 600,
      bottom: 70,
      x: 500,
      y: 40,
      toJSON: () => ({}),
    });
    act(() => {
      for (const w of watchers) w();
    });
    expect(document.querySelector('.tour-spot') as HTMLElement).toBeTruthy();
    expect((document.querySelector('.tour-spot') as HTMLElement).style.left).not.toBe(before);
  });
});

describe('finishing', () => {
  it('Esc skips and saves', async () => {
    render(<App />);
    await dialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updatePrefs).toHaveBeenCalledWith({ tourSeen: TOUR_VERSION });
  });

  it('Skip tour saves', async () => {
    render(<App />);
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updatePrefs).toHaveBeenCalledWith({ tourSeen: TOUR_VERSION });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the fallback when the save fails, and does not start again', async () => {
    api.updatePrefs.mockRejectedValue(new Error('offline'));
    render(<App />);
    await dialog();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(localStorage.getItem('tds-brain-tour-seen')).toBe('1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the fallback on Esc too when the save fails', async () => {
    api.updatePrefs.mockRejectedValue(new Error('offline'));
    render(<App />);
    await dialog();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(localStorage.getItem('tds-brain-tour-seen')).toBe('1'));
  });
});

describe('focus, keys and replay', () => {
  it('moves focus into the card and puts it back afterwards', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    const chats = document.querySelector('button.rail-item[data-dock-label="Chats"]') as HTMLElement;
    chats.focus();
    act(() => startTour());
    const d = await dialog();
    await waitFor(() => expect(d.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(chats);
  });

  it('replays through startTour even when seen', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => startTour());
    await dialog();
    expect(title()).toBe('Welcome to TDS Cortex');
  });

  it('closes a pushing drawer and shows Home when it starts', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    const todos = document.querySelector('button.rail-item[data-dock-label="Tasks"]') as HTMLElement;
    fireEvent.click(todos);
    await waitFor(() => expect(todos.getAttribute('aria-expanded')).toBe('true'));
    act(() => startTour());
    await dialog();
    expect(todos.getAttribute('aria-expanded')).toBe('false');
  });

  it('does nothing for the single keys while it shows', async () => {
    render(<App />);
    await dialog();
    const help = document.querySelector('button.rail-item[data-dock-label="Help"]') as HTMLElement;
    for (const key of ['c', 't', 's', 'h', '?', '/']) fireEvent.keyDown(document.body, { key });
    expect(help.getAttribute('aria-expanded')).toBe('false');
    expect(
      document.querySelector('button.rail-item[data-dock-label="Tasks"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('anchors', () => {
  it('scrolls each step’s target into view, so the spotlight is never off-screen', async () => {
    const scrolled: Element[] = [];
    const scroll = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<App />);
      await dialog();
      next();
      await waitFor(() => expect(scrolled).toContain(document.querySelector(ALWAYS[0]?.anchor ?? 'body')));
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('finds every anchor on the real Home, rail and sheet bar', async () => {
    setup({ tourSeen: TOUR_VERSION });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    for (const step of ALWAYS) {
      expect(document.querySelector(step.anchor ?? 'body'), `${step.id}: ${step.anchor}`).not.toBeNull();
    }
  });
});
