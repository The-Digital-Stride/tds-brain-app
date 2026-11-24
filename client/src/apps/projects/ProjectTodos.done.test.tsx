// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCard, ProjectDoneRow, ProjectTodoRow } from '../../../../shared/projects-contract.ts';

const dispatch = vi.hoisted(() => vi.fn());
const revealDoneTodo = vi.hoisted(() => vi.fn());
vi.mock('../../store.tsx', () => ({
  useStore: () => ({
    todos: { changes: 'on', canProject: true, canUsePersonal: true },
    boot: null,
    toggleFavouriteTodo: vi.fn(),
    openSettings: vi.fn(),
    revealDoneTodo,
  }),
}));
vi.mock('../../shell/ShellProvider.tsx', () => ({ useShell: () => ({ dispatch }) }));

const { ProjectTodos, doneRowMeta } = await import('./ProjectTodos.tsx');

const card = { key: 'tds/sky', stages: [], archived: false, client: 'tds' } as unknown as ProjectCard;
const row = (id: string, over: Partial<ProjectDoneRow> = {}): ProjectDoneRow => ({
  key: `done:todo/done/${id}`,
  id,
  scope: 'tds',
  title: `Job ${id}`,
  assignee: null,
  stage: null,
  doneDate: '2026-11-12',
  doneBy: null,
  ...over,
});
const show = (done?: ProjectDoneRow[], doneCount?: number) =>
  render(
    <ProjectTodos
      card={card}
      team={[]}
      rows={[]}
      done={done}
      doneCount={doneCount}
      failed={false}
      reload={async () => {}}
    />,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectTodos Done section', () => {
  it('shows a folded Done section with the count when there are finished rows', () => {
    show([row('a'), row('b', { doneDate: null })], 7);
    const head = screen.getByRole('button', { name: /Done/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.textContent).toContain('7');
  });

  it('shows no section for an older server or an empty list', () => {
    show(undefined);
    expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
    cleanup();
    show([], 0);
    expect(screen.queryByRole('button', { name: /Done/ })).toBeNull();
  });

  it('opens the finished to-do in the drawer when its row is pressed', () => {
    show([row('a')], 1);
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    const open = screen.getByText('Job a');
    expect(screen.getByText(/Done, 12 Nov 2026/)).toBeTruthy();
    fireEvent.click(open);
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-drawer', drawer: 'todos' });
    expect(revealDoneTodo).toHaveBeenCalledWith('done:todo/done/a');
  });
});

describe("ProjectTodos teammates' rows", () => {
  const todo = (id: string, mine: boolean) =>
    ({
      key: mine ? `todo/${id}` : `team:${id}`,
      id,
      scope: 'tds',
      title: `Job ${id}`,
      assignee: 'ben-mcadam',
      stage: null,
      due: null,
      mine,
    }) as unknown as ProjectTodoRow;

  it("opens a teammate's to-do read only under its team: key, without star or chat", () => {
    render(
      <ProjectTodos
        card={card}
        team={[]}
        rows={[todo('t.md', false)]}
        failed={false}
        reload={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Job t.md/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-drawer', drawer: 'todos' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-todo', key: 'team:todo/t.md', mode: 'read' });
    expect(screen.getByText(/Assigned to/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /star|chat/i })).toBeNull();
  });

  it('leaves a personal to-do that is not on my lists as plain text (it is never sent as a team: key)', () => {
    const personal = { ...todo('p.md', false), key: 'personal/p.md', scope: 'personal' } as ProjectTodoRow;
    render(<ProjectTodos card={card} team={[]} rows={[personal]} failed={false} reload={async () => {}} />);
    expect(screen.getByText('Job p.md')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Job p.md/ })).toBeNull();
  });

  it('still opens my own to-do by its own key', () => {
    render(
      <ProjectTodos
        card={card}
        team={[]}
        rows={[todo('m.md', true)]}
        failed={false}
        reload={async () => {}}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Job m.md/ })[0] as HTMLElement);
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-todo', key: 'todo/m.md', mode: 'read' });
  });
});

describe('doneRowMeta', () => {
  it('names who ticked it (first name), not who had it, and keeps the year', () => {
    expect(doneRowMeta({ doneDate: '2026-11-12', doneBy: 'Sam Taylor' })).toMatch(/^Done by Sam, 12 Nov/);
    expect(doneRowMeta({ doneDate: '2026-11-12', doneBy: null })).toMatch(/^Done, 12 Nov/);
    expect(doneRowMeta({ doneDate: null, doneBy: 'Sam Taylor' })).toBe('Done by Sam; date not known');
    expect(doneRowMeta({ doneDate: null, doneBy: null })).toBe('Done; date not known');
  });
});
