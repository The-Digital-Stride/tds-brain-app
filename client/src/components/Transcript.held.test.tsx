// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../../shared/contract.ts';
import type { ChatItem } from '../state/chat-reducer.ts';

const api = vi.hoisted(() => ({ resend: vi.fn(async () => ({ ok: true })) }));
vi.mock('../api.ts', () => ({ api }));
const run = vi.hoisted(() =>
  vi.fn(async (action: () => Promise<unknown>) => {
    await action();
    return true;
  }),
);
vi.mock('../store.tsx', () => ({ useStore: () => ({ run, requestComposerFocus: () => {} }) }));

const { Transcript } = await import('./Transcript.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, text });
const held = (id: string): ChatItem => ({
  kind: 'notice',
  id,
  level: 'warning',
  text: "Claude Code held this message back, so Claude hasn't seen it.",
  resend: true,
});
const reply = (id: string): ChatItem => ({ kind: 'assistant', id, text: 'Here it is.', done: true });

function show(items: ChatItem[], state: SessionState = 'idle') {
  render(<Transcript items={items} sessionId="s1" sessionState={state} />);
}
const button = () => screen.queryByRole('button', { name: 'Send again' });

describe('a message Claude Code held back', () => {
  it('shows the reason with Send again, which sends it again', async () => {
    show([user('u1', 'Summarise this chat'), held('n1')]);
    expect(screen.getByText(/held this message back/)).toBeTruthy();
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith('s1'));
  });

  it('offers Send again only while Claude is free', () => {
    show([user('u1', 'x'), held('n1')], 'working');
    expect(button()).toBeNull();
  });

  it('offers it only on the newest hold, before anything else is said', () => {
    show([user('u1', 'x'), held('n1'), reply('a1')]);
    expect(button()).toBeNull();
    cleanup();
    show([user('u1', 'x'), held('n1'), user('u2', 'y'), held('n2')]);
    expect(screen.getAllByRole('button', { name: 'Send again' })).toHaveLength(1);
  });
});
