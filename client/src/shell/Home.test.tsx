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
  startSession: vi.fn(),
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
const { clientChoice, NO_CLIENT } = await import('../state/client-choice.ts');

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
  title,
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
    expect(needs.getByRole('button', { name: '1 more to-do' })).toBeTruthy();
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
    await screen.findByText('Nothing due today or tomorrow.');
    expect(screen.getByRole('button', { name: 'See all 1 to-do' })).toBeTruthy();
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

  it('sends the first message with the chosen client', async () => {
    const box = await renderHome();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'northwind' } });
    fireEvent.change(box, { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello there', client: 'northwind' });
  });

  it('choosing a client on Home is remembered for the apps, and "No client" is too', async () => {
    await renderHome();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'northwind' } });
    expect(clientChoice.get()).toBe('client:northwind');
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '' } });
    expect(clientChoice.get()).toBe(NO_CLIENT);
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('');
  });

  it('opens on the client chosen in an app', async () => {
    clientChoice.set('client:northwind');
    await renderHome();
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('northwind');
  });

  it('opens on "No client" when the person\'s own files were chosen in an app', async () => {
    clientChoice.set('personal');
    await renderHome();
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('');
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
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0]).toMatchObject({ todoId: 't-today.md' });
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
    fireEvent.click(screen.getByRole('button', { name: 'All to-dos' }));
    await waitFor(() => expect(drawer().hasAttribute('inert')).toBe(false));
    expect(within(drawer()).getByRole('heading', { name: 'To-dos' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All chats' }));
    await waitFor(() => expect(within(drawer()).getByRole('heading', { name: 'Chats' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'All skills' }));
    await waitFor(() => expect(within(drawer()).getByRole('heading', { name: 'Skills' })).toBeTruthy());
  });

  it('"N more to-dos" opens the To-dos drawer', async () => {
    await renderHome();
    fireEvent.click(await card('Needs you').findByRole('button', { name: '1 more to-do' }));
    await waitFor(() =>
      expect((document.getElementById('drawer') as HTMLElement).hasAttribute('inert')).toBe(false),
    );
  });
});
