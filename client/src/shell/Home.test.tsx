// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  startSession: vi.fn(),
  clientGuess: vi.fn(),
  close: vi.fn(),
  updatePrefs: vi.fn(),
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
const { clientChoice } = await import('../state/client-choice.ts');

const skill = (name: string, title: string): SkillInfo => ({
  name,
  title,
  description: '',
  kind: 'skill',
  maturity: 'live',
  argumentHint: null,
  restrictedTo: null,
});

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
  prefs: { pins: ['meeting-notes'], lastClient: null, todoPanelOpen: false, directWrites: false },
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
  sdkSessionId: null,
  title,
  client: null,
  todoId,
  state,
  startedAt: '',
  lastActivityAt: '2026-11-11T10:00:00.000Z',
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
});
afterEach(() => {
  clientChoice.set('');
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('Home', () => {
  it('shows the greeting, the summary and the three cards from boot data', async () => {
    await renderHome();
    expect(screen.getByText(/^Good (morning|afternoon|evening), Sam$/)).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await screen.findByText('One to-do is overdue, one is due today and one chat is waiting for you.');

    const needs = card('Needs you');
    expect(needs.getByText('2')).toBeTruthy();
    expect(needs.getByText('Write the call tracking case')).toBeTruthy();
    expect(needs.getByText('overdue by 2 days').className).toBe('late');
    expect(needs.getByText('Acme Heating').className).toBe('');
    expect(needs.getByText('due today').className).toBe('');
    expect(needs.queryByText('Plan the quarter')).toBeNull();
    expect(needs.queryByRole('button', { name: /more to-do/ })).toBeNull();
    expect(document.querySelector('.card-more')).toBeNull();
    expect(needs.queryByRole('checkbox')).toBeNull();

    const chats = card('Open chats');
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
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, pins: [] } });
    await renderHome();
    await screen.findByText('Nothing due today or tomorrow. 1 other to-do.');
    expect(screen.getByText('Nothing due today or tomorrow. 1 other to-do.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /See all/ })).toBeNull();
    expect(document.querySelector('.card-more')).toBeNull();
    expect(screen.getByText('No open chats.')).toBeTruthy();
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
    expect(card('Needs you').getByText('Loading')).toBeTruthy();
    expect(card('Open chats').getByText('Loading')).toBeTruthy();
  });

  const typeAndSend = (box: HTMLElement, value: string) => {
    fireEvent.change(box, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };
  const select = () => screen.getByLabelText('Client') as HTMLSelectElement;

  it('has no separate client row; the select sits in the composer foot and starts on auto', async () => {
    await renderHome();
    expect(document.querySelector('.home-client')).toBeNull();
    expect(select().closest('.composer-foot')).toBeTruthy();
    expect(select().value).toBe('@auto');
    expect([...select().options].map((o) => o.text)).toEqual([
      'Auto',
      'No client',
      'Acme Heating',
      'Northwind',
    ]);
  });

  it('a chosen client skips the guess and is sent', async () => {
    const box = await renderHome();
    fireEvent.change(select(), { target: { value: 'northwind' } });
    typeAndSend(box, 'Hello there');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello there', client: 'northwind' });
    expect(api.clientGuess).not.toHaveBeenCalled();
  });

  it('"No client" skips the guess and sends no client', async () => {
    const box = await renderHome();
    fireEvent.change(select(), { target: { value: '@none' } });
    typeAndSend(box, 'Hello there');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0].client).toBeNull();
    expect(api.clientGuess).not.toHaveBeenCalled();
  });

  it("does not read or write the apps' client choice, nor the last client", async () => {
    clientChoice.set('client:northwind');
    api.bootstrap.mockResolvedValue({ ...boot, prefs: { ...boot.prefs, lastClient: 'acme' } });
    await renderHome();
    expect(select().value).toBe('@auto');
    fireEvent.change(select(), { target: { value: 'acme' } });
    expect(clientChoice.get()).toBe('client:northwind');
  });

  it('auto: a sure guess starts the chat with that client', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'sure', client: 'acme', how: 'named' });
    const box = await renderHome();
    typeAndSend(box, 'Acme need a report');
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.clientGuess).toHaveBeenCalledWith({ text: 'Acme need a report' });
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Acme need a report', client: 'acme' });
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
  });

  it('"Another client…" lists every client and sends the one chosen', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: [] });
    const box = await renderHome();
    typeAndSend(box, 'Vague two');
    const group = await screen.findByRole('group', { name: 'Which client is this for?' });
    const other = within(group).getByLabelText('Another client') as HTMLSelectElement;
    expect([...other.options].map((o) => o.text)).toEqual(['Another client…', 'Acme Heating', 'Northwind']);
    const use = within(group).getByRole('button', { name: 'Use this client' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.change(other, { target: { value: 'acme' } });
    // Choosing in the list sends nothing by itself.
    expect(api.startSession).not.toHaveBeenCalled();
    expect(use.disabled).toBe(false);
    fireEvent.click(use);
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0].client).toBe('acme');
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
    expect(screen.getByText('Client', { selector: 'label' }).className).not.toContain('visually-hidden');
    expect(screen.getByText('Enter to send, Shift and Enter for a new line.')).toBeTruthy();
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
      fireEvent.click(await card('Needs you').findByRole('button', { name: /Check the monthly reports/ }));
      await waitFor(() =>
        expect(
          (screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value,
        ).toContain('Check the monthly reports'),
      );
      finish(kind === 'ask' ? { kind: 'ask', options: [] } : { kind: 'sure', client: 'acme', how: 'named' });
      await new Promise((r) => setTimeout(r, 20));
      expect(api.startSession).not.toHaveBeenCalled();
      expect(screen.queryByRole('group', { name: 'Which client is this for?' })).toBeNull();
      expect(
        (screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value,
      ).toContain('Check the monthly reports');
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
    fireEvent.click(await card('Needs you').findByRole('button', { name: /Acme thing/ }));
    await waitFor(() => expect(select().value).toBe('acme'));
    fireEvent.click(card('Needs you').getByRole('button', { name: /My own thing/ }));
    await waitFor(() => expect(select().value).toBe('@none'));
  });

  it('never sends /clear: it just empties the box', async () => {
    const box = (await renderHome()) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '/clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(box.value).toBe(''));
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('starts a chat from a to-do row and keeps the to-do link', async () => {
    const box = (await renderHome()) as HTMLTextAreaElement;
    fireEvent.click(await card('Needs you').findByRole('button', { name: /Check the monthly reports/ }));
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
    fireEvent.click(await card('Needs you').findByRole('button', { name: /Fresh from Ben/ }));
    await waitFor(() => expect(api.updatePrefs).toHaveBeenCalledWith({ todoSeen: { 't-new.md': at } }));
  });

  it('opens the live chat for a to-do that already has one', async () => {
    await renderHome();
    fireEvent.click(await card('Needs you').findByRole('button', { name: /Write the call tracking case/ }));
    await screen.findByRole('heading', { level: 1, name: 'Call tracking case' });
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('opens a chat from the Open chats card', async () => {
    await renderHome();
    fireEvent.click(await card('Open chats').findByRole('button', { name: /Monthly reports check/ }));
    await screen.findByRole('heading', { level: 1, name: 'Monthly reports check' });
  });

  it('starts a pinned skill', async () => {
    await renderHome();
    fireEvent.click(card('Pinned skills').getByRole('button', { name: 'Meeting notes' }));
    await screen.findByText('Meeting notes', { selector: 'strong' });
  });

  it('"All to-dos", "All chats" and "All skills" open their drawers', async () => {
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
});
