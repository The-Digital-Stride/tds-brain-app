// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession } from '../../../shared/contract.ts';
import type { ChatState } from '../state/chat-reducer.ts';

const h = vi.hoisted(() => ({
  role: 'scout' as string,
  activeChat: { kind: 'live', sessionId: 's1' } as unknown,
  chat: undefined as unknown,
  live: null as unknown,
}));
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    boot: {
      identity: { role: h.role },
      clients: [{ slug: 'acme', name: 'Acme Heating' }],
      engine: { permissionMode: 'default' },
    },
    activeChat: h.activeChat,
    chats: h.chat ? { s1: h.chat } : {},
    sessions: { live: h.live ? [h.live] : [], past: [] },
    todos: {
      mine: [{ id: '20261111-board.md', title: 'Write the call tracking case' }],
      open: [],
      othersCount: 0,
    },
  }),
}));

const { Inspector } = await import('./Inspector.tsx');
const { ShellProvider } = await import('./ShellProvider.tsx');

const liveChat = (over: Partial<LiveSession> = {}): LiveSession => ({
  id: 's1',
  sdkSessionId: 'abc-123',
  title: 'Report check',
  client: 'acme',
  todoId: '20261111-board.md',
  state: 'idle',
  startedAt: '2026-11-11T16:42:00.000Z',
  lastActivityAt: '2026-11-11T16:50:00.000Z',
  ...over,
});

const chatState = (items: ChatState['items']): ChatState => ({
  lastSeq: 1,
  sessionState: 'working',
  stateDetail: null,
  stateSince: null,
  sdkSessionId: null,
  items,
});

function renderPanel() {
  return render(
    <ShellProvider>
      <Inspector />
    </ShellProvider>,
  );
}

beforeEach(() => {
  h.role = 'scout';
  h.activeChat = { kind: 'live', sessionId: 's1' };
  h.live = liveChat();
  h.chat = chatState([
    { kind: 'user', id: 'u', text: 'hi' },
    {
      kind: 'tool',
      id: 't1',
      tool: 'Task',
      label: 'Asked a helper',
      status: 'ok',
      children: [
        { kind: 'tool', id: 't1a', tool: 'Read', label: 'Read business.md', status: 'failed', children: [] },
      ],
    },
    { kind: 'tool', id: 't2', tool: 'Bash', label: 'Counted enquiries', status: 'running', children: [] },
  ]);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the "This chat" panel', () => {
  it('lists every step, numbered, with its status in words and helpers indented', () => {
    renderPanel();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '1Asked a helperdone',
      '2Read business.mddid not work',
      '3Counted enquiriesworking',
    ]);
    expect(rows.map((r) => r.getAttribute('data-depth'))).toEqual(['0', '1', '0']);
  });

  it('says so when there are no steps yet', () => {
    h.chat = chatState([{ kind: 'user', id: 'u', text: 'hi' }]);
    renderPanel();
    expect(screen.getByText('No steps yet.')).toBeTruthy();
  });

  it('switches between Steps and Details', () => {
    renderPanel();
    const steps = screen.getByRole('radio', { name: 'Steps' });
    expect(steps.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.getByRole('radio', { name: 'Details' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('list')).toBeNull();
    const terms = Array.from(document.querySelectorAll('dt')).map((d) => d.textContent);
    expect(terms).toEqual(['Client', 'To-do', 'Started', 'State', 'Approvals', 'Continue in the terminal']);
    expect(screen.getByText('Acme Heating')).toBeTruthy();
    expect(screen.getByText('Write the call tracking case')).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText('Claude asks before it changes a file or runs a command.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Steps' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('leaves out the to-do when the chat has none, and says "No client" when there is none', () => {
    h.live = liveChat({ todoId: null, client: null });
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.queryByText('To-do')).toBeNull();
    expect(screen.getByText('No client')).toBeTruthy();
  });

  it.each(['owner', 'scout'])('shows the resume line to an %s', (role) => {
    h.role = role;
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.getByText('claude --resume abc-123')).toBeTruthy();
    expect(screen.getByText(/do not show in the terminal's own list/)).toBeTruthy();
  });

  it.each(['team', 'unknown'])('never shows the resume line to %s', (role) => {
    h.role = role;
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.queryByText(/claude --resume/)).toBeNull();
    expect(screen.queryByText('Continue in the terminal')).toBeNull();
  });

  it('renders nothing on Home (a new chat)', () => {
    h.activeChat = { kind: 'new', key: 1, draft: '', skill: null, todoId: null };
    const { container } = renderPanel();
    expect(container.textContent).toBe('');
  });
});
