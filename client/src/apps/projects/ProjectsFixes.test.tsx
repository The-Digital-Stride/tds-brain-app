// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TidyList } from '../../../../shared/projects-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  libraryVersion: 0,
  hiddenFileIds: new Set<string>(),
  deleteFile: vi.fn(),
  toggleFavouriteFile: vi.fn(),
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  toggleFavouriteTodo: vi.fn(),
  openChat: vi.fn(),
  sessions: null as unknown,
  boot: {
    identity: { slug: 'me' },
    clients: [] as { slug: string; name: string }[],
    prefs: { favouriteTodos: [] as string[], favouriteFiles: [] as string[] },
  },
  todos: {
    mine: [],
    open: [],
    othersCount: 0,
    team: [
      { slug: 'me', name: 'Me Myself' },
      { slug: 'simon', name: 'Simon' },
    ],
    canProject: true,
  } as unknown,
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn() }));
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
  tidy: vi.fn(),
  applyTidy: vi.fn(),
  librarySearch: vi.fn(),
  libraryItems: vi.fn(),
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
  useShell: () => ({
    dispatch: shell.dispatch,
    state: { todoPanel: null },
    modes: { drawerOverlays: false },
  }),
}));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ApiFailure } = await import('../../api.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me' });

beforeEach(() => {
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
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

describe('the form after a "changed" refusal (fix 1)', () => {
  it('reloads the latest card, keeps my edits and names what a teammate changed', async () => {
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sky site 2' } });
    api.changeProject.mockRejectedValue(new ApiFailure('changed' as never, 'x', 409));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const reload = await screen.findByRole('button', { name: 'Reload' });
    const latest = card({
      slug: 'site',
      title: 'Sky site',
      owner: 'me',
      status: 'on-hold',
      health: 'red',
      version: 'v2',
      lastChanged: { by: 'simon', at: '2026-11-21' },
    });
    api.projects.mockResolvedValue(projectList([latest]));
    await act(async () => {
      fireEvent.click(reload);
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Simon changed Status and Health\. Your other changes are kept\./),
      ).toBeTruthy(),
    );
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Sky site 2');
    expect(screen.getByRole('radio', { name: 'On hold' }).getAttribute('aria-checked')).toBe('true');
    // Saving now sends only my change, against the new version.
    api.changeProject.mockResolvedValue(projectList([latest]));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenLastCalledWith({
        kind: 'edit',
        key: SKY.key,
        fields: { title: 'Sky site 2' },
        expect: 'v2',
      }),
    );
  });
});

describe('a refresh while editing (fix-round review)', () => {
  it("saves against the card the form opened with, so a teammate's change is never undone", async () => {
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Simon puts it on hold; the window regains focus and the store refreshes underneath the form.
    act(() => {
      projectsStore.apply(
        projectList([
          card({ slug: 'site', title: 'Sky site', owner: 'me', status: 'on-hold', version: 'v2' }),
        ]),
      );
    });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sky site 2' } });
    api.changeProject.mockResolvedValue(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenLastCalledWith({
        kind: 'edit',
        key: SKY.key,
        fields: { title: 'Sky site 2' },
        expect: SKY.version,
      }),
    );
  });
});

