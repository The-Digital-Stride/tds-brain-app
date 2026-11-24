// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeChatSummary } from '../../../../shared/chat-summary.ts';
import type { ProjectUpdateItem } from '../../../../shared/project-updates-contract.ts';
import { ShellContext } from '../../shell/shell-context.ts';
import { projectPageRequest } from '../../state/client-choice.ts';
import { saveChatRequest, savingChat } from '../../state/save-chat-request.ts';
import { READ_ONLY_NOTICE } from './logic.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  openPast: vi.fn(),
  toggleFavouriteTodo: vi.fn(),
  boot: {
    identity: { slug: 'me' },
    clients: [] as { slug: string; name: string }[],
    prefs: { favouriteTodos: [] as string[] },
  },
  todos: { mine: [], open: [], othersCount: 0, team: [{ slug: 'me', name: 'Me' }], canProject: true },
}));
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
  projectUpdates: vi.fn(),
  library: vi.fn(),
  chatSummaryDraft: vi.fn(),
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
  useShell: () => ({ dispatch: vi.fn(), state: { todoPanel: null }, modes: { drawerOverlays: false } }),
}));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v1' });
const MINE = card({ slug: 'taxes', client: null, title: 'Taxes', owner: 'me', version: 'v9' });

const item = (over: Partial<ProjectUpdateItem> = {}): ProjectUpdateItem => ({
  v: 1,
  kind: 'note',
  by: 'me',
  at: '2026-11-23T14:05:00Z',
  clientSafe: false,
  summary: 'Sent the **draft**.',
  path: 'clients/skyseal/projects/site/updates/a.md',
  version: 'h-a',
  byName: 'Me Myself',
  canRemove: false,
  ...over,
});
const reply = (updates: ProjectUpdateItem[], over: Record<string, unknown> = {}) => ({
  updates,
  more: false,
  unreadable: 0,
  canAdd: true,
  ...over,
});

beforeEach(() => {
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  api.projectUpdates.mockResolvedValue(reply([]));
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

async function openUpdates(c = SKY) {
  const list = projectList([c]);
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  await screen.findByText(/of \d+ project/);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(c.title) }));
  fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
}

