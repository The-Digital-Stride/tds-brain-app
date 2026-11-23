// @vitest-environment jsdom
// The project's "Add a to-do" form and the Files picker hold the sheet like the project form does (plan
// 2026-11-23-ux-follow-ups, decision 1; design system, Actions rule 9), and Keep editing gives focus back to the field
// that was being edited. The whole app with the real store and shell and a fake server.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsSummary } from '../../../../shared/ads-contract.ts';
import { card, projectList } from './testing.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
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
vi.mock('../../tools/ad-manager/use-ads-due.ts', () => ({ useAdsDue: () => {} }));

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
const pageTitle = () => screen.getByRole('heading', { level: 1 }).textContent ?? '';

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
/** The project's To-dos tab with the add form open and a title typed. */
async function addFormTyped(text = 'Book the shoot') {
  await openProject();
  fireEvent.click(await tab(/^To-dos/));
  fireEvent.click(await screen.findByRole('button', { name: 'Add a to-do' }));
  const title = (await screen.findByLabelText('To-do')) as HTMLInputElement;
  fireEvent.change(title, { target: { value: text } });
  return title;
}
const addForm = () => screen.getByRole('form', { name: 'Add a to-do' });

describe('leaving the project add-a-to-do form with a title typed', () => {
  it('a rail click asks with the form strip; Keep editing keeps the title and focus goes back to it', async () => {
    const title = await addFormTyped();
    title.focus();
    rail(/^Home/);
    const group = within(addForm()).getByRole('group', { name: 'Discard your changes' });
    expect(screen.getAllByRole('group', { name: 'Discard your changes' })).toHaveLength(1);
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Keep editing' }));
    expect(pageTitle()).toMatch(/Projects/);
    press('Keep editing');
    expect(strip()).toBeNull();
    expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('Book the shoot');
    expect(document.activeElement).toBe(screen.getByLabelText('To-do'));
  });

  it('Discard changes goes to the page asked for', async () => {
    await addFormTyped();
    rail(/^Settings/);
    press('Discard changes');
    await waitFor(() => expect(pageTitle()).toMatch(/^Settings/));
  });

  it('a picked stage alone also asks', async () => {
    await openProject();
    fireEvent.click(await tab(/^To-dos/));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a to-do' }));
    fireEvent.change(await screen.findByLabelText('Stage'), { target: { value: 'Build' } });
    rail(/^Home/);
    expect(strip()).not.toBeNull();
  });

  it('with nothing typed, the rail goes at once', async () => {
    await openProject();
    fireEvent.click(await tab(/^To-dos/));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a to-do' }));
    await screen.findByLabelText('To-do');
    act(() => rail(/^Home/));
    expect(strip()).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('Cancel while the leave question shows leaves one strip, and Esc on it keeps editing', async () => {
    await addFormTyped();
    rail(/^Home/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('group', { name: 'Discard your changes' })).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
    expect(strip()).toBeNull();
    expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('Book the shoot');
  });

  it('a tab switch asks; Keep stays on To-dos with the title, Discard changes goes to Overview', async () => {
    await addFormTyped();
    fireEvent.click(await tab('Overview'));
    expect(within(addForm()).getByRole('group', { name: 'Discard your changes' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Details' })).toBeNull();
    press('Keep editing');
    expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('Book the shoot');
    fireEvent.click(await tab('Overview'));
    press('Discard changes');
    expect(await screen.findByRole('region', { name: 'Details' })).toBeTruthy();
    expect(screen.queryByLabelText('To-do')).toBeNull();
    // Coming back to To-dos, the form is not left open and empty.
    fireEvent.click(await tab(/^To-dos/));
    await screen.findByText('No open to-dos in this project.');
    expect(screen.queryByLabelText('To-do')).toBeNull();
  });
});

describe('All projects and Edit on the project page', () => {
  it('All projects asks with a title typed; Keep keeps it, Discard changes goes to the list', async () => {
    await addFormTyped();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(within(addForm()).getByRole('group', { name: 'Discard your changes' })).toBeTruthy();
    press('Keep editing');
    expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('Book the shoot');
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    press('Discard changes');
    expect(await screen.findByRole('button', { name: 'New project' })).toBeTruthy();
  });

  it('Edit asks with a title typed too', async () => {
    await addFormTyped();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(within(addForm()).getByRole('group', { name: 'Discard your changes' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Edit project' })).toBeNull();
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
