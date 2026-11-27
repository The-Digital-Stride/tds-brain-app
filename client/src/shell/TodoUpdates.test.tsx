// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entryKey } from '../../../shared/todo-changes.ts';
import type { TodoUpdate } from '../../../shared/todo-updates-contract.ts';
import { TodoUpdates, type TodoUpdatesProps } from './TodoUpdates.tsx';

// The Updates block on its own: the list (each kind of entry, plain text with safe links) and the box that adds
// one. How the panel sends it is tested in TodoPanel.test.tsx.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
/** Dates read against today ("Today, 14:05", no year this year), so the list tests fix it. */
const today = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });

const team = [
  { slug: 'sam-example', name: 'Sam Example' },
  { slug: 'ben-mcadam', name: 'Ben McAdam' },
];
const note = (text: string, over: Partial<TodoUpdate> = {}): TodoUpdate => ({
  kind: 'note',
  at: '2026-11-27T14:05:00+00:00',
  by: 'ben-mcadam',
  byName: 'Ben McAdam',
  text,
  via: null,
  action: 'update',
  ...over,
});
const auto = (text: string, over: Partial<TodoUpdate> = {}): TodoUpdate => ({
  kind: 'auto',
  at: '2026-11-27T14:09:00+00:00',
  by: 'ben-mcadam',
  byName: 'Ben McAdam',
  text,
  via: 'TDS Brain App',
  action: 'files',
  ...over,
});

function Box({
  onAdd = vi.fn().mockResolvedValue(true),
  canDone = false,
  busy = false,
  ...rest
}: Partial<TodoUpdatesProps> & {
  onAdd?: (text: string, markDone: boolean) => Promise<boolean>;
  canDone?: boolean;
  busy?: boolean;
}) {
  const [text, setText] = useState('');
  return (
    <TodoUpdates team={team} onStatus={vi.fn()} compose={{ text, setText, busy, canDone, onAdd }} {...rest} />
  );
}

