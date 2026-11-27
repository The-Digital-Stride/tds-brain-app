// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AskedTodo,
  AskedTodoList,
  LibraryItem,
  LibrarySearchHit,
  TodoAttachment,
  TodoItem,
  TodoList,
} from '../../../shared/contract.ts';
import type { ShellApi } from './contract.ts';

// Files on to-dos (plan 2026-11-16-todo-attachments): the Files block, Add a file, details-only editing.
// Same set-up as TodoPanel.test.tsx: the real shell, drawer and panel; the store, api and editor are stand-ins.
const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const apiMock = vi.hoisted(() => ({
  todoHistory: vi.fn(),
  libraryItems: vi.fn(),
  librarySearch: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());
const discardUpload = vi.hoisted(() => vi.fn());
vi.mock('../api.ts', () => ({ api: apiMock, uploadFile, discardUpload }));
vi.mock('../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: store.current.ads ?? null }),
  TODO_UNDO_MS: 10_000,
}));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);
const { askedStoreFields } = await import('./todo-test-kit.tsx');

const { ShellProvider, useShell } = await import('./ShellProvider.tsx');
const { TodosDrawer } = await import('./TodosDrawer.tsx');

let api: ShellApi;
function Probe() {
  api = useShell();
  return null;
}

const PERSONAL_WARNING =
  'This task has no client in the brain, so the file saves to your personal files. Only you can open it.';
const FILES = '## Files\n\n- [logo.png](../clients/acme/images/logo.png)';
const att = (over: Partial<TodoAttachment> = {}): TodoAttachment => ({
  path: 'clients/acme/images/logo.png',
  name: 'logo.png',
  kind: 'image',
  libraryId: 'acme.1',
  personal: false,
  holder: null,
  ...over,
});

const todo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: 'a.md',
  scope: 'tds',
  key: 'a.md',
  path: 'todo/a.md',
  handover: null,
  createdBy: null,
  title: 'First',
  assignee: 'sam-example',
  due: '2999-01-01',
  surfaceDate: null,
  project: null,
  client: 'acme',
  created: null,
  source: null,
  details: `Some notes\n\n${FILES}`,
  version: 'v1',
  attachments: [att()],
  ...over,
});

const changeTodos = vi.fn();
const uploadTodoFile = vi.fn();

function setStore(
  item: TodoItem,
  {
    canAttach = true,
    canUpload = true,
    canLink = false,
    clients = ['acme'],
    changes = 'on' as TodoList['changes'],
  } = {},
) {
  store.current = {
    ...askedStoreFields,
    changeTodos,
    uploadTodoFile,
    openView: vi.fn(),
    heldTodos: [],
    holdTodo: vi.fn(),
    undoHeld: vi.fn(),
    markTodosSeen: vi.fn(),
    toggleFavouriteTodo: vi.fn(),
    clearReveal: vi.fn(),
    reveal: null,
    newChat: vi.fn(),
    openChat: vi.fn(),
    view: 'chat',
    activeChat: { kind: 'new', key: 1, draft: '', skill: null, todoId: null },
    chats: {},
    boot: {
      clients: clients.map((slug) => ({ slug, name: slug })),
      identity: { slug: 'sam-example', role: 'owner' },
      prefs: { directWrites: true },
    },
    todos: {
      mine: [item],
      open: [],
      othersCount: 0,
      team: [
        { slug: 'sam-example', name: 'Sam Example' },
        { slug: 'ben-mcadam', name: 'Ben McAdam' },
      ],
      changes,
      canAddOpen: false,
      canUsePersonal: true,
      canAttach,
      canUpload,
      ...(canLink ? { canLink: true, canUpdate: true } : {}),
    } satisfies TodoList,
    sessions: { live: [], past: [] },
  };
}

function mount() {
  render(
    <ShellProvider>
      <Probe />
      <TodosDrawer />
    </ShellProvider>,
  );
  act(() => api.dispatch({ type: 'open-drawer', drawer: 'todos' }));
}
const openFirst = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'First' }));
  return screen.findByRole('dialog');
};
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
const status = () => within(screen.getByRole('dialog')).getAllByRole('status')[0]?.textContent;

const file = (name: string, size = 10) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pickFiles = (files: File[]) =>
  fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files } });
