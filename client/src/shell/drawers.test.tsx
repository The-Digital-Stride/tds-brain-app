// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import type { HeldTodo } from '../store.tsx';
import type { ShellAction } from './contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const shell = vi.hoisted(() => ({
  dispatch: vi.fn(),
  modes: { drawerOverlays: false, panelOverlays: false },
}));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./ShellProvider.tsx', async () => {
  const { useFakeShell } = await import('./todo-test-kit.tsx');
  return {
    // The real reducer keeps the open to-do; every action is also noted in `shell.dispatch`.
    useShell: () => {
      const fake = useFakeShell();
      return {
        ...fake,
        modes: shell.modes,
        dispatch: (a: ShellAction) => {
          shell.dispatch(a);
          fake.dispatch(a);
        },
      };
    },
  };
});
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);
const { askedStoreFields } = await import('./todo-test-kit.tsx');

const { fakeShell } = await import('./todo-test-kit.tsx');
const { TodosDrawer } = await import('./TodosDrawer.tsx');
const { ChatsDrawer } = await import('./ChatsDrawer.tsx');
const { SkillsDrawer } = await import('./SkillsDrawer.tsx');

const todo = (id: string, title: string, due: string | null = null): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  attachments: [],
  assignee: 'sam-example',
  due,
  surfaceDate: null,
  project: null,
  client: null,
});
const skill = (name: string, title: string, description = '', maturity = 'live'): SkillInfo =>
  ({ name, title, description, maturity, restrictedTo: null }) as SkillInfo;
const live = (id: string, todoId: string | null = null): LiveSession => ({
  id,
  sdkSessionId: null,
  title: `Chat ${id}`,
  client: null,
  todoId,
  state: 'idle',
  startedAt: '',
  lastActivityAt: '',
  kind: 'tds',
});

const fns = {
  completeTodo: vi.fn(),
  holdTodo: vi.fn(),
  markTodosSeen: vi.fn(),
  undoHeld: vi.fn(),
  pauseHeld: vi.fn(),
  resumeHeld: vi.fn(),
  newChat: vi.fn(),
  openChat: vi.fn(),
  openPast: vi.fn(),
  requestClose: vi.fn(),
  holdDeletePastChat: vi.fn(),
  undoDeletePastChat: vi.fn(),
  pauseChatDelete: vi.fn(),
  resumeChatDelete: vi.fn(),
  startSkill: vi.fn(),
  togglePin: vi.fn(),
  toggleFavouriteChat: vi.fn(),
};

function setStore(over: Record<string, unknown> = {}, directWrites = false, pins: string[] = []) {
  store.current = {
    ...askedStoreFields,
    ...fns,
    view: 'chat',
    heldTodos: [],
    heldChats: [],
    chatNotice: null,
    activeChat: { kind: 'new', key: 1, draft: '', skill: null, todoId: null },
    boot: {
      clients: [],
      usedOften: [],
      identity: { slug: 'sam-example' },
      prefs: { pins, directWrites },
      skills: [skill('b', 'Beta', 'Second one'), skill('a', 'Alpha', 'First one', 'draft')],
    },
    todos: {
      mine: [todo('t1.md', 'Renew contract', '2020-01-01')],
      open: [],
      othersCount: 2,
      team: [],
      changes: 'no-skill',
      canAddOpen: false,
    },
    sessions: {
      live: [],
      past: [{ sdkSessionId: 'p1', title: 'Old chat', lastModified: '2026-11-01T10:00:00Z', kind: 'tds' }],
    },
    ...over,
  };
}

beforeEach(() => {
  fakeShell.reset();
  for (const f of Object.values(fns)) f.mockReset();
  shell.dispatch.mockReset();
  shell.modes.drawerOverlays = false;
  setStore();
});
afterEach(cleanup);