describe('the Updates tab', () => {
  it('lists entries with who, kind and markers, and renders the summary safely', async () => {
    api.projectUpdates.mockResolvedValue(
      reply([
        item({ summary: 'Sent the **draft**.<script>x</script>' }),
        item({ path: 'b', kind: 'status', clientSafe: true, byName: 'Simon', summary: 'Status: A → B.' }),
        item({ path: 'c', kind: 'email', fromOldFolder: true, summary: 'Old.' }),
      ]),
    );
    await openUpdates();
    expect(await screen.findAllByText('Me Myself')).toHaveLength(2);
    expect(api.projectUpdates).toHaveBeenCalledWith(SKY.key);
    expect(screen.getAllByText('Note')).toHaveLength(1);
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getAllByText('Fine to share with the client')).toHaveLength(1);
    expect(screen.queryByText('Internal')).toBeNull();
    expect(screen.queryByText('Fine for the client')).toBeNull();
    expect(screen.getByText('From the old folder')).toBeTruthy();
    expect(screen.getByText('draft').tagName).toBe('STRONG');
    expect(document.querySelector('script')).toBeNull();
  });

  it('shows an email row: chip, subject, from line, summary, and Open in Gmail for the owner only', async () => {
    const email = {
      kind: 'email',
      byName: 'Ian',
      summary: 'They agreed the budget.',
      emailSubject: 'Budget for December',
      emailFrom: 'Alex Smith',
      emailPeople: ['Jo Lee', 'Sam Roe'],
      emailSentAt: '2026-11-20T16:30:00Z',
    };
    api.projectUpdates.mockResolvedValue(
      reply([
        item({
          ...email,
          path: 'e1',
          gmailUrl: 'https://mail.google.com/mail/?authuser=i%40x.com#all/thread-f:1',
        } as Partial<ProjectUpdateItem>),
        item({ ...email, path: 'e2', byName: 'Sam' } as Partial<ProjectUpdateItem>),
      ]),
    );
    await openUpdates();
    expect(await screen.findAllByText('Email')).toHaveLength(2);
    expect(screen.getAllByText('Budget for December')).toHaveLength(2);
    expect(screen.getAllByText(/^From Alex Smith · with 2 others · 20 Nov 2026, /)).toHaveLength(2);
    expect(screen.getAllByText('They agreed the budget.')).toHaveLength(2);
    const link = screen.getByRole('link', { name: /Open in Gmail/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('(opens in a new tab)');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText(/· In Sam's inbox$/)).toBeTruthy();
  });

  it('opens the form from the tab row and sends the update action', async () => {
    await openUpdates();
    expect(screen.queryByLabelText('Update')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an update' }));
    fireEvent.change(await screen.findByLabelText('Update'), { target: { value: ' Rang them. ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Call' }));
    fireEvent.click(screen.getByLabelText('Fine to share with the client'));
    api.changeProject.mockResolvedValue(projectList([SKY]));
    const form = screen.getByRole('form', { name: 'Add an update' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add an update' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith({
        kind: 'update',
        key: SKY.key,
        entry: { kind: 'call', summary: 'Rang them.', clientSafe: true },
      }),
    );
    await waitFor(() => expect(api.projectUpdates).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText('Update')).toBeNull());
  });

  it('puts "Write the update first." on the textarea, and a save failure on the form', async () => {
    await openUpdates();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an update' }));
    const form = await screen.findByRole('form', { name: 'Add an update' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add an update' }));
    const area = screen.getByLabelText('Update');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(area.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Write the update first.')).toBeTruthy();
    fireEvent.change(area, { target: { value: 'Rang them.' } });
    expect(area.getAttribute('aria-invalid')).toBeNull();
    api.changeProject.mockRejectedValue(new Error('x'));
    fireEvent.click(within(form).getByRole('button', { name: 'Add an update' }));
    await waitFor(() => expect(within(form).getAllByRole('alert')).toHaveLength(1));
    expect(screen.getByLabelText('Update').getAttribute('aria-invalid')).toBeNull();
  });

  it('asks before cancelling typed text', async () => {
    await openUpdates();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an update' }));
    fireEvent.change(await screen.findByLabelText('Update'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByLabelText('Update')).toBeNull());
  });

  it('shows no Add button or form when canAdd is false, with the old-skill notice', async () => {
    api.projectUpdates.mockResolvedValue(reply([item()], { canAdd: false }));
    await openUpdates();
    await screen.findByText('Me Myself');
    expect(screen.queryByRole('button', { name: 'Add an update' })).toBeNull();
    expect(screen.getByText(READ_ONLY_NOTICE)).toBeTruthy();
  });

  it('shows no notice when the card is not readable', async () => {
    api.projectUpdates.mockResolvedValue(reply([item()], { canAdd: false }));
    await openUpdates({ ...SKY, card: 'unreadable' } as typeof SKY);
    await screen.findByText('Me Myself');
    expect(screen.queryByText(READ_ONLY_NOTICE)).toBeNull();
  });

  it('says there are no updates yet', async () => {
    await openUpdates();
    const note = await screen.findByText('No updates yet.');
    expect(note.closest('[data-kind="empty"]')).toBeTruthy();
  });

  it('shows Delete only where canRemove, with different words for a personal project', async () => {
    api.projectUpdates.mockResolvedValue(
      reply([item({ canRemove: true }), item({ path: 'b', version: 'h-b', canRemove: false })]),
    );
    await openUpdates();
    await screen.findAllByText('Me Myself');
    expect(screen.getAllByRole('button', { name: /^Delete update: / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Delete update: / }));
    expect(screen.getByText("Delete this update? It will still be in the brain's history.")).toBeTruthy();
    api.changeProject.mockResolvedValue(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: 'Delete update' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith({
        kind: 'update-remove',
        key: SKY.key,
        file: 'clients/skyseal/projects/site/updates/a.md',
        expect: 'h-a',
      }),
    );
    cleanup();
    projectsStore.reset();
    api.projectUpdates.mockResolvedValue(reply([item({ canRemove: true })]));
    await openUpdates(MINE);
    fireEvent.click(await screen.findByRole('button', { name: /^Delete update: / }));
    expect(screen.getByText("Delete this update? It can't be brought back.")).toBeTruthy();
  });

  it('pages older entries with before, and counts unreadable ones', async () => {
    api.projectUpdates.mockResolvedValueOnce(reply([item()], { more: true, unreadable: 2 }));
    await openUpdates();
    expect(await screen.findByText("2 updates couldn't be read.")).toBeTruthy();
    api.projectUpdates.mockResolvedValueOnce(
      reply([item({ path: 'old', byName: 'Simon', summary: 'Earlier.' })]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Simon')).toBeTruthy();
    expect(api.projectUpdates).toHaveBeenLastCalledWith(
      SKY.key,
      'clients/skyseal/projects/site/updates/a.md',
    );
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
    const list = screen.getAllByRole('listitem').filter((li) => li.className.includes('proj-update-item'));
    expect(within(list[1] as HTMLElement).getByText('Earlier.')).toBeTruthy();
  });
});

describe('an edit whose log entry failed', () => {
  it('says the change was saved without its log entry', async () => {
    const list = projectList([SKY]);
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sky site 2' } });
    api.changeProject.mockResolvedValue({ ...projectList([SKY]), updatesFailed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findAllByText("Saved, but the change couldn't be added to the updates log."),
    ).not.toHaveLength(0);
  });
});

describe('chat summary entries', () => {
  const body = composeChatSummary({
    objective: 'Fix the redirects.',
    outcome: 'All 40 now work.',
    figures: ['40 redirects'],
    documents: [
      { ref: 'clients/skyseal/report.pdf', name: 'Report' },
      { ref: 'https://example.com/page', name: 'Live page' },
    ],
    nextSteps: ['Tell the client'],
  });
  const chat = (over: Partial<ProjectUpdateItem> = {}) =>
    item({
      kind: 'chat',
      path: 'c1',
      summary: body,
      chatId: '11111111-2222-3333-4444-555555555555',
      chatTitle: 'Fix the redirects',
      ...over,
    } as Partial<ProjectUpdateItem>);
  const shellDispatch = vi.fn();
  const renderSheet = (c = SKY) => {
    const list = projectList([c]);
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(
      <ShellContext.Provider
        value={{ dispatch: shellDispatch, sheetHold: { dirty: false, asking: false } } as never}
      >
        <ProjectsSheet />
      </ShellContext.Provider>,
    );
  };
  const openTab = async (c = SKY) => {
    renderSheet(c);
    await screen.findByText(/of \d+ project/);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(c.title) }));
    fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
  };

  it('shows Chat summary with Objective and Outcome, and the rest under More', async () => {
    api.projectUpdates.mockResolvedValue(reply([chat()]));
    await openTab();
    expect(await screen.findByText('Chat summary')).toBeTruthy();
    expect(screen.getByText('Fix the redirects')).toBeTruthy();
    expect(screen.getByText(/Fix the redirects\./)).toBeTruthy();
    expect(screen.getByText(/All 40 now work\./)).toBeTruthy();
    const more = screen.getByRole('button', { name: /More/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getByText('40 redirects')).toBeTruthy();
    expect(screen.getByText('Tell the client')).toBeTruthy();
  });

  it('opens a brain document in the viewer and an https one in a new tab', async () => {
    api.library.mockResolvedValue({
      items: [{ id: 'client:skyseal.abc', path: 'clients/skyseal/report.pdf', name: 'report.pdf' }],
    });
    api.projectUpdates.mockResolvedValue(reply([chat()]));
    await openTab();
    fireEvent.click(await screen.findByRole('button', { name: /More/ }));
    const live = screen.getByRole('link', { name: /Live page/ });
    expect(live.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    await waitFor(() =>
      expect(shellDispatch).toHaveBeenCalledWith({
        type: 'open-viewer',
        viewer: { item: expect.objectContaining({ path: 'clients/skyseal/report.pdf' }) },
      }),
    );
    expect(api.library).toHaveBeenCalledWith('client:skyseal');
  });

  it('says so when a linked file is no longer in the library', async () => {
    api.library.mockResolvedValue({ items: [] });
    api.projectUpdates.mockResolvedValue(reply([chat()]));
    await openTab();
    fireEvent.click(await screen.findByRole('button', { name: /More/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByText("That file isn't in the library any more.")).toBeTruthy();
  });

  it('shows Open chat only when the chat is on this Mac, and reopens it', async () => {
    store.openPast.mockResolvedValue(true);
    api.projectUpdates.mockResolvedValue(
      reply([chat({ chatOpenable: true }), chat({ path: 'c2', chatId: 'b'.repeat(8) })]),
    );
    await openTab();
    const buttons = await screen.findAllByRole('button', { name: 'Open chat' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    await waitFor(() =>
      expect(store.openPast).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555', { in: 'drawer' }),
    );
  });

  it('falls back to plain Markdown for a body that is not the layout', async () => {
    api.projectUpdates.mockResolvedValue(reply([chat({ summary: 'Edited by hand, with **bold**.' })]));
    await openTab();
    expect(await screen.findByText('bold')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
    expect(screen.queryByText('Objective:')).toBeNull();
  });

  it('shows the Save to project form on the Updates tab for a waiting request, and reloads after', async () => {
    api.projectUpdates.mockResolvedValue(reply([]));
    api.chatSummaryDraft.mockResolvedValue({
      chat: 'c',
      project: SKY.key,
      title: 'Fix the redirects',
      fields: { objective: 'Obj', outcome: 'Out', figures: [], nextSteps: [] },
      documents: [],
      fromEmail: false,
      earlier: [],
      nothingNew: false,
    });
    saveChatRequest.set({ key: SKY.key, chat: '11111111-2222-3333-4444-555555555555', title: 'Fix' });
    // The chat header sets both: the request, and the page to open.
    projectPageRequest.set(SKY.key);
    renderSheet();
    expect(await screen.findByLabelText('Objective')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Updates' }).getAttribute('aria-current')).toBe('page');
    expect(saveChatRequest.get()).toBeNull();
    // The chat drawer hides its own Save to project while this form is open, and gets it back on Cancel.
    expect(savingChat.get()).toBe('11111111-2222-3333-4444-555555555555');
    const calls = api.projectUpdates.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Objective')).toBeNull());
    expect(savingChat.get()).toBeNull();
    expect(api.projectUpdates.mock.calls.length).toBe(calls);
  });

  it('with typed work on the page, a save request asks through the leave guard before replacing it', async () => {
    const guardLeave = vi.fn();
    const list = projectList([SKY]);
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    projectPageRequest.set(SKY.key);
    render(
      <ShellContext.Provider
        value={{ dispatch: shellDispatch, sheetHold: { dirty: true, asking: false }, guardLeave } as never}
      >
        <ProjectsSheet />
      </ShellContext.Provider>,
    );
    await screen.findByRole('button', { name: 'Updates' });
    act(() =>
      saveChatRequest.set({ key: SKY.key, chat: '11111111-2222-3333-4444-555555555555', title: 'Fix' }),
    );
    await waitFor(() => expect(guardLeave).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Objective')).toBeNull();
  });
});
