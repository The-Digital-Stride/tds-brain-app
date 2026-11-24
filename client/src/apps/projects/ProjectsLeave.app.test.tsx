// @vitest-environment jsdom
// The Files picker holds the sheet like the project form does (plan 2026-11-23-ux-follow-ups, decision 1; design
// system, Actions rule 9), and Keep editing gives focus back to the field that was being edited. A project's "Add a
// to-do" opens the To-dos panel's full form with the project filled in, and that panel holds typing the same way.
// The whole app with the real store and shell and a fake server.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsSummary } from '../../../../shared/ads-contract.ts';
import { card, projectList } from './testing.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  changeTodo: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  updatePrefs: vi.fn(),
  adsAccounts: vi.fn(),
  adsApprovals: vi.fn(),
  adsBoard: vi.fn(),
  adsStandupBrief: vi.fn(),
  projects: vi.fn(),
  projectTodos: vi.fn(),
  projectFiles: vi.fn(),
  librarySearch: vi.fn(),
  libraryItems: vi.fn(),
}));
vi.mock('../../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));
const summary = vi.hoisted(() => ({ loadAdsSummary: vi.fn() }));
vi.mock('../../tools/ad-manager/summary.ts', () => summary);
vi.mock('../../tools/ad-manager/use-ads-preload.ts', () => ({ useAdsPreload: () => {} }));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

const { App } = await import('../../App.tsx');
const { adStore } = await import('../../tools/ad-manager/store.ts');
const { projectsStore } = await import('../../state/projects.ts');
// Projects loads on demand: load it once here, so no test spends its findBy wait on the import under load.
await import('./ui.ts');

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [{ slug: 'acme', name: 'Acme Heating' }],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false, tourSeen: 1 },
};
const adsSummary: AdsSummary = {
  visible: true,
  me: { slug: 'sam', name: 'Sam', role: 'owner' } as AdsSummary['me'],
  sameIdentity: true,
  waiting: 0,
  clients: [],
};
const SPRING = card({ slug: 'spring', client: 'acme', title: 'Spring launch', owner: 'sam' });

const strip = () => screen.queryByRole('group', { name: 'Discard your changes' });
const press = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Discard your changes' })).getByRole('button', { name }),
  );
const rail = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('innerWidth', 1700);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({
    mine: [],
    open: [],
    othersCount: 0,
    team: [{ slug: 'sam', name: 'Sam' }],
    canProject: true,
    changes: 'on',
  });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
  api.adsAccounts.mockResolvedValue([]);
  api.adsApprovals.mockRejectedValue(new Error('no approvals in this test'));
  api.adsBoard.mockRejectedValue(new Error('no board in this test'));
  api.adsStandupBrief.mockResolvedValue(null);
  api.projects.mockResolvedValue(projectList([SPRING]));
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.libraryItems.mockResolvedValue({ files: [] });
  api.librarySearch.mockResolvedValue({ hits: [] });
  summary.loadAdsSummary.mockResolvedValue(adsSummary);
  adStore.reset();
  projectsStore.reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

/** A project tab. The rail has a To-dos button too, so look inside the tabs row. */
const tab = async (name: string | RegExp) =>
  within(await screen.findByRole('navigation', { name: 'Project sections' })).getByRole('button', { name });

async function openProject() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  rail(/^Projects/);
  fireEvent.click(await screen.findByRole('button', { name: /Spring launch/ }));
}
/** The project's To-dos tab, then its Add a to-do: the To-dos panel's add form. */
async function openAdd() {
  await openProject();
  fireEvent.click(await tab(/^To-dos/));
  // As from the keyboard: the button has focus when it is pressed (a jsdom click doesn't move focus).
  projectAdd().focus();
  fireEvent.click(projectAdd());
  return (await screen.findByLabelText('What needs doing?')) as HTMLInputElement;
}
const addForm = () => screen.getByRole('form', { name: 'Add a to-do' });
/** The project page's own Add a to-do, at the end of its tabs row (the drawer and the form have one too). */
const projectAdd = () =>
  within(
    screen.getByRole('navigation', { name: 'Project sections' }).closest('.proj-tabrow') as HTMLElement,
  ).getByRole('button', { name: 'Add a to-do' });

