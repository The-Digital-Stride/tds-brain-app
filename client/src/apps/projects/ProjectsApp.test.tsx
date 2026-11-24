// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TidyList } from '../../../../shared/projects-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  boot: { identity: { slug: 'me' }, clients: [] as { slug: string; name: string }[] },
  todos: {
    mine: [],
    open: [],
    othersCount: 0,
    team: [
      { slug: 'me', name: 'Me Myself' },
      { slug: 'pat-jones', name: 'Pat Jones' },
    ],
    canProject: true,
  } as unknown,
}));
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  projectActivity: vi.fn(async () => ({ since: null, token: null, items: [], more: 0, comingUp: [] })),
  projectSeen: vi.fn(async () => undefined),
  projectMeetings: vi.fn(async () => ({ cache: 'none', checked: null, last: null, next: null })),
  projectBusiness: vi.fn(async () => ({ state: 'none', client: null, path: null, facts: [], sections: [] })),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
  tidy: vi.fn(),
  applyTidy: vi.fn(),
  librarySearch: vi.fn(),
}));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'someone' });
const ACME = card({ slug: 'boiler', client: 'acme', title: 'Boiler leads', owner: 'me' });
const MINE_TEAM = card({ slug: 'seo', client: 'acme', title: 'SEO audit', owner: 'x', team: ['me'] });
const PERSONAL = card({ slug: 'taxes', client: null, title: 'Taxes', owner: 'x' });

