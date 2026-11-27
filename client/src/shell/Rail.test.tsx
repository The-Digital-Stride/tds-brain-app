// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskedTodo, AskedTodoList, TodoItem } from '../../../shared/contract.ts';
import { lookedMark, type TodoLooked } from '../../../shared/todo-changes.ts';
import type { TodoUpdate } from '../../../shared/todo-updates-contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const desk = vi.hoisted(() => ({
  current: { railShowsNames: false, width: 1400 } as Record<string, unknown>,
  shell: { drawer: null, singleKeys: true } as Record<string, unknown>,
}));
vi.mock('../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: store.current.ads ?? null }),
}));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: desk.shell, dispatch: vi.fn() }),
  useDesk: () => desk.current,
}));
vi.mock('./SyncStamp.tsx', () => ({ SyncStamp: () => null }));
vi.mock('./RailUpdate.tsx', () => ({ RailUpdate: () => null }));

const { Rail } = await import('./Rail.tsx');

const at = new Date(Date.now() - 3_600_000).toISOString();
const todo = (id: string, by: string | null): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: by ? { by, byName: by, at, from: null, via: null, source: 'stamp' } : null,
  createdBy: null,
  title: id,
  assignee: 'sam-example',
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  attachments: [],
});

function setStore(
  mine: TodoItem[],
  seen: Record<string, string> = {},
  role = 'team',
  more: {
    asked?: AskedTodoList | null;
    askedState?: 'loading' | 'loaded' | 'failed';
    looked?: TodoLooked;
  } = {},
) {
  store.current = {
    asked: more.asked ?? null,
    askedState: more.askedState ?? 'loaded',
    boot: {
      identity: { slug: 'sam-example', name: 'Sam Example', role },
      prefs: { todoSeen: seen, todoLooked: more.looked ?? {} },
    },
    todos: { mine },
    sessions: { live: [] },
    view: 'chat',
    activeChat: { kind: 'new' },
    newChat: vi.fn(),
    openView: vi.fn(),
  };
}
afterEach(() => {
  cleanup();
  desk.current = { railShowsNames: false, width: 1400 };
  desk.shell = { drawer: null, singleKeys: true };
});

describe('Rail tasks item', () => {
  it('says how many are new and shows the pip', () => {
    setStore([todo('a.md', 'ben-mcadam'), todo('b.md', null)]);
    const { container } = render(<Rail />);
    expect(screen.getByRole('button', { name: 'Tasks, 2 of yours, 1 new or updated' })).toBeTruthy();
    expect(container.querySelector('.rail-pip[data-new="true"]')).toBeTruthy();
  });

  it('has no pip and no "new" when nothing is new', () => {
    setStore([todo('a.md', 'ben-mcadam')], { 'a.md': at });
    const { container } = render(<Rail />);
    expect(screen.getByRole('button', { name: 'Tasks, 1 of yours' })).toBeTruthy();
    expect(container.querySelector('.rail-pip[data-new="true"]')).toBeNull();
  });
});

describe('Rail tasks item: changes since you looked', () => {
  const entry = (at: string): TodoUpdate => ({
    kind: 'note',
    at,
    by: 'ben-mcadam',
    byName: 'Ben McAdam',
    text: 'Hello',
    via: null,
    action: 'update',
  });
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  const changedHeld = (id: string) => ({ ...todo(id, null), updates: [entry(recent)] });
  const askedRow = (id: string): AskedTodo =>
    ({
      id,
      key: `asked:${id}`,
      state: 'waiting',
      asked: { slug: 'sam-example', name: 'Sam Example', at: '2020-01-01T00:00:00Z', source: 'stamp' },
      done: null,
      updates: [entry(recent)],
    }) as unknown as AskedTodo;
  const list = (...ids: string[]): AskedTodoList => ({
    waiting: ids.map(askedRow),
    done: [],
    historyRead: true,
  });

  it('adds held tasks that changed and asked tasks that changed to the new count', () => {
    setStore([todo('a.md', 'ben-mcadam'), changedHeld('b.md')], {}, 'team', { asked: list('q.md') });
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'Tasks, 2 of yours, 3 new or updated' })).toBeTruthy();
  });

  it('counts held tasks only while the Asked list is loading or has failed', () => {
    for (const askedState of ['loading', 'failed'] as const) {
      setStore([changedHeld('b.md')], {}, 'team', { asked: list('q.md'), askedState });
      const { unmount } = render(<Rail />);
      expect(screen.getByRole('button', { name: 'Tasks, 1 of yours, 1 new or updated' })).toBeTruthy();
      unmount();
    }
  });

  it('drops a task once it has been looked at', () => {
    const t = changedHeld('b.md');
    const looked = {
      'b.md': lookedMark({ kind: 'held', todo: t }, { slug: 'sam-example', name: 'Sam Example' }, new Date()),
    };
    setStore([t], {}, 'team', { looked });
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'Tasks, 1 of yours' })).toBeTruthy();
  });
});

describe('Rail Help item', () => {
  it('is shown to an owner, above Settings', () => {
    setStore([], {}, 'owner');
    render(<Rail />);
    const help = screen.getByRole('button', { name: 'Help' });
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(help.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(help.getAttribute('aria-keyshortcuts')).toBe('h');
  });

  it.each(['team', 'scout', 'unknown'])('is shown to %s', (role) => {
    setStore([], {}, role);
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'Help' })).toBeTruthy();
  });
});

