// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoUpdate } from '../../../shared/todo-updates-contract.ts';
import { TodoUpdates, type TodoUpdatesProps } from './TodoUpdates.tsx';

// The Updates block on its own: the list (each kind of entry, plain text with safe links) and the box that adds
// one. How the panel sends it is tested in TodoPanel.test.tsx.
afterEach(cleanup);

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
    const time = within(items[1] as HTMLElement).getByText('27 Nov 2026, 14:05');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe('2026-11-27T14:05:00+00:00');
  });

  it('keeps the lines of a note', () => {
    render(<TodoUpdates team={team} compose={null} onStatus={vi.fn()} updates={[note('One\nTwo')]} />);
    const p = document.querySelector('.todo-update-text') as HTMLElement;
    expect(p.querySelectorAll('br')).toHaveLength(1);
    expect(p.textContent).toBe('OneTwo');
  });

  it('shows an automatic entry and a handover as one quiet line, with names for slugs', () => {
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
    expect(items[0]?.textContent).toBe('Ben McAdam added a file: quote.pdf 27 Nov 2026, 14:09');
    expect(items[0]?.getAttribute('data-kind')).toBe('auto');
    expect(items[1]?.textContent).toBe(
      'Ben McAdam passed it from Ben McAdam to Sam Example 26 Nov 2026, 10:00',
    );
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
  it('sends the text, then clears the box and says so', async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const onStatus = vi.fn();
    render(<Box onAdd={onAdd} onStatus={onStatus} />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: '  Sent the quote.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add update' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add update' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('Keep me');
  });

  it('asks for some text first', () => {
    const onAdd = vi.fn();
    const onStatus = vi.fn();
    render(<Box onAdd={onAdd} onStatus={onStatus} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add update' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('Write an update first.', true);
  });

  it('offers "Add update and mark as done" only to someone who can tick, and sends it with the text', async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<Box onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'Add update and mark as done' })).toBeNull();
    rerender(<Box onAdd={onAdd} canDone />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'All done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add update and mark as done' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('All done', true));
  });

  it('does nothing while another change is running', () => {
    const onAdd = vi.fn();
    render(<Box onAdd={onAdd} busy />);
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add update' }));
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