describe('the To-dos tab (fix 2)', () => {
  const rows = {
    count: 3,
    todos: [
      {
        key: 'a',
        id: 'a',
        scope: 'tds',
        title: 'Mine one',
        assignee: 'me',
        due: null,
        stage: 'Build',
        mine: true,
      },
      {
        key: 'b',
        id: 'b',
        scope: 'tds',
        title: 'Simon two',
        assignee: 'simon',
        due: null,
        stage: 'Discovery',
        mine: false,
      },
      {
        key: 'c',
        id: 'c',
        scope: 'tds',
        title: 'Loose',
        assignee: null,
        due: null,
        stage: null,
        mine: false,
      },
    ],
  };

  it("lists everyone's to-dos by stage, with names; only mine open the panel; the count comes from the server", async () => {
    api.projectTodos.mockResolvedValue(rows);
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: /^To-dos/ }));
    await screen.findByText('Simon two');
    expect(api.projectTodos).toHaveBeenCalledWith(SKY.key);
    expect(screen.getByRole('button', { name: 'To-dos, 3 waiting' })).toBeTruthy();
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(['Discovery', 'Build', 'No stage']);
    // A to-do that isn't mine says who it is assigned to (UX consistency, release 2B).
    expect(screen.getByText('Assigned to Simon')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Simon two/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Mine one/ }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'open-todo', key: 'a', mode: 'read' });
  });

  it("gives my to-dos the drawer's star and chat buttons; others' to-dos have neither", async () => {
    api.projectTodos.mockResolvedValue(rows);
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: /^To-dos/ }));
    await screen.findByText('Simon two');
    const star = screen.getByRole('button', { name: 'Favourite: Mine one' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.getAttribute('data-tip')).toBe('Favourite');
    // Star, then the chat button, as in a drawer row.
    const chat = screen.getByRole('button', { name: 'Start a chat on this: Mine one' });
    expect(chat.getAttribute('data-tip')).toBe('Start a chat');
    expect(star.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(star);
    expect(store.toggleFavouriteTodo).toHaveBeenCalledWith('a');
    fireEvent.click(chat);
    expect(store.newChat).toHaveBeenCalledWith(
      expect.objectContaining({ todoId: 'a', draft: expect.stringContaining('todo/a') }),
    );
    // Not on my lists: the server won't link a chat to it and Home wouldn't show the star.
    expect(screen.queryByRole('button', { name: /Simon two$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /: Loose$/ })).toBeNull();
  });

  describe('the add form asks before throwing away typing (UX consistency, release 2B)', () => {
    const openForm = async () => {
      api.projectTodos.mockResolvedValue(rows);
      await show(projectList([SKY]));
      fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
      fireEvent.click(screen.getByRole('button', { name: /^To-dos/ }));
      await screen.findByText('Simon two');
      fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    };

    it('closes at once on Cancel while nothing is typed', async () => {
      await openForm();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('To-do')).toBeNull();
      expect(screen.queryByText('Discard your changes?')).toBeNull();
    });

    it('asks on Cancel once a title is typed, with Keep editing focused', async () => {
      await openForm();
      fireEvent.change(screen.getByLabelText('To-do'), { target: { value: 'Half a thought' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('Discard your changes?')).toBeTruthy();
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' })),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('Half a thought');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(screen.queryByLabelText('To-do')).toBeNull();
      // Reopened, the form starts empty: the discarded typing is gone.
      fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
      expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('');
    });

    it('keeps the typing on Esc', async () => {
      await openForm();
      const field = screen.getByLabelText('To-do');
      fireEvent.change(field, { target: { value: 'Keep me' } });
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(screen.getByText('Discard your changes?')).toBeTruthy();
      // Esc again, from the strip, keeps editing.
      fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
      expect(screen.queryByText('Discard your changes?')).toBeNull();
      expect((screen.getByLabelText('To-do') as HTMLInputElement).value).toBe('Keep me');
    });

    it('submits with "Add a to-do"', async () => {
      await openForm();
      const form = screen.getByLabelText('To-do').closest('form') as HTMLElement;
      expect(within(form).getByRole('button', { name: 'Add a to-do' }).getAttribute('type')).toBe('submit');
    });
  });

  it('refreshes after Add a to-do', async () => {
    api.projectTodos.mockResolvedValue(rows);
    store.changeTodos.mockResolvedValue({});
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: /^To-dos/ }));
    await screen.findByText('Simon two');
    api.projects.mockResolvedValue(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.change(screen.getByLabelText('To-do'), { target: { value: 'New thing' } });
    const before = api.projectTodos.mock.calls.length;
    const form = screen.getByLabelText('To-do').closest('form') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Add a to-do' }));
    });
    await waitFor(() => expect(api.projectTodos.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('the tidy-up (fix 3)', () => {
  const tidy: TidyList = {
    rows: [
      {
        label: 'sky-site',
        todos: [
          { id: 'a', scope: 'tds', title: 'One', client: null, assignee: 'simon', version: 'v' },
          { id: 'b', scope: 'tds', title: 'Two', client: null, assignee: 'simon', version: 'v' },
          { id: 'c', scope: 'tds', title: 'Three', client: null, assignee: 'me', version: 'v' },
        ],
        conflicts: [],
        suggestion: { do: 'link', key: SKY.key, why: 'same-slug' },
      },
      {
        label: 'other',
        todos: [{ id: 'd', scope: 'tds', title: 'Four', client: 'skyseal', assignee: null, version: 'v' }],
        conflicts: [],
        suggestion: { do: 'merge', into: 'book-vault', why: 'near-spelling' },
      },
    ],
    skipped: [],
  };
  const open = async () => {
    api.tidy.mockResolvedValue(tidy);
    await show(projectList([SKY], { looseLabels: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Tidy up' }));
    await screen.findByText('One');
  };

  it('keeps an apply failure on screen', async () => {
    await open();
    api.applyTidy.mockRejectedValue(new ApiFailure('bad-request' as never, 'That did not work.', 400));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('listitem', { name: 'Label sky-site' })).getByRole('button', {
          name: 'Approve',
        }),
      );
    });
    expect((await screen.findByRole('alert')).textContent).toBe('That did not work.');
  });

  it('hides Approve when to-do changes are switched off, and shows the server message', async () => {
    await open();
    api.applyTidy.mockRejectedValue(
      new ApiFailure('not-allowed' as never, 'To-do changes are switched off in Settings.', 403),
    );
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('listitem', { name: 'Label sky-site' })).getByRole('button', {
          name: 'Approve',
        }),
      );
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Settings/);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('says what was linked, who owns them, and moves focus to the next row', async () => {
    await open();
    api.applyTidy.mockResolvedValue({ rows: [tidy.rows[1]], skipped: [] });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('listitem', { name: 'Label sky-site' })).getByRole('button', {
          name: 'Approve',
        }),
      );
    });
    const status = await screen.findByText(/Linked 3 to-dos \(2 belong to Simon\) to/);
    expect(status.textContent).toMatch(/Sky site/);
    const next = within(screen.getByRole('listitem', { name: 'Label other' })).getByRole('button', {
      name: 'Approve',
    });
    expect(document.activeElement).toBe(next);
    expect(screen.getByText(/Approving changes your teammates' to-dos too/)).toBeTruthy();
  });

  it('words a merge, names the client, and offers a new project and client only', async () => {
    await open();
    const row = screen.getByRole('listitem', { name: 'Label other' });
    expect(within(row).getByText("Rename to 'book-vault'", { exact: false })).toBeTruthy();
    expect(within(row).getByText(/\(Skyseal\)/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    expect(within(row).getByRole('option', { name: 'Make a new project with this name' })).toBeTruthy();
    expect(within(row).getByRole('option', { name: 'Client only' })).toBeTruthy();
  });
});

