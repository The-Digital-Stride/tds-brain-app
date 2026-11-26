// @vitest-environment jsdom
// The unsent drawer chat's hold (plan 2026-11-26-project-chat-in-place, decision 8): its own slot, beside the sheet's.
// The real store and the real shell provider; the hold is set the way `useDrawerHold` sets it (dispatch).
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../store.tsx';
import type { ShellApi } from './contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  sendMessage: vi.fn(),
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
  close() {}
}

const { StoreProvider, useStore } = await import('../store.tsx');
const { ShellProvider, useShell } = await import('./ShellProvider.tsx');

let store: Store;
let shell: ShellApi;
function Probe() {
  store = useStore();
  shell = useShell();
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
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};

const PROJECTS = 'app:projects';
const dispatch = (a: Parameters<ShellApi['dispatch']>[0]) => act(() => shell.dispatch(a));
const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

async function mount() {
  render(
    <StoreProvider>
      <ShellProvider>
        <Probe />
      </ShellProvider>
    </StoreProvider>,
  );
  await waitFor(() => expect(store?.boot).not.toBeNull());
}
/** On Projects with an unsent chat in the drawer; `typed` says whether its box holds text. */
async function unsent(typed: boolean) {
  await mount();
  act(() => store.openView(PROJECTS));
  act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
  expect(store.newChatDrawer).not.toBeNull();
  if (typed) dispatch({ type: 'set-drawer-dirty', dirty: true });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('innerWidth', 1600);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('the drawer hold and the sheet hold are separate', () => {
  it('both dirty keep separate questions: clearing one leaves the other', async () => {
    await unsent(true);
    dispatch({ type: 'set-sheet-dirty', dirty: true });
    act(() => store.openView('settings'));
    // The sheet's question first; the drawer's waits behind it.
    expect(shell.sheetHold.asking).toBe(true);
    expect(shell.drawerHold?.asking).toBe(false);
    expect(store.view).toBe(PROJECTS);
    dispatch({ type: 'discard-sheet' });
    expect(shell.sheetHold).toEqual({ dirty: false, asking: false });
    expect(shell.drawerHold).toEqual({ dirty: true, asking: true });
    expect(store.view).toBe(PROJECTS);
    dispatch({ type: 'keep-drawer' });
    expect(shell.drawerHold).toEqual({ dirty: true, asking: false });
    expect(store.view).toBe(PROJECTS);
    expect(store.newChatDrawer).not.toBeNull();
  });

  it('a sheet form going clean does not clear the drawer, and the reverse', async () => {
    await unsent(true);
    dispatch({ type: 'set-sheet-dirty', dirty: true });
    dispatch({ type: 'set-sheet-dirty', dirty: false });
    expect(shell.drawerHold?.dirty).toBe(true);
    dispatch({ type: 'set-sheet-dirty', dirty: true });
    dispatch({ type: 'set-drawer-dirty', dirty: false });
    expect(shell.sheetHold.dirty).toBe(true);
  });
});

describe('guardLeave and guardDrawer', () => {
  it('guardLeave asks for a dirty drawer; Discard goes on to the page', async () => {
    await unsent(true);
    act(() => store.openView('settings'));
    expect(shell.drawerHold).toEqual({ dirty: true, asking: true });
    expect(store.view).toBe(PROJECTS);
    dispatch({ type: 'discard-drawer' });
    expect(store.view).toBe('settings');
    expect(store.newChatDrawer).toBeNull();
    expect(shell.drawerHold).toEqual({ dirty: false, asking: false });
  });

  it('Discard drops the unsent chat at once, whatever was held back', async () => {
    await unsent(true);
    // As a chat being started for the drawer does: what is held only lets the start carry on.
    let went = false;
    act(() => shell.guardDrawer?.(() => (went = true)));
    expect(shell.drawerHold?.asking).toBe(true);
    dispatch({ type: 'discard-drawer' });
    expect(went).toBe(true);
    expect(store.newChatDrawer).toBeNull();
    expect(store.view).toBe(PROJECTS);
  });

  it('Discard on the way to a tool leaves no unsent chat over the tool', async () => {
    await unsent(true);
    act(() => store.openTool('ads', 'ad-manager'));
    expect(store.view).toBe(PROJECTS);
    dispatch({ type: 'discard-drawer' });
    expect(store.view).toBe('tool:ads/ad-manager');
    expect(store.newChatDrawer).toBeNull();
  });

  it('with the task panel open, it shuts before the drawer asks (the question is never behind it)', async () => {
    await unsent(true);
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    dispatch({ type: 'open-todo', key: 'a', mode: 'read' });
    expect(shell.state.todoPanel).not.toBeNull();
    act(() => store.openView('settings'));
    expect(shell.state.todoPanel).toBeNull();
    expect(shell.drawerHold).toEqual({ dirty: true, asking: true });
    expect(store.view).toBe(PROJECTS);
  });

  it('Keep writing stays on the page with the chat and the text', async () => {
    await unsent(true);
    act(() => store.openView('settings'));
    dispatch({ type: 'keep-drawer' });
    expect(store.view).toBe(PROJECTS);
    expect(store.newChatDrawer).not.toBeNull();
    expect(shell.drawerHold?.dirty).toBe(true);
  });

  it('a clean drawer lets the page change at once', async () => {
    await unsent(false);
    act(() => store.openView('settings'));
    expect(store.view).toBe('settings');
    expect(shell.drawerHold?.asking).toBe(false);
  });

  it('a tab or page change inside Projects (no page change in the store) asks nothing', async () => {
    await unsent(true);
    act(() => store.openView(PROJECTS));
    expect(shell.drawerHold?.asking).toBe(false);
    expect(store.view).toBe(PROJECTS);
  });

  it('a second drawer chat and a chat opened in the drawer ask; Discard carries on', async () => {
    await unsent(true);
    const first = store.newChatDrawer;
    act(() => store.newChat({ in: 'drawer', project: 'acme/other' }));
    expect(shell.drawerHold?.asking).toBe(true);
    expect(store.newChatDrawer).toBe(first);
    dispatch({ type: 'discard-drawer' });
    expect(store.newChatDrawer).not.toBe(first);
    expect(store.newChatDrawer).not.toBeNull();
    dispatch({ type: 'set-drawer-dirty', dirty: true });
    act(() => store.openChat('s5', { in: 'drawer' }));
    expect(shell.drawerHold?.asking).toBe(true);
    dispatch({ type: 'discard-drawer' });
    expect(store.chatDrawer).toBe('s5');
  });

  it('Open full screen moves the text without asking', async () => {
    await unsent(true);
    act(() => store.expandNewChatDrawer('typed', { project: 'acme/site', client: 'acme' }));
    expect(shell.drawerHold?.asking).toBe(false);
    expect(store.view).toBe('chat');
    expect(store.activeChat).toMatchObject({ kind: 'new', draft: 'typed' });
  });

  it('the sheet form still asks first when Open full screen moves the text', async () => {
    await unsent(true);
    dispatch({ type: 'set-sheet-dirty', dirty: true });
    act(() => store.expandNewChatDrawer('typed', { project: '', client: '@auto' }));
    expect(shell.sheetHold.asking).toBe(true);
    expect(shell.drawerHold?.asking).toBe(false);
    dispatch({ type: 'discard-sheet' });
    expect(store.view).toBe('chat');
  });
});

describe('Esc in the drawer', () => {
  it('with text in an unsent chat asks and does not close', async () => {
    await unsent(true);
    esc();
    expect(shell.drawerHold).toEqual({ dirty: true, asking: true });
    expect(store.newChatDrawer).not.toBeNull();
    dispatch({ type: 'discard-drawer' });
    expect(store.newChatDrawer).toBeNull();
    expect(store.view).toBe(PROJECTS);
  });

  it('with Keep writing the chat stays', async () => {
    await unsent(true);
    esc();
    dispatch({ type: 'keep-drawer' });
    expect(store.newChatDrawer).not.toBeNull();
  });

  it('from a clean unsent chat closes it (a fresh sheet chat) with no question', async () => {
    await unsent(false);
    esc();
    expect(shell.drawerHold?.asking).toBe(false);
    expect(store.newChatDrawer).toBeNull();
    expect(store.view).toBe(PROJECTS);
    expect(store.activeChat).toMatchObject({ kind: 'new', in: 'sheet' });
  });

  it('Hide chat from the shell goes through the hold too', async () => {
    await unsent(true);
    dispatch({ type: 'close-chat-drawer' });
    expect(shell.drawerHold?.asking).toBe(true);
    expect(store.newChatDrawer).not.toBeNull();
  });

  it("a live drawer chat's Esc is unchanged: hides it, or does nothing while text is in its box", async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.openChat('s5', { in: 'drawer' }));
    expect(store.chatDrawer).toBe('s5');
    // Nothing typed (no focused message box): Esc hides the drawer; the chat stays live and the hold is not involved.
    esc();
    expect(store.chatDrawer).toBeNull();
    expect(shell.drawerHold?.asking).toBe(false);
    act(() => store.openChat('s5', { in: 'drawer' }));
    const box = document.createElement('div');
    box.dataset.placement = 'drawer';
    const area = document.createElement('textarea');
    area.value = 'typing';
    box.append(area);
    document.body.append(box);
    area.focus();
    esc();
    expect(store.chatDrawer).toBe('s5');
    box.remove();
  });
});
