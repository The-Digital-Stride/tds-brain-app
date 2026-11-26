// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectChat, ProjectChatsResponse } from '../../../../shared/project-chats-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  openChat: vi.fn(),
  openPast: vi.fn(),
  sessions: null as unknown,
  boot: { identity: { slug: 'me' }, clients: [], prefs: { favouriteTodos: [] } },
  todos: { mine: [], open: [], othersCount: 0, team: [{ slug: 'me', name: 'Me' }], canProject: true },
}));
const api = vi.hoisted(() => ({ projectChats: vi.fn(), projects: vi.fn(), projectUnsavedChats: vi.fn() }));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {},
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ dispatch: vi.fn(), state: { todoPanel: null }, modes: { drawerOverlays: false } }),
}));

const { ProjectChats } = await import('./ProjectChats.tsx');
const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');

const ID = '11111111-2222-3333-4444-555555555555';
const chat = (over: Partial<ProjectChat> = {}): ProjectChat => ({
  chat: ID,
  title: 'Fix the redirects',
  lastActive: '2026-11-24T14:05:00Z',
  busy: false,
  saved: 'never',
  savedAt: null,
  ...over,
});
const reply = (chats: ProjectChat[], over: Partial<ProjectChatsResponse> = {}): ProjectChatsResponse => ({
  chats,
  canSave: true,
  more: false,
  ...over,
});
const past = (id: string, over: Record<string, unknown> = {}) => ({
  sdkSessionId: id,
  title: 'Fix the redirects',
  lastModified: '2026-11-24T14:05:00Z',
  kind: 'tds',
  project: 'skyseal/site',
  ...over,
});
const live = (id: string, sdk: string | null, over: Record<string, unknown> = {}) => ({
  id,
  sdkSessionId: sdk,
  title: 'Fix the redirects',
  state: 'idle',
  project: 'skyseal/site',
  ...over,
});

const props = (over: Partial<Parameters<typeof ProjectChats>[0]> = {}) => ({
  projectKey: 'skyseal/site',
  movedFrom: [],
  canStart: true,
  onSave: vi.fn(),
  ...over,
});