describe("a project's Add a to-do", () => {
  it('opens the full form in the To-dos panel, starting in the project, and adds it there', async () => {
    const title = await openAdd();
    // Every option, from the start: nothing behind "More options".
    within(addForm()).getByLabelText('Due date (optional)');
    within(addForm()).getByLabelText('Assigned to');
    within(addForm()).getByLabelText('Project');
    within(addForm()).getByLabelText('Stage');
    expect(within(addForm()).queryByRole('button', { name: 'More options' })).toBeNull();
    // The project page has no cut-down form of its own.
    expect(screen.queryByLabelText('To-do')).toBeNull();
    api.changeTodo.mockResolvedValue({
      mine: [],
      open: [],
      othersCount: 0,
      team: [{ slug: 'sam', name: 'Sam' }],
      canProject: true,
      changes: 'on',
    });
    fireEvent.change(title, { target: { value: 'Book the shoot' } });
    fireEvent.change(within(addForm()).getByLabelText('Stage'), { target: { value: 'Build' } });
    const before = api.projectTodos.mock.calls.length;
    fireEvent.submit(addForm());
    await waitFor(() =>
      expect(api.changeTodo).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'add',
          title: 'Book the shoot',
          client: 'acme',
          project: 'acme/spring',
          stage: 'Build',
        }),
      ),
    );
    // The project's list reloads to show it.
    await waitFor(() => expect(api.projectTodos.mock.calls.length).toBeGreaterThan(before));
  });

  it('pressed again with a title typed, keeps the typing', async () => {
    const title = await openAdd();
    fireEvent.change(title, { target: { value: 'Half a thought' } });
    fireEvent.click(projectAdd());
    expect(strip()).toBeNull();
    expect((screen.getByLabelText('What needs doing?') as HTMLInputElement).value).toBe('Half a thought');
  });

  it('puts the keyboard in the title every time, and Cancel gives it back to the project button', async () => {
    await openAdd();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('What needs doing?')));
    fireEvent.click(within(addForm()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add a to-do' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(projectAdd()));
    // Again with the drawer shut: the panel's code is loaded now, and the drawer opening must not take the keyboard.
    fireEvent.click(
      within(document.getElementById('drawer') as HTMLElement).getAllByRole('button', {
        name: /^Close/,
      })[0] as HTMLElement,
    );
    await waitFor(() => expect(document.querySelector('#drawer form, #todo-panel-slot form')).toBeNull());
    projectAdd().focus();
    fireEvent.click(projectAdd());
    await screen.findByLabelText('What needs doing?');
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(screen.getByLabelText('What needs doing?'));
  });

  it('with a title typed, a rail click asks in the panel; Keep editing keeps the title', async () => {
    const title = await openAdd();
    fireEvent.change(title, { target: { value: 'Book the shoot' } });
    rail(/^Home/);
    // The To-dos panel's own rule: the page changes and the panel asks before it closes.
    expect(strip()).not.toBeNull();
    press('Keep editing');
    expect((screen.getByLabelText('What needs doing?') as HTMLInputElement).value).toBe('Book the shoot');
  });
});

describe('leaving the Files picker with files chosen', () => {
  const hit = {
    item: {
      id: 'i1',
      kind: 'image',
      name: 'hero.png',
      title: 'Hero',
      path: 'clients/acme/images/hero.png',
      group: 'Acme',
    },
  };
  it('a tab switch asks; Keep keeps the choice, Discard changes switches', async () => {
    api.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
      hits: kind === 'image' ? [hit] : [],
    }));
    await openProject();
    fireEvent.click(await tab('Files'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add files' }));
    fireEvent.change(await screen.findByPlaceholderText('Search images and documents'), {
      target: { value: 'hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(within(await screen.findByRole('list', { name: 'Files found' })).getByRole('checkbox'));
    fireEvent.click(await tab('Overview'));
    expect(strip()).not.toBeNull();
    press('Keep editing');
    expect(screen.getByRole('list', { name: 'Chosen files' })).toBeTruthy();
    fireEvent.click(await tab('Overview'));
    press('Discard changes');
    expect(await screen.findByRole('region', { name: 'Details' })).toBeTruthy();
  });

  it("the picker's own Close asks too; Keep keeps the choice, Discard changes closes it", async () => {
    api.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
      hits: kind === 'image' ? [hit] : [],
    }));
    await openProject();
    fireEvent.click(await tab('Files'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add files' }));
    fireEvent.change(await screen.findByPlaceholderText('Search images and documents'), {
      target: { value: 'hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(within(await screen.findByRole('list', { name: 'Files found' })).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(strip()).not.toBeNull();
    press('Keep editing');
    expect(screen.getByRole('list', { name: 'Chosen files' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    press('Discard changes');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Add files' })).toBeNull());
  });
});

describe('Keep editing on the project form', () => {
  it('puts focus back on the field that was being edited', async () => {
    await openProject();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const title = (await screen.findByLabelText('Title')) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Spring launch 2' } });
    title.focus();
    rail(/^Home/);
    const keep = within(screen.getByRole('group', { name: 'Discard your changes' })).getByRole('button', {
      name: 'Keep editing',
    });
    expect(document.activeElement).toBe(keep);
    press('Keep editing');
    expect(strip()).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Spring launch 2');
  });
});