describe('the form rules (fix 5)', () => {
  const edit = async (over = {}) => {
    const c = card({ slug: 'site', title: 'Sky site', owner: 'me', ...over });
    await show(projectList([c]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    return c;
  };

  it('words the lights On track, At risk and Off track in the page and the form', async () => {
    await show(
      projectList([card({ slug: 'site', title: 'Sky site', owner: 'me', health: 'amber', comms: 'red' })]),
    );
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    expect(screen.getByText('At risk')).toBeTruthy();
    expect(screen.getByText('Off track')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Health and Client comms each offer the three words; the amber one is chosen for Health.
    expect(screen.getAllByRole('radio', { name: 'On track' })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: 'Off track' })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: 'At risk' })[0]?.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radio', { name: 'Amber' })).toBeNull();
  });

  it('shows Not set for a card with no kind, and does not save billable when untouched', async () => {
    const c = await edit({ kind: null, billable: null, budgetHours: null });
    expect(screen.getAllByRole('radio', { name: 'Not set' })[0]?.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Billable') as HTMLInputElement).checked).toBe(false);
    api.changeProject.mockResolvedValue(projectList([c]));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sky site 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith({
        kind: 'edit',
        key: c.key,
        fields: { title: 'Sky site 3' },
        expect: c.version,
      }),
    );
  });

  it('clears Budget hours when the kind changes, and asks before dropping an end date', async () => {
    await edit({ kind: 'one-off', budgetHours: 40, end: '2027-02-28' });
    fireEvent.click(screen.getByRole('radio', { name: 'Ongoing' }));
    expect(screen.getByText(/will be removed/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'One-off' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to ongoing' }));
    expect(
      screen.getByText('Budget hours cleared: one-off is for the whole project, ongoing is per month.'),
    ).toBeTruthy();
    expect((screen.getByLabelText('Hours a month') as HTMLInputElement).value).toBe('');
  });

  it('focuses the first invalid field', async () => {
    await edit();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Title')));
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
  });

  it('asks before Cancel discards changes', async () => {
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sky site' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('heading', { name: 'Sky site' })).toBeTruthy();
  });
});

describe('the list (fix 4) and focus (fix 7)', () => {
  it('says "No card yet", offers Show them, and focus returns to the row on Back', async () => {
    const none = card({ slug: 'bare', title: 'Bare', card: 'none', version: '' });
    await show(projectList([SKY, none]));
    expect(screen.getByRole('button', { name: /Bare/ }).textContent).toMatch(/No card yet/);
    expect(screen.getByText('1 project needs a card')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.queryByRole('button', { name: /Sky site/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Bare/ }));
    expect(document.activeElement?.tagName).toBe('H2');
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Bare/ }));
  });
});