beforeEach(() => {
  store.sessions = { live: [], past: [past(ID)] };
  store.openPast.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectChats', () => {
  it('shows each saved state in the details line, as a drawer row', async () => {
    store.sessions = { live: [], past: ['a', 'b', 'c', 'd'].map((x) => past(x)) };
    api.projectChats.mockResolvedValue(
      reply([
        chat({ chat: 'a', saved: 'never' }),
        chat({ chat: 'b', saved: 'saved', savedAt: '2026-11-20T09:00:00Z' }),
        chat({ chat: 'c', saved: 'new', savedAt: '2026-11-20T09:00:00Z' }),
        chat({ chat: 'd', saved: null }),
      ]),
    );
    const { container } = render(<ProjectChats {...props()} />);
    expect(await screen.findByText('Your chats for this project')).toBeTruthy();
    expect(screen.getByText('Only you can see these. They stay on this Mac.')).toBeTruthy();
    expect(api.projectChats).toHaveBeenCalledWith('skyseal/site');
    expect(screen.getByText('Last active 24 Nov 2026 · not saved yet')).toBeTruthy();
    expect(screen.getByText('Last active 24 Nov 2026 · saved 20 Nov 2026')).toBeTruthy();
    expect(
      screen.getByText('Last active 24 Nov 2026 · new messages since you saved on 20 Nov 2026'),
    ).toBeTruthy();
    expect(screen.getByText('Last active 24 Nov 2026')).toBeTruthy();
    const row = container.querySelector('li.line > button.line-main > .line-text > .line-title');
    expect(row?.textContent).toBe('Fix the redirects');
  });

  it('says nothing about saving when saving is not possible', async () => {
    api.projectChats.mockResolvedValue(reply([chat()], { canSave: false }));
    render(<ProjectChats {...props()} />);
    expect(await screen.findByText('Last active 24 Nov 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save to project/ })).toBeNull();
  });

  it('offers Save to project only when it can save, is not busy and is not saved; it asks for the form', async () => {
    store.sessions = { live: [], past: ['a', 'b', 'c', 'd'].map((x) => past(x, { title: x })) };
    api.projectChats.mockResolvedValue(
      reply([
        chat({ chat: 'a', title: 'a', saved: 'never' }),
        chat({ chat: 'b', title: 'b', saved: 'saved', savedAt: '2026-11-20T09:00:00Z' }),
        chat({ chat: 'c', title: 'c', saved: 'new', savedAt: '2026-11-20T09:00:00Z', busy: true }),
        chat({ chat: 'd', title: 'd', saved: null }),
      ]),
    );
    const p = props();
    render(<ProjectChats {...p} />);
    await screen.findByText('a');
    expect(
      screen.getAllByRole('button', { name: /^Save to project:/ }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Save to project: a', 'Save to project: d']);
    fireEvent.click(screen.getByRole('button', { name: 'Save to project: a' }));
    expect(p.onSave).toHaveBeenCalledWith({ key: 'skyseal/site', chat: 'a', title: 'a' });
  });

  it('opens a live chat with its own id and a past one by session id, both in the drawer', async () => {
    store.sessions = {
      live: [live('app-1', 'liveSdk')],
      past: [past('pastSdk', { title: 'Older' })],
    };
    api.projectChats.mockResolvedValue(
      reply([
        chat({ chat: 'liveSdk', title: 'Fix the redirects' }),
        chat({ chat: 'pastSdk', title: 'Older' }),
      ]),
    );
    render(<ProjectChats {...props()} />);
    expect(await screen.findByText('Open now · not saved yet')).toBeTruthy();
    fireEvent.click(screen.getByText('Fix the redirects'));
    expect(store.openChat).toHaveBeenCalledWith('app-1', { in: 'drawer' });
    expect(store.openPast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Older'));
    await waitFor(() => expect(store.openPast).toHaveBeenCalledWith('pastSdk', { in: 'drawer' }));
  });

  it("says so when a chat can't be opened", async () => {
    store.openPast.mockResolvedValue(false);
    api.projectChats.mockResolvedValue(reply([chat()]));
    render(<ProjectChats {...props()} />);
    fireEvent.click(await screen.findByText('Fix the redirects'));
    expect(await screen.findByText("That chat can't be opened on this Mac.")).toBeTruthy();
  });

  it('hides a chat the store no longer lists, and shows the empty state if none are left', async () => {
    store.sessions = { live: [], past: [past('keep')] };
    api.projectChats.mockResolvedValue(
      reply([chat({ chat: 'keep', title: 'Kept' }), chat({ chat: 'gone', title: 'Gone' })]),
    );
    const { unmount } = render(<ProjectChats {...props()} />);
    expect(await screen.findByText('Kept')).toBeTruthy();
    expect(screen.queryByText('Gone')).toBeNull();
    unmount();
    store.sessions = { live: [], past: [] };
    render(<ProjectChats {...props()} />);
    expect(await screen.findByText(/No chats for this project on this Mac yet\./)).toBeTruthy();
  });

  it('names New chat for this project in the empty text only when the project can start one', async () => {
    api.projectChats.mockResolvedValue(reply([]));
    const { unmount } = render(<ProjectChats {...props()} />);
    const note = await screen.findByText(/No chats for this project on this Mac yet\./);
    expect(note.textContent).toBe(
      'No chats for this project on this Mac yet. Press New chat for this project to start one.',
    );
    expect(within(note).getByText('New chat for this project').tagName).toBe('STRONG');
    unmount();
    render(<ProjectChats {...props({ canStart: false })} />);
    const plain = await screen.findByText(/No chats for this project on this Mac yet\./);
    expect(plain.textContent).toBe('No chats for this project on this Mac yet.');
  });

  it('shows loading, then a failure that Try again reads again, and the newest-100 note', async () => {
    api.projectChats.mockRejectedValueOnce(new Error('down'));
    render(<ProjectChats {...props()} />);
    expect(screen.getByText('Loading chats…')).toBeTruthy();
    expect(await screen.findByText(/The chats couldn't be read\./)).toBeTruthy();
    api.projectChats.mockResolvedValue(reply([chat()], { more: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Fix the redirects')).toBeTruthy();
    expect(api.projectChats).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText('Showing the newest 100 chats. Older ones are in the Chats drawer.'),
    ).toBeTruthy();
  });

  it("reads again when the project's chats in the store change, keeping the rows meanwhile", async () => {
    api.projectChats.mockResolvedValueOnce(reply([chat()]));
    const p = props();
    const { rerender } = render(<ProjectChats {...p} />);
    expect(await screen.findByText('Fix the redirects')).toBeTruthy();
    // Another project's chat arriving changes nothing here.
    store.sessions = { live: [], past: [past(ID), past('x', { project: 'other/thing' })] };
    rerender(<ProjectChats {...p} />);
    expect(api.projectChats).toHaveBeenCalledTimes(1);
    // A chat for this project arriving does, and the old rows stay while the answer is awaited.
    let resolve: (r: ProjectChatsResponse) => void = () => {};
    api.projectChats.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    store.sessions = { live: [], past: [past(ID), past('n', { title: 'New one' })] };
    rerender(<ProjectChats {...p} />);
    await waitFor(() => expect(api.projectChats).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Fix the redirects')).toBeTruthy();
    expect(screen.queryByText('Loading chats…')).toBeNull();
    resolve(reply([chat(), chat({ chat: 'n', title: 'New one' })]));
    expect(await screen.findByText('New one')).toBeTruthy();
  });

  it('counts a moved-from key, and ignores an answer that arrives late', async () => {
    api.projectChats.mockResolvedValueOnce(reply([chat()]));
    const p = props({ movedFrom: ['old/key'] });
    const { rerender } = render(<ProjectChats {...p} />);
    await screen.findByText('Fix the redirects');
    let slow: (r: ProjectChatsResponse) => void = () => {};
    api.projectChats.mockReturnValueOnce(new Promise((r) => (slow = r)));
    store.sessions = { live: [], past: [past(ID), past('m', { project: 'old/key' })] };
    rerender(<ProjectChats {...p} />);
    await waitFor(() => expect(api.projectChats).toHaveBeenCalledTimes(2));
    api.projectChats.mockResolvedValueOnce(reply([chat({ title: 'Fresh' })]));
    store.sessions = { live: [], past: [past(ID), past('m', { project: 'old/key', title: 'renamed' })] };
    rerender(<ProjectChats {...p} />);
    expect(await screen.findByText('Fresh')).toBeTruthy();
    slow(reply([chat({ title: 'Stale' })]));
    await Promise.resolve();
    expect(screen.queryByText('Stale')).toBeNull();
  });
});

describe('the Chats tab', () => {
  it('is the last tab on a project page and shows the card', async () => {
    const sky = card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v1' });
    const list = projectList([sky]);
    api.projects.mockResolvedValue(list);
    api.projectChats.mockResolvedValue(reply([chat()]));
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    const nav = await screen.findByRole('navigation', { name: 'Project sections' });
    const names = within(nav)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Overview', expect.stringContaining('Tasks'), 'Updates', 'Files', 'Chats']);
    fireEvent.click(within(nav).getByRole('button', { name: 'Chats' }));
    expect(await screen.findByText('Your chats for this project')).toBeTruthy();
  });
});
