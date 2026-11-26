// @vitest-environment jsdom
// The unsent chat in the chat drawer (plan 2026-11-26-project-chat-in-place, decisions 6, 8, 9): the real store, shell
// and message box, with the API mocked.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickerText, pickOption } from '../test/pick.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  sendMessage: vi.fn(),
  clientGuess: vi.fn(),
  clientPickOutcome: vi.fn(async () => ({})),
  updatePrefs: vi.fn(),
  projects: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
  uploadFile: vi.fn(),
  discardUpload: vi.fn(),
}));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

const { StoreProvider, useStore } = await import('../store.tsx');
const { ShellProvider } = await import('./ShellProvider.tsx');
const { ChatDrawer } = await import('./ChatDrawer.tsx');
const { projectsStore } = await import('../state/projects.ts');

type StoreApi = ReturnType<typeof useStore>;
let store: StoreApi;
function Probe() {
  store = useStore();
  return null;
}

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [
    { slug: 'acme', name: 'Acme Heating' },
    { slug: 'northwind', name: 'Northwind' },
  ],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};

const card = (key: string, client: string | null, title: string) => ({
  key,
  space: client === null ? 'personal' : 'client',
  slug: key.split('/')[1],
  client,
  folder: `clients/${client}/projects/${key.split('/')[1]}`,
  archived: false,
  status: 'active',
  title,
});
const PROJECTS = 'app:projects';
const live = (id: string) => ({
  id,
  sdkSessionId: null,
  title: 'New chat',
  client: 'acme',
  project: 'acme/site',
  todoId: null,
  state: 'working',
  startedAt: '',
  lastActivityAt: '',
  kind: 'tds',
});