describe('the list', () => {
  it('shows a note with its writer, the time in UK time and its text, newest first', () => {
    today('2026-12-05T12:00:00Z');
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[
          note('First thing'),
          note('Second thing', { at: '2026-11-28T09:30:00+00:00', byName: 'Sam Example', by: 'sam-example' }),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Second thing');
    expect(items[1]?.textContent).toContain('First thing');
    expect(within(items[1] as HTMLElement).getByText('Ben McAdam')).toBeTruthy();
    const time = within(items[1] as HTMLElement).getByText('27 Nov, 14:05');
    expect(time.tagName).toBe('TIME');
    // The full date and time stay in the tooltip.
    expect(time.getAttribute('title')).toBe('27 Nov 2026, 14:05');
    expect(time.getAttribute('datetime')).toBe('2026-11-27T14:05:00+00:00');
  });

  it('keeps the lines of a note', () => {
    render(<TodoUpdates team={team} compose={null} onStatus={vi.fn()} updates={[note('One\nTwo')]} />);
    const p = document.querySelector('.todo-update-text') as HTMLElement;
    expect(p.querySelectorAll('br')).toHaveLength(1);
    expect(p.textContent).toBe('OneTwo');
  });

  it('shows an automatic entry and a handover as one quiet line, with names for slugs', () => {
    today('2026-12-05T12:00:00Z');
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[
          {
            kind: 'handover',
            at: '2026-11-26T10:00:00+00:00',
            by: null,
            byName: 'Ben McAdam',
            text: 'passed it from ben-mcadam to sam-example',
            via: 'TDS Brain App',
            action: 'assignee',
          },
          auto('added a file: quote.pdf'),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    // Newest first: the file was added after the handover.
    expect(items[0]?.textContent).toBe('Ben McAdam added a file: quote.pdf · 27 Nov, 14:09');
    expect(items[0]?.getAttribute('data-kind')).toBe('auto');
    // The person who passed it on is named once (UX gate: "from Ben McAdam" after their own name read as a typo).
    expect(items[1]?.textContent).toBe('Ben McAdam passed it to Sam Example · 26 Nov, 10:00');
    expect(items[1]?.getAttribute('data-kind')).toBe('handover');
  });

  it("says older updates aren't shown, and shows hand-edited lines as plain text", () => {
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[note('Hi')]}
        more
        extras={['- a line someone typed']}
      />,
    );
    expect(screen.getByText("Older updates aren't shown.")).toBeTruthy();
    expect(screen.getByText('- a line someone typed')).toBeTruthy();
  });

  it('says there are none yet when it can take one, and shows nothing at all when it cannot', () => {
    const { container, rerender } = render(<Box />);
    expect(screen.getByText('No updates yet.')).toBeTruthy();
    rerender(<TodoUpdates team={team} compose={null} onStatus={vi.fn()} updates={[]} />);
    expect(container.textContent).toBe('');
    rerender(<TodoUpdates team={team} compose={null} onStatus={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('text from people stays text', () => {
  it('turns an http(s) address into a link that opens in a new tab, leaving the full stop out', () => {
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[note('The quote is at https://drive.example.com/file/1?x=2. Thanks')]}
      />,
    );
    const link = screen.getByRole('link', { name: /drive\.example\.com/ });
    expect(link.getAttribute('href')).toBe('https://drive.example.com/file/1?x=2');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('(opens in a new tab)');
    expect(document.querySelector('.todo-update-text')?.textContent).toContain('. Thanks');
  });

  it('leaves a very long run of brackets after an address as text, and still links a normal address', () => {
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[note(`https://a.co/${')'.repeat(3000)}`), note('See https://b.example.com/ok')]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://b.example.com/ok');
  });

  it('never makes HTML, markdown or other schemes into anything but text', () => {
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[note('<script>alert(1)</script> **bold** [x](javascript:alert(1)) <img src=x onerror=y>')]}
      />,
    );
    const p = document.querySelector('.todo-update-text') as HTMLElement;
    expect(p.querySelector('script, strong, img, a')).toBeNull();
    expect(p.textContent).toContain('<script>alert(1)</script> **bold** [x](javascript:alert(1))');
  });
});

describe('adding an update', () => {
  it('puts the box above the newest-first list', () => {
    render(<Box updates={[note('Older')]} />);
    const box = screen.getByLabelText('Add an update');
    const list = document.querySelector('.todo-update-list') as HTMLElement;
    expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sends once when pressed twice before the reply', async () => {
    let reply: (v: boolean) => void = () => {};
    const onAdd = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          reply = r;
        }),
    );
    render(<Box onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Once' } });
    const button = screen.getByRole('button', { name: 'Add an update' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText('Add an update'), { key: 'Enter', metaKey: true });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    reply(true);
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
  });

  it('sends the text, then clears the box and says so', async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const onStatus = vi.fn();
    render(<Box onAdd={onAdd} onStatus={onStatus} />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: '  Sent the quote.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Sent the quote.', false));
    await waitFor(() =>
      expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(onStatus).toHaveBeenCalledWith('Update added.');
  });

  it('keeps what was typed when it was not added', async () => {
    const onAdd = vi.fn().mockResolvedValue(false);
    render(<Box onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('Keep me');
  });

  it('asks for some text first', () => {
    const onAdd = vi.fn();
    const onStatus = vi.fn();
    render(<Box onAdd={onAdd} onStatus={onStatus} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add an update' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('Write an update first.', true);
  });

  it('offers "Add an update and mark as done" only to someone who can tick, and sends it with the text', async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<Box onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'Add an update and mark as done' })).toBeNull();
    rerender(<Box onAdd={onAdd} canDone />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'All done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update and mark as done' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('All done', true));
  });

  it('does nothing while another change is running', () => {
    const onAdd = vi.fn();
    render(<Box onAdd={onAdd} busy />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update' }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows a count only when the text is near the limit', () => {
    render(<Box />);
    const box = screen.getByLabelText('Add an update');
    fireEvent.change(box, { target: { value: 'short' } });
    expect(screen.queryByText(/characters$/)).toBeNull();
    fireEvent.change(box, { target: { value: 'x'.repeat(1900) } });
    expect(screen.getByText('1,900 of 2,000 characters')).toBeTruthy();
  });

  it('has no box and no buttons when it is read only', () => {
    render(<TodoUpdates team={team} compose={null} onStatus={vi.fn()} updates={[note('Hi')]} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('what is new since the person looked', () => {
  const old = note('Old one.', { at: '2026-11-27T10:00:00+00:00' });
  const fresh = note('Fresh one.', { at: '2026-11-27T14:05:00+00:00' });

  it('tags the entries in the set with "New", and says how many in a polite status line above the list', () => {
    today('2026-11-27T15:00:00Z');
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[old, fresh]}
        newKeys={new Set([entryKey(fresh)])}
      />,
    );
    const line = screen.getByText('1 new since you last looked.');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.getAttribute('aria-live')).toBe('polite');
    const items = screen.getAllByRole('listitem');
    expect(within(items[0] as HTMLElement).getByText('New')).toBeTruthy();
    expect(within(items[1] as HTMLElement).queryByText('New')).toBeNull();
  });

  it('counts more than one', () => {
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[old, fresh]}
        newKeys={new Set([entryKey(old), entryKey(fresh)])}
      />,
    );
    expect(screen.getByText('2 new since you last looked.')).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(2);
  });

  it('shows no tag and no words without a set, or with an empty one', () => {
    const { rerender } = render(
      <TodoUpdates team={team} compose={null} onStatus={vi.fn()} updates={[old, fresh]} />,
    );
    expect(screen.queryByText('New')).toBeNull();
    rerender(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[old, fresh]}
        newKeys={new Set()}
      />,
    );
    expect(screen.queryByText(/new since you last looked/)).toBeNull();
  });
});

