// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const shell = vi.hoisted(() => ({
  dispatch: vi.fn(),
  modes: { drawerOverlays: false, panelOverlays: false },
}));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: {}, dispatch: shell.dispatch, modes: shell.modes }),
}));

const { TodosDrawer } = await import('./TodosDrawer.tsx');
const { ChatsDrawer } = await import('./ChatsDrawer.tsx');
const { SkillsDrawer } = await import('./SkillsDrawer.tsx');

const todo = (id: string, title: string, due: string | null = null): TodoItem => ({
  id,
  title,
  created: null,
  source: null,
  details: '',
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
});

const fns = {
  completeTodo: vi.fn(),
  holdTodo: vi.fn(),
  undoHeld: vi.fn(),
  newChat: vi.fn(),
  openChat: vi.fn(),
  openPast: vi.fn(),
  requestClose: vi.fn(),
  startSkill: vi.fn(),
  togglePin: vi.fn(),
};

function setStore(over: Record<string, unknown> = {}, directWrites = false, pins: string[] = []) {
  store.current = {
    ...fns,
    view: 'chat',
    heldTodos: [],
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
    },
    sessions: {
      live: [],
      past: [{ sdkSessionId: 'p1', title: 'Old chat', lastModified: '2026-11-01T10:00:00Z' }],
    },
    ...over,
  };
}

beforeEach(() => {
  for (const f of Object.values(fns)) f.mockReset();
  shell.dispatch.mockReset();
  shell.modes.drawerOverlays = false;
  setStore();
});
afterEach(cleanup);

describe('To-dos drawer', () => {
  it('shows no tick boxes when direct writes are off', () => {
    render(<TodosDrawer />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Renew contract')).toBeTruthy();
  });

  it('ticking a to-do holds it for undo and leaves the drawer alone', () => {
    setStore({}, true);
    shell.modes.drawerOverlays = true;
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark "Renew contract" as done' }));
    expect(fns.holdTodo).toHaveBeenCalledWith(expect.objectContaining({ todoId: 't1.md', kind: 'tick' }));
    expect(fns.completeTodo).not.toHaveBeenCalled();
    expect(shell.dispatch).not.toHaveBeenCalled();
  });

  it('starts a chat with a draft naming the to-do and its id, then closes a floating drawer', () => {
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
      },
    });
    render(<TodosDrawer />);
    expect(screen.getByRole('button', { name: /Renew contract/ }).textContent).toContain('Acme Heating');
    const second = screen.getByRole('button', { name: /Plan the pages/ }).textContent ?? '';
    expect(second).toContain('UC AI search');
    expect(second).not.toContain('uc-ai-search');
  });

  it('names the row button with its action, title, due words and client', () => {
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
      },
    });
    render(<TodosDrawer />);
    const name =
      screen.getByRole('button', { name: /^Start a chat on this: Renew contract/ }).textContent ?? '';
    expect(name).toContain('overdue by');
    expect(name).toContain('Acme Heating');
    expect(screen.getByRole('button', { name: /Acme Heating/ })).toBeTruthy();
  });

  it('keeps the line about other people, and the old group of to-dos open to anyone', () => {
    setStore({
      todos: {
        mine: [],
        open: [todo('o.md', 'Anyone can do this')],
        othersCount: 1,
        team: [],
        changes: 'no-skill',
      },
    });
    render(<TodosDrawer />);
    expect(screen.getByText('1 more belongs to other people.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Open to anyone, 1' }));
    expect(screen.getByText('Anyone can do this')).toBeTruthy();
  });
});

describe('Chats drawer', () => {
  it('Earlier rows open the past chat', () => {
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    fireEvent.click(screen.getByRole('button', { name: /Old chat/ }));
    expect(fns.openPast).toHaveBeenCalledWith('p1');
  });

  it('Open rows open the chat and have a separate close button', () => {
    setStore({ sessions: { live: [live('s1')], past: [] }, activeChat: { kind: 'live', sessionId: 's1' } });
    render(<ChatsDrawer />);
    const close = screen.getByRole('button', { name: 'Close chat: Chat s1' });
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

  it('search filters to one flat list', () => {
    render(<SkillsDrawer />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: 'second' },
    });
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText(/Alpha/)).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No skills match that search.')).toBeTruthy();
  });

  it('the pin toggle reflects and changes the pin, without starting the skill', () => {
    setStore({}, false, ['a']);
    render(<SkillsDrawer />);
    const unpin = screen.getAllByRole('button', { name: 'Unpin Alpha' })[0] as HTMLElement;
    expect(unpin.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(unpin);
    expect(fns.togglePin).toHaveBeenCalledWith('a');
    expect(fns.startSkill).not.toHaveBeenCalled();
    expect(shell.dispatch).not.toHaveBeenCalled();
  });

  it('a skill shows one line of its description until it is expanded, without starting it', () => {
    render(<SkillsDrawer />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'beta' } });
    const more = screen.getByRole('button', { name: 'Description of Beta' });
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
  it('closing a chat from a floating drawer also closes the drawer, so the confirm can be seen', () => {
    shell.modes.drawerOverlays = true;
    setStore({ sessions: { live: [{ ...live('s1'), title: '' }], past: [] } });
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Close chat: New chat' }));
    expect(fns.requestClose).toHaveBeenCalledWith('s1');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });
});
