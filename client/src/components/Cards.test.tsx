// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionItem, QuestionItem } from '../state/chat-reducer.ts';

const api = vi.hoisted(() => ({ answerPermission: vi.fn(), answerQuestion: vi.fn() }));
const focusComposer = vi.hoisted(() => vi.fn());
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    run: async (fn: () => Promise<unknown>) => {
      await fn();
      return true;
    },
    requestComposerFocus: focusComposer,
  }),
}));

const { PermissionCard, QuestionCard } = await import('./Cards.tsx');

const perm = (over: Partial<PermissionItem> = {}): PermissionItem => ({
  kind: 'permission',
  requestId: 'r1',
  tool: 'Write',
  title: 'Claude wants to save a file',
  detail: 'clients/example/notes.md',
  warning: null,
  sessionAllowLabel: "For the rest of this chat, Claude won't ask before saving files.",
  outcome: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('PermissionCard', () => {
  it('Allow sends allow, with no note', async () => {
    render(<PermissionCard item={perm()} sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(api.answerPermission).toHaveBeenCalledWith('s1', { requestId: 'r1', decision: 'allow' }),
    );
  });

  it("Don't allow sends deny with the typed reason", async () => {
    render(<PermissionCard item={perm()} sessionId="s1" />);
    fireEvent.change(screen.getByLabelText(/tell Claude why/), { target: { value: ' wrong file ' } });
    fireEvent.click(screen.getByRole('button', { name: "Don't allow" }));
    await waitFor(() =>
      expect(api.answerPermission).toHaveBeenCalledWith('s1', {
        requestId: 'r1',
        decision: 'deny',
        note: 'wrong file',
      }),
    );
  });

  it('Allow for this chat sends allow-session and shows its sentence', async () => {
    render(<PermissionCard item={perm()} sessionId="s1" />);
    expect(screen.getByText(/rest of this chat/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow for this chat' }));
    await waitFor(() =>
      expect(api.answerPermission).toHaveBeenCalledWith('s1', { requestId: 'r1', decision: 'allow-session' }),
    );
  });

  it('sends focus to the message box after an answer, unless told what to do instead', async () => {
    const { unmount } = render(<PermissionCard item={perm()} sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(focusComposer).toHaveBeenCalledTimes(1));
    unmount();

    const onAnswered = vi.fn();
    render(<PermissionCard item={perm()} sessionId="s1" onAnswered={onAnswered} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });

  it('takes focus when it appears, and shows only a record once answered', () => {
    const { rerender } = render(<PermissionCard item={perm()} sessionId="s1" />);
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Claude wants to save a file' }));
    rerender(<PermissionCard item={perm({ outcome: 'allowed' })} sessionId="s1" />);
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.getByText('You allowed this: Claude wants to save a file')).toBeTruthy();
  });

  it("offers Allow first, then Allow for this chat, then Don't allow, with the reason under the row", () => {
    render(<PermissionCard item={perm()} sessionId="s1" />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Allow', 'Allow for this chat', "Don't allow"]);
    const forChat = screen.getByRole('button', { name: 'Allow for this chat' });
    const why = document.getElementById(forChat.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toMatch(/rest of this chat/);
  });

  it('hides Allow for this chat when there is no label, and shows a warning', () => {
    render(
      <PermissionCard
        item={perm({ sessionAllowLabel: null, warning: 'Outside the brain folder.' })}
        sessionId="s1"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Allow for this chat' })).toBeNull();
    expect(screen.getByText(/Outside the brain folder/)).toBeTruthy();
  });
});

const question = (over: Partial<QuestionItem['questions'][number]> = {}): QuestionItem => ({
  kind: 'question',
  requestId: 'q1',
  outcome: null,
  questions: [
    {
      question: 'Which call?',
      header: 'Call',
      multiSelect: false,
      options: [
        { label: 'New call', description: 'First time' },
        { label: 'Already filed', description: '' },
      ],
      ...over,
    },
  ],
});

describe('QuestionCard', () => {
  it('a single choice sends the label', async () => {
    render(<QuestionCard item={question()} sessionId="s1" />);
    fireEvent.click(screen.getByRole('radio', { name: /New call/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() =>
      expect(api.answerQuestion).toHaveBeenCalledWith('s1', {
        requestId: 'q1',
        answers: { 'Which call?': 'New call' },
      }),
    );
  });

  it('several choices send an array', async () => {
    render(<QuestionCard item={question({ multiSelect: true })} sessionId="s1" />);
    fireEvent.click(screen.getByRole('checkbox', { name: /New call/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Already filed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() =>
      expect(api.answerQuestion).toHaveBeenCalledWith('s1', {
        requestId: 'q1',
        answers: { 'Which call?': ['New call', 'Already filed'] },
      }),
    );
  });

  it('own words replace a single choice, and Send waits for an answer', async () => {
    render(<QuestionCard item={question()} sessionId="s1" />);
    const send = screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /New call/ }));
    fireEvent.change(screen.getByLabelText('Or type your own answer'), { target: { value: 'Neither' } });
    fireEvent.click(send);
    await waitFor(() =>
      expect(api.answerQuestion).toHaveBeenCalledWith('s1', {
        requestId: 'q1',
        answers: { 'Which call?': 'Neither' },
      }),
    );
  });
});