describe('Tasks drawer', () => {
  it('shows no tick box, and no way to finish a task, when the switch is off', () => {
    render(<TodosDrawer />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Options for/ })).toBeNull();
    expect(screen.getByText('Renew contract')).toBeTruthy();
  });

  it('with only the switch on, a task is opened and marked as done on purpose, held for undo', async () => {
    setStore({}, true);
    shell.modes.drawerOverlays = true;
    render(<TodosDrawer />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    // No "Options" (three dots) button any more (plan 2026-11-22-ux-consistency, decision 10): the title opens it.
    expect(screen.queryByRole('button', { name: /^Options for/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Renew contract' }));
    const panel = await screen.findByRole('dialog', { name: 'Renew contract' });
    const done = within(panel).getByRole('button', { name: 'Mark as done' });
    // Focus goes to the heading, not the button, so two presses of Enter can't finish it.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Renew contract'));
    expect(within(panel).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(done);
    expect(fns.holdTodo).toHaveBeenCalledWith(
      expect.objectContaining({ todoId: 't1.md', kind: 'tick', label: 'Marked as done' }),
    );
    expect(fns.completeTodo).not.toHaveBeenCalled();
    expect(fakeShell.state.todoPanel).toBeNull();
    expect(shell.dispatch).not.toHaveBeenCalledWith({ type: 'close-drawer' });
  });

  it('closes the opened task with its close button without finishing it', async () => {
    setStore({}, true);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Renew contract' }));
    await screen.findByRole('dialog', { name: 'Renew contract' });
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fns.holdTodo).not.toHaveBeenCalled();
  });

  it('starts a chat with a draft naming the task and its id, then closes a floating drawer', () => {
    shell.modes.drawerOverlays = true;
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /^Start a chat on this: Renew contract/ }));
    const arg = fns.newChat.mock.calls[0]?.[0] as { draft: string; todoId: string };
    expect(arg.todoId).toBe('t1.md');
    expect(arg.draft).toContain('todo/t1.md');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });

  it('offers Open chat when a live chat exists, marks the one on the sheet, and keeps a pushing drawer open', () => {
    setStore({
      sessions: { live: [live('s1', 't1.md')], past: [] },
      activeChat: { kind: 'live', sessionId: 's1' },
    });
    render(<TodosDrawer />);
    const row = screen.getByRole('button', { name: /^Open chat: Renew contract/ });
    expect(row.closest('li')?.getAttribute('aria-current')).toBe('true');
    fireEvent.click(row);
    expect(fns.openChat).toHaveBeenCalledWith('s1');
    expect(fns.newChat).not.toHaveBeenCalled();
    expect(shell.dispatch).not.toHaveBeenCalled();
  });

  it('shows a project by name, never as a folder name', () => {
    setStore({
      boot: {
        clients: [{ slug: 'acme', name: 'Acme Heating' }],
        usedOften: [],
        identity: { slug: 'sam-example' },
        prefs: { pins: [], directWrites: false },
        skills: [],
      },
      todos: {
        mine: [
          { ...todo('t1.md', 'Renew contract', '2020-01-01'), project: 'acme' },
          { ...todo('t2.md', 'Plan the pages', '2020-01-02'), project: 'uc-ai-search' },
        ],
        open: [],
        othersCount: 0,
        team: [],
        changes: 'no-skill',
        canAddOpen: false,
      },
    });
    render(<TodosDrawer />);
    const rowOf = (name: RegExp) => screen.getByRole('button', { name }).closest('li')?.textContent ?? '';
    expect(rowOf(/Start a chat on this: Renew contract/)).toContain('Acme Heating');
    const second = rowOf(/Start a chat on this: Plan the pages/);
    expect(second).toContain('UC AI search');
    expect(second).not.toContain('uc-ai-search');
  });

  it('names the chat button with its action and title, and shows the due words and client on the row', () => {
    setStore({
      boot: {
        clients: [{ slug: 'acme', name: 'Acme Heating' }],
        usedOften: [],
        identity: { slug: 'sam-example' },
        prefs: { pins: [], directWrites: false },
        skills: [],
      },
      todos: {
        mine: [{ ...todo('t1.md', 'Renew contract', '2020-01-01'), client: 'acme' }],
        open: [],
        othersCount: 0,
        team: [],
        changes: 'no-skill',
        canAddOpen: false,
      },
    });
    render(<TodosDrawer />);
    const go = screen.getByRole('button', { name: 'Start a chat on this: Renew contract' });
    const row = go.closest('li')?.textContent ?? '';
    expect(row).toContain('Overdue by');
    expect(row).toContain('Acme Heating');
    // The row itself is not a button: only its own buttons act.
    expect(screen.queryByRole('button', { name: /Acme Heating/ })).toBeNull();
    // A keyboard or screen-reader user on the arrow still hears the details.
    const said = (go.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(said).toContain('Overdue by');
    expect(said).toContain('Acme Heating');
    // The buttons are the last thing on the bottom line, and the place describes the chat button.
    const end = go.closest('.todo-end');
    expect(end?.lastElementChild?.classList.contains('todo-btns')).toBe(true);
  });

  it('keeps the line about other people, and the old group of tasks open to anyone', () => {
    setStore({
      todos: {
        mine: [],
        open: [todo('o.md', 'Anyone can do this')],
        othersCount: 1,
        team: [],
        changes: 'no-skill',
        canAddOpen: false,
      },
    });
    render(<TodosDrawer />);
    expect(screen.getByText('1 more belongs to other people.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Open, 1' }));
    expect(screen.getByText('Anyone can do this')).toBeTruthy();
  });
});