async function open(over: Parameters<StoreApi['newChat']>[0] = {}) {
  render(
    <StoreProvider>
      <ShellProvider>
        <Probe />
        <ChatDrawer />
      </ShellProvider>
    </StoreProvider>,
  );
  await waitFor(() => expect(store?.boot).not.toBeNull());
  act(() => store.openView(PROJECTS));
  act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme', ...over }));
  await screen.findByRole('region', { name: 'New chat' });
  await waitFor(() => expect(api.projects).toHaveBeenCalled());
  await act(async () => {});
}
const box = () => screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.input(box(), { target: { value } });
const hide = () => fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('innerWidth', 1600);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
  api.projects.mockResolvedValue({
    projects: [card('acme/site', 'acme', 'Site rebuild'), card('personal/diary', null, 'Diary')],
    duplicates: [],
  });
  api.startSession.mockResolvedValue({ session: live('s9') });
});
afterEach(() => {
  projectsStore.reset();
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('the unsent chat in the drawer', () => {
  it('has the New chat header with the project chip, both pickers filled and the empty-state line', async () => {
    await open();
    const region = screen.getByRole('region', { name: 'New chat' });
    expect(within(region).getByRole('heading', { level: 2, name: 'New chat' })).toBeTruthy();
    await waitFor(() => expect(region.querySelector('.chip')?.textContent).toBe('Site rebuild'));
    expect(region.querySelector('.chip')?.getAttribute('data-tip')).toBe('Acme Heating · Site rebuild');
    expect(pickerText('Project')).toBe('Site rebuild');
    expect(pickerText('Chat for')).toBe('Acme Heating');
    expect(screen.queryByRole('combobox', { name: 'Working on' })).toBeNull();
    expect(
      within(region).getByRole('heading', { level: 3, name: 'What would you like to do?' }),
    ).toBeTruthy();
    expect(within(region).getByText('Nothing is sent until you press Send.')).toBeTruthy();
    expect(document.activeElement).toBe(box());
  });

  it('Hide with text asks; Keep writing keeps the text and the drawer', async () => {
    await open();
    type('Half a thought');
    hide();
    const ask = await screen.findByRole('group', { name: 'Discard your message' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep writing' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Discard your message' })).toBeNull());
    expect(store.newChatDrawer).not.toBeNull();
    expect(box().value).toBe('Half a thought');
    // Discard closes it.
    hide();
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Discard your message' })).getByRole('button', {
        name: 'Discard message',
      }),
    );
    await waitFor(() => expect(store.newChatDrawer).toBeNull());
    expect(screen.queryByRole('region', { name: 'New chat' })).toBeNull();
  });

  it('Hide with an empty box closes it without asking', async () => {
    await open();
    hide();
    await waitFor(() => expect(store.newChatDrawer).toBeNull());
    expect(screen.queryByRole('group', { name: 'Discard your message' })).toBeNull();
  });

  it('Hide puts focus back on the button that opened the drawer', async () => {
    render(
      <StoreProvider>
        <ShellProvider>
          <Probe />
          <button type="button">Opener</button>
          <ChatDrawer />
        </ShellProvider>
      </StoreProvider>,
    );
    await waitFor(() => expect(store?.boot).not.toBeNull());
    act(() => store.openView(PROJECTS));
    const opener = screen.getByRole('button', { name: 'Opener' });
    act(() => opener.focus());
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme' }));
    await screen.findByRole('region', { name: 'New chat' });
    await waitFor(() => expect(document.activeElement).toBe(box()));
    hide();
    await waitFor(() => expect(store.newChatDrawer).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('Open full screen carries the text and both picks to Home', async () => {
    await open();
    pickOption('Project', 'Diary');
    expect(pickerText('Chat for')).toBe('No client');
    type('Carry me');
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    await waitFor(() => expect(store.newChatDrawer).toBeNull());
    expect(store.view).toBe('chat');
    expect(store.activeChat).toMatchObject({
      kind: 'new',
      in: 'sheet',
      scope: 'chat',
      draft: 'Carry me',
      picks: { project: 'personal/diary', client: '@none' },
    });
  });

  it('a Which client is this for? answer sends, and the chat stays in the drawer', async () => {
    api.clientGuess.mockResolvedValue({ kind: 'ask', options: ['acme', 'northwind'] });
    await open({ project: undefined, client: undefined });
    pickOption('Chat for', 'Auto');
    type('Vague request');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const ask = await screen.findByRole('group', { name: 'Which client is this for?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Northwind' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Vague request', client: 'northwind' });
    await waitFor(() => expect(store.chatDrawer).toBe('s9'));
    expect(store.view).toBe(PROJECTS);
    expect(store.newChatDrawer).toBeNull();
  });

  it('keeps one frame across Send, and focus lands in the live chat box', async () => {
    await open();
    const frame = document.querySelector('.chat-drawer');
    expect(frame).toBeTruthy();
    type('Go');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(store.chatDrawer).toBe('s9'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'New chat', level: 2 })).toBeNull());
    expect(document.querySelector('.chat-drawer')).toBe(frame);
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it('after Send, leaving while the chat starts asks nothing and the chat does not follow', async () => {
    let started: (v: { session: ReturnType<typeof live> }) => void = () => {};
    api.startSession.mockReturnValueOnce(new Promise((resolve) => (started = resolve)));
    await open();
    type('Go');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    // The text is still in the box while it starts, but it has been sent: there is nothing to discard.
    act(() => store.openView('settings'));
    expect(screen.queryByRole('group', { name: 'Discard your message' })).toBeNull();
    expect(store.view).toBe('settings');
    await act(async () => started({ session: live('s9') }));
    expect(store.view).toBe('settings');
    expect(store.chatDrawer).toBeNull();
    expect(document.querySelector('.chat-drawer')).toBeNull();
  });

  it('a second chat opened while the first starts still asks before its text goes', async () => {
    let started: (v: { session: ReturnType<typeof live> }) => void = () => {};
    api.startSession.mockReturnValueOnce(new Promise((resolve) => (started = resolve)));
    await open();
    type('First');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    hide();
    await waitFor(() => expect(store.newChatDrawer).toBeNull());
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme' }));
    await screen.findByRole('region', { name: 'New chat' });
    type('Second');
    act(() => store.openView('settings'));
    expect(screen.getByRole('group', { name: 'Discard your message' })).toBeTruthy();
    expect(store.view).toBe(PROJECTS);
    await act(async () => started({ session: live('s9') }));
    expect(box().value).toBe('Second');
    expect(store.chatDrawer).toBeNull();
  });

  it('Open full screen between Send and the start is held, so the message cannot be sent twice', async () => {
    let started: (v: { session: ReturnType<typeof live> }) => void = () => {};
    api.startSession.mockReturnValueOnce(new Promise((resolve) => (started = resolve)));
    await open();
    type('Go');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(store.view).toBe(PROJECTS);
    expect(store.newChatDrawer).not.toBeNull();
    expect(screen.getByText('Your message is sending. Try again in a moment.')).toBeTruthy();
    await act(async () => started({ session: live('s9') }));
    await waitFor(() => expect(store.chatDrawer).toBe('s9'));
    expect(screen.queryByText('Your message is sending. Try again in a moment.')).toBeNull();
  });

  it('the sending note goes when a start fails and does not come back on the next Send', async () => {
    const note = 'Your message is sending. Try again in a moment.';
    let fail: (e: Error) => void = () => {};
    api.startSession.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    await open();
    type('Go');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(screen.getByText(note)).toBeTruthy();
    await act(async () => fail(new Error('Four chats are already running.')));
    await waitFor(() => expect(screen.queryByText(note)).toBeNull());
    api.startSession.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(note)).toBeNull();
  });

  it('repeats a refused start in its own status line', async () => {
    api.startSession.mockRejectedValue(new Error('Four chats are already running.'));
    await open();
    type('Go');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(document.querySelector('.chat-drawer .home-status')?.textContent).not.toBe(''),
    );
    expect(store.newChatDrawer).not.toBeNull();
  });
});
