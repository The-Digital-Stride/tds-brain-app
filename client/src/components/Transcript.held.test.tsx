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
const requestComposerFocus = vi.hoisted(() => vi.fn());
vi.mock('../store.tsx', () => ({ useStore: () => ({ run, requestComposerFocus }) }));

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
  text: "This message wasn't sent, so Claude hasn't seen it. A check in Claude Code held it back.",
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
    expect(screen.getByText(/held it back/)).toBeTruthy();
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith('s1'));
  });

  it('sends once however often it is pressed, then hands focus back to the message box', async () => {
    let finish: () => void = () => {};
    api.resend.mockReturnValueOnce(new Promise((r) => (finish = () => r({ ok: true }))));
    show([user('u1', 'x'), held('n1')]);
    const b = button() as HTMLElement;
    fireEvent.click(b);
    fireEvent.click(b);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    finish();
    await waitFor(() => expect(requestComposerFocus).toHaveBeenCalled());
    expect(api.resend).toHaveBeenCalledTimes(1);
    // The box is announced, and the button says what it sends again.
    expect(screen.getByRole('status').textContent).toContain('held it back');
    expect(b.getAttribute('aria-describedby')).toBeTruthy();
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

  it('stops offering it once the server says it was sent again, even if that reply was stopped', () => {
    const sentAgain: ChatItem = { kind: 'notice', id: 'n2', level: 'info', text: 'Sent again.' };
    show([user('u1', 'x'), held('n1'), sentAgain]);
    expect(button()).toBeNull();
  });
});