describe('Rail Workbench item', () => {
  it('is the current item while one of its tools is open', () => {
    setStore([]);
    store.current.ads = { visible: true, me: null, sameIdentity: true, waiting: 0, clients: [] };
    store.current.view = 'tool:workbench/ad-manager';
    render(<Rail />);
    expect(screen.getByRole('button', { name: /Workbench/ }).getAttribute('aria-current')).toBe('page');
    cleanup();
    store.current.view = 'chat';
    render(<Rail />);
    expect(screen.getByRole('button', { name: /Workbench/ }).getAttribute('aria-current')).toBeNull();
  });
});

describe('Rail hover expand', () => {
  const nav = (c: HTMLElement) => c.querySelector('.rail') as HTMLElement;
  const slot = (c: HTMLElement) => c.querySelector('.railslot') as HTMLElement;
  const rest = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const mouse = { pointerType: 'mouse' };
  const toggle = (c: HTMLElement) => c.querySelector('.rail-toggle') as HTMLElement;

  it('opens after the mouse rests, names showing, without touching the saved width', () => {
    vi.useFakeTimers();
    setStore([]);
    const { container } = render(<Rail />);
    expect(nav(container).getAttribute('data-wide')).toBe('false');
    fireEvent.pointerEnter(slot(container), mouse);
    rest(199);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    rest(1);
    expect(nav(container).getAttribute('data-expanded')).toBe('true');
    expect(nav(container).getAttribute('data-wide')).toBe('true');
    // The names show, so there is no rail tooltip to blink beside them.
    expect(container.querySelector('.rail-item[data-tip]')).toBeNull();
    expect(toggle(container).getAttribute('aria-label')).toBe('Keep names showing');
    fireEvent.pointerLeave(slot(container), mouse);
    rest(150);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    expect(toggle(container).getAttribute('aria-label')).toBe('Show names');
    vi.useRealTimers();
  });

  it('never opens for touch, with the names pinned, or while something modal is open', () => {
    vi.useFakeTimers();
    setStore([]);
    const { container, rerender } = render(<Rail />);
    fireEvent.pointerEnter(slot(container), { pointerType: 'touch' });
    rest(1000);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    fireEvent.pointerLeave(slot(container));

    desk.shell = { drawer: null, singleKeys: true, paletteOpen: true };
    rerender(<Rail />);
    fireEvent.pointerEnter(slot(container), mouse);
    rest(1000);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    fireEvent.pointerLeave(slot(container));

    desk.shell = { drawer: null, singleKeys: true };
    desk.current = { railShowsNames: true, width: 1400 };
    rerender(<Rail />);
    fireEvent.pointerEnter(slot(container), mouse);
    rest(1000);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    vi.useRealTimers();
  });

  it('closes when a modal opens while it is open', () => {
    vi.useFakeTimers();
    setStore([]);
    const { container, rerender } = render(<Rail />);
    fireEvent.pointerEnter(slot(container), mouse);
    rest(200);
    desk.current = { railShowsNames: false, width: 1400, drawerModal: true };
    rerender(<Rail />);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    vi.useRealTimers();
  });

  it('still opens on the first rest after a pop-up came and went with the pointer elsewhere', () => {
    vi.useFakeTimers();
    setStore([]);
    const { container, rerender } = render(<Rail />);
    desk.shell = { drawer: null, singleKeys: true, paletteOpen: true };
    rerender(<Rail />);
    desk.shell = { drawer: null, singleKeys: true };
    rerender(<Rail />);
    fireEvent.pointerEnter(slot(container), mouse);
    rest(200);
    expect(nav(container).getAttribute('data-expanded')).toBe('true');
    vi.useRealTimers();
  });

  it('opens when Tab moves focus in, but not for a click or a focus handed back after Escape', () => {
    setStore([]);
    const { container } = render(<Rail />);
    const home = screen.getByRole('button', { name: 'Home' });
    fireEvent.pointerDown(home);
    act(() => home.focus());
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    act(() => home.blur());
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => home.focus());
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    act(() => home.blur());
    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => home.focus());
    expect(nav(container).getAttribute('data-expanded')).toBe('true');
    act(() => home.blur());
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
  });

  it('Escape closes a pointer-opened rail and stops there; a focus-opened one lets Escape through', () => {
    vi.useFakeTimers();
    setStore([]);
    const { container } = render(<Rail />);
    fireEvent.pointerEnter(slot(container), mouse);
    rest(200);
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    vi.useRealTimers();

    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => screen.getByRole('button', { name: 'Home' }).focus());
    expect(nav(container).getAttribute('data-expanded')).toBe('true');
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
  });

  it('puts Projects straight under Home, and keeps the other apps in the Apps group', () => {
    setStore([]);
    render(<Rail />);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names[names.indexOf('Home') + 1]).toBe('Projects');
    const group = screen.getByText('Apps').closest('.rail-group') as HTMLElement;
    expect(within(group).queryByRole('button', { name: 'Projects' })).toBeNull();
    expect(within(group).getByRole('button', { name: 'Images' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Documents' })).toBeTruthy();
  });

  it('shows Skills to owners and scouts only, at the foot just above Help', () => {
    setStore([], {}, 'team');
    const { unmount } = render(<Rail />);
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull();
    unmount();
    for (const role of ['owner', 'scout']) {
      setStore([], {}, role);
      const r = render(<Rail />);
      const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
      const at = names.indexOf('Skills');
      expect(at).toBeGreaterThan(names.indexOf('Projects'));
      expect(names[at + 1]).toBe('Help');
      r.unmount();
    }
  });

  it('closes when an item is chosen', () => {
    vi.useFakeTimers();
    setStore([]);
    const { container } = render(<Rail />);
    fireEvent.pointerEnter(slot(container), mouse);
    rest(200);
    fireEvent.click(screen.getByRole('button', { name: /^Chats/ }));
    expect(nav(container).getAttribute('data-expanded')).toBeNull();
    vi.useRealTimers();
  });
});
