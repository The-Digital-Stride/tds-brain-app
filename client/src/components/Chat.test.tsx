// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatState, PermissionItem } from '../state/chat-reducer.ts';

const h = vi.hoisted(() => ({
  chat: null as unknown,
  lastActivityAt: '2026-11-11T10:00:00.000Z',
  composerFocus: 0,
  requestComposerFocus: vi.fn(),
}));
const api = vi.hoisted(() => ({
  answerPermission: vi.fn().mockResolvedValue({ ok: true }),
  answerQuestion: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    boot: {
      prefs: { pins: [], lastClient: null },
      skills: [],
      clients: [],
      usedOften: [],
      identity: { role: 'team' },
    },
    activeChat: { kind: 'live', sessionId: 's1' },
    chats: { s1: h.chat },
    sessions: {
      live: [{ id: 's1', title: 'T', client: null, sdkSessionId: null, lastActivityAt: h.lastActivityAt }],
      past: [],
    },
    send: async () => true,
    run: async (fn: () => Promise<unknown>) => {
      await fn();
      return true;
    },
    actionError: null,
    clearError: () => {},
    startSkill: () => {},
    openView: () => {},
    composerFocus: h.composerFocus,
    requestComposerFocus: h.requestComposerFocus,
    closeRequest: null,
    cancelClose: () => {},
    requestClose: () => {},
    closeChat: async () => true,
  }),
}));

const { ChatView } = await import('./Chat.tsx');
const { ShellProvider } = await import('../shell/ShellProvider.tsx');

const sheet = () => (
  <ShellProvider>
    <ChatView />
  </ShellProvider>
);

const chatState = (sessionState: ChatState['sessionState'], stepLabel?: string): ChatState => ({
  lastSeq: 1,
  sessionState,
  stateDetail: null,
  stateSince: null,
  sdkSessionId: null,
  items: [
    { kind: 'user', id: 'u', text: 'hi' },
    ...(stepLabel
      ? [
          {
            kind: 'tool' as const,
            id: stepLabel,
            tool: 'Edit',
            label: stepLabel,
            status: 'running' as const,
            children: [],
          },
        ]
      : []),
  ],
});

const lines = () => document.querySelectorAll('.attn-text');

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('status line above the message box', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is always exactly one line, showing the current state', () => {
    const steps: [ChatState['sessionState'], string | undefined, RegExp][] = [
      ['starting', undefined, /^Working/],
      ['working', 'Running a command', /^Working.*Running a command/],
      ['working', 'Editing a.txt', /^Working.*Editing a\.txt/],
      ['waiting', 'Editing a.txt', /^Needs your answer/],
      ['idle', undefined, /^Ready for you/],
    ];
    h.chat = chatState(steps[0]?.[0] ?? 'idle');
    const { rerender } = render(sheet());
    for (const [state, step, expected] of steps) {
      h.chat = chatState(state, step);
      rerender(sheet());
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(lines()).toHaveLength(1);
      expect(lines()[0]?.textContent?.trim()).toMatch(expected);
    }
  });
});