const addFile = () => fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));

beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1280;
  changeTodos.mockReset();
  changeTodos.mockResolvedValue({ done: 1 });
  uploadTodoFile.mockReset();
  uploadFile.mockReset();
  uploadFile.mockImplementation(async (_f: File, name: string) => ({ id: `u-${name}`, name }));
  discardUpload.mockReset();
  apiMock.libraryItems.mockReset();
  apiMock.librarySearch.mockReset();
  setStore(todo());
});
afterEach(cleanup);

describe('the Files block', () => {
  it('shows the details without the Files section, and the files as a list', async () => {
    mount();
    const panel = await openFirst();
    expect(within(panel).getByLabelText('Details').textContent).toBe('Some notes');
    expect(within(panel).getByRole('heading', { name: 'Files' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'logo.png' })).toBeTruthy();
  });

  it('shows the whole body and no Files block when files are not available', async () => {
    setStore(todo(), { canAttach: false, canUpload: false });
    mount();
    const panel = await openFirst();
    expect(within(panel).getByLabelText('Details').textContent).toContain('## Files');
    expect(within(panel).queryByRole('heading', { name: 'Files' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add a file' })).toBeNull();
  });

  it("says why a file can't be opened, and that your own personal file stays on your Mac", async () => {
    setStore(
      todo({
        attachments: [
          att({ name: 'gone.pdf', path: 'clients/acme/files/gone.pdf', libraryId: null }),
          att({
            name: 'ben.pdf',
            path: 'personal/files/ben.pdf',
            libraryId: null,
            personal: true,
            holder: 'ben-mcadam',
          }),
          att({
            name: 'mine.pdf',
            path: 'personal/files/mine.pdf',
            libraryId: 'p.1',
            personal: true,
            holder: 'sam-example',
          }),
        ],
      }),
    );
    mount();
    const panel = await openFirst();
    expect(within(panel).getByText("Can't be found")).toBeTruthy();
    expect(within(panel).getByText("Only on Ben's Mac")).toBeTruthy();
    expect(within(panel).getByText('Only on your Mac')).toBeTruthy();
    // Only the file that can be found is a button.
    expect(within(panel).queryByRole('button', { name: 'gone.pdf' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'ben.pdf' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'mine.pdf' })).toBeTruthy();
  });

  it('opens a file in the viewer', async () => {
    const item = { id: 'acme.1', kind: 'image', path: 'clients/acme/images/logo.png' } as LibraryItem;
    apiMock.libraryItems.mockResolvedValue({ files: [{ item, scope: { id: 'acme', name: 'Acme' } }] });
    mount();
    fireEvent.click(await within(await openFirst()).findByRole('button', { name: 'logo.png' }));
    await waitFor(() => expect(api.state.viewer).toMatchObject({ item: { id: 'acme.1' }, place: 'Acme' }));
    expect(apiMock.libraryItems).toHaveBeenCalledWith(['acme.1']);
  });

  it('shows the files read only, and opens one, to someone who cannot change tasks here', async () => {
    setStore(todo(), { canAttach: false, canUpload: false, changes: 'switched-off' });
    const item = { id: 'acme.1', kind: 'image', path: 'clients/acme/images/logo.png' } as LibraryItem;
    apiMock.libraryItems.mockResolvedValue({ files: [{ item, scope: { id: 'acme', name: 'Acme' } }] });
    mount();
    const panel = await openFirst();
    expect(within(panel).queryByText(/## Files/)).toBeNull();
    expect(within(panel).queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add a file' })).toBeNull();
    fireEvent.click(await within(panel).findByRole('button', { name: 'logo.png' }));
    await waitFor(() => expect(api.state.viewer).toMatchObject({ item: { id: 'acme.1' } }));
  });

  it('removes a file with the version it was read at, and says the file stays in the library', async () => {
    mount();
    const panel = await openFirst();
    const remove = within(panel).getByRole('button', { name: 'Remove logo.png from this task' });
    expect(remove.getAttribute('data-tip')).toContain('stays in the library');
    fireEvent.click(remove);
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'detach', id: 'a.md', path: 'clients/acme/images/logo.png', expect: 'v1' },
    ]);
    await waitFor(() => expect(status()).toContain('The file is still in the library'));
  });

  it('shows the files, read only, on a task you passed on', async () => {
    const asked: AskedTodo = {
      key: 'asked:todo/x.md',
      id: 'x.md',
      state: 'waiting',
      path: 'todo/x.md',
      title: 'Send the quote',
      assignee: 'ben-mcadam',
      assigneeName: 'Ben McAdam',
      due: null,
      details: `Their notes\n\n${FILES}`,
      asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-13T12:00:00+00:00', source: 'stamp' },
      done: null,
      version: 'v1',
      attachments: [att()],
    };
    store.current = {
      ...store.current,
      asked: { waiting: [asked], done: [], historyRead: true } as AskedTodoList,
    };
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Asked, 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the quote' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByLabelText('Details').textContent).toBe('Their notes');
    expect(within(panel).getByRole('button', { name: 'logo.png' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add a file' })).toBeNull();
  });
});

describe('ticking and editing the details', () => {
  it('ticks a box on the details part and sends only that', async () => {
    setStore(todo({ details: `- [ ] one\n\n${FILES}` }));
    mount();
    const panel = await openFirst();
    fireEvent.click(within(panel).getByRole('button', { name: 'Tick 1' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'edit', id: 'a.md', details: '- [x] one', expect: 'v1' }),
    ]);
  });

  it('edits only the details part and sends only that', async () => {
    mount();
    await openFirst();
    edit();
    const box = screen.getByLabelText('Details') as HTMLTextAreaElement;
    expect(box.value).toBe('Some notes');
    fireEvent.change(box, { target: { value: 'New notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    const [actions] = changeTodos.mock.calls[0] as [{ details?: string }[]];
    expect(actions).toEqual([
      expect.objectContaining({ kind: 'edit', details: 'New notes', detailsOnly: true, expect: 'v1' }),
    ]);
    expect(JSON.stringify(actions)).not.toContain('Files');
  });

  it('sends the whole body when files are not available', async () => {
    setStore(todo(), { canAttach: false, canUpload: false });
    mount();
    await openFirst();
    edit();
    const box = screen.getByLabelText('Details') as HTMLTextAreaElement;
    expect(box.value).toContain('## Files');
    fireEvent.change(box, { target: { value: 'Replaced' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ kind: 'edit', details: 'Replaced' }),
    ]);
    expect(changeTodos.mock.calls[0]?.[0][0]).not.toHaveProperty('detailsOnly');
  });
});

describe('adding a task with details', () => {
  const openAdd = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    return screen.findByRole('form', { name: 'Add a task' });
  };

  it('sends the details with the new task when files are available', async () => {
    mount();
    const form = await openAdd();
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'New job' } });
    fireEvent.change(within(form).getByLabelText('Details'), { target: { value: 'What to do' } });
    fireEvent.submit(form);
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ kind: 'add', title: 'New job', details: 'What to do' }),
    ]);
  });

  it('has no details field when files are not available', async () => {
    setStore(todo(), { canAttach: false, canUpload: false });
    mount();
    const form = await openAdd();
    expect(within(form).queryByLabelText('Details')).toBeNull();
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'New job' } });
    fireEvent.submit(form);
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos.mock.calls[0]?.[0]).toEqual([
      { kind: 'add', title: 'New job', due: null, assignee: 'sam-example' },
    ]);
  });
});

