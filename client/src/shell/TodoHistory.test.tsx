// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoActor, TodoEvent, TodoHistoryResponse } from '../../../shared/contract.ts';

const apiMock = vi.hoisted(() => ({ todoHistory: vi.fn() }));
vi.mock('../api.ts', () => ({ api: apiMock }));

const { TodoHistory } = await import('./TodoHistory.tsx');

const team = [
  { slug: 'ian-hancock', name: 'Ian Hancock' },
  { slug: 'ben-mcadam', name: 'Ben McAdam' },
];
const actor = (name: string | null, source: TodoActor['source'] = 'stamp'): TodoActor => ({
  slug: null,
  name,
  at: '2026-11-13T14:05:00',
  source,
});
const ev = (kind: TodoEvent['kind'], over: Partial<TodoEvent> = {}): TodoEvent => ({
  kind,
  actor: actor('Ian Hancock'),
  ...over,
});
const reply = (over: Partial<TodoHistoryResponse> = {}): TodoHistoryResponse => ({
  status: 'ok',
  events: [],
  more: false,
  ...over,
});
const show = () => {
  render(<TodoHistory todoKey="a.md" team={team} />);
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
};

beforeEach(() => apiMock.todoHistory.mockReset());
afterEach(cleanup);

describe('TodoHistory', () => {
  it('asks only when opened, and once', async () => {
    apiMock.todoHistory.mockResolvedValue(reply());
    render(<TodoHistory todoKey="a.md" team={team} />);
    expect(apiMock.todoHistory).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: 'History' });
    fireEvent.click(toggle);
    await screen.findByText('No changes are recorded yet.', { selector: '.todo-note' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(apiMock.todoHistory).toHaveBeenCalledTimes(1);
    expect(apiMock.todoHistory).toHaveBeenCalledWith('a.md');
  });

  it('says each kind of change in plain words, newest first', async () => {
    apiMock.todoHistory.mockResolvedValue(
      reply({
        events: [
          ev('passed-on', { from: 'ian-hancock', to: 'ben-mcadam' }),
          ev('retitled', { from: 'Old name', to: 'New' }),
          ev('due', { to: '2026-11-18' }),
          ev('due', { to: null }),
          ev('details'),
          ev('done', { actor: actor(null) }),
          ev('deleted'),
          ev('changed'),
          ev('created', { to: 'open' }),
          ev('created', { to: 'ben-mcadam' }),
        ],
      }),
    );
    show();
    const items = (await screen.findAllByRole('listitem')).map((li) => li.textContent);
    expect(items).toEqual([
      '13 Nov, 14:05 · Ian Hancock passed it from Ian Hancock to Ben McAdam',
      '13 Nov, 14:05 · Ian Hancock renamed it from ‘Old name’',
      '13 Nov, 14:05 · Ian Hancock set the due date to 18 Nov',
      '13 Nov, 14:05 · Ian Hancock cleared the due date',
      '13 Nov, 14:05 · Ian Hancock changed the details',
      '13 Nov, 14:05 · Someone ticked it off',
      '13 Nov, 14:05 · Ian Hancock deleted it',
      '13 Nov, 14:05 · Ian Hancock changed it',
      '13 Nov, 14:05 · Ian Hancock added it, open to anyone',
      '13 Nov, 14:05 · Ian Hancock added it for Ben McAdam',
    ]);
  });

  it('marks names from the sync record once, with a note', async () => {
    apiMock.todoHistory.mockResolvedValue(
      reply({ events: [ev('done', { actor: actor('Pete', 'history') })] }),
    );
    show();
    await screen.findByText(/^\* From git history \(the brain's sync record\)/);
    expect(screen.getByText('(git history)', { exact: false })).toBeTruthy();
  });

  it('says what a personal, unavailable or cut-short record means', async () => {
    apiMock.todoHistory.mockResolvedValueOnce(reply({ status: 'personal' }));
    show();
    await screen.findByText("Personal tasks aren't synced, so there's no history.");
    cleanup();
    apiMock.todoHistory.mockResolvedValueOnce(reply({ status: 'unavailable' }));
    show();
    await screen.findByText("History isn't available in this brain.");
    cleanup();
    apiMock.todoHistory.mockResolvedValueOnce(reply({ events: [ev('done')], more: true }));
    show();
    await screen.findByText("Older changes aren't shown.");
  });

  it('says what happens to a screen reader, in one status line', async () => {
    let resolve: (r: TodoHistoryResponse) => void = () => {};
    apiMock.todoHistory.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    show();
    const status = () => screen.getByRole('status').textContent;
    await waitFor(() => expect(status()).toBe('Loading…'));
    resolve(reply({ events: [ev('done'), ev('retitled', { from: 'a', to: 'b' })] }));
    await waitFor(() => expect(status()).toBe('2 changes.'));
    cleanup();
    apiMock.todoHistory.mockRejectedValueOnce(new Error('x'));
    show();
    await waitFor(() => expect(status()).toBe("Couldn't load the history."));
    cleanup();
    apiMock.todoHistory.mockResolvedValueOnce(reply());
    show();
    await waitFor(() => expect(status()).toBe('No changes are recorded yet.'));
  });

  it('shows a short retry line when the request fails, and retries', async () => {
    apiMock.todoHistory.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(reply());
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByText('No changes are recorded yet.', { selector: '.todo-note' })).toBeTruthy(),
    );
  });
});
