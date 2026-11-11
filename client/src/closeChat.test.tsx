// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, StreamFrame } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
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
  identity: { name: 'Sam Example', slug: 'sam-example', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
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
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.getByText('Claude is still working. Close anyway?')).toBeTruthy();
    expect(api.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(api.close).toHaveBeenCalledTimes(1));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
  });

  it('Keep open cancels the confirm', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'waiting' });
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.getByText('Claude is waiting for your answer. Close anyway?')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep open' }));
    expect(api.close).not.toHaveBeenCalled();
    expect(screen.queryByText(/Close anyway/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close chat' }));
  });

  it('takes the "This chat" panel with it: Home never offers the panel', async () => {
    await openChat();
    chatEvent(1, { type: 'state', state: 'idle' });
    const panel = () => document.getElementById('panel') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Steps and details' }));
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('radio', { name: 'Steps' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(panel().hasAttribute('inert')).toBe(true);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Steps and details' })).toBeNull();
  });
});
