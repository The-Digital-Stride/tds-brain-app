// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatState } from '../state/chat-reducer.ts';

const h = vi.hoisted(() => ({ chat: null as unknown, lastActivityAt: '2026-11-11T10:00:00.000Z' }));
vi.mock('../api.ts', () => ({ api: {} }));
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
    run: async () => true,
    actionError: null,
    clearError: () => {},
    startSkill: () => {},
    openView: () => {},
    composerFocus: 0,
  }),
}));

const { ChatView } = await import('./Chat.tsx');

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('status line above the message box', () => {
  it('is always exactly one line, showing the current state', () => {
    const steps: [ChatState['sessionState'], string | undefined, RegExp][] = [
      ['starting', undefined, /^Working/],
      ['working', 'Running a command', /^Working.*Running a command/],
      ['working', 'Editing a.txt', /^Working.*Editing a\.txt/],
      ['waiting', 'Editing a.txt', /^Needs your answer/],
      ['idle', undefined, /^Ready for you/],
    ];
    h.chat = chatState(steps[0]?.[0] ?? 'idle');
    const { rerender } = render(<ChatView />);
    for (const [state, step, expected] of steps) {
      h.chat = chatState(state, step);
      rerender(<ChatView />);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(lines()).toHaveLength(1);
      expect(lines()[0]?.textContent?.trim()).toMatch(expected);
    }
  });
});