describe('Add a card when the Account Owner is dropped', () => {
  const bare = card({ slug: 'bare', title: 'Bare', card: 'none', version: '', owner: null });

  async function addCard(returned: ReturnType<typeof card>) {
    await show(projectList([bare]));
    fireEvent.click(screen.getByRole('button', { name: /Bare/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    fireEvent.change(screen.getByLabelText('Account Owner'), { target: { value: 'simon' } });
    api.changeProject.mockResolvedValue(projectList([returned]));
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));
  }

  it('says the owner was left blank when the saved card has none', async () => {
    await addCard(card({ slug: 'bare', title: 'Bare', owner: null }));
    expect(await screen.findByText(/it was left blank/)).toBeTruthy();
  });

  it('says nothing when the owner stuck', async () => {
    await addCard(card({ slug: 'bare', title: 'Bare', owner: 'simon' }));
    await screen.findByRole('heading', { name: 'Bare' });
    expect(screen.queryByText(/it was left blank/)).toBeNull();
  });
});

describe('the Files tab', () => {
  const doc = {
    id: 'tds.abc',
    kind: 'document',
    name: 'plan.docx',
    title: 'Agency Brian - building the TDS Google Ads Manager, a very long name',
    path: 'clients/the-digital-stride/projects/site/plan.docx',
    format: 'doc',
    ext: 'docx',
    bytes: 1000,
    group: 'Projects',
    view: 'html',
    thumb: false,
    modified: 1,
  };

  async function openFiles() {
    api.projectFiles.mockImplementation(async (_key: string, kind: string) =>
      kind === 'document' ? { items: [doc], hidden: 0 } : { items: [], hidden: 0 },
    );
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Files/ }));
    return screen.findByRole('button', { name: /^Agency Brian/ });
  }

  it('opens a document in the viewer drawer, with its library, and stays on the Files tab', async () => {
    api.libraryItems.mockResolvedValue({
      files: [{ item: doc, scope: { id: 'tds', name: 'The Digital Stride' } }],
    });
    fireEvent.click(await openFiles());
    // It opens at once; the library's name and "Open in Documents" follow when the lookup answers.
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'open-viewer', viewer: { item: doc } });
    await waitFor(() =>
      expect(shell.dispatch).toHaveBeenCalledWith({
        type: 'update-viewer',
        viewer: { item: doc, place: 'The Digital Stride', openIn: { app: 'documents', scope: 'tds' } },
      }),
    );
    expect(api.libraryItems).toHaveBeenCalledWith(['tds.abc']);
    expect(screen.getByRole('button', { name: /^Agency Brian/ })).toBeTruthy();
  });

  it('still opens the file when its library cannot be looked up', async () => {
    api.libraryItems.mockRejectedValue(new Error('offline'));
    fireEvent.click(await openFiles());
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'open-viewer', viewer: { item: doc } });
    await waitFor(() => expect(api.libraryItems).toHaveBeenCalled());
    expect(shell.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update-viewer' }));
  });
});
