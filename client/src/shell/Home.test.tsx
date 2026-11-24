// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LibraryItem,
  LibraryScope,
  LiveSession,
  SkillInfo,
  TodoItem,
} from '../../../shared/contract.ts';
import { openPicker, pickOption } from '../test/pick.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
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
  identity: { name: 'Sam Example', slug: 'sam-example', email: null, role: 'team', knownMember: true },
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
    tourSeen: 1,
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
  fireEvent.click(await card('Favourite to-dos').findByRole('button', { name: title }));
  const panel = await screen.findByRole('dialog');
  fireEvent.click(within(panel).getByRole('button', { name: /^(Start a chat|Open chat)$/ }));
};

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue(todoList);
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
    await screen.findByText('One to-do is overdue, one is due today and one chat is waiting for you.');

    const needs = card('Favourite to-dos');
    expect(needs.getByText('2')).toBeTruthy();
    expect(needs.getByText('Write the call tracking case')).toBeTruthy();
    expect(needs.getByText('overdue by 2 days').className).toBe('late');
    expect(needs.getByText('Acme Heating').className).toBe('');
    expect(needs.getByText('due today').className).toBe('');
    // Home lists what is pinned, not what is due: a to-do that is not starred stays off it.
    expect(needs.queryByText('Plan the quarter')).toBeNull();
    expect(needs.queryByRole('checkbox')).toBeNull();

    const chats = card('Favourite chats');
    expect(chats.getByText('Monthly reports check')).toBeTruthy();
    expect(chats.getByText('Needs your answer')).toBeTruthy();
    expect(chats.getByText('Working')).toBeTruthy();

    const skills = card('Favourite skills');
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
    expect(await screen.findByText('Favourite a to-do to keep it here.')).toBeTruthy();
    expect(screen.getByText('Favourite a chat to keep it here.')).toBeTruthy();
    expect(await screen.findByText('Favourite a file to keep it here.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Favourite skills' })).toBeTruthy();
    expect(screen.getByText('Favourite a skill to keep it here.')).toBeTruthy();
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
    expect(card('Favourite to-dos').getByText('Loading…')).toBeTruthy();
    expect(card('Favourite chats').getByText('Loading…')).toBeTruthy();
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
    fireEvent.click(card('Favourite skills').getByRole('button', { name: 'Meeting notes' }));
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
      fireEvent.click(card('Favourite skills').getByRole('button', { name: 'Meeting notes' }));
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

  it("a to-do chat opens on the to-do's client; a personal to-do on No client", async () => {
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

  it("a to-do's client beats Working on's, and isn't credited to it", async () => {
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

  it("starts a chat from a to-do's panel and keeps the to-do link", async () => {
    const box = (await renderHome()) as HTMLTextAreaElement;
    await startChatFromPanel(/^Check the monthly reports/);
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value).toBe(
        'Help me with this to-do: todo/t-today.md (Check the monthly reports)',
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

  it('marks a to-do passed to you as seen when it is opened from Home', async () => {
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
    fireEvent.click(await card('Favourite to-dos').findByRole('button', { name: /^Fresh from Ben/ }));
    await waitFor(() => expect(api.updatePrefs).toHaveBeenCalledWith({ todoSeen: { 't-new.md': at } }));
  });

  it('opens the live chat for a to-do that already has one', async () => {
    await renderHome();
    await startChatFromPanel(/^Write the call tracking case/);
    await screen.findByRole('heading', { level: 1, name: 'Call tracking case' });
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('opens a chat from the Pinned chats card', async () => {
    await renderHome();
    fireEvent.click(await card('Favourite chats').findByRole('button', { name: /^Monthly reports check/ }));
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
    const files = card('Favourite files');
    await files.findByText('Newer plan');
    const rows = files.getAllByRole('listitem');
    expect(api.libraryItems).toHaveBeenCalledWith(['f2', 'f1']);
    expect(rows.map((r) => r.textContent)).toEqual(['Newer planAcme Heating', 'Older planAcme Heating']);
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: /^Newer plan/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Newer plan' })).toBeTruthy();
  });

  it('shows five pinned to-dos, and "Show N more" expands the card in place and back', async () => {
    const mine = Array.from({ length: 7 }, (_, i) => todo(`m${i}.md`, `To-do ${i}`, null));
    api.todos.mockResolvedValue({ ...todoList, mine });
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, favouriteTodos: mine.map((t) => t.key) },
    });
    await renderHome();
    const card1 = card('Favourite to-dos');
    await card1.findByText('To-do 4');
    expect(card1.queryByText('To-do 5')).toBeNull();
    const more = card1.getByRole('button', { name: 'Show 2 more to-dos' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(card1.getByText('To-do 5')).toBeTruthy();
    expect(card1.getByText('To-do 6')).toBeTruthy();
    expect(more.textContent).toBe('Show fewer to-dos'); // "to-dos" is visually hidden
    expect(more.getAttribute('aria-expanded')).toBe('true');
    // It no longer opens the drawer (which did nothing visible when the drawer was already open).
    expect(screen.queryByRole('heading', { name: 'To-dos' })).toBeNull();
    fireEvent.click(more);
    expect(card1.queryByText('To-do 5')).toBeNull();
    expect(more.textContent).toBe('Show 2 more to-dos');
  });

  it('says "1 more to-do", not "1 more to-dos"', async () => {
    const mine = Array.from({ length: 6 }, (_, i) => todo(`m${i}.md`, `To-do ${i}`, null));
    api.todos.mockResolvedValue({ ...todoList, mine });
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, favouriteTodos: mine.map((t) => t.key) },
    });
    await renderHome();
    const card1 = card('Favourite to-dos');
    expect(await card1.findByRole('button', { name: 'Show 1 more to-do' })).toBeTruthy();
  });

  it('keeps focus in the card when the last favourite to-do is taken off it', async () => {
    const only = todo('m0.md', 'Only favourite', null);
    api.todos.mockResolvedValue({ ...todoList, mine: [only] });
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, favouriteTodos: [only.key] } });
    api.updatePrefs.mockResolvedValue({ ...boot.prefs, favouriteTodos: [] });
    await renderHome();
    const star = await card('Favourite to-dos').findByRole('button', { name: 'Favourite: Only favourite' });
    star.focus();
    fireEvent.click(star);
    await card('Favourite to-dos').findByText('Favourite a to-do to keep it here.', { exact: false });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Favourite to-dos' })),
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
    fireEvent.click(await card('Favourite chats').findByRole('button', { name: /^Last week plan/ }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith({ resume: sid }));
  });

  it('starts a pinned skill', async () => {
    await renderHome();
    fireEvent.click(card('Favourite skills').getByRole('button', { name: 'Meeting notes' }));
    await screen.findByText('Meeting notes', { selector: 'strong' });
  });

  it('"All to-dos", "All chats" and "All skills" open their drawers', async () => {
    api.bootstrap.mockResolvedValue({ ...boot, identity: { ...boot.identity, role: 'owner' } });
    await renderHome();
    const drawer = () => document.getElementById('drawer') as HTMLElement;
    expect(drawer().hasAttribute('inert')).toBe(true);
    for (const name of ['All to-dos', 'All chats', 'All skills']) {
      expect(screen.getByRole('button', { name }).getAttribute('data-size')).toBe('small');
    }
    fireEvent.click(screen.getByRole('button', { name: 'All to-dos' }));
    await waitFor(() => expect(drawer().hasAttribute('inert')).toBe(false));
    expect(within(drawer()).getByRole('heading', { name: 'To-dos' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All chats' }));
    await waitFor(() => expect(within(drawer()).getByRole('heading', { name: 'Chats' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'All skills' }));
    await waitFor(() => expect(within(drawer()).getByRole('heading', { name: 'Skills' })).toBeTruthy());
  });

  it('has no "All skills" for someone the Skills drawer is not for (team)', async () => {
    await renderHome();
    expect(screen.queryByRole('button', { name: 'All skills' })).toBeNull();
    expect(screen.getByRole('button', { name: 'All chats' })).toBeTruthy();
  });
});