beforeEach(() => {
  store.boot.clients = [
    { slug: 'skyseal', name: 'Skyseal' },
    { slug: 'acme', name: 'Acme Heating' },
  ];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

async function show(list: ReturnType<typeof projectList>) {
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  await screen.findByText(/of \d+ project/);
}

describe('the list', () => {
  it('groups by client with personal last, and shows light, end date and open tasks', async () => {
    await show(projectList([SKY, PERSONAL, ACME, MINE_TEAM]));
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(['Acme Heating', 'Skyseal', 'Personal']);
    const row = screen.getByRole('button', { name: /Sky site/ });
    expect(row.textContent).toMatch(/Active · ends 28 Feb 2027 · 2 open tasks/);
    expect(row.textContent).toMatch(/Health: on track/);
  });

  it('Mine shows the projects I own, am in the team of, or am in from tasks', async () => {
    const fromTodos = card({
      slug: 'ft',
      title: 'From tasks',
      owner: 'x',
      teamFromTodos: [{ person: 'me', openTodos: 1, lastActive: '2026-11-20' }],
    });
    await show(projectList([SKY, ACME, MINE_TEAM, fromTodos]));
    fireEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(screen.queryByRole('button', { name: /Sky site/ })).toBeNull();
    for (const t of ['Boiler leads', 'SEO audit', 'From tasks'])
      expect(screen.getByRole('button', { name: new RegExp(t) })).toBeTruthy();
  });

  it('filters by status', async () => {
    await show(projectList([SKY, card({ slug: 'old', title: 'Old job', status: 'done' })]));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
    expect(screen.queryByRole('button', { name: /Sky site/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Old job/ })).toBeTruthy();
  });
});

describe('read-only mode', () => {
  it('shows the notice and no way to change anything', async () => {
    const fromTodos = card({
      slug: 'ft',
      owner: 'x',
      teamFromTodos: [{ person: 'pat-jones', openTodos: 1, lastActive: '2026-11-20' }],
    });
    await show(projectList([fromTodos], { canChange: false, looseLabels: 3 }));
    expect(screen.getByText("Update the brain's skills to change projects.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tidy up' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Website rebuild/ }));
    expect(screen.getByText("Update the brain's skills to change projects.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add .* to the team/ })).toBeNull();
  });
});

describe('Add to team', () => {
  it('adds a person from tasks to the team with the card version as expect', async () => {
    const c = card({
      owner: 'x',
      team: ['simon'],
      version: 'abc123',
      teamFromTodos: [{ person: 'pat-jones', openTodos: 2, lastActive: '2026-11-20' }],
    });
    api.changeProject.mockResolvedValue(projectList([c]));
    await show(projectList([c]));
    fireEvent.click(screen.getByRole('button', { name: /Website rebuild/ }));
    expect(screen.getByText('from tasks')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Pat Jones to the team' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith({
        kind: 'edit',
        key: c.key,
        fields: { team: ['simon', 'pat-jones'] },
        expect: 'abc123',
      }),
    );
  });

  it('says plainly when the card changed meanwhile', async () => {
    const c = card({
      teamFromTodos: [{ person: 'pat-jones', openTodos: 1, lastActive: '2026-11-20' }],
    });
    const { ApiFailure } = await import('../../api.ts');
    api.changeProject.mockRejectedValue(new ApiFailure('changed' as never, 'x', 409));
    await show(projectList([c]));
    fireEvent.click(screen.getByRole('button', { name: /Website rebuild/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add Pat Jones/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/It's been reloaded, so try again/);
  });
});

describe('notices on a project', () => {
  it('offers Add a card for a card-less project, and is read-only for an archived one', async () => {
    const none = card({ slug: 'bare', title: 'Bare', card: 'none', version: '' });
    const archived = card({ slug: 'gone', title: 'Gone', archived: true });
    await show(projectList([none, archived]));
    fireEvent.click(screen.getByRole('button', { name: /Bare/ }));
    expect(screen.getByRole('button', { name: 'Add a card' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    // Archived projects are off the list until the Archived filter is chosen.
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'archived' } });
    fireEvent.click(screen.getByRole('button', { name: /Gone/ }));
    expect(screen.getByText(/archived/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
  });

  it('labels the hours "Hours a month" for an ongoing project', async () => {
    await show(projectList([card({ kind: 'ongoing', budgetHours: 15 })]));
    fireEvent.click(screen.getByRole('button', { name: /Website rebuild/ }));
    expect(screen.getByText('Hours a month')).toBeTruthy();
    expect(screen.queryByText('Budget hours')).toBeNull();
  });

  it('puts the Brief first, then About the client, then Details', async () => {
    api.projectBusiness.mockResolvedValueOnce({
      state: 'ok',
      client: { slug: 'skyseal', name: 'Skyseal', status: null },
      path: 'clients/skyseal/context/business.md',
      facts: [{ id: 'contact', words: 'Main contact', value: 'Sam, ops lead', from: 'business' }],
      sections: [],
    } as never);
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    const brief = screen.getByRole('heading', { name: 'Brief' });
    const about = await screen.findByRole('heading', { name: 'About Skyseal' });
    const details = screen.getByRole('region', { name: 'Details' });
    expect(brief.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(about.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the tidy-up', () => {
  const rows: TidyList = {
    rows: [
      {
        label: 'sky-site',
        todos: [
          { id: 'a.md', scope: 'tds', title: 'Fix header', client: null, assignee: null, version: 'v' },
        ],
        conflicts: [{ id: 'b.md', scope: 'tds', title: 'Other job', client: 'acme' }],
        suggestion: { do: 'link', key: SKY.key, why: 'same-slug' },
      },
      {
        label: 'misc',
        todos: [{ id: 'c.md', scope: 'tds', title: 'Misc job', client: null, assignee: null, version: 'v' }],
        conflicts: [],
        suggestion: { do: 'skip', why: 'no-match' },
      },
    ],
    skipped: [],
  };

  const open = async () => {
    api.tidy.mockResolvedValue(rows);
    await show(projectList([SKY], { looseLabels: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Tidy up' }));
    await screen.findByText('Fix header');
  };

  it('shows conflicts apart and Approve sends the suggestion, then redraws from the returned list', async () => {
    await open();
    expect(screen.getByText(/different client/)).toBeTruthy();
    expect(screen.getByText(/Other job/)).toBeTruthy();
    api.applyTidy.mockResolvedValue({ rows: [rows.rows[1]], skipped: [] });
    const first = screen.getByRole('listitem', { name: 'Label sky-site' });
    fireEvent.click(within(first).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(api.applyTidy).toHaveBeenCalledWith({
        label: 'sky-site',
        do: 'approve',
        suggestion: { do: 'link', key: SKY.key, why: 'same-slug' },
      }),
    );
    await waitFor(() => expect(screen.queryByText('Fix header')).toBeNull());
    expect(screen.getByText('Misc job')).toBeTruthy();
  });

  it('Skip skips the label; a no-match row cannot be approved; Change picks a project', async () => {
    await open();
    const second = screen.getByRole('listitem', { name: 'Label misc' });
    // Not-allowed buttons are aria-disabled, never disabled (design system, Actions rule 12).
    expect(within(second).getByRole('button', { name: 'Approve' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.click(within(second).getByRole('button', { name: 'Change' }));
    fireEvent.change(within(second).getByLabelText('Use this instead'), { target: { value: SKY.key } });
    api.applyTidy.mockResolvedValue({ rows: [rows.rows[0]], skipped: [] });
    await act(async () => {
      fireEvent.click(within(second).getByRole('button', { name: 'Apply' }));
    });
    expect(api.applyTidy).toHaveBeenCalledWith({
      label: 'misc',
      do: 'approve',
      suggestion: { do: 'link', key: SKY.key, why: 'same-slug' },
    });
    api.applyTidy.mockResolvedValue({ rows: [], skipped: ['sky-site'] });
    const first = await screen.findByRole('listitem', { name: 'Label sky-site' });
    await act(async () => {
      fireEvent.click(within(first).getByRole('button', { name: 'Skip' }));
    });
    expect(api.applyTidy).toHaveBeenLastCalledWith({ label: 'sky-site', do: 'skip' });
    expect(await screen.findByRole('button', { name: 'Bring back sky-site' })).toBeTruthy();
  });
});
