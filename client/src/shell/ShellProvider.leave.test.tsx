// @vitest-environment jsdom
// Leaving a page with unsaved form work asks first (plan 2026-11-23-ux-follow-ups, decision 1; design system,
// Actions rule 9). The real store and the real shell provider: every page change the store makes passes through the
// shell's leave guard. The holds are set the way their forms set them (dispatch), so the order can be checked alone.
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
const summary = vi.hoisted(() => ({ loadAdsSummary: vi.fn() }));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));
vi.mock('../tools/ad-manager/summary.ts', () => summary);

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

const ADS = 'tool:workbench/ad-manager';

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
/** On Ads with the right panel open and holding typed work, as the proposal note makes it. */
async function onAdsWithPanelWork() {
  await mount();
  act(() => store.openTool('workbench', 'ad-manager'));
  act(() => shell.dispatch({ type: 'set-panel', open: true }));
  act(() => shell.dispatch({ type: 'set-panel-dirty', dirty: true }));
  expect(store.view).toBe(ADS);
}
const sheetDirty = (dirty: boolean) => act(() => shell.dispatch({ type: 'set-sheet-dirty', dirty }));
/** The to-do panel open (it lives with the To-dos drawer) on a to-do, without (`read`) or with typed changes. */
const todoOpen = () => {
  act(() => shell.dispatch({ type: 'open-drawer', drawer: 'todos' }));
  act(() => shell.dispatch({ type: 'open-todo', key: 'todo-1', mode: 'read' }));
  expect(shell.state.todoPanel?.key).toBe('todo-1');
};
const todoDirty = () => {
  act(() => shell.dispatch({ type: 'open-drawer', drawer: 'todos' }));
  act(() => shell.dispatch({ type: 'open-todo', key: 'todo-1', mode: 'edit' }));
  act(() => shell.dispatch({ type: 'set-todo-dirty', dirty: true }));
  expect(shell.state.todoPanel?.dirty).toBe(true);
  expect(shell.panelHold.asking).toBe(false);
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('innerWidth', 1600);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
  summary.loadAdsSummary.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('leave guard: nothing unsaved', () => {
  it('every page change happens at once', async () => {
    await mount();
    act(() => store.openTool('workbench', 'ad-manager'));
    expect(store.view).toBe(ADS);
    act(() => store.openView('settings'));
    expect(store.view).toBe('settings');
    act(() => store.newChat());
    expect(store.view).toBe('chat');
    act(() => store.openSettings('about'));
    expect(store.view).toBe('settings');
    expect(store.settingsTab).toBe('about');
    act(() => store.openView('app:projects'));
    expect(store.view).toBe('app:projects');
    expect(shell.panelHold.asking).toBe(false);
    expect(shell.sheetHold.asking).toBe(false);
  });
});

describe('leave guard: the right panel holds typed work', () => {
  it('a rail click to another page asks; Keep stays on the page and keeps the work', async () => {
    await onAdsWithPanelWork();
    act(() => store.openView('app:projects'));
    expect(shell.panelHold.asking).toBe(true);
    expect(store.view).toBe(ADS);
    act(() => shell.dispatch({ type: 'keep-panel' }));
    expect(store.view).toBe(ADS);
    expect(shell.panelHold).toEqual({ dirty: true, asking: false });
  });

  it('Discard goes to the page asked for', async () => {
    await onAdsWithPanelWork();
    act(() => store.openTool('workbench', 'ads-account-summary'));
    expect(store.view).toBe(ADS);
    act(() => shell.dispatch({ type: 'discard-panel' }));
    expect(store.view).toBe('tool:workbench/ads-account-summary');
    expect(shell.panelHold).toEqual({ dirty: false, asking: false });
  });

  it('Home, Settings and a chat ask too', async () => {
    await onAdsWithPanelWork();
    act(() => store.newChat());
    expect(store.view).toBe(ADS);
    expect(store.activeChat.kind).toBe('new');
    act(() => shell.dispatch({ type: 'keep-panel' }));
    act(() => store.openSettings('about'));
    expect(store.view).toBe(ADS);
    expect(store.settingsTab).toBe('general');
    act(() => shell.dispatch({ type: 'keep-panel' }));
    act(() => store.openChat('s1'));
    expect(store.view).toBe(ADS);
    expect(store.activeChat.kind).toBe('new');
    act(() => shell.dispatch({ type: 'discard-panel' }));
    expect(store.view).toBe('chat');
    expect(store.activeChat).toEqual({ kind: 'live', sessionId: 's1' });
  });

  it('the latest page asked for is the one Discard goes to', async () => {
    await onAdsWithPanelWork();
    act(() => store.openView('app:projects'));
    act(() => store.openView('settings'));
    act(() => shell.dispatch({ type: 'discard-panel' }));
    expect(store.view).toBe('settings');
  });

  it('opens a shut panel to ask', async () => {
    await onAdsWithPanelWork();
    // A resize can shut the panel past the hold.
    act(() => shell.dispatch({ type: 'set-panel-dirty', dirty: false }));
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    act(() => shell.dispatch({ type: 'set-panel-dirty', dirty: true }));
    act(() => store.openView('settings'));
    expect(shell.state.panelOpen).toBe(true);
    expect(shell.panelHold.asking).toBe(true);
  });

  it('the page already shown asks nothing; the same tool for another account does', async () => {
    await onAdsWithPanelWork();
    act(() => store.openTool('workbench', 'ad-manager'));
    expect(shell.panelHold.asking).toBe(false);
    act(() => store.openTool('workbench', 'ad-manager', 'acme'));
    expect(shell.panelHold.asking).toBe(true);
    expect(store.toolArg).toBeNull();
    act(() => shell.dispatch({ type: 'discard-panel' }));
    expect(store.toolArg).toBe('acme');
  });

  it('a chat opened in the drawer over the tool leaves the page alone and asks nothing', async () => {
    await onAdsWithPanelWork();
    act(() => store.openChat('s1', { in: 'drawer' }));
    expect(shell.panelHold.asking).toBe(false);
    expect(store.view).toBe(ADS);
    expect(store.chatDrawer).toBe('s1');
  });
});

describe('leave guard: a sheet form holds typed work', () => {
  it('asks; Keep runs nothing; Discard goes', async () => {
    await mount();
    act(() => store.openView('app:projects'));
    sheetDirty(true);
    expect(shell.sheetHold).toEqual({ dirty: true, asking: false });
    act(() => store.newChat());
    expect(shell.sheetHold.asking).toBe(true);
    expect(store.view).toBe('app:projects');
    act(() => shell.dispatch({ type: 'keep-sheet' }));
    expect(shell.sheetHold).toEqual({ dirty: true, asking: false });
    expect(store.view).toBe('app:projects');
    act(() => store.openTool('workbench', 'ad-manager'));
    act(() => shell.dispatch({ type: 'discard-sheet' }));
    expect(store.view).toBe(ADS);
    expect(shell.sheetHold).toEqual({ dirty: false, asking: false });
  });

  it('a form that reports itself clean again lets the page change at once', async () => {
    await mount();
    act(() => store.openView('app:projects'));
    sheetDirty(true);
    sheetDirty(false);
    act(() => store.openView('settings'));
    expect(store.view).toBe('settings');
  });

  it('with the right panel too: the panel asks first, then the sheet, never both at once', async () => {
    await onAdsWithPanelWork();
    sheetDirty(true);
    act(() => store.openView('settings'));
    expect(shell.panelHold.asking).toBe(true);
    expect(shell.sheetHold.asking).toBe(false);
    act(() => shell.dispatch({ type: 'discard-panel' }));
    expect(shell.sheetHold.asking).toBe(true);
    expect(store.view).toBe(ADS);
    act(() => shell.dispatch({ type: 'discard-sheet' }));
    expect(store.view).toBe('settings');
  });

  it('Keep at the panel runs nothing after it and never asks the sheet', async () => {
    await onAdsWithPanelWork();
    sheetDirty(true);
    act(() => store.openView('settings'));
    act(() => shell.dispatch({ type: 'keep-panel' }));
    expect(shell.sheetHold.asking).toBe(false);
    expect(store.view).toBe(ADS);
    // Nothing held is left: a later Discard at the sheet runs nothing.
    act(() => shell.dispatch({ type: 'discard-sheet' }));
    expect(store.view).toBe(ADS);
  });
});

describe('leave guard and the task panel', () => {
  it('a dirty task alone: the page changes at once and the task asks, as before', async () => {
    await mount();
    act(() => store.openView('app:projects'));
    todoDirty();
    act(() => store.openView('settings'));
    expect(store.view).toBe('settings');
    expect(shell.state.todoPanel?.ask).toEqual({ type: 'close-todo' });
    act(() => shell.dispatch({ type: 'keep-todo' }));
    expect(shell.state.todoPanel).not.toBeNull();
  });

  it('a dirty task and a dirty panel: the task asks first; Keep runs nothing', async () => {
    await onAdsWithPanelWork();
    todoDirty();
    act(() => store.openView('settings'));
    expect(shell.state.todoPanel?.ask).not.toBeNull();
    expect(shell.panelHold.asking).toBe(false);
    expect(store.view).toBe(ADS);
    act(() => shell.dispatch({ type: 'keep-todo' }));
    expect(shell.state.todoPanel).not.toBeNull();
    expect(shell.panelHold.asking).toBe(false);
    expect(store.view).toBe(ADS);
  });

  it('Discard at the task closes it, then the panel asks, then Discard there goes', async () => {
    await onAdsWithPanelWork();
    todoDirty();
    act(() => store.openView('settings'));
    act(() => shell.dispatch({ type: 'discard-todo' }));
    expect(shell.state.todoPanel).toBeNull();
    expect(shell.panelHold.asking).toBe(true);
    expect(store.view).toBe(ADS);
    act(() => shell.dispatch({ type: 'discard-panel' }));
    expect(store.view).toBe('settings');
  });

  it('a task question replaced by another step drops the page change', async () => {
    await onAdsWithPanelWork();
    todoDirty();
    act(() => store.openView('settings'));
    // Choosing another to-do while it asks replaces the question.
    act(() => shell.dispatch({ type: 'open-todo', key: 'todo-2', mode: 'read' }));
    act(() => shell.dispatch({ type: 'discard-todo' }));
    expect(shell.state.todoPanel?.key).toBe('todo-2');
    expect(shell.panelHold.asking).toBe(false);
    expect(store.view).toBe(ADS);
  });

  it('a clean task over a dirty panel shuts first, so the panel question can be reached', async () => {
    await onAdsWithPanelWork();
    todoOpen();
    act(() => store.openView('settings'));
    expect(shell.state.todoPanel).toBeNull();
    expect(shell.panelHold.asking).toBe(true);
    expect(store.view).toBe(ADS);
  });
});