describe('the sheet bar', () => {
  it('names the chat as the page heading, leaves out an empty client chip and toggles the panel', () => {
    h.chat = chatState('idle');
    render(sheet());
    const heading = screen.getByRole('heading', { level: 1, name: 'T' });
    // The bar may cut a long title short; the full title is on hover.
    expect(heading.getAttribute('title')).toBe('T');
    // No client: no chip (the panel's Details says "No client").
    expect(screen.queryByText('No client')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Steps and details' });
    expect(toggle.getAttribute('aria-controls')).toBe('panel');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('puts the panel toggle last, at the top right, after "Search or jump to"', () => {
    h.chat = chatState('idle');
    render(sheet());
    const toggle = screen.getByRole('button', { name: 'Steps and details' });
    expect(toggle.parentElement?.lastElementChild).toBe(toggle);
    expect(toggle.previousElementSibling).toBe(screen.getByRole('button', { name: 'Search or jump to' }));
  });
});

const perm = (
  requestId: string,
  title: string,
  outcome: PermissionItem['outcome'] = null,
): PermissionItem => ({
  kind: 'permission',
  requestId,
  tool: 'Write',
  title,
  detail: '',
  warning: null,
  sessionAllowLabel: null,
  outcome,
});

const withItems = (items: ChatItem[]): ChatState => ({ ...chatState('waiting'), items });

describe('the card waiting on you', () => {
  beforeEach(() => {
    h.composerFocus = 0;
    h.requestComposerFocus.mockReset();
    h.requestComposerFocus.mockImplementation(() => {
      h.composerFocus += 1;
    });
    api.answerPermission.mockClear();
  });

  const floater = () => document.querySelector('.floater') as HTMLElement;
  const thread = () => document.querySelector('.thread') as HTMLElement;
  const box = () => screen.getByRole('textbox', { name: 'Message to Claude' });
  const cardNamed = (title: string) => screen.getByRole('region', { name: title });

  it('shows once, above the message box, and moves to the thread once answered', async () => {
    const user: ChatItem = { kind: 'user', id: 'u', text: 'hi' };
    h.chat = withItems([user, perm('r1', 'Save a file')]);
    const { rerender } = render(sheet());

    expect(screen.getAllByText('Save a file')).toHaveLength(1);
    const card = cardNamed('Save a file');
    expect(floater().contains(card)).toBe(true);
    expect(thread().contains(card)).toBe(false);
    expect(card.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(card);
    // While a card waits, the box says why it can't take a message.
    expect(box().getAttribute('placeholder')).toBe('Claude is waiting for your answer above.');

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(h.requestComposerFocus).toHaveBeenCalledTimes(1));

    h.chat = withItems([user, perm('r1', 'Save a file', 'allowed')]);
    rerender(sheet());
    expect(screen.queryByRole('region', { name: 'Save a file' })).toBeNull();
    expect(floater().querySelector('.pending')).toBeNull();
    expect(thread().textContent).toContain('You allowed this: Save a file');
    expect(document.activeElement).toBe(box());
  });

  it('with two waiting, shows the first; after an answer focus goes to the second, then to the message box', async () => {
    h.chat = withItems([perm('r1', 'First file'), perm('r2', 'Second file')]);
    const { rerender } = render(sheet());

    expect(screen.getAllByText('First file')).toHaveLength(1);
    expect(screen.queryByText('Second file')).toBeNull();
    expect(document.activeElement).toBe(cardNamed('First file'));

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(api.answerPermission).toHaveBeenCalledTimes(1));
    // Another card is waiting, so focus is not sent to the message box.
    expect(h.requestComposerFocus).not.toHaveBeenCalled();

    h.chat = withItems([perm('r1', 'First file', 'allowed'), perm('r2', 'Second file')]);
    rerender(sheet());
    const second = cardNamed('Second file');
    expect(floater().contains(second)).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(thread().textContent).toContain('You allowed this: First file');

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(h.requestComposerFocus).toHaveBeenCalledTimes(1));
    h.chat = withItems([perm('r1', 'First file', 'allowed'), perm('r2', 'Second file', 'allowed')]);
    rerender(sheet());
    expect(floater().querySelector('.pending')).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it('shows a question in the same place', () => {
    h.chat = withItems([
      {
        kind: 'question',
        requestId: 'q1',
        outcome: null,
        questions: [
          {
            question: 'Which call?',
            header: '',
            multiSelect: false,
            options: [{ label: 'New', description: '' }],
          },
        ],
      },
    ]);
    render(sheet());
    const form = screen.getByRole('form', { name: 'Claude has a question for you' });
    expect(floater().contains(form)).toBe(true);
    expect(document.activeElement).toBe(form);
  });
});