describe('a handover and the note written with it', () => {
  const handover = (over: Partial<TodoUpdate> = {}): TodoUpdate => ({
    kind: 'handover',
    at: '2026-11-27T14:05:00+00:00',
    by: null,
    byName: 'Ben McAdam',
    text: 'handed it back to sam-example',
    via: 'TDS Brain App',
    action: 'assignee',
    ...over,
  });

  it('show as one card: the handover line as its heading with the time, the note under it', () => {
    today('2026-12-05T12:00:00Z');
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[handover(), note('Over to you, the quote is attached.')]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute('data-kind')).toBe('handover');
    expect(items[0]?.getAttribute('data-merged')).toBe('true');
    expect(items[0]?.querySelector('.todo-update-line')?.textContent).toBe(
      'Ben McAdam handed it back to Sam Example · 27 Nov, 14:05',
    );
    expect(items[0]?.querySelector('.todo-update-text')?.textContent).toBe(
      'Over to you, the quote is attached.',
    );
  });

  it('pairs them whichever came first in the log', () => {
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[note('Over to you.'), handover()]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('keep apart when the writers differ, or the minute does', () => {
    const { rerender } = render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[handover(), note('Hello.', { byName: 'Sam Example', by: 'sam-example' })]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    rerender(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[handover(), note('Later.', { at: '2026-11-27T14:06:00+00:00' })]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('tag the one card when either was unseen', () => {
    const n = note('Over to you.');
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[handover(), n]}
        newKeys={new Set([entryKey(n)])}
      />,
    );
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getByText('1 new since you last looked.')).toBeTruthy();
  });

  it('counts the one card once when both its lines were unseen, so the number matches the tags (UX gate R2)', () => {
    const n = note('Over to you.');
    const h = handover();
    render(
      <TodoUpdates
        team={team}
        compose={null}
        onStatus={vi.fn()}
        updates={[h, n]}
        newKeys={new Set([entryKey(n), entryKey(h)])}
      />,
    );
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getByText('1 new since you last looked.')).toBeTruthy();
  });
});
