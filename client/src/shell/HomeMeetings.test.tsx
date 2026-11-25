// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeMeeting, HomeMeetingsResponse } from '../../../shared/home-meetings-contract.ts';
import type { ProjectKey } from '../../../shared/projects-contract.ts';

const store = vi.hoisted(() => ({ openView: vi.fn() }));
const api = vi.hoisted(() => ({ homeMeetings: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({ useStore: () => store }));

const { HomeMeetings } = await import('./HomeMeetings.tsx');
const { projectPageRequest } = await import('../state/client-choice.ts');
const { fileNotesPrompt } = await import('../apps/projects/ProjectMeetings.tsx');

// Tuesday 24 November 2026, 10:00 local.
const NOW = new Date(2026, 10, 24, 10, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();

const meeting = (over: Partial<HomeMeeting> = {}): HomeMeeting => ({
  id: 'm1',
  title: 'Design review',
  start: at(24, 14),
  end: at(24, 14, 30),
  allDay: false,
  day: '2026-11-24',
  lastDay: null,
  people: [],
  others: 0,
  project: null,
  client: null,
  calendar: 'https://www.google.com/calendar/event?eid=abc',
  calendarKind: 'event',
  join: null,
  ...over,
});
const reply = (over: Partial<HomeMeetingsResponse> = {}): HomeMeetingsResponse => ({
  cache: 'fresh',
  checked: at(24, 8, 12),
  meetings: [],
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  api.homeMeetings.mockReset();
  store.openView.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  projectPageRequest.set('');
});

async function show(data: HomeMeetingsResponse) {
  api.homeMeetings.mockResolvedValue(data);
  render(<HomeMeetings />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('Home meetings card states', () => {
  it('says loading first', () => {
    api.homeMeetings.mockReturnValue(new Promise(() => {}));
    render(<HomeMeetings />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('says so when there is no calendar yet', async () => {
    await show(reply({ cache: 'none', checked: null }));
    expect(screen.getByText('Your meetings show here after /gm has checked your calendar.')).toBeTruthy();
  });

  it('always shows when the calendar was checked', async () => {
    await show(reply({ meetings: [meeting()] }));
    expect(screen.getByText('Calendar checked today at 08:12.')).toBeTruthy();
    cleanup();
    await show(reply({ checked: at(23, 17, 40), meetings: [meeting()] }));
    expect(screen.getByText('Calendar checked yesterday at 17:40.')).toBeTruthy();
  });

  it('adds the nudge when stale', async () => {
    await show(reply({ cache: 'stale', checked: at(21, 9), meetings: [meeting()] }));
    expect(screen.getByText('Calendar checked 21 Nov. Run /gm to update.')).toBeTruthy();
  });

  it('says when nothing is coming up', async () => {
    await show(reply());
    expect(screen.getByText('No meetings coming up in your calendar.')).toBeTruthy();
  });

  it('shows an error with Try again, which reads again', async () => {
    api.homeMeetings.mockRejectedValueOnce(new Error('x'));
    render(<HomeMeetings />);
    await screen.findByText("Couldn't read your meetings.");
    api.homeMeetings.mockResolvedValue(reply({ meetings: [meeting()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Design review');
  });

  it('keeps its rows when a later refresh fails, and re-reads every five minutes', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    api.homeMeetings.mockResolvedValueOnce(reply({ meetings: [meeting()] }));
    render(<HomeMeetings />);
    await screen.findByText('Design review');
    api.homeMeetings.mockRejectedValue(new Error('x'));
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(api.homeMeetings).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Design review')).toBeTruthy();
    expect(screen.queryByText("Couldn't read your meetings.")).toBeNull();
  });
});

describe('Home meetings rows', () => {
  it('groups by day as Today, Tomorrow and a date', async () => {
    await show(
      reply({
        meetings: [
          meeting({ id: 'a', title: 'A' }),
          meeting({ id: 'b', title: 'B', start: at(25, 9), end: at(25, 10), day: '2026-11-25' }),
          meeting({ id: 'c', title: 'C', start: at(27, 9), end: at(27, 10), day: '2026-11-27' }),
        ],
      }),
    );
    // Each day heading: the name to scan for, then its date (", " is for screen readers).
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Today, Tue 24 Nov',
      'Tomorrow, Wed 25 Nov',
      'Friday, 27 Nov',
    ]);
  });

  it('groups days into calendar weeks: this week (for screen readers only), Next week, then Week of …', async () => {
    await show(
      reply({
        meetings: [
          meeting({ id: 'a', title: 'A' }),
          meeting({ id: 'b', title: 'B', start: at(30, 9), end: at(30, 10), day: '2026-11-30' }),
          meeting({
            id: 'c',
            title: 'C',
            start: new Date(2026, 11, 8, 9).toISOString(),
            end: new Date(2026, 11, 8, 10).toISOString(),
            day: '2026-12-08',
          }),
        ],
      }),
    );
    const weeks = screen.getAllByRole('heading', { level: 3 });
    expect(weeks.map((h) => h.textContent)).toEqual(['This week', 'Next week', 'Week of 7 Dec']);
    expect(weeks[0]?.className).toBe('visually-hidden');
    expect(weeks[1]?.className).toBe('meet-week');
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Today, Tue 24 Nov',
      'Monday, 30 Nov',
      'Tuesday, 8 Dec',
    ]);
  });

  it('shows an all-day row with All day and until, never Now', async () => {
    await show(
      reply({
        meetings: [
          meeting({
            title: 'Conference',
            allDay: true,
            start: '2026-11-24',
            end: '2026-11-28',
            day: '2026-11-24',
            lastDay: '2026-11-27',
          }),
        ],
      }),
    );
    expect(screen.getByText('All day')).toBeTruthy();
    expect(screen.getByText('until Fri 27 Nov')).toBeTruthy();
    expect(screen.queryByText('Now')).toBeNull();
  });

  it('marks a meeting in progress with Now', async () => {
    await show(reply({ meetings: [meeting({ start: at(24, 9, 30), end: at(24, 10, 30) })] }));
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.queryByText('09:30')).toBeNull();
  });

  it('shows time, end time, client, project and people', async () => {
    await show(
      reply({
        meetings: [
          meeting({
            people: ['Sam Lee', 'Jo Hart'],
            others: 4,
            client: { slug: 'sky', name: 'Skyseal' },
            project: { key: 'client:sky/site' as ProjectKey, title: 'Website', ref: null },
          }),
        ],
      }),
    );
    expect(screen.getByText('14:00')).toBeTruthy();
    expect(screen.getByText('14:30')).toBeTruthy();
    const row = screen.getByText('Design review').closest('li') as HTMLElement;
    expect(row.textContent).toContain('Skyseal · Website, with Sam Lee, Jo Hart +2');
  });

  it('opens the project from the project link', async () => {
    await show(
      reply({
        meetings: [
          meeting({ project: { key: 'client:sky/site' as ProjectKey, title: 'Website', ref: null } }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open project Website' }));
    expect(projectPageRequest.get()).toBe('client:sky/site');
    expect(store.openView).toHaveBeenCalledWith('app:projects');
  });

  it('shows Join only from 15 minutes before the start until the end', async () => {
    const join = 'https://meet.google.com/abc-defg-hij';
    await show(reply({ meetings: [meeting({ join, start: at(24, 10, 20), end: at(24, 10, 50) })] }));
    expect(screen.queryByRole('link', { name: /^Join/ })).toBeNull();
    cleanup();
    await show(reply({ meetings: [meeting({ join, start: at(24, 10, 10), end: at(24, 10, 50) })] }));
    const link = screen.getByRole('link', { name: 'Join Design review (opens in a new tab)' });
    expect(link.getAttribute('href')).toBe(join);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('labels the link Open invite, or Open calendar for a day link', async () => {
    await show(
      reply({
        meetings: [
          meeting({ id: 'a', title: 'A' }),
          meeting({
            id: 'b',
            title: 'B',
            calendarKind: 'day',
            calendar: 'https://calendar.google.com/calendar/r/day/2026/11/24',
          }),
        ],
      }),
    );
    const invite = screen.getByRole('link', { name: 'Open invite for A (opens in a new tab)' });
    expect(invite.getAttribute('target')).toBe('_blank');
    expect(invite.getAttribute('rel')).toBe('noopener noreferrer');
    const day = screen.getByRole('link', { name: 'Open calendar for Tue 24 Nov (opens in a new tab)' });
    expect(day.getAttribute('href')).toBe('https://calendar.google.com/calendar/r/day/2026/11/24');
    const head = screen.getByRole('link', { name: 'Open Google Calendar (opens in a new tab)' });
    expect(head.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows three rows when today is quiet and counts the rest under Show more', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      meeting({
        id: `m${i}`,
        title: `Meeting ${i}`,
        start: at(25, 8 + i),
        end: at(25, 9 + i),
        day: '2026-11-25',
      }),
    );
    await show(reply({ meetings: many }));
    expect(screen.getByText('Meeting 2')).toBeTruthy();
    expect(screen.queryByText('Meeting 3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 4 more meetings' }));
    expect(screen.getByText('Meeting 6')).toBeTruthy();
    expect(
      within(screen.getByText('Meeting 6').closest('li') as HTMLElement).getAllByRole('link'),
    ).toHaveLength(1);
  });

  it('never hides a meeting today, however many there are', async () => {
    const today = Array.from({ length: 5 }, (_, i) =>
      meeting({
        id: `t${i}`,
        title: `Today ${i}`,
        start: at(24, 13 + i),
        end: at(24, 14 + i),
        day: '2026-11-24',
      }),
    );
    const later = meeting({ id: 'l', title: 'Later', start: at(26, 9), end: at(26, 10), day: '2026-11-26' });
    await show(reply({ meetings: [...today, later] }));
    expect(screen.getByText('Today 4')).toBeTruthy();
    expect(screen.queryByText('Later')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show 1 more meeting' })).toBeTruthy();
  });

  it('never puts a calendar or join link in the File the notes prompt', () => {
    const calendar = 'https://www.google.com/calendar/event?eid=SECRET';
    const m = {
      ...meeting({ calendar, join: 'https://meet.google.com/x' }),
      match: 'title' as const,
      notes: null,
    };
    const prompt = fileNotesPrompt(m, 'Skyseal Website');
    expect(prompt).not.toContain('SECRET');
    expect(prompt).not.toContain('google.com');
    expect(prompt).not.toContain('meet.');
  });
});
