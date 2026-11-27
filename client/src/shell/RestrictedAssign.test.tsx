// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card, projectList } from '../apps/projects/testing.ts';

// Restricted projects, decision 7: a task in a restricted project can't go to someone outside it. The pickers show
// them unavailable with the note (the server refuses too); nothing is blocked client-side without `seesAll`.

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const api = vi.hoisted(() => ({ projects: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);

const { projectsStore } = await import('../state/projects.ts');
const { projectChoice } = await import('../state/client-choice.ts');
const { AddTodoForm } = await import('./TodoForms.tsx');
const { SearchSelect } = await import('./SearchSelect.tsx');
const { filterOptions } = await import('../state/projects.ts');
const { openPicker } = await import('../test/pick.ts');

const SECRET = card({
  slug: 'merger',
  client: 'acme',
  title: 'Secret merger',
  owner: 'pat-jones',
  team: ['sam-lee'],
  visibility: 'restricted',
});
const OPEN = card({ slug: 'site', client: 'acme', title: 'Open site', owner: 'pat-jones' });
const TEAM = [
  { slug: 'pat-jones', name: 'Pat Jones' },
  { slug: 'sam-lee', name: 'Sam Lee' },
  { slug: 'ben-mcadam', name: 'Ben McAdam' },
  { slug: 'sue-scout', name: 'Sue Scout' },
];

beforeEach(() => {
  store.current = {
    boot: {
      clients: [{ slug: 'acme', name: 'Acme' }],
      identity: { name: 'Pat Jones', slug: 'pat-jones', role: 'team', knownMember: true },
    },
    todos: { team: TEAM },
  };
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  act(() => projectChoice.set(''));
  api.projects.mockReset();
});

function addForm(list: ReturnType<typeof projectList>, startProject: string) {
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  return render(
    <AddTodoForm
      me="pat-jones"
      team={TEAM}
      busy={false}
      canAddOpen={false}
      canUsePersonal={false}
      canProject
      startPersonal={false}
      startProject={startProject}
      onAdd={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}
const who = () => screen.getByLabelText('Assigned to') as HTMLSelectElement;
const option = (name: RegExp) => within(who()).getByRole('option', { name }) as HTMLOptionElement;

describe('the Assigned to list on a task in a restricted project', () => {
  it('keeps outsiders in the list, unavailable, with the exact note; the team and owners stay available', () => {
    addForm(projectList([SECRET], { seesAll: ['sue-scout'] }), SECRET.key);
    const ben = option(/Ben McAdam/);
    expect(ben.disabled).toBe(true);
    // Marked in the list itself, with the reason in the hint under the box (no hover tip: a menu never shows one).
    expect(ben.textContent).toBe('Ben McAdam (not on this project)');
    expect(screen.getByText(/can't be given its tasks\. Add them to the project team first\./)).toBeTruthy();
    expect(option(/Sam Lee/).disabled).toBe(false);
    expect(option(/Sue Scout/).disabled).toBe(false);
    // The Account Owner (me) is always fine.
    expect((within(who()).getByRole('option', { name: 'Me' }) as HTMLOptionElement).disabled).toBe(false);
  });

  it('blocks nobody when the server sent no seesAll (an older server)', () => {
    addForm(projectList([SECRET]), SECRET.key);
    for (const o of within(who()).getAllByRole('option'))
      expect((o as HTMLOptionElement).disabled).toBe(false);
  });

  it('blocks nobody on an open project', () => {
    addForm(projectList([OPEN], { seesAll: ['sue-scout'] }), OPEN.key);
    for (const o of within(who()).getAllByRole('option'))
      expect((o as HTMLOptionElement).disabled).toBe(false);
  });
});

describe('the Restricted badge in a project picker', () => {
  it('shows beside a restricted project in the list, and not beside an open one', () => {
    render(
      <>
        <label htmlFor="pick">Working on</label>
        <SearchSelect
          id="pick"
          value=""
          options={filterOptions([SECRET, OPEN], [{ slug: 'acme', name: 'Acme' }])}
          onChange={vi.fn()}
        />
      </>,
    );
    openPicker('Working on');
    const rows = screen.getAllByRole('option');
    const secret = rows.find((r) => r.textContent?.includes('Secret merger')) as HTMLElement;
    const open = rows.find((r) => r.textContent?.includes('Open site')) as HTMLElement;
    expect(within(secret).getByText('Restricted: only its team, owners and scouts can see it')).toBeTruthy();
    expect(within(open).queryByText(/^Restricted/)).toBeNull();
    // A label and an icon, not colour alone.
    expect(within(secret).getByText('Restricted')).toBeTruthy();
    expect(secret.querySelector('svg')).toBeTruthy();
  });
});