describe('adding a file from the library', () => {
  const hit = (id: string, name: string, path: string): LibrarySearchHit =>
    ({
      item: { id, kind: 'document', name, title: name, path },
      scope: { id: 'acme', name: 'Acme' },
    }) as LibrarySearchHit;

  it('links two picked files in turn, the first at the version read', async () => {
    apiMock.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
      hits:
        kind === 'document'
          ? [
              hit('d1', 'Brief.pdf', 'clients/acme/files/Brief.pdf'),
              hit('d2', 'Plan.pdf', 'clients/acme/files/Plan.pdf'),
            ]
          : [],
      total: 2,
      partial: false,
    }));
    mount();
    await openFirst();
    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'From the library' }));
    fireEvent.change(await screen.findByLabelText('Search the library'), { target: { value: 'brief' } });
    fireEvent.click(await screen.findByLabelText(/Brief\.pdf/));
    fireEvent.click(screen.getByLabelText(/Plan\.pdf/));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    // The store gives every step after the first the version the step before left behind.
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'attach', id: 'a.md', path: 'clients/acme/files/Brief.pdf', expect: 'v1' },
      { kind: 'attach', id: 'a.md', path: 'clients/acme/files/Plan.pdf' },
    ]);
    await waitFor(() => expect(status()).toBe('Added 2 files.'));
    // The keyboard comes back to the button that opened the picker.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a file' })),
    );
  });

  it('names the file that failed and how many went in', async () => {
    apiMock.librarySearch.mockResolvedValue({
      hits: [
        hit('d1', 'Brief.pdf', 'clients/acme/files/Brief.pdf'),
        hit('d2', 'Plan.pdf', 'clients/acme/files/Plan.pdf'),
      ],
      total: 2,
      partial: false,
    });
    changeTodos.mockResolvedValue({
      done: 1,
      error: { code: 'changed', message: 'Someone else changed it.' },
    });
    mount();
    await openFirst();
    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'From the library' }));
    fireEvent.change(await screen.findByLabelText('Search the library'), { target: { value: 'pdf' } });
    fireEvent.click((await screen.findAllByLabelText(/Brief\.pdf/))[0] as HTMLElement);
    fireEvent.click(screen.getAllByLabelText(/Plan\.pdf/)[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await waitFor(() => expect(status()).toContain('1 of 2 added.'));
    expect(status()).toContain('"Plan.pdf" couldn\'t be added');
  });

  it('closes the picker with Esc, leaving the panel open', async () => {
    mount();
    await openFirst();
    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'From the library' }));
    fireEvent.keyDown(await screen.findByLabelText('Search the library'), { key: 'Escape' });
    expect(screen.queryByLabelText('Search the library')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('uploading files', () => {
  const saved = (path: string, version: string, personal = false) => ({
    ok: true as const,
    path,
    personal,
    todos: { ...(store.current.todos as TodoList), mine: [todo({ version })] },
  });

  it('uploads one at a time, each with the version the one before left, and says where it went', async () => {
    uploadTodoFile
      .mockResolvedValueOnce(saved('clients/acme/files/a.pdf', 'v2'))
      .mockResolvedValueOnce(saved('clients/acme/files/b.pdf', 'v3'));
    mount();
    await openFirst();
    addFile();
    pickFiles([file('a.pdf'), file('b.pdf')]);
    await waitFor(() => expect(uploadTodoFile).toHaveBeenCalledTimes(2));
    expect(uploadTodoFile.mock.calls.map((c) => c[0])).toEqual([
      { upload: 'u-a.pdf', id: 'a.md', expect: 'v1' },
      { upload: 'u-b.pdf', id: 'a.md', expect: 'v2' },
    ]);
    await waitFor(() => expect(status()).toBe("Added 2 files. Saved in acme's Files."));
  });

  it('says "2 of 3 added" and names the file that failed', async () => {
    uploadTodoFile
      .mockResolvedValueOnce(saved('clients/acme/files/a.pdf', 'v2'))
      .mockResolvedValueOnce(saved('clients/acme/files/b.pdf', 'v3'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'changed', message: 'It changed.' } });
    mount();
    await openFirst();
    addFile();
    pickFiles([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
    await waitFor(() => expect(status()).toContain('2 of 3 added.'));
    expect(status()).toContain('"c.pdf" couldn\'t be added: It changed.');
    expect(discardUpload).toHaveBeenCalledWith('u-c.pdf');
  });

  it('refuses a type that is not allowed, and a file over 32 MB, before sending anything', async () => {
    mount();
    await openFirst();
    addFile();
    pickFiles([file('run.exe'), file('huge.pdf', 33 * 1024 * 1024)]);
    await waitFor(() => expect(status()).toContain('"run.exe" wasn\'t added: that type can\'t be added.'));
    expect(status()).toContain('Only PNG, JPG, WebP, GIF, PDF, Word, Excel, PowerPoint, CSV, Markdown');
    expect(status()).toContain('"huge.pdf" wasn\'t added: it is over 32 MB.');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('warns once before saving to personal files, and says so after', async () => {
    setStore(todo({ client: null }));
    uploadTodoFile.mockResolvedValue(saved('personal/files/a.pdf', 'v2', true));
    mount();
    await openFirst();
    addFile();
    pickFiles([file('a.pdf')]);
    expect(await screen.findByText(PERSONAL_WARNING)).toBeTruthy();
    expect(uploadFile).not.toHaveBeenCalled();
    // Cancel: nothing goes up.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(screen.queryByText(PERSONAL_WARNING)).toBeNull();
    // Continue: it goes up, and the status line says where.
    addFile();
    pickFiles([file('a.pdf')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(uploadTodoFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(status()).toBe('Added a.pdf. Saved in your personal files.'));
    // Not asked again for the next file on this to-do.
    addFile();
    pickFiles([file('b.pdf')]);
    await waitFor(() => expect(uploadTodoFile).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('has no Upload choice when uploads are not available', async () => {
    setStore(todo(), { canAttach: true, canUpload: false });
    mount();
    await openFirst();
    addFile();
    expect(screen.getByRole('button', { name: 'From the library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });
});

describe('rejected files, progress and extras', () => {
  const saved = (path: string, version: string) => ({
    ok: true as const,
    path,
    personal: false,
    todos: { ...(store.current.todos as TodoList), mine: [todo({ version })] },
  });

  it('keeps the rejected-file notes in the final line after the others are added', async () => {
    uploadTodoFile.mockResolvedValueOnce(saved('clients/acme/images/a.png', 'v2'));
    mount();
    await openFirst();
    addFile();
    pickFiles([file('a.png'), file('IMG_01.heic')]);
    await waitFor(() => expect(status()).toContain('Added a.png.'));
    expect(status()).toContain("Saved in acme's Images.");
    expect(status()).toContain('"IMG_01.heic" wasn\'t added: that type can\'t be added.');
    expect(status()).not.toContain('The others');
  });

  it('says which file is being added, one by one', async () => {
    const seen: string[] = [];
    uploadTodoFile.mockImplementation(async (a: { upload: string }) => {
      await act(async () => {});
      seen.push(status() ?? '');
      return saved(`clients/acme/files/${a.upload.slice(2)}`, `v${seen.length + 1}`);
    });
    mount();
    await openFirst();
    addFile();
    pickFiles([file('a.pdf'), file('b.pdf')]);
    // Generous wait: two uploads in sequence are slow when the whole suite runs at once. Wait for both lines, not
    // just the second call: each call records its line only after an awaited act, so under load the call count
    // reaches 2 before the second line is in.
    await waitFor(() => expect(seen).toHaveLength(2), { timeout: 5000 });
    expect(seen).toEqual(['Adding 1 of 2…', 'Adding 2 of 2…']);
  });

  it('shows other lines under Files as plain text', async () => {
    setStore(todo({ details: `Notes\n\n${FILES}\n- <b>Link</b> https://example.com` }));
    mount();
    const panel = await openFirst();
    const list = within(panel).getByText('- <b>Link</b> https://example.com');
    expect(list.tagName).toBe('LI');
    expect(list.querySelector('b')).toBeNull();
  });
});

describe('picking from the library, again', () => {
  const hit = (id: string, name: string, path: string): LibrarySearchHit =>
    ({
      item: { id, kind: 'document', name, title: name, path },
      scope: { id: 'acme', name: 'Acme' },
    }) as LibrarySearchHit;
  const search = (term: string) =>
    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: term } });
  const toLibrary = () => {
    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'From the library' }));
  };

  it('keeps a pick from an earlier search, lists it as chosen, and counts results', async () => {
    apiMock.librarySearch.mockImplementation(async (q: string, kind: string) => ({
      hits:
        kind !== 'document'
          ? []
          : q === 'brief'
            ? [hit('d1', 'Brief.pdf', 'clients/acme/files/Brief.pdf')]
            : [hit('d2', 'Plan.pdf', 'clients/acme/files/Plan.pdf')],
      total: 1,
      partial: false,
    }));
    mount();
    await openFirst();
    toLibrary();
    search('brief');
    fireEvent.click(await screen.findByLabelText(/Brief\.pdf/));
    await waitFor(() => expect(screen.getByText('1 found')).toBeTruthy());
    search('plan');
    // The old row is gone at once, so it can't be ticked; the pick stays chosen.
    expect(screen.queryByRole('checkbox', { name: /Brief\.pdf/ })).toBeNull();
    expect(screen.getByText('Searching…')).toBeTruthy();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Plan\.pdf/ }));
    expect(within(screen.getByLabelText('Chosen files')).getByText('Brief.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ path: 'clients/acme/files/Brief.pdf' }),
      expect.objectContaining({ path: 'clients/acme/files/Plan.pdf' }),
    ]);
  });

  it('asks once before linking a personal file to a team task', async () => {
    apiMock.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
      hits: kind === 'document' ? [hit('p1', 'Mine.pdf', 'personal/files/Mine.pdf')] : [],
      total: 1,
      partial: false,
    }));
    mount();
    await openFirst();
    toLibrary();
    search('mine');
    fireEvent.click(await screen.findByLabelText(/Mine\.pdf/));
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    expect(
      screen.getByText('Its name will show on this task for the team, but only you can open it.'),
    ).toBeTruthy();
    expect(changeTodos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    // Not asked again on this panel.
    toLibrary();
    search('mine');
    fireEvent.click(await screen.findByLabelText(/Mine\.pdf/));
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
  });
});

describe('the two personal warnings are separate', () => {
  it('agreeing to link a personal file still asks before an upload to personal files', async () => {
    setStore(todo({ client: null }));
    uploadTodoFile.mockResolvedValue({
      ok: true as const,
      path: 'personal/files/a.pdf',
      personal: true,
      todos: { ...(store.current.todos as TodoList), mine: [todo({ client: null, version: 'v3' })] },
    });
    apiMock.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
      hits:
        kind === 'document'
          ? [
              {
                item: {
                  id: 'p1',
                  kind: 'document',
                  name: 'Mine.pdf',
                  title: 'Mine.pdf',
                  path: 'personal/files/Mine.pdf',
                },
                scope: { id: 'personal', name: 'My personal files' },
              } as LibrarySearchHit,
            ]
          : [],
      total: 1,
      partial: false,
    }));
    mount();
    await openFirst();
    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'From the library' }));
    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: 'mine' } });
    fireEvent.click(await screen.findByLabelText(/Mine\.pdf/));
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    addFile();
    pickFiles([file('a.pdf')]);
    expect(await screen.findByText(PERSONAL_WARNING)).toBeTruthy();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe('after Add', () => {
  const addOne = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    const form = await screen.findByRole('form', { name: 'Add a task' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'New job' } });
    fireEvent.submit(form);
  };
  const withNew = (canAttach: boolean) => {
    const added = todo({ id: 'n.md', key: 'n.md', title: 'New job', details: '', attachments: [] });
    changeTodos.mockResolvedValue({
      done: 1,
      todos: { ...(store.current.todos as TodoList), canAttach, mine: [todo(), added] },
    });
  };

  it('opens the new task to read when files are available', async () => {
    mount();
    withNew(true);
    await addOne();
    await waitFor(() => expect(api.state.todoPanel).toMatchObject({ key: 'n.md', mode: 'read' }));
  });

  it('keeps edit mode when files are not available', async () => {
    setStore(todo(), { canAttach: false, canUpload: false });
    mount();
    withNew(false);
    await addOne();
    await waitFor(() => expect(api.state.todoPanel).toMatchObject({ key: 'n.md', mode: 'edit' }));
  });
});

