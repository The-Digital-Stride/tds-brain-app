// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AskedTodo,
  LibraryItem,
  LibraryScope,
  LiveSession,
  SkillInfo,
  TodoItem,
} from '../../../shared/contract.ts';
import { PINNED_ROWS } from '../state/home-pins.ts';
import { openPicker, pickOption } from '../test/pick.ts';
import { TOUR_VERSION } from '../tour/steps.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  askedTodos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  startSession: vi.fn(),
  clientGuess: vi.fn(),
  clientPickOutcome: vi.fn(async () => ({})),
  close: vi.fn(),
  updatePrefs: vi.fn(),
  libraryItems: vi.fn(),
  libraryRecent: vi.fn(),
  libraryScopes: vi.fn(() => new Promise(() => {})),
  projects: vi.fn(),
  homeMeetings: vi.fn(async () => ({ cache: 'none', checked: null, meetings: [] })),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));

class FakeEventSource {
  static CLOSED = 2;
  static last: FakeEventSource | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { App } = await import('../App.tsx');
const { clientChoice, projectChoice } = await import('../state/client-choice.ts');
const { projectsStore } = await import('../state/projects.ts');

const skill = (name: string, title: string): SkillInfo => ({
  name,
  title,
  description: '',
  kind: 'skill',
  maturity: 'live',
  argumentHint: null,
  restrictedTo: null,
});

const SID1 = '11111111-1111-4111-8111-111111111111';
const SID2 = '22222222-2222-4222-8222-222222222222';

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam Example', slug: 'sam-example', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [skill('meeting-notes', 'Meeting notes'), skill('standup', 'Standup')],
  clients: [
    { slug: 'acme', name: 'Acme Heating' },
    { slug: 'northwind', name: 'Northwind' },
  ],
  usedOften: [],
  prefs: {
    pins: ['meeting-notes'],
    lastClient: null,
    todoPanelOpen: false,
    directWrites: false,
    tourSeen: TOUR_VERSION,
    // Every to-do and chat these tests open from Home is pinned: Home lists only what is pinned.
    favouriteTodos: ['t-late.md', 't-today.md', 't-a.md', 'personal/t-p.md', 't-new.md'],
    favouriteChats: [SID1, SID2],
    favouriteFiles: [],
  },
};

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const todo = (id: string, title: string, due: string | null, client: string | null = null): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  attachments: [],
  assignee: 'sam-example',
  due,
  surfaceDate: null,
  project: null,
  client,
});
const chat = (
  id: string,
  title: string,
  state: LiveSession['state'],
  todoId: string | null = null,
): LiveSession => ({
  id,
  sdkSessionId: id === 's1' ? SID1 : id === 's2' ? SID2 : null,
  title,
  client: null,
  todoId,
  state,
  startedAt: '',
  lastActivityAt: '2026-11-11T10:00:00.000Z',
  kind: 'tds',
});

const todoList = {
  mine: [
    todo('t-late.md', 'Write the call tracking case', dayOffset(-2), 'acme'),
    todo('t-today.md', 'Check the monthly reports', dayOffset(0)),
    todo('t-later.md', 'Plan the quarter', dayOffset(20)),
  ],
  open: [],
  othersCount: 0,
  team: [],
};

async function renderHome() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  const box = screen.getByRole('textbox', { name: 'Message to Claude' });
  await waitFor(() => expect(document.activeElement).toBe(box));
  return box;
}
const card = (name: string) => within(screen.getByRole('region', { name }));
/**
 * A favourite to-do's row opens the to-do panel (decision 9); a chat starts from the panel's own button. This
 * clicks the row, then that button (Start a chat, or Open chat when the to-do already has one).
 */