describe('Tasks drawer, held ticks (plan 2026-11-22-ux-consistency, R1)', () => {
  const two = () => ({
    mine: [todo('t1.md', 'Renew contract', '2020-01-01'), todo('t2.md', 'Book the van', '2020-01-01')],
    open: [],
    othersCount: 0,
    team: [],
    changes: 'no-skill',
    canAddOpen: false,
  });
  /** The store's own held queue behind the mocked store, so "sent at 10 s" is the real clock. */
  async function withRealQueue() {
    const { createHeldQueue } = await vi.importActual<typeof import('../store.tsx')>('../store.tsx');
    const { UNDO_MS } = await import('./UndoLine.tsx');
    const sent: string[] = [];
    const queue = createHeldQueue<HeldTodo>({
      send: async (h) => {
        sent.push(h.todoId);
      },
      onQueued: () => {},
    });
    fns.holdTodo.mockImplementation((h: HeldTodo) => {
      queue.hold(h.todoId, h, { replace: true });
      store.current = { ...store.current, heldTodos: [h] };
    });
    fns.pauseHeld.mockImplementation((id: string) => queue.pause(id));
    fns.resumeHeld.mockImplementation((id: string) => queue.resume(id));
    return { sent, UNDO_MS };
  }
  async function openAndFind() {
    setStore({ todos: two() }, true);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Renew contract' }));
    const panel = await screen.findByRole('dialog', { name: 'Renew contract' });
    return within(panel).getByRole('button', { name: 'Mark as done' });
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('people who can only tick things off see the star and the chat button, no Options or Edit', () => {
    setStore({}, true);
    render(<TodosDrawer />);
    const row = screen.getByRole('button', { name: 'Renew contract' }).closest('li') as HTMLElement;
    const buttons = within(row)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(buttons).toEqual([
      'Renew contract',
      'Pin: Renew contract',
      'Start a chat on this: Renew contract',
    ]);
  });

  it('a POINTER tick is sent at 10 s with no further interaction: focus goes to the next row, not Undo', async () => {
    const { sent, UNDO_MS } = await withRealQueue();
    const done = await openAndFind();
    vi.useFakeTimers();
    fireEvent.pointerDown(done);
    fireEvent.click(done, { detail: 1 });
    const undo = screen.getByRole('button', { name: 'Undo marking as done "Renew contract"' });
    expect(document.activeElement).not.toBe(undo);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Book the van' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
    });
    expect(sent).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(sent).toEqual(['t1.md']);
  });

  it('a KEYBOARD tick puts focus on Undo, which holds the clock while it is there', async () => {
    const { sent, UNDO_MS } = await withRealQueue();
    const done = await openAndFind();
    vi.useFakeTimers();
    fireEvent.keyDown(done, { key: 'Enter' });
    fireEvent.click(done, { detail: 0 });
    const undo = screen.getByRole('button', { name: 'Undo marking as done "Renew contract"' });
    expect(document.activeElement).toBe(undo);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS * 3);
    });
    expect(sent).toEqual([]);
  });
});

