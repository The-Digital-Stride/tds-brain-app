// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card, projectList } from './testing.ts';

// Restricted projects (plan 2026-11-27-restricted-projects, decisions 9 and 10): the badge, the "Who can see it" choice
// and the confirm that names who will stop seeing the project.

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  openChat: vi.fn(),
  requestComposerFocus: vi.fn(),
  newChatDrawer: null as number | null,
  activeChat: { kind: 'new', key: 1, project: null } as { kind: string; key: number; project: string | null },
  sessions: null as { live: unknown[]; past: unknown[] } | null,
  changeTodos: vi.fn(),
  boot: {
    identity: { name: 'Owen Owner', slug: 'owen-owner', role: 'owner', knownMember: true } as {
      name: string;
      slug: string;
      role: string;
      knownMember: boolean;
    },
    clients: [{ slug: 'acme', name: 'Acme Heating' }],
  },
  todos: {
    mine: [],
    open: [],
    othersCount: 0,
    team: [
      { slug: 'owen-owner', name: 'Owen Owner' },
      { slug: 'pat-jones', name: 'Pat Jones' },
      { slug: 'sam-lee', name: 'Sam Lee' },
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
  projectTodos: vi.fn(),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
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
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ dispatch: vi.fn(), state: {}, modes: {} }),
}));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { ProjectForm } = await import('./ProjectForm.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { keptDrafts } = await import('../../state/kept-drafts.ts');

const BADGE = 'Restricted: only its team, owners and scouts can see it';
const OPEN = card({ slug: 'site', title: 'Open site', owner: 'pat-jones', client: 'acme' });
const SECRET = card({
  slug: 'merger',
  title: 'Secret merger',
  client: 'acme',
  owner: 'pat-jones',
  team: ['sam-lee'],
  visibility: 'restricted',
});

const team = [
  { slug: 'owen-owner', name: 'Owen Owner' },
  { slug: 'pat-jones', name: 'Pat Jones' },
  { slug: 'sam-lee', name: 'Sam Lee' },
];
const clients = [{ slug: 'acme', name: 'Acme Heating' }];

beforeEach(() => {
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  store.boot.identity = { name: 'Owen Owner', slug: 'owen-owner', role: 'owner', knownMember: true };
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  keptDrafts.reload();
  projectsStore.reset();
  vi.clearAllMocks();
});

function openTask(assignee: string | null, id = 't1') {
  return { key: id, id, scope: 'tds', title: `Task ${id}`, assignee, due: null, stage: null, mine: false };
}

function renderForm(
  list: ReturnType<typeof projectList>,
  opts: { mode?: 'create' | 'edit'; card?: ReturnType<typeof card> | null } = {},
) {
  projectsStore.apply(list);
  api.projects.mockResolvedValue(list);
  return render(
    <ProjectForm
      mode={opts.mode ?? 'edit'}
      card={opts.card === undefined ? OPEN : opts.card}
      clients={clients}
      team={team}
      me="owen-owner"
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe('the badge', () => {
  it('marks a restricted project on the list and its page, and an open one on neither', async () => {
    const list = projectList([OPEN, SECRET]);
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    const rows = screen.getAllByRole('listitem');
    const secretRow = rows.find((r) => r.textContent?.includes('Secret merger'));
    const openRow = rows.find((r) => r.textContent?.includes('Open site'));
    expect(within(secretRow as HTMLElement).getByText(BADGE)).toBeTruthy();
    expect(within(secretRow as HTMLElement).getByText('Restricted')).toBeTruthy();
    expect(within(openRow as HTMLElement).queryByText(BADGE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Secret merger/ }));
    const head = await screen.findByRole('heading', { level: 2, name: /Secret merger/ });
    expect(within(head).getByText(BADGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    fireEvent.click(screen.getByRole('button', { name: /Open site/ }));
    const open = await screen.findByRole('heading', { level: 2, name: /Open site/ });
    expect(within(open).queryByText(BADGE)).toBeNull();
  });
});

describe('the Who can see it choice', () => {
  const choice = () => screen.queryByRole('radiogroup', { name: 'Who can see it' });

  it('shows only when the server can switch it and this person may', () => {
    // The script can't (no canRestrict): no control.
    renderForm(projectList([OPEN]));
    expect(choice()).toBeNull();
    cleanup();
    // The script can, and this is an owner.
    renderForm(projectList([OPEN], { canRestrict: true }));
    expect(choice()).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Everyone on the team' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Only the project team' })).toBeTruthy();
    expect(
      screen.getByText(/It is hidden, not locked: its files are still in the brain on every Mac\./),
    ).toBeTruthy();
    cleanup();
    // The script can, but this is a team member who isn't the Account Owner.
    store.boot.identity = { name: 'Sam Lee', slug: 'sam-lee', role: 'team', knownMember: true };
    renderForm(projectList([OPEN], { canRestrict: true }));
    expect(choice()).toBeNull();
    cleanup();
    // The Account Owner may, whatever their role.
    store.boot.identity = { name: 'Pat Jones', slug: 'pat-jones', role: 'team', knownMember: true };
    renderForm(projectList([OPEN], { canRestrict: true }));
    expect(choice()).toBeTruthy();
  });

  it('is not offered for a personal project, but is when creating a client project', () => {
    const mine = card({ slug: 'taxes', client: null, title: 'Taxes' });
    renderForm(projectList([mine], { canRestrict: true }), { card: mine });
    expect(choice()).toBeNull();
    cleanup();
    renderForm(projectList([], { canRestrict: true }), { mode: 'create', card: null });
    // "Who is it for" starts on a client: anyone creating may choose it.
    expect(choice()).toBeTruthy();
    cleanup();
    renderForm(projectList([], { canRestrict: false }), { mode: 'create', card: null });
    expect(choice()).toBeNull();
  });

  it('sends visibility only when it changed', async () => {
    api.changeProject.mockResolvedValue(projectList([OPEN], { canRestrict: true }));
    renderForm(projectList([OPEN], { canRestrict: true }));
    // Nothing touched: a title change alone sends no visibility.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Open site 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.changeProject).toHaveBeenCalledTimes(1));
    const sent = api.changeProject.mock.calls[0]?.[0] as { fields: Record<string, unknown> };
    expect(sent.fields).toEqual({ title: 'Open site 2' });
    expect('visibility' in sent.fields).toBe(false);
  });

  it('sends "everyone" when a restricted project is opened up, with no question', async () => {
    api.changeProject.mockResolvedValue(projectList([SECRET], { canRestrict: true }));
    renderForm(projectList([SECRET], { canRestrict: true }), { card: SECRET });
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone on the team' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.changeProject).toHaveBeenCalledTimes(1));
    expect(api.changeProject.mock.calls[0]?.[0]).toMatchObject({ fields: { visibility: 'everyone' } });
  });
});

describe('the confirm before restricting', () => {
  const list = () => projectList([OPEN], { canRestrict: true, seesAll: ['owen-owner'] });

  it('names who has open tasks and will stop seeing it, then sends visibility when confirmed', async () => {
    // Pat is the Account Owner, Owen sees all: only Sam (open task, not on the project) is affected.
    api.projectTodos.mockResolvedValue({
      todos: [
        openTask('sam-lee', 'a'),
        openTask('pat-jones', 'b'),
        openTask('owen-owner', 'c'),
        openTask(null, 'd'),
      ],
      count: 4,
    });
    api.changeProject.mockResolvedValue(list());
    renderForm(list());
    fireEvent.click(screen.getByRole('radio', { name: 'Only the project team' }));
    const ask = await screen.findByRole('group', { name: 'Who will see this project' });
    // The question names the project and says who will still see it, owners and scouts included.
    expect(ask.textContent).toContain('Restrict Open site?');
    expect(ask.textContent).toContain('Only its team, owners and scouts will see it in Cortex.');
    expect(ask.textContent).toContain('Sam Lee has open tasks here and will stop seeing this project.');
    expect(ask.textContent).not.toContain('Pat Jones');
    expect(ask.textContent).not.toContain('Owen Owner');
    expect(ask.textContent).toContain('Their tasks stay with them, shown as a restricted project.');
    expect(ask.textContent).toContain('People on an older Cortex still see it until they update.');
    // Nothing is sent, and the choice hasn't moved, until it is confirmed.
    expect(api.changeProject).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Everyone on the team', checked: true })).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Restrict project' }));
    expect(screen.queryByRole('group', { name: 'Who will see this project' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Only the project team', checked: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.changeProject).toHaveBeenCalledTimes(1));
    expect(api.changeProject.mock.calls[0]?.[0]).toMatchObject({ fields: { visibility: 'restricted' } });
  });

  it('can be cancelled without sending or changing anything', async () => {
    api.projectTodos.mockResolvedValue({ todos: [openTask('sam-lee')], count: 1 });
    renderForm(list());
    fireEvent.click(screen.getByRole('radio', { name: 'Only the project team' }));
    const ask = await screen.findByRole('group', { name: 'Who will see this project' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it open' }));
    expect(screen.queryByRole('group', { name: 'Who will see this project' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Everyone on the team', checked: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Nothing changed, so the form closes without a request.
    await act(async () => {});
    expect(api.changeProject).not.toHaveBeenCalled();
  });

  it('still shows the older-Cortex line when nobody is affected', async () => {
    renderForm(list());
    fireEvent.click(screen.getByRole('radio', { name: 'Only the project team' }));
    const ask = await screen.findByRole('group', { name: 'Who will see this project' });
    expect(ask.textContent).toContain('People on an older Cortex still see it until they update.');
    expect(ask.textContent).not.toContain('will stop seeing');
  });

  it('asks before taking someone with open tasks off a restricted project, and not for someone without', async () => {
    api.projectTodos.mockResolvedValue({ todos: [openTask('sam-lee')], count: 1 });
    renderForm(projectList([SECRET], { canRestrict: true, seesAll: ['owen-owner'] }), { card: SECRET });
    const samBox = screen.getByRole('checkbox', { name: 'Sam Lee' }) as HTMLInputElement;
    fireEvent.click(samBox);
    const ask = await screen.findByRole('group', { name: 'Who will see this project' });
    expect(ask.textContent).toContain('Sam Lee has open tasks here and will stop seeing this project.');
    // Keep: still ticked.
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep them on the team' }));
    expect(samBox.checked).toBe(true);
    // Confirm: unticked.
    fireEvent.click(samBox);
    const again = await screen.findByRole('group', { name: 'Who will see this project' });
    fireEvent.click(within(again).getByRole('button', { name: 'Take them off the team' }));
    expect(samBox.checked).toBe(false);
  });

  it("says it couldn't check, not that nobody is affected, when the tasks can't be read", async () => {
    api.projectTodos.mockRejectedValue(new Error('offline'));
    renderForm(list());
    fireEvent.click(screen.getByRole('radio', { name: 'Only the project team' }));
    const ask = await screen.findByRole('group', { name: 'Who will see this project' });
    expect(ask.textContent).toContain("Cortex couldn't check who has open tasks here.");
    expect(ask.textContent).not.toContain('Nobody with open tasks');
    expect(ask.textContent).toContain('People on an older Cortex still see it until they update.');
    // The failed read isn't remembered: asking again reads again.
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it open' }));
    api.projectTodos.mockResolvedValue({ todos: [openTask('sam-lee')], count: 1 });
    fireEvent.click(screen.getByRole('radio', { name: 'Only the project team' }));
    const again = await screen.findByRole('group', { name: 'Who will see this project' });
    expect(again.textContent).toContain('Sam Lee has open tasks here and will stop seeing this project.');
  });

  it("asks before taking someone off a restricted project when their tasks can't be read", async () => {
    api.projectTodos.mockRejectedValue(new Error('offline'));
    renderForm(projectList([SECRET], { canRestrict: true, seesAll: ['owen-owner'] }), { card: SECRET });
    const samBox = screen.getByRole('checkbox', { name: 'Sam Lee' }) as HTMLInputElement;
    fireEvent.click(samBox);
    const ask = await screen.findByRole('group', { name: 'Who will see this project' });
    expect(ask.textContent).toContain("Cortex couldn't check whether Sam Lee has open tasks here.");
    expect(ask.textContent).toContain('Take Sam Lee off this restricted project?');
    expect(samBox.checked).toBe(true);
    fireEvent.click(within(ask).getByRole('button', { name: 'Take them off the team' }));
    expect(samBox.checked).toBe(false);
  });

  it('takes someone with no open tasks off a restricted project without asking', async () => {
    api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
    renderForm(projectList([SECRET], { canRestrict: true, seesAll: [] }), { card: SECRET });
    const samBox = screen.getByRole('checkbox', { name: 'Sam Lee' }) as HTMLInputElement;
    fireEvent.click(samBox);
    await waitFor(() => expect(samBox.checked).toBe(false));
    expect(screen.queryByRole('group', { name: 'Who will see this project' })).toBeNull();
  });
});
