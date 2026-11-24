// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCard, ProjectDoneRow, ProjectTodoRow } from '../../../../shared/projects-contract.ts';
import { todoWhoKey } from './todo-who.ts';

vi.mock('../../store.tsx', () => ({
  useStore: () => ({
    todos: { changes: 'on', canProject: true, canUsePersonal: true },
    boot: { identity: { slug: 'sam' }, prefs: {} },
    toggleFavouriteTodo: vi.fn(),
    openSettings: vi.fn(),
    revealDoneTodo: vi.fn(),
  }),
}));
vi.mock('../../shell/ShellProvider.tsx', () => ({ useShell: () => ({ dispatch: vi.fn() }) }));

const { ProjectTodos } = await import('./ProjectTodos.tsx');

const card = { key: 'tds/sky', stages: [], archived: false, client: 'tds' } as unknown as ProjectCard;
const open = (id: string, assignee: string | null, scope: 'tds' | 'personal' = 'tds'): ProjectTodoRow =>
  ({
    key:
      assignee === 'sam' || scope === 'personal'
        ? `${scope === 'personal' ? 'personal/' : ''}${id}`
        : `todo/${id}`,
    id,
    scope,
    title: `Job ${id}`,
    assignee,
    stage: null,
    due: null,
    mine: assignee === 'sam' || assignee === null,
  }) as ProjectTodoRow;
const finished = (id: string, assignee: string | null): ProjectDoneRow => ({
  key: `done:todo/done/${id}`,
  id,
  scope: 'tds',
  title: `Done ${id}`,
  assignee,
  stage: null,
  doneDate: '2026-11-12',
  doneBy: null,
});
const show = (rows: ProjectTodoRow[], done: ProjectDoneRow[] = []) =>
  render(
    <ProjectTodos
      card={card}
      team={[]}
      rows={rows}
      done={done}
      doneCount={done.length}
      failed={false}
      reload={async () => {}}
    />,
  );
const rows = [open('a.md', 'sam'), open('b.md', 'ben'), open('c.md', null), open('p.md', 'sam', 'personal')];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the Everyone / Mine switch', () => {
  it("starts on Everyone, with each side's count, and lists everyone's to-dos", () => {
    show(rows);
    const sw = screen.getByRole('radiogroup', { name: 'Whose to-dos' });
    const everyone = within(sw).getByRole('radio', { name: 'Everyone, 4' });
    expect(everyone.getAttribute('aria-checked')).toBe('true');
    expect(within(sw).getByRole('radio', { name: 'Mine, 2' })).toBeTruthy();
    for (const id of ['a', 'b', 'c', 'p']) expect(screen.getByText(`Job ${id}.md`)).toBeTruthy();
  });

  it('on Mine shows only mine (assigned to me and my personal ones), Done included, and remembers it', () => {
    show(rows, [finished('x.md', 'sam'), finished('y.md', 'ben')]);
    fireEvent.click(screen.getByRole('radio', { name: 'Mine, 2' }));
    expect(screen.getByText('Job a.md')).toBeTruthy();
    expect(screen.getByText('Job p.md')).toBeTruthy();
    expect(screen.queryByText('Job b.md')).toBeNull();
    expect(screen.queryByText('Job c.md')).toBeNull();
    const head = screen.getByRole('button', { name: /^Done/ });
    expect(head.textContent).toContain('1');
    fireEvent.click(head);
    expect(screen.getByText('Done x.md')).toBeTruthy();
    expect(screen.queryByText('Done y.md')).toBeNull();
    expect(localStorage.getItem(todoWhoKey('sam'))).toBe('mine');

    cleanup();
    show(rows);
    expect(screen.getByRole('radio', { name: 'Mine, 2' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Job b.md')).toBeNull();
  });

  it("says so when none are mine, and Show everyone's switches back with focus on the switch", () => {
    localStorage.setItem(todoWhoKey('sam'), 'mine');
    show([open('b.md', 'ben')]);
    expect(screen.getByText(/You have no open to-dos in this project/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Show everyone's" }));
    const everyone = screen.getByRole('radio', { name: 'Everyone, 1' });
    expect(everyone.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(everyone);
    expect(screen.getByText('Job b.md')).toBeTruthy();
    expect(localStorage.getItem(todoWhoKey('sam'))).toBe('everyone');
  });

  it('is not shown in a personal project, where every to-do is mine', () => {
    const personal = { ...card, space: 'personal' } as unknown as ProjectCard;
    render(
      <ProjectTodos
        card={personal}
        team={[]}
        rows={[open('p.md', 'sam', 'personal')]}
        failed={false}
        reload={async () => {}}
      />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('Job p.md')).toBeTruthy();
  });

  it('is not shown while loading or when the project has no to-dos at all', () => {
    render(<ProjectTodos card={card} team={[]} rows={null} failed={false} reload={async () => {}} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    cleanup();
    localStorage.setItem(todoWhoKey('sam'), 'mine');
    show([]);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('No open to-dos in this project.')).toBeTruthy();
  });
});