// Web links in the Files block (plan 2026-11-27-task-updates-handback): "Files and links", Add a link.
describe('web links', () => {
  const links = [
    { url: 'https://www.drive.example.com/file/1', name: 'Quote on Drive' },
    { url: 'https://example.com/spec', name: 'The spec' },
  ];
  const addLink = () => fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
  const fill = (url: string, name = '') => {
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: url } });
    if (name) fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: name } });
  };

  it('lists links that open in a new tab, with the host quietly beside each', async () => {
    setStore(todo({ links }), { canLink: true });
    mount();
    const panel = await openFirst();
    expect(within(panel).getByRole('heading', { name: 'Files and links' })).toBeTruthy();
    const link = within(panel).getByRole('link', { name: /Quote on Drive/ });
    expect(link.getAttribute('href')).toBe('https://www.drive.example.com/file/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(panel).getByText('drive.example.com')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'logo.png' })).toBeTruthy();
  });

  it('keeps the heading as Files when links are off and there are none', async () => {
    setStore(todo());
    mount();
    const panel = await openFirst();
    expect(within(panel).getByRole('heading', { name: 'Files' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Add a link' })).toBeNull();
  });

  it('lists links without controls when links cannot be changed', async () => {
    setStore(todo({ links }));
    mount();
    const panel = await openFirst();
    expect(within(panel).getByRole('heading', { name: 'Files and links' })).toBeTruthy();
    expect(within(panel).getByRole('link', { name: /The spec/ })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Add a link' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /Remove The spec/ })).toBeNull();
  });

  it('offers Add a link when the task has no links yet', async () => {
    setStore(todo({ attachments: [], details: 'Some notes' }), { canLink: true });
    mount();
    const panel = await openFirst();
    expect(within(panel).getByRole('heading', { name: 'Files and links' })).toBeTruthy();
    expect(within(panel).getByText('No files or links yet.')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Add a link' })).toBeTruthy();
  });

  it('adds a link with the address and the name', async () => {
    setStore(todo(), { canLink: true });
    mount();
    await openFirst();
    addLink();
    fill('https://example.com/brief', 'The brief');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'link', id: 'a.md', url: 'https://example.com/brief', name: 'The brief', expect: 'v1' },
      ]),
    );
    expect(await screen.findByText('Added a link: The brief.')).toBeTruthy();
    expect(screen.queryByLabelText('Web address')).toBeNull();
  });

  it('sends no name when none is typed, and says the address in the status', async () => {
    setStore(todo(), { canLink: true });
    mount();
    await openFirst();
    addLink();
    fill('  https://www.example.com/brief  ');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'link', id: 'a.md', url: 'https://www.example.com/brief', expect: 'v1' },
      ]),
    );
    expect(await screen.findByText('Added a link: example.com.')).toBeTruthy();
  });

  it('refuses an address that is not a web address, in plain words', async () => {
    setStore(todo(), { canLink: true });
    mount();
    await openFirst();
    addLink();
    for (const bad of ['javascript:alert(1)', 'example.com', 'https://exa mple.com', 'ftp://example.com/a']) {
      fill(bad);
      fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
      expect((await screen.findByRole('alert')).textContent).toContain('start with http:// or https://');
    }
    fill('');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Type the web address of the link.');
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('refuses a name with square brackets', async () => {
    setStore(todo(), { canLink: true });
    mount();
    await openFirst();
    addLink();
    fill('https://example.com/x', 'The [spec]');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect((await screen.findByRole('alert')).textContent).toBe("The name can't hold square brackets.");
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('keeps the form and says why when the link could not be added', async () => {
    setStore(todo(), { canLink: true });
    changeTodos.mockResolvedValue({
      done: 0,
      error: { code: 'bad-request', message: 'That link is already there.' },
    });
    mount();
    await openFirst();
    addLink();
    fill('https://example.com/x');
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That link is already there.');
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe('https://example.com/x');
  });

  it('Esc closes the form and not the panel', async () => {
    setStore(todo(), { canLink: true });
    mount();
    await openFirst();
    addLink();
    fireEvent.keyDown(screen.getByLabelText('Web address'), { key: 'Escape' });
    expect(screen.queryByLabelText('Web address')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('removes a link, saying so, and sends the address', async () => {
    setStore(todo({ links }), { canLink: true });
    mount();
    const panel = await openFirst();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove The spec from this task' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'unlink', id: 'a.md', url: 'https://example.com/spec', expect: 'v1' },
      ]),
    );
    expect(await screen.findByText('Removed The spec from this task.')).toBeTruthy();
  });

  it('sends the personal scope for a personal task', async () => {
    setStore(todo({ scope: 'personal', key: 'personal/a.md', links }), { canLink: true });
    mount();
    const panel = await openFirst();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove The spec from this task' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'unlink', id: 'a.md', url: 'https://example.com/spec', expect: 'v1', scope: 'personal' },
      ]),
    );
  });
});
