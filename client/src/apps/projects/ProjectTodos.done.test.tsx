// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCard, ProjectDoneRow } from '../../../../shared/projects-contract.ts';

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

const { ProjectTodos } = await import('./ProjectTodos.tsx');

const card = { key: 'tds/sky', stages: [], archived: false, client: 'tds' } as unknown as ProjectCard;
const row = (id: string, over: Partial<ProjectDoneRow> = {}): ProjectDoneRow => ({
  key: `done:todo/done/${id}`,
  id,
  scope: 'tds',
  title: `Job ${id}`,
  assignee: null,
  stage: null,
  doneDate: '2026-11-12',
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
    expect(screen.getByText(/Done 12 Nov 2026/)).toBeTruthy();
    fireEvent.click(open);
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-drawer', drawer: 'todos' });
    expect(revealDoneTodo).toHaveBeenCalledWith('done:todo/done/a');
  });
});
