// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeetingView, ProjectMeetingsResponse } from '../../../../shared/project-meetings-contract.ts';
import type { ProjectKey } from '../../../../shared/projects-contract.ts';

const store = vi.hoisted(() => ({
  openView: vi.fn(),
  startChat: vi.fn(async (..._args: unknown[]) => 's1' as string | null),
}));
const dispatch = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({ startSession: vi.fn(), libraryItems: vi.fn(), projectMeetings: vi.fn() }));
const openLibraryItem = vi.hoisted(() => vi.fn());
vi.mock('../shared/search.ts', () => ({ openLibraryItem }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { ProjectMeetings } = await import('./ProjectMeetings.tsx');
const { ShellContext } = await import('../../shell/shell-context.ts');

const KEY = 'client:skyseal/site' as ProjectKey;
const card = { key: KEY, title: 'Website rebuild', client: 'skyseal', space: 'client' };
const clients = [{ slug: 'skyseal', name: 'Skyseal' }];
// Wednesday 25 November 2026, 14:30 in whatever zone the test runs in.
const START = new Date(2026, 10, 25, 14, 30).toISOString();

const meeting = (over: Partial<MeetingView> = {}): MeetingView => ({
  id: 'm1',
  title: 'Secret invite title',
  start: START,
  end: null,
  people: ['Jo Smith', 'Sam Lee'],
  others: 4,
  match: 'title',
  notes: null,
  calendar: 'https://www.google.com/calendar/event?eid=abc',
  calendarKind: 'event',
  join: null,
  ...over,
});
const reply = (over: Partial<ProjectMeetingsResponse> = {}): ProjectMeetingsResponse => ({
  cache: 'fresh',
  checked: '2026-11-23T08:00:00Z',
  last: null,
  next: null,
  ...over,
});

function show(data: ProjectMeetingsResponse | null, error = false) {
  return render(
    <ShellContext.Provider value={{ dispatch } as never}>
      <ProjectMeetings card={card} clients={clients} meetings={{ data, error, retry: vi.fn() }} />
    </ShellContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Meetings card', () => {
  it('says so when there is no calendar yet, and while loading or failing', () => {
    show(reply({ cache: 'none', checked: null }));
    expect(screen.getByText('Your meetings show here after /gm has checked your calendar.')).toBeTruthy();
    cleanup();
    show(null);
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    show(null, true);
    expect(screen.getByText("Couldn't read your meetings.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says none found, and hints when the calendar is stale', () => {
    show(reply({ cache: 'stale', checked: '2026-11-19T08:00:00Z' }));
    expect(screen.getByText('Calendar last checked 19 Nov.')).toBeTruthy();
    expect(screen.getByText('No meetings found for this project in your calendar.')).toBeTruthy();
  });

  it('shows last and next with day, time and people', () => {
    show(reply({ last: meeting(), next: meeting({ id: 'm2', title: 'Kick-off', people: [], others: 0 }) }));
    expect(screen.getByText('Last meeting: Secret invite title')).toBeTruthy();
    expect(screen.getByText('Wed 25 Nov, 14:30 · With Jo Smith, Sam Lee +2')).toBeTruthy();
    expect(screen.getByText('Next meeting: Kick-off')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'File the notes' })).toBeTruthy();
  });

  it('File the notes starts a project chat in the drawer, without the invite title', async () => {
    show(reply({ last: meeting() }));
    fireEvent.click(screen.getByRole('button', { name: 'File the notes' }));
    await waitFor(() =>
      expect(store.startChat).toHaveBeenCalledWith(
        "File the notes for my meeting on Wednesday 25 November at 14:30 with the meeting-notes skill. It's for the Skyseal Website rebuild project.",
        'skyseal',
        { open: true, in: 'drawer', project: KEY },
      ),
    );
    expect(JSON.stringify(store.startChat.mock.calls)).not.toContain('Secret invite title');
  });

  it('uses the "probably" wording for a likely match', async () => {
    store.startChat.mockClear();
    show(reply({ last: meeting({ match: 'only' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'File the notes' }));
    await waitFor(() => expect(store.startChat).toHaveBeenCalled());
    expect(store.startChat.mock.calls[0]?.[0]).toBe(
      "File the notes for my meeting on Wednesday 25 November at 14:30 with the meeting-notes skill. It's probably for the Skyseal Website rebuild project; check that with me.",
    );
  });

  it('uses the certain wording for a match by code', async () => {
    store.startChat.mockClear();
    show(reply({ last: meeting({ match: 'ref' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'File the notes' }));
    await waitFor(() => expect(store.startChat).toHaveBeenCalled());
    const prompt = String(store.startChat.mock.calls[0]?.[0]);
    expect(prompt).toBe(
      "File the notes for my meeting on Wednesday 25 November at 14:30 with the meeting-notes skill. It's for the Skyseal Website rebuild project.",
    );
    expect(prompt).not.toContain('check');
  });

  it('shows Notes filed with Open notes, which opens Documents', async () => {
    const item = { id: 'n1', kind: 'document' };
    api.libraryItems.mockResolvedValue({ files: [{ scope: { id: 'scope-1' }, item }] });
    show(reply({ last: meeting({ notes: { id: 'n1', path: 'clients/skyseal/call-notes/x.md' } }) }));
    expect(screen.getByText('Notes filed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'File the notes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open notes/ }));
    await waitFor(() => expect(store.openView).toHaveBeenCalledWith('app:documents'));
    expect(api.libraryItems).toHaveBeenCalledWith(['n1']);
    expect(openLibraryItem).toHaveBeenCalledWith('documents', 'scope-1', item);
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });
  });
});

describe('invite links', () => {
  afterEach(() => cleanup());
  it('Last and Next carry Open invite, Open calendar for a day link', () => {
    show(
      reply({
        last: meeting({ title: 'Kick-off' }),
        next: meeting({
          id: 'm2',
          title: 'Review',
          calendarKind: 'day',
          calendar: 'https://calendar.google.com/calendar/r/day/2026/11/25',
        }),
      }),
    );
    const invite = screen.getByRole('link', { name: 'Open invite for Kick-off (opens in a new tab)' });
    expect(invite.getAttribute('target')).toBe('_blank');
    expect(invite.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('link', { name: /^Open calendar for Wed 25 Nov/ })).toBeTruthy();
  });

  it('Next carries Join only in the 15-minute window', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 25, 14, 20) });
    try {
      show(reply({ next: meeting({ join: 'https://meet.google.com/abc' }) }));
      expect(
        screen.getByRole('link', { name: 'Join Secret invite title (opens in a new tab)' }),
      ).toBeTruthy();
      cleanup();
      vi.setSystemTime(new Date(2026, 10, 25, 13, 0));
      show(reply({ next: meeting({ join: 'https://meet.google.com/abc' }) }));
      expect(screen.queryByRole('link', { name: /^Join/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