describe('Chats drawer kind filter', () => {
  const personal = (id: string): LiveSession => ({ ...live(id), kind: 'personal' });
  const kindSwitch = () => screen.queryByRole('radiogroup', { name: 'Which kind of chat' });

  it('keeps both switches and New chat in the fixed band above the list, so they never scroll away', () => {
    setStore({ sessions: { live: [live('s1'), personal('s2')], past: [] } });
    render(<ChatsDrawer />);
    const band = screen
      .getByRole('radiogroup', { name: 'Which chats' })
      .closest('.drawer-tools') as HTMLElement;
    const list = screen.getByText('Chat s1').closest('.drawer-scroll') as HTMLElement;
    expect(band).not.toBeNull();
    expect(list).not.toBeNull();
    expect(band.contains(kindSwitch())).toBe(true);
    expect(band.contains(screen.getByRole('button', { name: 'New chat' }))).toBe(true);
    expect(list.contains(band)).toBe(false);
    expect(band.parentElement).toBe(list.parentElement);
  });

  it('hides the switch when no chat is personal', () => {
    setStore({ sessions: { live: [live('s1')], past: [] } });
    render(<ChatsDrawer />);
    expect(kindSwitch()).toBeNull();
  });

  it('shows the switch and marks personal rows, with counts unfiltered', () => {
    setStore({ sessions: { live: [live('s1'), personal('s2')], past: [] } });
    render(<ChatsDrawer />);
    expect(kindSwitch()).not.toBeNull();
    const meta = (id: string) =>
      (screen.getByText(`Chat ${id}`).closest('li') as HTMLElement).querySelector('.line-meta')?.textContent;
    expect(meta('s2')).toMatch(/, personal$/);
    expect(meta('s1')).not.toMatch(/personal/);
    // No lock: a personal chat is only sorted apart, not private.
    expect(document.querySelector('.todo-lock')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Personal' }));
    expect(screen.queryByText('Chat s1')).toBeNull();
    expect(screen.getByText('Chat s2')).toBeTruthy();
    expect(meta('s2')).not.toMatch(/personal/);
    expect(screen.getByRole('radio', { name: 'Open, 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'TDS' }));
    expect(screen.queryByText('Chat s2')).toBeNull();
    expect(screen.getByText('Chat s1')).toBeTruthy();
  });

  it('filters earlier chats and says when none match', () => {
    setStore({
      sessions: {
        live: [live('s1')],
        past: [
          { sdkSessionId: 'p1', title: 'Old work', lastModified: new Date().toISOString(), kind: 'tds' },
          {
            sdkSessionId: 'p2',
            title: 'Old private',
            lastModified: new Date().toISOString(),
            kind: 'personal',
          },
        ],
      },
    });
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    expect(screen.getByText('Old private')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Personal' }));
    expect(screen.queryByText('Old work')).toBeNull();
    expect(screen.getByText('Old private')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Open, 1' }));
    expect(screen.getByText('No personal chats open.')).toBeTruthy();
  });

  it('says so when no earlier chat is TDS', () => {
    setStore({
      sessions: {
        live: [],
        past: [
          {
            sdkSessionId: 'p2',
            title: 'Old private',
            lastModified: new Date().toISOString(),
            kind: 'personal',
          },
        ],
      },
    });
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    fireEvent.click(screen.getByRole('radio', { name: 'TDS' }));
    expect(screen.getByText('No earlier TDS chats.')).toBeTruthy();
  });
});

describe('Chats drawer favourites', () => {
  const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const C = '16fd2706-8baf-433b-82eb-8c7fada847da';
  const now = new Date().toISOString();
  const past = (id: string, title: string) => ({
    sdkSessionId: id,
    title,
    lastModified: now,
    kind: 'tds' as const,
  });
  const withFavs = (favouriteChats: string[], sessions: unknown) => {
    setStore({ sessions });
    const boot = store.current.boot as { prefs: Record<string, unknown> };
    store.current.boot = { ...boot, prefs: { ...boot.prefs, favouriteChats } };
  };
  const titles = () => Array.from(document.querySelectorAll('.line-title')).map((t) => t.textContent);

  it('puts favourite open chats first and stars them, with no star before a chat has an id', () => {
    withFavs([B], {
      live: [
        { ...live('s1'), sdkSessionId: A, lastActivityAt: '2026-11-14T10:00:00Z' },
        { ...live('s2'), sdkSessionId: B, lastActivityAt: '2026-11-14T09:00:00Z' },
        live('s3'),
      ],
      past: [],
    });
    render(<ChatsDrawer />);
    expect(titles()).toEqual(['Chat s2', 'Chat s1', 'Chat s3']);
    const on = screen.getByRole('button', { name: 'Pin: Chat s2' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pin: Chat s1' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Pin: Chat s3' })).toBeNull();
    fireEvent.click(on);
    expect(fns.toggleFavouriteChat).toHaveBeenCalledWith(B);
  });

  it('shows earlier favourites in an open Pinned section, once, with today still open', () => {
    withFavs([C], { live: [], past: [past(A, 'Alpha chat'), past(C, 'Gamma chat')] });
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const favs = screen.getByRole('button', { name: /Pinned/ });
    expect(favs.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Today/ }).getAttribute('aria-expanded')).toBe('true');
    expect(titles()).toEqual(['Gamma chat', 'Alpha chat']);
  });

  it('opens the closed section an unstarred chat moves to, and focus follows it there', () => {
    const old = { ...past(B, 'Beta chat'), lastModified: '2020-01-01T10:00:00Z' };
    withFavs([B], { live: [], past: [past(A, 'Alpha chat'), old] });
    const view = render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const star = screen.getByRole('button', { name: 'Pin: Beta chat' });
    star.focus();
    fireEvent.click(star);
    withFavs([], { live: [], past: [past(A, 'Alpha chat'), old] });
    view.rerender(<ChatsDrawer />);
    expect(screen.getByRole('button', { name: /^Earlier/ }).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pin: Beta chat');
  });

  it('brings focus back when a failed save puts the star back', () => {
    const sessions = { live: [], past: [past(A, 'Alpha chat'), past(B, 'Beta chat')] };
    withFavs([], sessions);
    const view = render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const star = screen.getByRole('button', { name: 'Pin: Beta chat' });
    star.focus();
    fireEvent.click(star);
    withFavs([B], sessions);
    view.rerender(<ChatsDrawer />);
    // The save failed: the store puts the list back, so the row moves again.
    withFavs([], sessions);
    view.rerender(<ChatsDrawer />);
    const back = screen.getByRole('button', { name: 'Pin: Beta chat' });
    expect(back.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(back);
  });

  it('does not take focus back when a reply brings the same stars again', () => {
    const sessions = { live: [], past: [past(A, 'Alpha chat'), past(B, 'Beta chat'), past(C, 'Gamma chat')] };
    withFavs([], sessions);
    const view = render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const star = screen.getByRole('button', { name: 'Pin: Beta chat' });
    star.focus();
    fireEvent.click(star);
    withFavs([B], sessions);
    view.rerender(<ChatsDrawer />);
    // The person moves on to another star, then the save's reply lands with an equal, new list.
    const other = screen.getByRole('button', { name: 'Pin: Alpha chat' });
    other.focus();
    withFavs([B], sessions);
    view.rerender(<ChatsDrawer />);
    expect(document.activeElement).toBe(other);
    // Or moves focus off the drawer entirely: still not taken back.
    other.blur();
    withFavs([B], sessions);
    view.rerender(<ChatsDrawer />);
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus with the chat to its new place after a star press', () => {
    withFavs([], { live: [], past: [past(A, 'Alpha chat'), past(B, 'Beta chat')] });
    const view = render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const star = screen.getByRole('button', { name: 'Pin: Beta chat' });
    star.focus();
    fireEvent.click(star);
    expect(fns.toggleFavouriteChat).toHaveBeenCalledWith(B);
    // The store saves it: the list moves Beta into Pinned, a new row.
    withFavs([B], { live: [], past: [past(A, 'Alpha chat'), past(B, 'Beta chat')] });
    view.rerender(<ChatsDrawer />);
    const moved = screen.getByRole('button', { name: 'Pin: Beta chat' });
    expect(moved.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(moved);
  });
});

describe('Chats drawer', () => {
  it('groups earlier chats under headings, with only the newest group open', () => {
    const iso = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString();
    setStore({
      sessions: {
        live: [],
        past: [
          { sdkSessionId: 'n', title: 'Just now chat', lastModified: new Date().toISOString() },
          { sdkSessionId: 'o', title: 'Ancient chat', lastModified: iso(40) },
        ],
      },
    });
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const today = screen.getByRole('button', { name: /Today/ });
    const earlier = screen.getByRole('button', { name: /Earlier/ });
    expect(today.getAttribute('aria-expanded')).toBe('true');
    expect(earlier.getAttribute('aria-expanded')).toBe('false');
  });

  it('Earlier rows open the past chat', () => {
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    fireEvent.click(screen.getByRole('button', { name: /^Old chat/ }));
    expect(fns.openPast).toHaveBeenCalledWith('p1');
  });

  describe('deleting an earlier chat', () => {
    const openEarlier = () => {
      render(<ChatsDrawer />);
      fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    };

    it('gives each Earlier row a bin button', () => {
      setStore({
        sessions: {
          live: [],
          past: [
            { sdkSessionId: 'p1', title: 'Old chat', lastModified: '2026-11-01T10:00:00Z', kind: 'tds' },
            { sdkSessionId: 'p2', title: 'Other chat', lastModified: '2026-11-01T09:00:00Z', kind: 'tds' },
          ],
        },
      });
      openEarlier();
      expect(screen.getByRole('button', { name: 'Delete chat: Old chat' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Delete chat: Other chat' })).toBeTruthy();
    });

    // The inline "Move this chat to the Bin?" question is gone (plan 2026-11-22-ux-consistency, decision 12): the bin
    // holds the delete in the store and the row gives way to an Undo line. These replace the old question's tests.
    const two = [
      { sdkSessionId: 'p1', title: 'Old chat', lastModified: '2026-11-01T10:00:00Z', kind: 'tds' as const },
      { sdkSessionId: 'p2', title: 'Other chat', lastModified: '2026-11-01T09:00:00Z', kind: 'tds' as const },
    ];
    const held = (phase: 'waiting' | 'sending' = 'waiting') => ({
      sdkSessionId: 'p1',
      title: 'Old chat',
      phase,
      session: two[0],
    });
    /** What the store serves while p1 is held: the past list without it, and the held line. */
    const holding = (phase: 'waiting' | 'sending' = 'waiting') =>
      setStore({ sessions: { live: [], past: [two[1]] }, heldChats: [held(phase)] });

    it('the bin holds the delete at once, with no question first', () => {
      openEarlier();
      fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Old chat' }));
      expect(fns.holdDeletePastChat).toHaveBeenCalledExactlyOnceWith('p1', 'Old chat');
      expect(screen.queryByText(/Move this chat to the Bin/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Keep chat' })).toBeNull();
    });

    it('shows the held chat as an Undo line in its place, and says so in the always-there status line', () => {
      holding();
      openEarlier();
      const undo = screen.getByRole('button', { name: 'Undo deleting “Old chat”' });
      expect(undo.textContent).toBe('Undo');
      const line = undo.closest('li') as HTMLElement;
      expect(line.classList.contains('undo-line')).toBe(true);
      expect(line.textContent).toContain('“Old chat” moved to the Bin. It leaves the terminal too.');
      // In its place: before the other chat, as it was.
      const rows = Array.from(document.querySelectorAll('.drawer-list > li'));
      expect(rows.indexOf(line)).toBe(0);
      expect(screen.getByTestId('chat-delete-status').textContent).toBe(
        '“Old chat” moved to the Bin. It leaves the terminal too. Undo is in its place.',
      );
      fireEvent.mouseEnter(line);
      expect(fns.pauseChatDelete).toHaveBeenCalledWith('p1');
      fireEvent.mouseLeave(line);
      expect(fns.resumeChatDelete).toHaveBeenCalledWith('p1');
      fireEvent.click(undo);
      expect(fns.undoDeletePastChat).toHaveBeenCalledWith('p1');
    });

    it('says "Sending…" once the time is up, with no Undo; the result is left to the sheet notice', () => {
      holding('sending');
      const view = render(<ChatsDrawer />);
      fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
      expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
      expect(screen.getByText('Sending…')).toBeTruthy();
      setStore({
        sessions: { live: [], past: [two[1]] },
        chatNotice: '“Old chat” moved to the Bin. You can put it back from there.',
      });
      view.rerender(<ChatsDrawer />);
      // The sheet's always-mounted notice speaks the result (it survives the drawer closing), so the drawer's
      // own line stays empty rather than announcing it twice.
      expect(screen.getByTestId('chat-delete-status').textContent).toBe('');
    });

    it('after a pointer press focus goes to the next chat, not to Undo, so nothing holds the clock', () => {
      setStore({ sessions: { live: [], past: two } });
      // The store updates in the same press, as the real one does.
      fns.holdDeletePastChat.mockImplementation(() => holding());
      render(<ChatsDrawer />);
      fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
      const bin = screen.getByRole('button', { name: 'Delete chat: Old chat' });
      bin.focus();
      fireEvent.pointerDown(bin);
      fireEvent.click(bin, { detail: 1 });
      expect(screen.getByRole('button', { name: 'Undo deleting “Old chat”' })).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Other chat/ }));
      expect(fns.pauseChatDelete).not.toHaveBeenCalled();
    });

    it('after a keyboard press focus goes to Undo', () => {
      setStore({ sessions: { live: [], past: two } });
      fns.holdDeletePastChat.mockImplementation(() => holding());
      render(<ChatsDrawer />);
      fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
      const bin = screen.getByRole('button', { name: 'Delete chat: Old chat' });
      bin.focus();
      fireEvent.keyDown(bin, { key: 'Enter' });
      fireEvent.click(bin, { detail: 0 });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo deleting “Old chat”' }));
    });

    it('Undo puts focus back on the chat’s own bin', () => {
      holding();
      fns.undoDeletePastChat.mockImplementation(() => setStore({ sessions: { live: [], past: two } }));
      render(<ChatsDrawer />);
      fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo deleting “Old chat”' }));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete chat: Old chat' }));
    });

    it('no bin is ever disabled', () => {
      holding();
      openEarlier();
      expect(
        (screen.getByRole('button', { name: 'Delete chat: Other chat' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  it('puts New chat at the end of the Open/Earlier row, as a primary + like the Tasks drawer', () => {
    shell.modes.drawerOverlays = true;
    render(<ChatsDrawer />);
    const button = screen.getByRole('button', { name: 'New chat' });
    const row = button.closest('.chats-switch') as HTMLElement;
    expect(row.lastElementChild).toBe(button);
    expect(within(row).getByRole('radiogroup', { name: 'Which chats' })).toBeTruthy();
    expect(button.classList.contains('icon-btn')).toBe(true);
    expect(button.dataset.variant).toBe('primary');
    fireEvent.click(button);
    expect(fns.newChat).toHaveBeenCalledWith();
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });

  it('Open rows open the chat and have a separate End chat button (its own icon, not X)', () => {
    setStore({ sessions: { live: [live('s1')], past: [] }, activeChat: { kind: 'live', sessionId: 's1' } });
    render(<ChatsDrawer />);
    expect(screen.queryByRole('button', { name: 'Close chat: Chat s1' })).toBeNull();
    const close = screen.getByRole('button', { name: 'End chat: Chat s1' });
    expect(close.dataset.tip).toBe('End chat');
    // The `end` icon (an arrow out of a box), not the X.
    expect(close.querySelector('path')?.getAttribute('d')).toMatch(/^M8\.5 4H5/);
    fireEvent.click(close);
    expect(fns.requestClose).toHaveBeenCalledWith('s1');
    expect(fns.openChat).not.toHaveBeenCalled();
    const row = close.closest('li') as HTMLElement;
    expect(row.getAttribute('aria-current')).toBe('true');
    fireEvent.click(within(row).getByText('Chat s1'));
    expect(fns.openChat).toHaveBeenCalledWith('s1');
  });
});

describe('Skills drawer', () => {
  it('lists all skills alphabetically once the group is opened', () => {
    render(<SkillsDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    const titles = screen.getAllByText(/^(Alpha|Beta)/).map((e) => e.textContent);
    expect(titles[0]).toContain('Alpha');
    expect(screen.getByText('Still being tested')).toBeTruthy();
  });

  it('shows a tier chip for a team level, and "Set by skill" for a skill with its own', () => {
    setStore({
      skillLevels: { levels: { b: { tier: 'deep', setBy: 'x', at: '' } }, canSet: false, writable: true },
    });
    const boot = (store.current as { boot: { skills: Record<string, unknown>[] } }).boot;
    boot.skills[1] = { ...boot.skills[1], ownLevel: { model: 'haiku', effort: null } };
    render(<SkillsDrawer />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'e' } });
    const chips = Array.from(document.querySelectorAll('.skill-level-chip')).map((c) => c.textContent);
    expect(chips.sort()).toEqual(['Deep', 'Set by skill']);
  });

  it('shows no chip on an older server', () => {
    render(<SkillsDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    expect(document.querySelector('.skill-level-chip')).toBeNull();
  });

  it('search filters to one flat list', () => {
    render(<SkillsDrawer />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: 'second' },
    });
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText(/Alpha/)).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'zzz' } });
    // Shown, and announced through the hidden status line.
    expect(screen.getAllByText('No skills match that search.')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('No skills match that search.');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: 'second' },
    });
    expect(screen.getByRole('status').textContent).toBe('1 skill matches');
  });

  it("the star reflects and changes a skill's favourite, under Pinned, without starting the skill", () => {
    setStore({}, false, ['a']);
    render(<SkillsDrawer />);
    expect(screen.getByRole('button', { name: /^Pinned/ })).toBeTruthy();
    const star = screen.getAllByRole('button', { name: 'Pin: Alpha' })[0] as HTMLElement;
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.dataset.tip).toBe('Pin');
    expect(star.querySelector('.icon-pin')).not.toBeNull();
    fireEvent.click(star);
    expect(fns.togglePin).toHaveBeenCalledWith('a');
    expect(fns.startSkill).not.toHaveBeenCalled();
    expect(shell.dispatch).not.toHaveBeenCalled();
  });

  it('opens the section a skill moves to when its star is pressed, so it never vanishes into a closed one', () => {
    setStore({}, false, ['a']);
    const { rerender } = render(<SkillsDrawer />);
    const allSkills = () => screen.getByRole('button', { name: /^All skills/ });
    expect(allSkills().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getAllByRole('button', { name: 'Pin: Alpha' })[0] as HTMLElement);
    expect(fns.togglePin).toHaveBeenCalledWith('a');
    // Alpha isn't used often, so un-starred it lives only under All skills.
    setStore({}, false, []);
    rerender(<SkillsDrawer />);
    expect(allSkills().getAttribute('aria-expanded')).toBe('true');
  });

  it('a skill shows one line of its description until it is expanded, without starting it', () => {
    render(<SkillsDrawer />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'beta' } });
    const more = screen.getByRole('button', { name: 'Description of Beta' });
    expect(more.hasAttribute('data-chevron')).toBe(true);
    const row = more.closest('li') as HTMLElement;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(row.dataset.open).toBe('false');
    fireEvent.click(more);
    const less = screen.getByRole('button', { name: 'Description of Beta' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    expect(row.dataset.open).toBe('true');
    expect(document.getElementById(less.getAttribute('aria-controls') as string)?.textContent).toBe(
      'Second one',
    );
    expect(fns.startSkill).not.toHaveBeenCalled();
  });

  it('a skill with no description has nothing to expand', () => {
    setStore({
      boot: {
        clients: [],
        usedOften: [],
        identity: { slug: 'sam-example' },
        prefs: { pins: [], directWrites: false },
        skills: [skill('c', 'Gamma')],
      },
    });
    render(<SkillsDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /All skills/ }));
    expect(screen.queryByRole('button', { name: /Description of Gamma/ })).toBeNull();
  });

  it('starting a skill closes a floating drawer', () => {
    shell.modes.drawerOverlays = true;
    render(<SkillsDrawer />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('button', { name: /^Beta/ }));
    expect(fns.startSkill).toHaveBeenCalled();
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });
});

describe('Chats drawer, floating', () => {
  // The button is "End chat" now (plan 2026-11-22-ux-consistency, decision 10); the behaviour is unchanged.
  it('ending a chat from a floating drawer also closes the drawer, so the confirm can be seen', () => {
    shell.modes.drawerOverlays = true;
    setStore({ sessions: { live: [{ ...live('s1'), title: '' }], past: [] } });
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'End chat: New chat' }));
    expect(fns.requestClose).toHaveBeenCalledWith('s1');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });
});
