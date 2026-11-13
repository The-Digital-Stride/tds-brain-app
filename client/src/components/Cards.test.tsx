// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeLine, ProposedChange } from '../../../shared/contract.ts';
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
  change: null,
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

describe('PermissionCard: the change', () => {
  const lineTexts = (root: Element) =>
    [...root.querySelectorAll('.diff-line')].map((l) => `${l.getAttribute('data-kind')}:${l.textContent}`);
  const fold = () => document.querySelector('details.change-fold') as HTMLDetailsElement | null;
  const edit = (lines: ChangeLine[], everyMatch = false): ProposedChange => ({
    kind: 'edit',
    parts: [{ everyMatch, lines }],
  });

  it('shows an edit as one closed line that says how much changes, and opens to the lines', () => {
    render(
      <PermissionCard
        item={perm({
          tool: 'Edit',
          title: 'Claude wants to change a file',
          change: edit([
            { kind: 'same', text: '# Contacts' },
            { kind: 'removed', text: 'Phone: 0161 000 0000' },
            { kind: 'added', text: 'Phone: 0161 111 1111' },
            { kind: 'added', text: 'Mobile: 07700 900000' },
          ]),
        })}
        sessionId="s1"
      />,
    );
    expect(screen.getByText('clients/example/notes.md')).toBeTruthy();
    const details = fold();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('The change: 1 line removed, 2 added');
    fireEvent.click(details?.querySelector('summary') as HTMLElement);
    expect(details?.open).toBe(true);
    expect(screen.getByText(/Lines marked − are removed and lines marked \+ are added/)).toBeTruthy();
    const region = screen.getByRole('region', { name: 'The change' });
    expect(region.tabIndex).toBe(0);
    expect(lineTexts(region)).toEqual([
      // An unchanged line starts with a space, so its text lines up under the − and + signs.
      'same: # Contacts',
      'removed:−Removed: Phone: 0161 000 0000',
      'added:+Added: Phone: 0161 111 1111',
      'added:+Added: Mobile: 07700 900000',
    ]);
  });

  it('words a one-sided edit without a zero', () => {
    const { rerender } = render(
      <PermissionCard item={perm({ change: edit([{ kind: 'added', text: 'x' }]) })} sessionId="s1" />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe('The change: 1 line added');
    rerender(
      <PermissionCard
        item={perm({
          change: edit([
            { kind: 'removed', text: 'a' },
            { kind: 'removed', text: 'b' },
          ]),
        })}
        sessionId="s1"
      />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe('The change: 2 lines removed');
  });

  it('says on the closed line when an edit changes every place the text appears', () => {
    const { rerender } = render(
      <PermissionCard
        item={perm({
          change: edit(
            [
              { kind: 'removed', text: 'foo' },
              { kind: 'added', text: 'bar' },
            ],
            true,
          ),
        })}
        sessionId="s1"
      />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe(
      'The change: 1 line removed, 1 added, everywhere it appears in the file',
    );
    rerender(
      <PermissionCard
        item={perm({
          change: {
            kind: 'edit',
            parts: [
              { everyMatch: false, lines: [{ kind: 'cut' }] },
              { everyMatch: true, lines: [{ kind: 'cut' }] },
            ],
          },
        })}
        sessionId="s1"
      />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe(
      'The change (2 edits), too long to show in full, some made everywhere they appear in the file',
    );
  });

  it('says so plainly when an edit changes no lines', () => {
    render(<PermissionCard item={perm({ change: edit([]) })} sessionId="s1" />);
    expect(fold()).toBeNull();
    expect(screen.getByText('No lines change.')).toBeTruthy();
  });

  it('numbers several edits, says when a change happens everywhere, and counts folded lines', () => {
    render(
      <PermissionCard
        item={perm({
          change: {
            kind: 'edit',
            parts: [
              {
                everyMatch: false,
                lines: [
                  { kind: 'removed', text: 'a' },
                  { kind: 'gap', count: 4 },
                  { kind: 'added', text: 'b' },
                  { kind: 'gap', count: 1 },
                ],
              },
              { everyMatch: true, lines: [{ kind: 'added', text: 'c' }] },
            ],
          },
        })}
        sessionId="s1"
      />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe(
      'The change (2 edits): 1 line removed, 2 added, some made everywhere they appear in the file',
    );
    expect(screen.getByText('Change 1 of 2')).toBeTruthy();
    expect(
      screen.getByText(
        (_, el) =>
          el?.className === 'diff-part-head' &&
          el.textContent ===
            'Change 2 of 2 · Claude will make this change everywhere it appears in the file, not just the first time.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('4 unchanged lines')).toBeTruthy();
    expect(screen.getByText('1 unchanged line')).toBeTruthy();
  });

  it('says plainly when the change was cut short, without counts that would understate it', () => {
    render(
      <PermissionCard
        item={perm({
          change: {
            kind: 'edit',
            parts: [
              { everyMatch: false, lines: [{ kind: 'removed', text: 'a' }, { kind: 'cut' }] },
              { everyMatch: true, lines: [{ kind: 'cut' }] },
            ],
          },
        })}
        sessionId="s1"
      />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe(
      'The change (2 edits), too long to show in full, some made everywhere they appear in the file',
    );
    expect(screen.getAllByText("The rest isn't shown because the change is too long.")).toHaveLength(2);
  });

  it('shows a new or replacing file as plain lines with no signs, and words each case plainly', () => {
    const one = (kind: 'new-file' | 'replace-file', lines: ChangeLine[]) =>
      perm({ change: { kind, parts: [{ everyMatch: false, lines }] } });
    const { rerender } = render(
      <PermissionCard
        item={one('new-file', [
          { kind: 'added', text: '# Title' },
          { kind: 'added', text: 'Body' },
        ])}
        sessionId="s1"
      />,
    );
    expect(fold()?.querySelector('summary')?.textContent).toBe('What the new file will contain: 2 lines');
    expect(screen.queryByText(/Lines marked/)).toBeNull();
    expect(document.querySelector('.diff-sign')).toBeNull();
    expect(screen.queryByText(/Added:/)).toBeNull();
    expect(lineTexts(screen.getByRole('region', { name: 'The new contents' }))).toEqual([
      'plain:# Title',
      'plain:Body',
    ]);
    rerender(<PermissionCard item={one('replace-file', [{ kind: 'added', text: 'x' }])} sessionId="s1" />);
    expect(fold()?.querySelector('summary')?.textContent).toBe('Replaces the whole file with 1 line');
    rerender(<PermissionCard item={one('new-file', [])} sessionId="s1" />);
    expect(fold()).toBeNull();
    expect(screen.getByText('The new file will be empty.')).toBeTruthy();
    rerender(<PermissionCard item={one('replace-file', [])} sessionId="s1" />);
    expect(screen.getByText('This empties the whole file.')).toBeTruthy();
  });

  it('shows nothing extra when there is no change', () => {
    render(<PermissionCard item={perm({ tool: 'Bash', change: null })} sessionId="s1" />);
    expect(fold()).toBeNull();
    expect(document.querySelector('.change-empty')).toBeNull();
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
