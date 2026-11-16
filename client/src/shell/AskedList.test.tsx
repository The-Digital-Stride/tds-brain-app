// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskedTodo, AskedTodoList } from '../../../shared/contract.ts';
import { AskedList } from './AskedList.tsx';

const asked = (id: string, title: string, over: Partial<AskedTodo> = {}): AskedTodo => ({
  key: `asked:todo/${id}`,
  id,
  state: 'waiting',
  path: `todo/${id}`,
  title,
  assignee: 'ben-mcadam',
  assigneeName: 'Ben McAdam',
  due: null,
  details: '',
  asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-13T12:00:00+00:00', source: 'stamp' },
  done: null,
  version: 'v1',
  ...over,
});
const done = (name: string | null): AskedTodo =>
  asked('d.md', 'Finished job', {
    key: 'asked:todo/done/d.md',
    state: 'done',
    done: { slug: null, name, at: '2026-11-14T12:00:00+00:00', source: 'stamp' },
  });
const full = (over: Partial<AskedTodoList> = {}): AskedTodoList => ({
  waiting: [asked('a.md', 'Send the quote')],
  done: [done('Ben McAdam')],
  historyRead: true,
  ...over,
});
const view = (
  list: AskedTodoList | null,
  state: 'loading' | 'loaded' | 'failed' = 'loaded',
  onOpen = vi.fn(),
) => render(<AskedList list={list} state={state} onRetry={vi.fn()} openKey={null} onOpen={onOpen} />);

afterEach(cleanup);

describe('AskedList', () => {
  it('leads with the quiet line and shows who has each waiting to-do and since when', () => {
    view(full());
    expect(screen.getByText(/^Asked of others:/)).toBeTruthy();
    expect(screen.getByText('With Ben since 13 Nov')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Waiting/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps Done closed, and says who finished and when (or just Done when no one is named)', () => {
    view(
      full({ done: [done('Ben McAdam'), { ...done(null), key: 'asked:todo/done/e.md', title: 'Other' }] }),
    );
    const fold = screen.getByRole('button', { name: /Done in the last 60 days/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByText('Done by Ben, 14 Nov', { selector: 'span' })).toHaveLength(1);
    expect(screen.getAllByText('Done, 14 Nov', { selector: 'span' })).toHaveLength(1);
  });

  it('says so when nothing is waiting or done', () => {
    view(full({ waiting: [], done: [] }));
    expect(screen.getByText("Nothing you've asked of others is waiting.")).toBeTruthy();
    expect(screen.getByText("Nothing you've asked of others was finished recently.")).toBeTruthy();
  });

  it('adds one quiet line when the git history could not be read', () => {
    view(full({ historyRead: false }));
    expect(screen.getByText(/the git history couldn't be read/)).toBeTruthy();
  });

  it('hides the due date on done rows and keeps it on waiting rows', () => {
    view(
      full({
        waiting: [asked('a.md', 'Send the quote', { due: '2999-01-01' })],
        done: [{ ...done('Ben McAdam'), due: '2999-01-01' }],
      }),
    );
    const metas = Array.from(document.querySelectorAll('.todo-meta')).map((e) => e.textContent ?? '');
    expect(metas[0]).toMatch(/^With Ben since 13 Nov, /);
    expect(metas[1]).toBe('Done by Ben, 14 Nov');
  });

  it('says the loading and failure lines as a status', () => {
    const { unmount } = view(null, 'loading');
    expect(screen.getByText("Loading what you've asked of others.")).toBeTruthy();
    unmount();
    view(null, 'failed');
    expect(screen.getByText(/Couldn't load these/).getAttribute('role')).toBe('status');
  });

  it('opens a closed fold when the panel moves to a row inside it', () => {
    const props = { list: full(), state: 'loaded' as const, onRetry: vi.fn(), onOpen: vi.fn() };
    const { rerender } = render(<AskedList {...props} openKey={null} />);
    const fold = () => screen.getByRole('button', { name: /Done in the last 60 days/ });
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    rerender(<AskedList {...props} openKey="asked:todo/done/d.md" />);
    expect(fold().getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a row, and shows a retry line only here when the load failed', () => {
    const onOpen = vi.fn();
    const { unmount } = view(full(), 'loaded', onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Send the quote' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'asked:todo/a.md' }));
    unmount();
    view(null, 'failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