const startChatFromPanel = async (title: RegExp) => {
  fireEvent.click(await card('Pinned tasks').findByRole('button', { name: title }));
  const panel = await screen.findByRole('dialog');
  fireEvent.click(within(panel).getByRole('button', { name: /^(Start a chat|Open chat)$/ }));
};

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue(todoList);
  api.askedTodos.mockResolvedValue({ waiting: [], done: [], historyRead: true });
  api.sessions.mockResolvedValue({
    live: [
      chat('s1', 'Monthly reports check', 'waiting'),
      chat('s2', 'Call tracking case', 'working', 't-late.md'),
    ],
    past: [],
  });
  api.startSession.mockResolvedValue({ session: chat('new1', 'New chat', 'working') });
  api.updatePrefs.mockResolvedValue(boot.prefs);
  api.libraryItems.mockResolvedValue({ files: [] });
  api.libraryRecent.mockResolvedValue({ files: [], partial: false });
});
afterEach(() => {
  projectChoice.set('');
  clientChoice.set('');
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('Home', () => {
  it('shows the greeting, the summary and the pinned cards from boot data', async () => {
    await renderHome();
    expect(screen.getByText(/^Good (morning|afternoon|evening), Sam$/)).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await screen.findByText('One task is overdue, one is due today and one chat is waiting for you.');

    const needs = card('Pinned tasks');
    expect(needs.getByText('2')).toBeTruthy();
    expect(needs.getByText('Write the call tracking case')).toBeTruthy();
    expect(needs.getByText('overdue by 2 days').className).toBe('late');
    expect(needs.getByText('Acme Heating').className).toBe('');
    expect(needs.getByText('due today').className).toBe('');
    // Home lists what is pinned, not what is due: a to-do that is not starred stays off it.
    expect(needs.queryByText('Plan the quarter')).toBeNull();
    expect(needs.queryByRole('checkbox')).toBeNull();

    const chats = card('Pinned chats');
    expect(chats.getByText('Monthly reports check')).toBeTruthy();
    expect(chats.getByText('Needs your answer')).toBeTruthy();
    expect(chats.getByText('Working')).toBeTruthy();

    const skills = card('Pinned skills');
    expect(skills.getByText('Meeting notes')).toBeTruthy();
    expect(skills.queryByText('Standup')).toBeNull();
  });

  it('says so plainly when nothing is due, has no chats and nothing is pinned', async () => {
    api.todos.mockResolvedValue({
      mine: [todo('x.md', 'Plan the quarter', dayOffset(20))],
      open: [],
      othersCount: 0,
    });
    api.sessions.mockResolvedValue({ live: [], past: [] });
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, pins: [], favouriteTodos: [], favouriteChats: [] },
    });
    await renderHome();
    expect(await screen.findByText('Pin a task to keep it here.')).toBeTruthy();
    expect(screen.getByText('Pin a chat to keep it here.')).toBeTruthy();
    expect(await screen.findByText('Pin a file to keep it here.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pinned skills' })).toBeTruthy();
    expect(screen.getByText('Pin a skill to keep it here.')).toBeTruthy();
    expect(screen.getByText('Nothing is waiting for you.')).toBeTruthy();
  });

  it('titles the skills card "Used often" only when used-often skills are shown', async () => {
    api.bootstrap.mockResolvedValue({
      ...boot,
      usedOften: [{ name: 'standup', count: 3 }],
      prefs: { ...boot.prefs, pins: [] },
    });
    await renderHome();
    expect(await screen.findByRole('region', { name: 'Used often' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Standup' })).toBeTruthy();
  });

  it('shows Loading in the cards while the lists are still coming', async () => {
    api.todos.mockReturnValue(new Promise(() => {}));
    api.sessions.mockReturnValue(new Promise(() => {}));
    await renderHome();
    expect(card('Pinned tasks').getByText('Loading…')).toBeTruthy();
    expect(card('Pinned chats').getByText('Loading…')).toBeTruthy();
  });

  const typeAndSend = (box: HTMLElement, value: string) => {
    fireEvent.change(box, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };
  const select = () => screen.getByRole('combobox', { name: 'Chat for' }) as HTMLInputElement;

  it('has no separate client row; the select sits in the message box and starts on auto', async () => {
    await renderHome();
    expect(document.querySelector('.home-client')).toBeNull();
    expect(select().closest('.home-composer .composer-scope')).toBeTruthy();
    expect(select().value).toBe('Auto');
    openPicker('Chat for');
    expect(screen.getAllByRole('option').map((o) => o.textContent?.replace(/, chosen$/, ''))).toEqual([
      'Auto',
      'No client',
      'Acme Heating',
      'Northwind',
    ]);
  });

  it('a chosen client skips the guess and is sent', async () => {
    const box = await renderHome();
    pickOption('Chat for', 'Northwind');
    typeAndSend(box, 'Hello there');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello there', client: 'northwind' });
    expect(api.clientGuess).not.toHaveBeenCalled();
    expect(api.clientPickOutcome).toHaveBeenCalledWith('by-hand');
  });

  it('"No client" skips the guess and sends no client', async () => {
    const box = await renderHome();
    pickOption('Chat for', 'No client');
    typeAndSend(box, 'Hello there');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0].client).toBeNull();
    expect(api.clientGuess).not.toHaveBeenCalled();
  });

  it("does not read or write the apps' client choice, nor the last client", async () => {
    clientChoice.set('client:northwind');
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, lastClient: 'acme' } });
    await renderHome();
    expect(select().value).toBe('Auto');
    pickOption('Chat for', 'Acme Heating');
    expect(clientChoice.get()).toBe('client:northwind');
  });

  it("Working on sits in the message box, first, and starts Chat for on its project's client", async () => {
    projectChoice.set('northwind/site');
    const box = await renderHome();
    const working = screen.getByRole('combobox', { name: 'Working on' });
    expect(working.closest('.home-composer .composer-scope')).toBeTruthy();
    expect(working.compareDocumentPosition(select()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(select().value).toBe('Northwind');
    expect(select().getAttribute('aria-describedby')).toBe('client-select-why');
    typeAndSend(box, 'Hello there');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello there', client: 'northwind' });
    expect(api.clientGuess).not.toHaveBeenCalled();
    expect(api.clientPickOutcome).toHaveBeenCalledWith('preset');
    // Never written back: the app-wide choice is the project's, untouched by the chat.
    expect(projectChoice.get().project).toBe('northwind/site');
  });

  it('a hand-picked Chat for beats the project, and is not written back', async () => {
    projectChoice.set('northwind/site');
    const box = await renderHome();
    pickOption('Chat for', 'Acme Heating');
    expect(select().getAttribute('aria-describedby')).toBeNull();
    typeAndSend(box, 'Hello there');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello there', client: 'acme' });
    expect(clientChoice.get()).toBe('client:northwind');
  });

  describe('Recent projects card', () => {
    const card = (key: string, title: string, at: string | null, status = 'active') => ({
      key,
      space: 'client',
      slug: key.split('/')[1],
      client: 'northwind',
      folder: `clients/northwind/projects/${key.split('/')[1]}`,
      archived: false,
      status,
      title,
      lastChanged: at ? { by: 'ian', at } : null,
    });
    afterEach(() => {
      projectsStore.reset();
      api.projects.mockReset();
    });

    it('lists open projects by the date they were last worked on, newest first', async () => {
      projectsStore.reset();
      api.projects.mockResolvedValue({
        projects: [
          card('northwind/old', 'Old job', '2026-10-01T09:00:00Z'),
          card('northwind/new', 'New job', '2026-11-24T09:00:00Z'),
          card('northwind/shut', 'Closed job', '2026-11-25T09:00:00Z', 'done'),
        ],
        duplicates: [],
      });
      await renderHome();
      const section = (await screen.findByRole('heading', { name: 'Recent projects' })).closest('section');
      if (!section) throw new Error('no card');
      const rows = within(section).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain('New job');
      expect(rows[0]?.textContent).toContain('Last worked on 24 Nov');
      expect(rows[1]?.textContent).toContain('Old job');
    });

    it('lists only the projects this person worked on, by their own last change', async () => {
      projectsStore.reset();
      api.projects.mockResolvedValue({
        projects: [
          { ...card('northwind/team', 'Team job', '2026-11-25T09:00:00Z'), lastMine: null },
          { ...card('northwind/mine', 'My job', '2026-11-25T08:00:00Z'), lastMine: '2026-11-20T09:00:00Z' },
        ],
        duplicates: [],
      });
      await renderHome();
      const section = (await screen.findByRole('heading', { name: 'Recent projects' })).closest('section');
      if (!section) throw new Error('no card');
      const rows = within(section).getAllByRole('listitem');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent).toContain('My job');
      expect(rows[0]?.textContent).toContain('You last worked on 20 Nov');
    });

    it('marks a restricted project in the card, and an open one not', async () => {
      projectsStore.reset();
      api.projects.mockResolvedValue({
        projects: [
          { ...card('northwind/secret', 'Secret job', '2026-11-24T09:00:00Z'), visibility: 'restricted' },
          card('northwind/plain', 'Plain job', '2026-11-20T09:00:00Z'),
        ],
        duplicates: [],
      });
      await renderHome();
      const section = (await screen.findByRole('heading', { name: 'Recent projects' })).closest('section');
      if (!section) throw new Error('no card');
      const rows = within(section).getAllByRole('listitem');
      expect(
        within(rows[0] as HTMLElement).getByText('Restricted: only its team, owners and scouts can see it'),
      ).toBeTruthy();
      expect(within(rows[1] as HTMLElement).queryByText(/^Restricted/)).toBeNull();
    });

    it('is not shown when no project has been worked on', async () => {
      projectsStore.reset();
      api.projects.mockResolvedValue({ projects: [], duplicates: [] });
      await renderHome();
      await act(async () => {});
      expect(screen.queryByRole('heading', { name: 'Recent projects' })).toBeNull();
    });
  });

  describe('the chat is for a project (projects R2)', () => {
    const projectCard = (key: string, client: string | null, title: string) => ({
      key,
      space: client === null ? 'personal' : 'client',
      slug: key.split('/')[1],
      client,
      folder: `clients/${client}/projects/${key.split('/')[1]}`,
      archived: false,
      status: 'active',
      title,
    });
    const withProjects = () => {
      projectsStore.reset();
      api.projects.mockResolvedValue({
        projects: [
          projectCard('northwind/site', 'northwind', 'Site rebuild'),
          projectCard('personal/diary', null, 'Diary'),
        ],
        duplicates: [],
      });
    };
    afterEach(() => projectsStore.reset());

    it("sends Working on's project while Chat for is still its client", async () => {
      withProjects();
      projectChoice.set('northwind/site');
      const box = await renderHome();
      await waitFor(() => expect(api.projects).toHaveBeenCalled());
      await act(async () => {});
      typeAndSend(box, 'Hello there');
      await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
      expect(api.startSession).toHaveBeenCalledWith({
        prompt: 'Hello there',
        client: 'northwind',
        project: 'northwind/site',
      });
    });

    it('drops the project when Chat for is hand-picked to another client', async () => {
      withProjects();
      projectChoice.set('northwind/site');
      const box = await renderHome();
      await waitFor(() => expect(api.projects).toHaveBeenCalled());
      await act(async () => {});
      pickOption('Chat for', 'Acme Heating');
      typeAndSend(box, 'Hello there');
      await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
      expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello there', client: 'acme' });
    });

    it('a personal project is sent with No client', async () => {
      withProjects();
      projectChoice.set('personal/diary');
      const box = await renderHome();
      await waitFor(() => expect(api.projects).toHaveBeenCalled());
      await act(async () => {});
      typeAndSend(box, 'Hello there');
      await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
      expect(api.startSession).toHaveBeenCalledWith({
        prompt: 'Hello there',
        client: null,
        project: 'personal/diary',
      });
    });

    // A task that belongs to a project opens Home's chat for that project: its own Project picker (plan decision 3).
    const projectTask = () => ({
      ...todo('t-a.md', 'Northwind thing', dayOffset(0), 'northwind'),
      projectMatch: { how: 'key' as const, key: 'northwind/site' },
    });

    // The chat's own Project picker, inside the message box (Home's cards have a Project filter too).
    const chatProject = () =>
      (
        within(document.querySelector('.home-composer') as HTMLElement).getByRole('combobox', {
          name: 'Project',
        }) as HTMLInputElement
      ).value;
    it('a chat for a project shows a filled Project picker and no loose text', async () => {
      withProjects();
      api.todos.mockResolvedValue({ ...todoList, mine: [projectTask()] });
      await renderHome();
      await waitFor(() => expect(api.projects).toHaveBeenCalled());
      await act(async () => {});
      await startChatFromPanel(/^Northwind thing/);
      await waitFor(() => expect(chatProject()).toBe('Site rebuild'));
      expect(select().value).toBe('Northwind');
      expect(screen.queryByRole('combobox', { name: 'Working on' })).toBeNull();
      expect(document.querySelector('[data-testid="home-project"]')).toBeNull();
      expect(screen.queryByText(/^Project:/)).toBeNull();
      // Picking another client says so in view: Project goes to No project, and nothing is sent for it.
      pickOption('Chat for', 'Acme Heating');
      expect(chatProject()).toBe('No project');
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
      expect(api.startSession.mock.calls[0]?.[0]).not.toHaveProperty('project');
    });

    it('with Working on set, the chat for a project keeps its Working on line under the box', async () => {
      withProjects();
      api.todos.mockResolvedValue({ ...todoList, mine: [projectTask()] });
      await renderHome();
      await waitFor(() => expect(api.projects).toHaveBeenCalled());
      await act(async () => {});
      await startChatFromPanel(/^Northwind thing/);
      await waitFor(() => expect(chatProject()).toBe('Site rebuild'));
      expect(document.querySelector('.home-scope')).toBeNull();
      act(() => projectChoice.set('personal/diary'));
      const working = await screen.findByRole('combobox', { name: 'Working on' });
      expect(working.closest('.home-scope')).toBeTruthy();
      expect(working.closest('.composer-scope')).toBeNull();
      // Starting the chat never wrote it: the project's own pick is the chat's.
      expect(chatProject()).toBe('Site rebuild');
      expect(projectChoice.get().project).toBe('personal/diary');
    });
  });

  it('a personal project starts Chat for on No client; a client not in the list leaves Auto', async () => {
    projectChoice.set('personal/diary');
    await renderHome();
    expect(select().value).toBe('No client');
    cleanup();
    projectChoice.set('');
    clientChoice.set('');
    projectChoice.set('gone/site');
    await renderHome();
    expect(select().value).toBe('Auto');
  });

  it('auto: a sure guess starts the chat with that client', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'sure', client: 'acme', how: 'named' });
    const box = await renderHome();
    typeAndSend(box, 'Acme need a report');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.clientGuess).toHaveBeenCalledWith({ text: 'Acme need a report' });
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Acme need a report', client: 'acme' });
    // The server counts its own guesses; Home reports nothing for these.
    expect(api.clientPickOutcome).not.toHaveBeenCalled();
  });

  it('auto: only the first 4,000 characters are sent to be guessed', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'none' });
    const box = await renderHome();
    typeAndSend(box, 'x'.repeat(5000));
    await waitFor(() => expect(api.clientGuess).toHaveBeenCalledTimes(1));
    expect(api.clientGuess.mock.calls[0]?.[0].text).toHaveLength(4000);
  });

  it('auto: "none" starts with no client', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'none' });
    const box = await renderHome();
    typeAndSend(box, 'Plan the away day');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0].client).toBeNull();
  });

  it('auto: empty text (a skill alone) is treated as none without asking', async () => {
    const box = await renderHome();
    expect(box).toBeTruthy();
    fireEvent.click(card('Pinned skills').getByRole('button', { name: 'Meeting notes' }));
    await screen.findByText('Meeting notes', { selector: 'strong' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.clientGuess).not.toHaveBeenCalled();
    expect(api.startSession.mock.calls[0]?.[0].client).toBeNull();
    expect(api.clientPickOutcome).toHaveBeenCalledWith('skill-only');
  });

  it('shows a polite status when the guess is slow, with the box read-only and unchanged', async () => {
    let finish: (v: unknown) => void = () => {};
    api.clientGuess.mockReturnValue(new Promise((r) => (finish = r)));
    const box = (await renderHome()) as HTMLTextAreaElement;
    typeAndSend(box, 'Slow one');
    const status = await screen.findByText('Working out the client…');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe('Slow one');
    finish({ kind: 'none' });
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Working out the client…')).toBeNull());
  });

  it('asks when unsure; choosing an option sends with that client', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: ['northwind'] });
    const box = await renderHome();
    typeAndSend(box, 'Something vague');
    const group = await screen.findByRole('group', { name: 'Which client is this for?' });
    await waitFor(() => expect(document.activeElement).toBe(group));
    expect(api.startSession).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole('button', { name: 'Northwind' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Something vague', client: 'northwind' });
    expect(api.clientPickOutcome).toHaveBeenCalledWith('ask-suggested');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Which client is this for?' })).toBeNull(),
    );
  });

  it('"No client" sends with no client', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    const box = await renderHome();
    typeAndSend(box, 'Vague one');
    const group = await screen.findByRole('group', { name: 'Which client is this for?' });
    fireEvent.click(within(group).getByRole('button', { name: 'No client' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0].client).toBeNull();
    expect(api.clientPickOutcome).toHaveBeenCalledWith('ask-no-client');
  });

  it('"Another client…" lists every client and sends the one chosen', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    const box = await renderHome();
    typeAndSend(box, 'Vague two');
    const group = await screen.findByRole('group', { name: 'Which client is this for?' });
    const other = within(group).getByRole('combobox', { name: 'Another client' }) as HTMLInputElement;
    expect(other.value).toBe('');
    expect(other.placeholder).toBe('Another client…');
    openPicker('Another client');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme Heating', 'Northwind']);
    fireEvent.keyDown(other, { key: 'Escape' });
    const use = within(group).getByRole('button', { name: 'Use this client' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    pickOption('Another client', 'Acme Heating');
    // Choosing in the list sends nothing by itself.
    expect(api.startSession).not.toHaveBeenCalled();
    expect(use.disabled).toBe(false);
    fireEvent.click(use);
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0].client).toBe('acme');
    expect(api.clientPickOutcome).toHaveBeenCalledWith('ask-other');
  });

  it('an error from the guess asks with no options', async () => {
    api.clientGuess.mockRejectedValue(new Error('down'));
    const box = await renderHome();
    typeAndSend(box, 'Hello');
    const group = await screen.findByRole('group', { name: 'Which client is this for?' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['No client', 'Use this client', 'Cancel']);
  });

  it('an unknown kind asks with no options', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'maybe' });
    const box = await renderHome();
    typeAndSend(box, 'Hello');
    await screen.findByRole('group', { name: 'Which client is this for?' });
  });

  it('disables the Client select while a guess or question is pending, and frees it on Cancel', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    const box = await renderHome();
    expect(select().disabled).toBe(false);
    typeAndSend(box, 'Hold on');
    const group = await screen.findByRole('group', { name: 'Which client is this for?' });
    expect(select().disabled).toBe(true);
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(select().disabled).toBe(false));
  });

  it('shows a visible Client label, and swaps the hint while the question is open', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    const box = await renderHome();
    expect(screen.getByText('Chat for', { selector: 'label' }).className).not.toContain('visually-hidden');
    // The keys are said to screen readers only: Enter to send is expected, and Send is plain to see.
    expect(screen.getByText('Enter to send, Shift and Enter for a new line.').className).toBe(
      'visually-hidden',
    );
    typeAndSend(box, 'Vague');
    await screen.findByText('Answer the question above, or Cancel to change your message.');
    expect(screen.queryByText('Enter to send, Shift and Enter for a new line.')).toBeNull();
  });

  it('the status region is in the page before it has text', async () => {
    await renderHome();
    expect(document.querySelector('.home-status[role="status"]')).toBeTruthy();
  });

  it('a guess that lands after Home moved to another chat is dropped', async () => {
    for (const kind of ['ask', 'sure'] as const) {
      let finish: (v: unknown) => void = () => {};
      api.clientGuess.mockReturnValue(new Promise((r) => (finish = r)));
      const box = await renderHome();
      typeAndSend(box, 'Old message');
      await waitFor(() => expect(api.clientGuess).toHaveBeenCalled());
      // Another new chat (a favourite skill starts one): the pending guess must be dropped.
      fireEvent.click(card('Pinned skills').getByRole('button', { name: 'Meeting notes' }));
      await screen.findByText('Meeting notes', { selector: 'strong' });
      finish(kind === 'ask' ? { kind: 'ask', options: [] } : { kind: 'sure', client: 'acme', how: 'named' });
      await new Promise((r) => setTimeout(r, 20));
      expect(api.startSession).not.toHaveBeenCalled();
      expect(screen.queryByRole('group', { name: 'Which client is this for?' })).toBeNull();
      expect(select().disabled).toBe(false);
      cleanup();
      vi.clearAllMocks();
      api.bootstrap.mockResolvedValue(boot);
      api.todos.mockResolvedValue(todoList);
      api.sessions.mockResolvedValue({ live: [], past: [] });
    }
  });

  it('Cancel and Escape close the question and keep the text', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    const box = (await renderHome()) as HTMLTextAreaElement;
    typeAndSend(box, 'Keep me');
    let group = await screen.findByRole('group', { name: 'Which client is this for?' });
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Which client is this for?' })).toBeNull(),
    );
    expect(box.value).toBe('Keep me');
    expect(box.readOnly).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    group = await screen.findByRole('group', { name: 'Which client is this for?' });
    fireEvent.keyDown(group, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Which client is this for?' })).toBeNull(),
    );
    expect(box.value).toBe('Keep me');
    expect(api.startSession).not.toHaveBeenCalled();
    expect(api.clientPickOutcome.mock.calls).toEqual([['ask-cancelled'], ['ask-cancelled']]);
  });

  it("a task chat opens on the task's client; a personal task on No client", async () => {
    api.todos.mockResolvedValue({
      ...todoList,
      mine: [
        todo('t-a.md', 'Acme thing', dayOffset(0), 'acme'),
        { ...todo('personal/t-p.md', 'My own thing', dayOffset(0), 'acme'), scope: 'personal' },
      ],
    });
    await renderHome();
    await startChatFromPanel(/^Acme thing/);
    await waitFor(() => expect(select().value).toBe('Acme Heating'));
    await startChatFromPanel(/^My own thing/);
    await waitFor(() => expect(select().value).toBe('No client'));
    // Sending a chat whose client arrived with it counts as preset, not chosen by hand.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.clientPickOutcome).toHaveBeenCalledWith('preset');
    expect(api.clientGuess).not.toHaveBeenCalled();
  });

  it("a task's client beats Working on's, and isn't credited to it", async () => {
    api.todos.mockResolvedValue({ ...todoList, mine: [todo('t-a.md', 'Acme thing', dayOffset(0), 'acme')] });
    await renderHome();
    await startChatFromPanel(/^Acme thing/);
    await waitFor(() => expect(select().value).toBe('Acme Heating'));
    act(() => projectChoice.set('northwind/site'));
    expect(select().value).toBe('Acme Heating');
    expect(select().getAttribute('aria-describedby')).toBeNull();
    // A to-do whose client matches the project's: still the to-do's choice, not credited to Working on.
    act(() => projectChoice.set('acme/site'));
    expect(select().value).toBe('Acme Heating');
    expect(select().getAttribute('aria-describedby')).toBeNull();
  });

  it('locks Working on with Chat for while the client question is open', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    // A client not in the list leaves Chat for on Auto, so the question is asked.
    projectChoice.set('gone/site');
    const box = await renderHome();
    typeAndSend(box, 'Vague');
    await screen.findByText('Answer the question above, or Cancel to change your message.');
    expect((screen.getByRole('combobox', { name: 'Working on' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('never sends /clear: it just empties the box', async () => {
    const box = (await renderHome()) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '/clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(box.value).toBe(''));
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it("starts a chat from a task's panel and keeps the task link", async () => {
    const box = (await renderHome()) as HTMLTextAreaElement;
    await startChatFromPanel(/^Check the monthly reports/);
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value).toBe(
        'Help me with this task: todo/t-today.md (Check the monthly reports)',
      ),
    );
    expect(box).toBeTruthy();
    // A to-do with no client is worked out like any new chat.
    api.clientGuess.mockResolvedValue({ kind: 'none' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.clientGuess).toHaveBeenCalledTimes(1);
    expect(api.startSession.mock.calls[0]?.[0]).toMatchObject({ todoId: 't-today.md', client: null });
  });

  it('marks a task passed to you as seen when it is opened from Home', async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    api.todos.mockResolvedValue({
      ...todoList,
      mine: [
        {
          ...todo('t-new.md', 'Fresh from Ben', dayOffset(0)),
          handover: { by: 'ben-mcadam', byName: 'Ben McAdam', at, from: null, via: null, source: 'stamp' },
        },
      ],
    });
    await renderHome();
    fireEvent.click(await card('Pinned tasks').findByRole('button', { name: /^Fresh from Ben/ }));
    await waitFor(() => expect(api.updatePrefs).toHaveBeenCalledWith({ todoSeen: { 't-new.md': at } }));
  });

  it('opens the live chat for a task that already has one', async () => {
    await renderHome();
    await startChatFromPanel(/^Write the call tracking case/);
    await screen.findByRole('heading', { level: 1, name: 'Call tracking case' });
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('opens a chat from the Pinned chats card', async () => {
    await renderHome();
    fireEvent.click(await card('Pinned chats').findByRole('button', { name: /^Monthly reports check/ }));
    await screen.findByRole('heading', { level: 1, name: 'Monthly reports check' });
  });

  it('lists pinned files, newest first, and opens one in the viewer', async () => {
    const file = (id: string, title: string) => ({
      item: { id, title, name: `${title}.md`, kind: 'document' } as unknown as LibraryItem,
      scope: { id: 'client:acme', name: 'Acme Heating' } as unknown as LibraryScope,
    });
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, favouriteFiles: ['f1', 'f2'] } });
    api.libraryItems.mockResolvedValue({ files: [file('f2', 'Newer plan'), file('f1', 'Older plan')] });
    await renderHome();
    const files = card('Pinned files');
    await files.findByText('Newer plan');
    const rows = files.getAllByRole('listitem');
    expect(api.libraryItems).toHaveBeenCalledWith(['f2', 'f1']);
    expect(rows.map((r) => r.textContent)).toEqual(['Newer planAcme Heating', 'Older planAcme Heating']);
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: /^Newer plan/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Newer plan' })).toBeTruthy();
  });

  it('shows five pinned tasks, and "Show N more" expands the card in place and back', async () => {
    const mine = Array.from({ length: 7 }, (_, i) => todo(`m${i}.md`, `Task ${i}`, null));
    api.todos.mockResolvedValue({ ...todoList, mine });
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, favouriteTodos: mine.map((t) => t.key) },
    });
    await renderHome();
    const card1 = card('Pinned tasks');
    await card1.findByText('Task 4');
    expect(card1.queryByText('Task 5')).toBeNull();
    const more = card1.getByRole('button', { name: 'Show 2 more tasks' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(card1.getByText('Task 5')).toBeTruthy();
    expect(card1.getByText('Task 6')).toBeTruthy();
    expect(more.textContent).toBe('Show fewer tasks'); // "tasks" is visually hidden
    expect(more.getAttribute('aria-expanded')).toBe('true');
    // It no longer opens the drawer (which did nothing visible when the drawer was already open).
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
    fireEvent.click(more);
    expect(card1.queryByText('Task 5')).toBeNull();
    expect(more.textContent).toBe('Show 2 more tasks');
  });

  it('says "1 more task", not "1 more tasks"', async () => {
    const mine = Array.from({ length: 6 }, (_, i) => todo(`m${i}.md`, `Task ${i}`, null));
    api.todos.mockResolvedValue({ ...todoList, mine });
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, favouriteTodos: mine.map((t) => t.key) },
    });
    await renderHome();
    const card1 = card('Pinned tasks');
    expect(await card1.findByRole('button', { name: 'Show 1 more task' })).toBeTruthy();
  });

  it('keeps focus in the card when the last favourite task is taken off it', async () => {
    const only = todo('m0.md', 'Only favourite', null);
    api.todos.mockResolvedValue({ ...todoList, mine: [only] });
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, favouriteTodos: [only.key] } });
    api.updatePrefs.mockResolvedValue({ ...boot.prefs, favouriteTodos: [] });
    await renderHome();
    const star = await card('Pinned tasks').findByRole('button', { name: 'Pin: Only favourite' });
    star.focus();
    fireEvent.click(star);
    await card('Pinned tasks').findByText('Pin a task to keep it here.', { exact: false });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Pinned tasks' })),
    );
  });

  it('lists a pinned chat that is not open, and opens it from earlier chats', async () => {
    const sid = '33333333-3333-4333-8333-333333333333';
    api.sessions.mockResolvedValue({
      live: [],
      past: [
        { sdkSessionId: sid, title: 'Last week plan', lastModified: '2026-11-04T10:00:00.000Z', kind: 'tds' },
      ],
    });
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, favouriteChats: [sid] } });
    api.startSession.mockResolvedValue({ session: chat('r1', 'Last week plan', 'working') });
    await renderHome();
    fireEvent.click(await card('Pinned chats').findByRole('button', { name: /^Last week plan/ }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith({ resume: sid }));
  });

  it('starts a pinned skill', async () => {
    await renderHome();
    fireEvent.click(card('Pinned skills').getByRole('button', { name: 'Meeting notes' }));
    await screen.findByText('Meeting notes', { selector: 'strong' });
  });

  it('"All tasks", "All chats" and "All skills" open their drawers', async () => {
    api.bootstrap.mockResolvedValue({ ...boot, identity: { ...boot.identity, role: 'owner' } });
    await renderHome();
    const drawer = () => document.getElementById('drawer') as HTMLElement;
    expect(drawer().hasAttribute('inert')).toBe(true);
    for (const name of ['All tasks', 'All chats', 'All skills']) {
      expect(screen.getAllByRole('button', { name })[0]?.getAttribute('data-size')).toBe('small');
    }
    fireEvent.click(card('Pinned tasks').getByRole('button', { name: 'All tasks' }));
    await waitFor(() => expect(drawer().hasAttribute('inert')).toBe(false));
    expect(within(drawer()).getByRole('heading', { name: 'Tasks' })).toBeTruthy();
    fireEvent.click(card('Pinned chats').getByRole('button', { name: 'All chats' }));
    await waitFor(() => expect(within(drawer()).getByRole('heading', { name: 'Chats' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'All skills' }));
    await waitFor(() => expect(within(drawer()).getByRole('heading', { name: 'Skills' })).toBeTruthy());
  });

  it('has no Pinned skills card, and no "All skills", for someone the Skills drawer is not for (team)', async () => {
    api.bootstrap.mockResolvedValue({ ...boot, identity: { ...boot.identity, role: 'team' } });
    await renderHome();
    expect(screen.queryByRole('heading', { name: /skills/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All skills' })).toBeNull();
    expect(card('Pinned chats').getByRole('button', { name: 'All chats' })).toBeTruthy();
  });

  it('never counts the Pinned skills card as hidden for the team', async () => {
    api.bootstrap.mockResolvedValue({
      ...boot,
      identity: { ...boot.identity, role: 'team' },
      prefs: { ...boot.prefs, homeHidden: ['skills'], homeShortcuts: [] },
    });
    await renderHome();
    expect(screen.queryByText(/cards? hidden\./)).toBeNull();
  });
});

describe('Home: moving the cards', () => {
  const order = () =>
    [...document.querySelectorAll('.home-tray > section h2')].map((h) => h.textContent?.trim());
  const KEY = 'tds.home.cardOrder.v1:sam-example';

  it('moves a card with the keyboard on its grip, saves it for this person, and resets', async () => {
    await renderHome();
    await card('Pinned tasks').findByText('Write the call tracking case');
    expect(order()).toEqual([
      'Meetings',
      'Task updates',
      'Pinned tasks',
      'Recent tasks',
      'Pinned chats',
      'Recent chats',
      'Pinned files',
      'Recent documents',
      'Recent images',
      'Pinned skills',
    ]);
    expect(screen.queryByRole('button', { name: 'Reset card order' })).toBeNull();

    const grip = screen.getByRole('button', { name: 'Move Pinned tasks, 3 of 10' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(order()).toEqual([
      'Meetings',
      'Task updates',
      'Recent tasks',
      'Pinned tasks',
      'Pinned chats',
      'Recent chats',
      'Pinned files',
      'Recent documents',
      'Recent images',
      'Pinned skills',
    ]);
    expect(screen.getByText('Pinned tasks moved to 4 of 10')).toBeTruthy();
    // Ads approvals and Recent projects are hidden (nothing waiting, no projects) but keep their default places in what is saved.
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([
      'meetings',
      'ads',
      'task-updates',
      'recent-todos',
      'todos',
      'projects',
      'chats',
      'recent-chats',
      'files',
      'recent-documents',
      'recent-images',
      'skills',
    ]);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Pinned tasks, 4 of 10' })),
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Pinned files, 7 of 10' }), { key: 'Home' });
    expect(order()[0]).toBe('Pinned files');

    fireEvent.click(screen.getByRole('button', { name: 'Reset card order' }));
    expect(order()).toEqual([
      'Meetings',
      'Task updates',
      'Pinned tasks',
      'Recent tasks',
      'Pinned chats',
      'Recent chats',
      'Pinned files',
      'Recent documents',
      'Recent images',
      'Pinned skills',
    ]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual([]);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Meetings, 1 of 10' })),
    );
  });

  it("uses this person's saved order, not someone else's on the same browser", async () => {
    localStorage.setItem(KEY, JSON.stringify(['skills', 'files']));
    localStorage.setItem('tds.home.cardOrder.v1:other-person', JSON.stringify(['chats']));
    await renderHome();
    await waitFor(() =>
      expect(order()).toEqual([
        'Pinned skills',
        'Pinned files',
        'Meetings',
        'Task updates',
        'Pinned tasks',
        'Recent tasks',
        'Pinned chats',
        'Recent chats',
        'Recent documents',
        'Recent images',
      ]),
    );
    expect(screen.getByRole('button', { name: 'Reset card order' })).toBeTruthy();
  });

  it('a key that moves nothing saves nothing', async () => {
    await renderHome();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Meetings, 1 of 10' }), { key: 'ArrowUp' });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByText('Meetings moved to 1 of 10')).toBeTruthy();
  });

  it('a card is only draggable while its grip is pressed', async () => {
    await renderHome();
    const section = screen.getByRole('region', { name: 'Pinned chats' });
    expect(section.getAttribute('draggable')).toBe('false');
    const grip = within(section).getByRole('button', { name: /^Move Pinned chats/ });
    fireEvent.pointerDown(grip);
    expect(section.getAttribute('draggable')).toBe('true');
    fireEvent.pointerUp(grip);
    expect(section.getAttribute('draggable')).toBe('false');
  });

  describe('Start my day', () => {
    it('is hidden when the brain has no /gm skill', async () => {
      await renderHome();
      expect(screen.queryByRole('button', { name: 'Start my day' })).toBeNull();
    });

    it('starts a chat that runs /gm', async () => {
      api.bootstrap.mockResolvedValue({ ...boot, skills: [...boot.skills, skill('gm', 'Good morning')] });
      await renderHome();
      fireEvent.click(await screen.findByRole('button', { name: 'Start my day' }));
      await waitFor(() => expect(api.startSession).toHaveBeenCalled());
      expect(JSON.stringify(api.startSession.mock.calls[0])).toContain('/gm');
    });
  });
});

describe('Home: choosing what shows', () => {
  const order = () =>
    [...document.querySelectorAll('.home-tray > section h2')].map((h) => h.textContent?.trim());
  const KEY = 'tds.home.cardOrder.v1:sam-example';
  const withPrefs = (extra: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    api.bootstrap.mockResolvedValue({ ...boot, ...more, prefs: { ...boot.prefs, ...extra } });

  it('a hidden card disappears, and the grip counts only the cards shown', async () => {
    withPrefs({
      homeHidden: ['chats', 'files', 'recent-chats', 'recent-documents', 'recent-images'],
      homeShortcuts: [],
    });
    await renderHome();
    await card('Pinned tasks').findByText('Write the call tracking case');
    expect(order()).toEqual(['Meetings', 'Task updates', 'Pinned tasks', 'Recent tasks', 'Pinned skills']);
    expect(screen.getByRole('button', { name: 'Move Pinned tasks, 3 of 5' })).toBeTruthy();
  });

  it('hiding a card keeps the saved order for when it comes back', async () => {
    localStorage.setItem(KEY, JSON.stringify(['skills', 'files', 'chats']));
    withPrefs({
      homeHidden: ['files', 'recent-todos', 'recent-chats', 'recent-documents', 'recent-images'],
      homeShortcuts: [],
    });
    await renderHome();
    await waitFor(() =>
      expect(order()).toEqual(['Pinned skills', 'Pinned chats', 'Meetings', 'Task updates', 'Pinned tasks']),
    );
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['skills', 'files', 'chats']);
  });

  it('does not look up pinned files while that card is hidden', async () => {
    withPrefs({ homeHidden: ['files'], homeShortcuts: [], favouriteFiles: ['a'] });
    await renderHome();
    await card('Pinned tasks').findByText('Write the call tracking case');
    expect(api.libraryItems).not.toHaveBeenCalled();
  });

  it('keeps Start my day hidden when it is hidden', async () => {
    withPrefs(
      { homeHidden: ['start-my-day'], homeShortcuts: [] },
      { skills: [...boot.skills, skill('gm', 'Good morning')] },
    );
    await renderHome();
    expect(screen.queryByRole('button', { name: 'Start my day' })).toBeNull();
  });

  it('has no Customise Home toggle when the server is older (no homeHidden)', async () => {
    await renderHome();
    expect(screen.queryByRole('button', { name: 'Customise Home' })).toBeNull();
  });

  it('has the Customise Home toggle when the server sends homeHidden', async () => {
    withPrefs({ homeHidden: [], homeShortcuts: [] });
    await renderHome();
    expect(screen.getByRole('button', { name: 'Customise Home' })).toBeTruthy();
  });

  it('says how many cards are hidden, with a button that opens the panel', async () => {
    withPrefs({ homeHidden: ['chats', 'files'], homeShortcuts: [] });
    await renderHome();
    expect(await screen.findByText('2 cards hidden.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show hidden cards' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset card order' })).toBeNull();
  });

  it('says "1 card hidden." in the singular, and does not count Ads without access', async () => {
    withPrefs({ homeHidden: ['chats', 'ads'], homeShortcuts: [] });
    await renderHome();
    expect(await screen.findByText('1 card hidden.')).toBeTruthy();
  });

  it('says so when every card is hidden', async () => {
    withPrefs({
      homeHidden: [
        'meetings',
        'todos',
        'chats',
        'files',
        'skills',
        'recent-todos',
        'task-updates',
        'recent-chats',
        'recent-documents',
        'recent-images',
      ],
      homeShortcuts: [],
    });
    await renderHome();
    expect(await screen.findByText('Your Home has no cards. Customise Home to add some.')).toBeTruthy();
  });

  it('never shows a skill as a shortcut, even one that slipped into the settings', async () => {
    withPrefs({
      homeHidden: [],
      homeShortcuts: [{ kind: 'skill', name: 'standup' } as never, { kind: 'drawer', drawer: 'chats' }],
    });
    await renderHome();
    const row = within(document.querySelector('.home-shortcuts') as HTMLElement);
    expect(row.getByRole('button', { name: 'Chats' })).toBeTruthy();
    expect(row.queryByRole('button', { name: 'Standup' })).toBeNull();
  });

  it('a drawer shortcut opens its drawer and a place shortcut opens the place', async () => {
    withPrefs({
      homeHidden: [],
      homeShortcuts: [
        { kind: 'drawer', drawer: 'todos' },
        { kind: 'place', place: 'documents' },
      ],
    });
    await renderHome();
    const row = within(document.querySelector('.home-shortcuts') as HTMLElement);
    const drawer = () => document.getElementById('drawer') as HTMLElement;
    fireEvent.click(row.getByRole('button', { name: 'Tasks' }));
    await waitFor(() => expect(drawer().hasAttribute('inert')).toBe(false));
    expect(within(drawer()).getByRole('heading', { name: 'Tasks' })).toBeTruthy();
    fireEvent.click(row.getByRole('button', { name: 'Documents' }));
    await screen.findByRole('heading', { level: 1, name: 'Documents' });
  });

  it('has no shortcut row when there is nothing to show', async () => {
    withPrefs({ homeHidden: [], homeShortcuts: [] });
    await renderHome();
    expect(document.querySelector('.home-shortcuts')).toBeNull();
  });

  it('lets a lone last card fill the row only with an odd count of shown cards', async () => {
    await renderHome();
    const tray = () => document.querySelector('.home-tray');
    expect(tray()?.getAttribute('data-odd')).toBe('false');
    cleanup();
    withPrefs({ homeHidden: ['files'], homeShortcuts: [] });
    await renderHome();
    expect(tray()?.getAttribute('data-odd')).toBe('true');
  });
});

describe('Home: recent cards', () => {
  const rtodo = (
    id: string,
    title: string,
    created: string | null,
    over: Partial<TodoItem> = {},
  ): TodoItem => ({
    ...todo(id, title, null),
    created,
    ...over,
  });
  const rfile = (
    id: string,
    title: string,
    kind: 'document' | 'image' = 'document',
    projects?: string[],
  ) => ({
    item: {
      id,
      title,
      name: `${title}.md`,
      kind,
      modified: '2026-11-24T10:00:00.000Z',
      projects,
    } as unknown as LibraryItem,
    scope: { id: 'client:acme', name: 'Acme Heating' } as unknown as LibraryScope,
  });
  // Working on only holds a project the list knows.
  const withProject = () => {
    projectsStore.reset();
    api.projects.mockResolvedValue({
      projects: [
        {
          key: 'northwind/site',
          space: 'client',
          slug: 'site',
          client: 'northwind',
          folder: 'clients/northwind/projects/site',
          archived: false,
          status: 'active',
          title: 'Site rebuild',
        },
      ],
      duplicates: [],
    });
  };
  afterEach(() => projectsStore.reset());
  const withTodos = (mine: TodoItem[], open: TodoItem[] = []) =>
    api.todos.mockResolvedValue({ mine, open, othersCount: 0, team: [] });
  const unpinned = () =>
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, favouriteTodos: [], favouriteChats: [], favouriteFiles: [] },
    });

  describe('Recent tasks', () => {
    it('lists the newest first with "Added" and "Passed to you", leaves personal ones out', async () => {
      withTodos(
        [
          rtodo('old.md', 'Old one', '2026-11-01', { client: 'acme' }),
          rtodo('p.md', 'Private one', '2026-11-25', { scope: 'personal', key: 'personal/p.md' }),
          rtodo('passed.md', 'Passed one', '2026-11-02', {
            handover: {
              by: 'x',
              byName: 'X',
              at: '2026-11-24T10:00:00+00:00',
              from: null,
              via: null,
              source: 'stamp',
            },
          }),
        ],
        [rtodo('new.md', 'Open to anyone', '2026-11-25')],
      );
      await renderHome();
      const c = card('Recent tasks');
      await c.findByText('Passed one');
      const rows = c.getAllByRole('listitem');
      expect(rows.map((r) => r.textContent)).toEqual([
        'Passed onePassed to you 24 Nov',
        'Old oneAdded 1 Nov, Acme Heating',
      ]);
      expect(c.queryByText('Private one')).toBeNull();
      // Only tasks assigned to this person: one open to anyone is not theirs (plan 2026-11-25-my-recents).
      expect(c.queryByText('Open to anyone')).toBeNull();
    });

    it('says so when empty, in a project and out of it, and has an All tasks button', async () => {
      withTodos([]);
      await renderHome();
      expect(await card('Recent tasks').findByText('Tasks assigned to you show here.')).toBeTruthy();
      fireEvent.click(card('Recent tasks').getByRole('button', { name: 'All tasks' }));
      await waitFor(() =>
        expect(
          within(document.getElementById('drawer') as HTMLElement).getByRole('heading', { name: 'Tasks' }),
        ),
      );
      cleanup();
      withProject();
      projectChoice.set('northwind/site');
      await renderHome();
      expect(await card('Recent tasks').findByText('No tasks of yours in this project.')).toBeTruthy();
    });

    it('says "Restricted project", never the client, on a task whose project is hidden from this person', async () => {
      withTodos([
        rtodo('mine.md', 'Book the room', '2026-11-20', {
          client: 'northwind',
          projectMatch: { how: 'restricted' },
        }),
      ]);
      await renderHome();
      const row = (await card('Recent tasks').findByText('Book the room')).closest('li') as HTMLElement;
      expect(row.textContent).toContain('Restricted project');
      expect(row.textContent).not.toContain('Northwind');
    });

    it('Working on narrows it', async () => {
      withProject();
      projectChoice.set('northwind/site');
      withTodos([
        rtodo('in.md', 'Inside', '2026-11-20', { projectMatch: { how: 'key', key: 'northwind/site' } }),
        rtodo('out.md', 'Outside', '2026-11-21'),
      ]);
      await renderHome();
      const c = card('Recent tasks');
      await c.findByText('Inside');
      expect(c.queryByText('Outside')).toBeNull();
    });

    it('shows five rows and Show N more, never more than 20', async () => {
      withTodos(
        Array.from({ length: 25 }, (_, i) =>
          rtodo(`m${i}.md`, `Task ${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`),
        ),
      );
      await renderHome();
      const c = card('Recent tasks');
      await c.findByText('Task 24');
      expect(c.getAllByRole('listitem')).toHaveLength(5);
      fireEvent.click(c.getByRole('button', { name: /Show 15 more tasks/ }));
      expect(c.getAllByRole('listitem')).toHaveLength(20);
    });

    it('a star press flips the star and the row stays', async () => {
      withTodos([rtodo('t-a.md', 'Starred later', '2026-11-20'), rtodo('x.md', 'Other', '2026-11-19')]);
      api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, favouriteTodos: ['x.md'] } });
      api.updatePrefs.mockImplementation(async (p: object) => ({ ...boot.prefs, ...p }));
      await renderHome();
      const c = card('Recent tasks');
      const star = await c.findByRole('button', { name: 'Pin: Starred later' });
      expect(star.getAttribute('aria-pressed')).toBe('false');
      expect(c.getByRole('button', { name: 'Pin: Other' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(star);
      await waitFor(() =>
        expect(
          card('Recent tasks')
            .getByRole('button', { name: 'Pin: Starred later' })
            .getAttribute('aria-pressed'),
        ).toBe('true'),
      );
      expect(card('Recent tasks').getAllByRole('listitem')).toHaveLength(2);
    });
  });

  describe('Recent chats', () => {
    it('lists open and earlier chats newest first, once each, and stars only chats with an id', async () => {
      api.sessions.mockResolvedValue({
        live: [
          { ...chat('s1', 'Open one', 'working'), lastActivityAt: '2026-11-25T09:00:00.000Z' },
          { ...chat('x9', 'No id yet', 'working'), lastActivityAt: '2026-11-25T11:00:00.000Z' },
        ],
        past: [
          {
            sdkSessionId: SID1,
            title: 'Same as open',
            lastModified: '2026-11-25T12:00:00.000Z',
            kind: 'tds',
          },
          {
            sdkSessionId: 'old-1',
            title: 'Earlier one',
            lastModified: '2026-11-25T10:00:00.000Z',
            kind: 'tds',
          },
        ],
      });
      unpinned();
      await renderHome();
      const c = card('Recent chats');
      await c.findByText('Earlier one');
      expect(c.getAllByRole('listitem').map((r) => r.querySelector('.line-title')?.textContent)).toEqual([
        'No id yet',
        'Earlier one',
        'Open one',
      ]);
      expect(c.queryByRole('button', { name: 'Pin: No id yet' })).toBeNull();
      expect(c.getByRole('button', { name: 'Pin: Open one' }).getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(c.getByRole('button', { name: /^Earlier one/ }));
      await waitFor(() => expect(api.sessions).toHaveBeenCalled());
    });

    it('says so when empty, and is not narrowed by Working on', async () => {
      api.sessions.mockResolvedValue({ live: [], past: [] });
      await renderHome();
      expect(await card('Recent chats').findByText('No chats yet.')).toBeTruthy();
      expect(card('Recent chats').getByRole('button', { name: 'All chats' })).toBeTruthy();
      cleanup();
      withProject();
      projectChoice.set('northwind/site');
      api.sessions.mockResolvedValue({ live: [chat('s1', 'Any project', 'working')], past: [] });
      await renderHome();
      expect(await card('Recent chats').findByText('Any project')).toBeTruthy();
    });

    it('a star press flips the star and the row stays', async () => {
      api.sessions.mockResolvedValue({ live: [chat('s1', 'Open one', 'working')], past: [] });
      unpinned();
      api.updatePrefs.mockImplementation(async (p: object) => ({ ...boot.prefs, ...p }));
      await renderHome();
      const star = await card('Recent chats').findByRole('button', { name: 'Pin: Open one' });
      expect(star.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(star);
      await waitFor(() =>
        expect(
          card('Recent chats').getByRole('button', { name: 'Pin: Open one' }).getAttribute('aria-pressed'),
        ).toBe('true'),
      );
      expect(card('Recent chats').getAllByRole('listitem')).toHaveLength(1);
    });
  });

  describe.each([
    {
      name: 'Recent documents',
      kind: 'document' as const,
      call: 'doc',
      all: 'All documents',
      none: 'Documents you change show here.',
      noneIn: "You haven't changed any documents in this project.",
      failed: "Couldn't load recent documents.",
      view: 'Documents',
    },
    {
      name: 'Recent images',
      kind: 'image' as const,
      call: 'image',
      all: 'All images',
      none: 'Images you change show here.',
      noneIn: "You haven't changed any images in this project.",
      failed: "Couldn't load recent images.",
      view: 'Images',
    },
  ])('$name', ({ name, kind, all, none, noneIn, failed, view }) => {
    const askedFor = (project?: string) =>
      api.libraryRecent.mock.calls.filter((c) => c[0] === kind && c[1] === project);

    it('lists rows with the place and change date, opens the viewer, and has an All button', async () => {
      api.libraryRecent.mockImplementation(async (k: string) => ({
        files: k === kind ? [rfile('f1', 'Newest file', kind), rfile('f2', 'Second file', kind)] : [],
        partial: false,
      }));
      await renderHome();
      const c = card(name);
      await c.findByText('Newest file');
      expect(c.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
        'Newest fileChanged 24 Nov, Acme Heating',
        'Second fileChanged 24 Nov, Acme Heating',
      ]);
      fireEvent.click(c.getByRole('button', { name: /^Newest file/ }));
      expect(await screen.findByRole('heading', { level: 2, name: 'Newest file' })).toBeTruthy();
      cleanup();
      await renderHome();
      fireEvent.click(card(name).getByRole('button', { name: all }));
      await screen.findByRole('heading', { level: 1, name: view });
    });

    it('says so when empty and when the server is older (404)', async () => {
      await renderHome();
      expect(await card(name).findByText(none)).toBeTruthy();
      cleanup();
      api.libraryRecent.mockRejectedValue(new Error('404'));
      await renderHome();
      expect(await card(name).findByText(failed)).toBeTruthy();
    });

    it('asks for the project when Working on is set, and says so when empty there', async () => {
      withProject();
      projectChoice.set('northwind/site');
      await renderHome();
      expect(await card(name).findByText(noneIn)).toBeTruthy();
      expect(askedFor('northwind/site').length).toBeGreaterThan(0);
    });

    it('makes no request while hidden', async () => {
      api.bootstrap.mockResolvedValue({
        ...boot,
        prefs: {
          ...boot.prefs,
          homeHidden: [kind === 'document' ? 'recent-documents' : 'recent-images'],
          homeShortcuts: [],
        },
      });
      await renderHome();
      await card('Pinned tasks').findByText('Write the call tracking case');
      expect(api.libraryRecent.mock.calls.filter((c) => c[0] === kind)).toHaveLength(0);
      expect(api.libraryRecent.mock.calls.length).toBeGreaterThan(0);
    });

    it('keeps the loading note and asks again while the answer is partial', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let n = 0;
        api.libraryRecent.mockImplementation(async (k: string) => {
          if (k !== kind) return { files: [], partial: false };
          n += 1;
          return n === 1
            ? { files: [], partial: true }
            : { files: [rfile('f1', 'Arrived late', kind)], partial: false };
        });
        await renderHome();
        await waitFor(() => expect(n).toBe(1));
        expect(card(name).getByText('Loading…')).toBeTruthy();
        expect(card(name).queryByText(none)).toBeNull();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });
        expect(await card(name).findByText('Arrived late')).toBeTruthy();
        expect(n).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops a late reply for an older project', async () => {
      let release: (v: unknown) => void = () => {};
      api.libraryRecent.mockImplementation((k: string, project?: string) =>
        k !== kind
          ? Promise.resolve({ files: [], partial: false })
          : project === 'northwind/site'
            ? new Promise((r) => {
                release = r;
              })
            : Promise.resolve({ files: [rfile('g1', 'Other project file', kind)], partial: false }),
      );
      withProject();
      projectChoice.set('northwind/site');
      await renderHome();
      await waitFor(() => expect(askedFor('northwind/site').length).toBe(1));
      act(() => projectChoice.set(''));
      expect(await card(name).findByText('Other project file')).toBeTruthy();
      await act(async () => {
        release({ files: [rfile('f9', 'Stale file', kind)], partial: false });
      });
      expect(card(name).queryByText('Stale file')).toBeNull();
      expect(card(name).getByText('Other project file')).toBeTruthy();
    });

    it('shows five rows and Show N more, at most 20', async () => {
      api.libraryRecent.mockImplementation(async (k: string) => ({
        files: k === kind ? Array.from({ length: 20 }, (_, i) => rfile(`f${i}`, `File ${i}`, kind)) : [],
        partial: false,
      }));
      await renderHome();
      const c = card(name);
      await c.findByText('File 0');
      expect(c.getAllByRole('listitem')).toHaveLength(5);
      fireEvent.click(c.getByRole('button', { name: /Show 15 more/ }));
      expect(c.getAllByRole('listitem')).toHaveLength(20);
    });

    it("shows the error, not the old project's files, when the new project's request fails", async () => {
      withProject();
      api.libraryRecent.mockImplementation(async (k: string, project?: string) => {
        if (k !== kind) return { files: [], partial: false };
        if (project === 'northwind/site') throw new Error('500');
        return { files: [rfile('g1', 'Old project file', kind)], partial: false };
      });
      await renderHome();
      expect(await card(name).findByText('Old project file')).toBeTruthy();
      act(() => projectChoice.set('northwind/site'));
      expect(await card(name).findByText(failed)).toBeTruthy();
      expect(card(name).queryByText('Old project file')).toBeNull();
    });

    it('shows the error when a partial empty answer is followed by a failure', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let n = 0;
        api.libraryRecent.mockImplementation(async (k: string) => {
          if (k !== kind) return { files: [], partial: false };
          n += 1;
          if (n === 1) return { files: [], partial: true };
          throw new Error('500');
        });
        await renderHome();
        await waitFor(() => expect(n).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });
        expect(await card(name).findByText(failed)).toBeTruthy();
        expect(card(name).queryByText(none)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows the error, and stops asking, when every retry is still partial and empty', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let n = 0;
        api.libraryRecent.mockImplementation(async (k: string) => {
          if (k === kind) n += 1;
          return { files: [], partial: true };
        });
        await renderHome();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(await card(name).findByText(failed)).toBeTruthy();
        expect(card(name).queryByText(none)).toBeNull();
        expect(n).toBe(6);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(n).toBe(6);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops asking again once the card is hidden', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let n = 0;
        api.libraryRecent.mockImplementation(async (k: string) => {
          if (k === kind) n += 1;
          return { files: [], partial: true };
        });
        await renderHome();
        await waitFor(() => expect(n).toBe(1));
        api.bootstrap.mockResolvedValue({
          ...boot,
          prefs: {
            ...boot.prefs,
            homeHidden: [kind === 'document' ? 'recent-documents' : 'recent-images'],
            homeShortcuts: [],
          },
        });
        act(() =>
          FakeEventSource.last?.onmessage?.({
            data: JSON.stringify({ kind: 'app', event: { type: 'brain-changed', area: 'clients' } }),
          }),
        );
        await waitFor(() =>
          expect(card('Pinned tasks').queryByText('Pin a task to keep it here.')).toBeNull(),
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(n).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks again when the library changes', async () => {
      await renderHome();
      await waitFor(() => expect(askedFor(undefined).length).toBe(1));
      act(() =>
        FakeEventSource.last?.onmessage?.({
          data: JSON.stringify({ kind: 'app', event: { type: 'brain-changed', area: 'library' } }),
        }),
      );
      await waitFor(() => expect(askedFor(undefined).length).toBe(2));
    });

    it('a star press keeps the row where it was on screen', async () => {
      api.libraryRecent.mockImplementation(async (k: string) => ({
        files: k === kind ? [rfile('f1', 'Keeps place', kind)] : [],
        partial: false,
      }));
      api.updatePrefs.mockImplementation(async (p: object) => ({ ...boot.prefs, ...p }));
      await renderHome();
      const star = await card(name).findByRole('button', { name: 'Pin: Keeps place' });
      const scroller = document.querySelector('.home-scroll') as HTMLElement;
      scroller.scrollTop = 100;
      // The first reading is the press; every later one is after the row's twin grew above it.
      let reads = 0;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        if (!this.matches('[data-star-id="f1"]')) return { top: 0 } as DOMRect;
        reads += 1;
        return { top: reads === 1 ? 300 : 340 } as DOMRect;
      });
      try {
        fireEvent.click(star);
        await waitFor(() =>
          expect(
            card(name).getByRole('button', { name: 'Pin: Keeps place' }).getAttribute('aria-pressed'),
          ).toBe('true'),
        );
        expect(scroller.scrollTop).toBe(140);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('a star press keeps the row in place once the Pinned files lookup returns', async () => {
      api.libraryRecent.mockImplementation(async (k: string) => ({
        files: k === kind ? [rfile('f1', 'Keeps place', kind)] : [],
        partial: false,
      }));
      api.updatePrefs.mockImplementation(async (p: object) => ({ ...boot.prefs, ...p }));
      let finish: (v: { files: unknown[] }) => void = () => {};
      api.libraryItems.mockImplementation(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      );
      await renderHome();
      const star = await card(name).findByRole('button', { name: 'Pin: Keeps place' });
      const scroller = document.querySelector('.home-scroll') as HTMLElement;
      scroller.scrollTop = 100;
      // The row only moves once Pinned files has its new row, after the lookup returns.
      let moved = false;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        if (!this.matches('[data-star-id="f1"]')) return { top: 0 } as DOMRect;
        return { top: moved ? 340 : 300 } as DOMRect;
      });
      try {
        fireEvent.click(star);
        await waitFor(() =>
          expect(
            card(name).getByRole('button', { name: 'Pin: Keeps place' }).getAttribute('aria-pressed'),
          ).toBe('true'),
        );
        await waitFor(() => expect(api.libraryItems).toHaveBeenCalledWith(['f1']));
        expect(scroller.scrollTop).toBe(100);
        moved = true;
        await act(async () => {
          finish({ files: [rfile('f1', 'Keeps place', kind)] });
        });
        expect(scroller.scrollTop).toBe(140);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('a star press flips the star and the row stays', async () => {
      api.libraryRecent.mockImplementation(async (k: string) => ({
        files: k === kind ? [rfile('f1', 'Starred later', kind)] : [],
        partial: false,
      }));
      api.updatePrefs.mockImplementation(async (p: object) => ({ ...boot.prefs, ...p }));
      await renderHome();
      const star = await card(name).findByRole('button', { name: 'Pin: Starred later' });
      expect(star.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(star);
      await waitFor(() =>
        expect(
          card(name).getByRole('button', { name: 'Pin: Starred later' }).getAttribute('aria-pressed'),
        ).toBe('true'),
      );
      expect(card(name).getAllByRole('listitem')).toHaveLength(1);
    });
  });
});

describe('Home: Task updates', () => {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const note = (by: string, byName: string, minutes: number, text = 'Sent it over') => ({
    kind: 'note' as const,
    at: ago(minutes),
    by,
    byName,
    text,
    via: null,
    action: null,
  });
  const held = (id: string, title: string, updates: ReturnType<typeof note>[]): TodoItem => ({
    ...todo(id, title, null),
    updates,
  });
  const askedTask = (id: string, title: string, over: Partial<AskedTodo> = {}): AskedTodo => ({
    key: `asked:todo/${id}`,
    id,
    state: 'waiting',
    path: `todo/${id}`,
    title,
    assignee: 'ben-mcadam',
    assigneeName: 'Ben McAdam',
    due: null,
    details: '',
    asked: { slug: 'sam-example', name: 'Sam Example', at: ago(60 * 24), source: 'stamp' },
    done: null,
    version: 'v1',
    attachments: [],
    ...over,
  });
  const withUpdates = (mine: TodoItem[], waiting: AskedTodo[] = [], done: AskedTodo[] = []) => {
    api.todos.mockResolvedValue({ mine, open: [], othersCount: 0, team: [] });
    api.askedTodos.mockResolvedValue({ waiting, done, historyRead: true });
  };

  it('lists held and asked tasks newest first, with the change line, and who has an asked one', async () => {
    withUpdates(
      [
        held('h1.md', 'Held old', [
          note('ben-mcadam', 'Ben McAdam', 300),
          note('ben-mcadam', 'Ben McAdam', 200),
        ]),
        held('h-own.md', 'My own note', [note('sam-example', 'Sam Example', 5)]),
      ],
      [askedTask('a1.md', 'Asked newest', { updates: [note('ben-mcadam', 'Ben McAdam', 10)] })],
    );
    await renderHome();
    const c = card('Task updates');
    await c.findByText('Asked newest');
    const rows = c.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(
      /^Asked newestWith Ben · Ben McAdam added an update · Today, \d\d:\d\d$/,
    );
    expect(rows[1]?.textContent).toMatch(
      /^Held oldBen McAdam added an update · (Today|Yesterday), \d\d:\d\d and 1 more$/,
    );
    expect(c.queryByText('My own note')).toBeNull();
    expect(screen.getByText(/and 2 tasks have updates\.$/)).toBeTruthy();
  });

  it('says so when empty and has an All tasks button that opens the drawer', async () => {
    await renderHome();
    expect(
      await card('Task updates').findByText('Updates from teammates on your tasks show here.'),
    ).toBeTruthy();
    expect(screen.queryByText(/have updates|has an update/)).toBeNull();
    fireEvent.click(card('Task updates').getByRole('button', { name: 'All tasks' }));
    await waitFor(() =>
      expect(
        within(document.getElementById('drawer') as HTMLElement).getByRole('heading', { name: 'Tasks' }),
      ).toBeTruthy(),
    );
  });

  it('puts the summary part for one task as "one task has an update"', async () => {
    withUpdates([held('h1.md', 'Held one', [note('ben-mcadam', 'Ben McAdam', 30)])]);
    await renderHome();
    expect(await screen.findByText(/and one task has an update\.$/)).toBeTruthy();
  });

  it('opens a held task in the panel and marks it looked', async () => {
    withUpdates([held('h1.md', 'Held one', [note('ben-mcadam', 'Ben McAdam', 30)])]);
    await renderHome();
    fireEvent.click(await card('Task updates').findByRole('button', { name: /Held one/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() =>
      expect(api.updatePrefs.mock.calls.some((c) => JSON.stringify(c).includes('h1.md'))).toBe(true),
    );
  });

  it('opens an asked task in the panel and marks it looked', async () => {
    withUpdates([], [askedTask('a1.md', 'Asked one', { updates: [note('ben-mcadam', 'Ben McAdam', 30)] })]);
    await renderHome();
    fireEvent.click(await card('Task updates').findByRole('button', { name: /Asked one/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() =>
      expect(api.updatePrefs.mock.calls.some((c) => JSON.stringify(c).includes('a1.md'))).toBe(true),
    );
  });

  it('shows a finished asked task as marked done, without a "With" prefix', async () => {
    withUpdates(
      [],
      [],
      [
        askedTask('d1.md', 'Finished one', {
          key: 'asked:todo/done/d1.md',
          state: 'done',
          done: { slug: 'ben-mcadam', name: 'Ben McAdam', at: ago(20), source: 'stamp' },
        }),
      ],
    );
    await renderHome();
    const row = (await card('Task updates').findByText('Finished one')).closest('li') as HTMLElement;
    expect(row.textContent).toMatch(/^Finished oneBen McAdam marked it as done · /);
  });

  it('shows "Show more" past the usual rows', async () => {
    withUpdates(
      Array.from({ length: 7 }, (_, i) =>
        held(`h${i}.md`, `Held ${i}`, [note('ben-mcadam', 'Ben McAdam', 10 + i)]),
      ),
    );
    await renderHome();
    const c = card('Task updates');
    await c.findByText('Held 0');
    expect(c.getAllByRole('listitem')).toHaveLength(PINNED_ROWS);
    fireEvent.click(c.getByRole('button', { name: /Show .* more/ }));
    expect(c.getAllByRole('listitem')).toHaveLength(7);
  });

  it('can be hidden', async () => {
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, homeHidden: ['task-updates'], homeShortcuts: [] },
    });
    await renderHome();
    await card('Pinned tasks').findByText('Write the call tracking case');
    expect(screen.queryByRole('region', { name: 'Task updates' })).toBeNull();
  });
});
