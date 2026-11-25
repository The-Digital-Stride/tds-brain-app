// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatFile } from '../../../shared/contract.ts';
import type { ChatItem } from '../state/chat-reducer.ts';
import { Transcript } from './Transcript.tsx';

vi.mock('../store.tsx', () => ({
  useStore: () => ({ boot: { identity: { email: 'me@tds.example' } } }),
}));

afterEach(cleanup);

const F = '```';
const DRAFT = `${F}email\nTo: jo@acme.co.uk\nSubject: Boiler quote\n\nHi Jo,\n\nRef: [ACM4K7]\n${F}`;
const reply = (id: string, text: string, done = true): ChatItem => ({ kind: 'assistant', id, text, done });
const user: ChatItem = { kind: 'user', id: 'u', text: 'Draft it' };
const step: ChatItem = {
  kind: 'tool',
  id: 't1',
  tool: 'Write',
  label: 'Saved a file',
  status: 'ok',
  children: [],
};
const file: ChatFile = {
  key: 'k1',
  path: 'clients/acme/reports/quote.md',
  item: null,
  scope: { id: 'client:acme', name: 'Acme', kind: 'client' },
  actions: ['mentioned'],
  toolUseIds: [],
  edits: 0,
  order: 1,
};

function show(items: ChatItem[], files: ChatFile[] = []) {
  const onFile = vi.fn();
  render(
    <Transcript
      items={items}
      sessionId="s"
      sessionState="idle"
      files={files}
      brainRoot="/brain"
      onFile={onFile}
    />,
  );
  return onFile;
}
const cards = () => screen.queryAllByRole('group', { name: /^Email draft/ });

describe('an email Claude drafted, in the thread', () => {
  it('shows the words before, the card, and the words after, in order', () => {
    show(
      [
        user,
        reply(
          'a',
          `Here it is, with \`clients/acme/reports/quote.md\` attached:\n\n${DRAFT}\n\nShall I **change** anything?`,
        ),
      ],
      [file],
    );
    const box = document.querySelector('.msg-assistant');
    expect(Array.from(box?.children ?? []).map((c) => c.className)).toEqual([
      'markdown',
      'email-draft',
      'markdown',
    ]);
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toBeTruthy();
    // The words round it are still markdown, and file links in them still work.
    expect(box?.querySelector('.markdown strong')?.textContent).toBe('change');
    expect(box?.querySelector('.markdown a[href^="#chat-file="]')).not.toBeNull();
    // The block is not also drawn as code.
    expect(box?.querySelector('pre code')).toBeNull();
  });

  it('a reply with no email is drawn exactly as before', () => {
    show([user, reply('a', `Words.\n\n${F}ts\nconst email = 1;\n${F}`)]);
    const box = document.querySelector('.msg-assistant');
    expect(Array.from(box?.children ?? []).map((c) => c.className)).toEqual(['markdown']);
    expect(box?.querySelector('pre code')?.textContent).toContain('const email = 1;');
    expect(cards()).toHaveLength(0);
  });

  it('stays in view when a step follows it in the same turn', () => {
    show([user, reply('a', `Draft:\n\n${DRAFT}`), step, reply('b', 'Saved the notes too.')]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.closest('details')).toBeNull();
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toBeTruthy();
  });

  it('has no buttons while it is still arriving, and gets them when the reply ends even unclosed', () => {
    const open = `Draft:\n\n${F}email\nTo: jo@acme.co.uk\n\nHi Jo`;
    const { unmount } = render(
      <Transcript items={[user, reply('a', open, false)]} sessionId="s" sessionState="working" />,
    );
    expect(cards()).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Open in Gmail/ })).toBeNull();
    unmount();
    render(<Transcript items={[user, reply('a', open, true)]} sessionId="s" sessionState="idle" />);
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toBeTruthy();
  });

  it('a reply that was stopped half-way through an email still gets its buttons', () => {
    // A stopped turn never marks its reply as finished: what follows it, or Claude going idle, does.
    const open = `Draft:\n\n${F}email\nTo: jo@acme.co.uk\n\nHi Jo, the quote is`;
    const stopped: ChatItem = {
      kind: 'turn-end',
      id: 'e',
      ok: true,
      interrupted: true,
      errorText: null,
      durationMs: 1,
    };
    const { unmount } = render(
      <Transcript items={[user, reply('a', open, false), stopped]} sessionId="s" sessionState="idle" />,
    );
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toBeTruthy();
    expect(cards()[0]?.getAttribute('aria-busy')).toBe('false');
    unmount();
    // Still the newest thing while Claude works: still arriving.
    render(<Transcript items={[user, reply('a', open, false)]} sessionId="s" sessionState="working" />);
    expect(screen.queryByRole('link', { name: /Open in Gmail/ })).toBeNull();
    cleanup();
    // An older unfinished reply, with a newer message after it, while Claude works on that one.
    render(
      <Transcript
        items={[user, reply('a', open, false), stopped, { ...user, id: 'u2' }, reply('b', 'Thinking', false)]}
        sessionId="s"
        sessionState="working"
      />,
    );
    expect(screen.getByRole('link', { name: /Open in Gmail/ })).toBeTruthy();
  });

  it("a helper's report never gets a card", () => {
    const helper: ChatItem = {
      kind: 'tool',
      id: 't2',
      tool: 'Agent',
      label: 'Asked a helper',
      status: 'ok',
      children: [{ kind: 'assistant', id: 'h1', text: DRAFT, done: true }],
    };
    show([
      user,
      helper,
      { kind: 'report', id: 'r1', name: 'helper', text: DRAFT } as ChatItem,
      reply('b', 'Done.'),
    ]);
    expect(cards()).toHaveLength(0);
    expect(document.querySelector('.email-draft')).toBeNull();
  });
});
