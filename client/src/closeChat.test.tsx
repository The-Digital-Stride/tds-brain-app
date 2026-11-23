// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, StreamFrame } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  close: vi.fn(),
  interrupt: vi.fn(),
}));
vi.mock('./api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));

class FakeEventSource {
  static last: FakeEventSource | null = null;
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { App } = await import('./App.tsx');

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam Example', slug: 'sam-example', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false, tourSeen: 1 },
};

function chatEvent(seq: number, event: ChatEvent) {
  const frame: StreamFrame = {
    kind: 'chat',
    sessionId: 's1',
    item: { seq, at: new Date().toISOString(), event },
  };
  act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(frame) }));
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.setItem('tds-brain-open-chat', 's1');
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({
    live: [
      {
        id: 's1',
        sdkSessionId: null,
        title: 'Report check',
        client: null,
        todoId: null,
        state: 'idle',
        startedAt: '',
        lastActivityAt: '',
      },
    ],
    past: [],
  });
  api.close.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

async function openChat() {
  render(<App />);
  await screen.findByRole('heading', { name: 'Report check' });
}

describe('closing a chat', () => {
  it('closes an idle chat at once and lands on Home, ready for a new chat', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'idle' });
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    await waitFor(() => expect(api.close).toHaveBeenCalledTimes(1));
    expect(api.close).toHaveBeenCalledWith('s1');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(screen.queryByRole('heading', { name: 'Report check' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message to Claude' })).toBeTruthy();
    expect(screen.getByText("Chat closed. It's under Earlier in Chats if you want it back.")).toBeTruthy();
  });

  it('asks first when the chat is working, and does nothing until confirmed', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'working' });
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    expect(screen.getByText('End this chat? Claude is still working on a reply.')).toBeTruthy();
    expect(api.close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'End chat' }).getAttribute('data-variant')).toBe('danger');
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    await waitFor(() => expect(api.close).toHaveBeenCalledTimes(1));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
  });

  it('the top bar button is labelled End chat; Esc in the confirm keeps the chat', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'working' });
    const end = screen.getByRole('button', { name: 'End chat' });
    expect(end.getAttribute('data-tip')).toBe('End chat');
    fireEvent.click(end);
    const group = screen.getByRole('group', { name: 'End this chat' });
    expect(within(group).getByText('End this chat? Claude is still working on a reply.')).toBeTruthy();
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Keep chat' }));
    fireEvent.keyDown(group, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'End this chat' })).toBeNull();
    expect(api.close).not.toHaveBeenCalled();
  });

  it('Keep chat cancels the confirm', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'waiting' });
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    expect(screen.getByText('End this chat? Claude is waiting for your answer.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep chat' }));
    expect(api.close).not.toHaveBeenCalled();
    expect(screen.queryByText(/End this chat\?/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End chat' }));
  });

  it('takes the "This chat" panel with it: Home never offers the panel', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'idle' });
    const panel = () => document.getElementById('panel') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Files and details' }));
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('radio', { name: 'Files' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'End chat' }));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(panel().hasAttribute('inert')).toBe(true);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Files and details' })).toBeNull();
  });
});
