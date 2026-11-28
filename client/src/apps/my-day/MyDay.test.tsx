// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmAnswer } from '../../../../shared/time-contract.ts';
import { day, entry, status, WORK_ITEMS } from './testing.ts';

const api = vi.hoisted(() => ({
  timeStatus: vi.fn(),
  timeConnect: vi.fn(),
  timeDisconnect: vi.fn(),
  timeWorkItems: vi.fn(),
  timeDay: vi.fn(),
  timeRefresh: vi.fn(),
  timeAddEntry: vi.fn(),
  timeChangeEntry: vi.fn(),
  timeDeleteEntry: vi.fn(),
  timeConfirm: vi.fn(),
}));
const openSettings = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => ({ openSettings }) }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: { panelOpen: true }, dispatch, modes: { panelOverlays: false } }),
}));

const { MyDaySheet } = await import('./MyDaySheet.tsx');
const { MyDayPanel } = await import('./MyDayPanel.tsx');
const { myDay } = await import('./store.ts');

const ID = entry().id;
const screenUi = () => (
  <>
    <MyDaySheet />
    <MyDayPanel />
  </>
);

beforeEach(() => {
  myDay.reset();
  for (const fn of Object.values(api)) fn.mockReset();
  openSettings.mockReset();
  dispatch.mockReset();
  api.timeStatus.mockResolvedValue(status());
  api.timeDay.mockResolvedValue(day());
  api.timeWorkItems.mockResolvedValue({ items: WORK_ITEMS, fetchedAt: '2026-11-28T08:00:00Z' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function shown() {
  render(screenUi());
  await screen.findByText('Planning the launch');
}

describe('the day', () => {
  it('shows the date, status, total, entries, chips and totals by work item', async () => {
    api.timeDay.mockResolvedValue(
      day({
        entries: [
          entry({
            id: 'b0000000-0000-4000-8000-000000000002',
            values: {
              ...entry().values,
              startAt: '2026-11-27T13:00:00+00:00',
              description: 'Afternoon call',
            },
            certainty: 'suggested',
            edited: ['description'],
            missing: true,
            workItemClosed: true,
            problems: ['That work item is closed.'],
          }),
          entry(),
        ],
        totalMinutes: 90,
        gaps: [{ startAt: '2026-11-27T09:45:00+00:00', minutes: 195 }],
        captureNotes: ['No chat history is kept this far back.'],
      }),
    );
    render(screenUi());
    await screen.findByText('Planning the launch');
    expect(screen.getByRole('heading', { level: 2, name: 'Saturday 28 November 2026' })).toBeTruthy();
    expect(screen.getByText('Not confirmed')).toBeTruthy();
    expect(screen.getByText('1:30')).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    // Time order: the morning entry, the quiet gap, then the afternoon one.
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Planning the launch'),
      expect.stringContaining('3:15 with nothing recorded from 09:45'),
      expect.stringContaining('Afternoon call'),
    ]);
    expect(within(rows[0] as HTMLElement).getByText('09:00–09:45')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('From chat')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Strong')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/Acme retainer · Billable/)).toBeTruthy();
    const late = within(rows[2] as HTMLElement);
    for (const word of [
      'Check',
      'Edited',
      'No longer found',
      'Closed in Toolbox',
      'That work item is closed.',
    ])
      expect(late.getByText(word)).toBeTruthy();
    expect(screen.getByText('No chat history is kept this far back.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Totals by work item' })).toBeTruthy();
  });

  it('Confirm day is the one primary button, disabled with its reason shown', async () => {
    api.timeDay.mockResolvedValue(day({ confirmBlocked: 'Pick a work item for 2 entries first.' }));
    await shown();
    const confirm = screen.getByRole('button', { name: 'Confirm day' });
    expect(confirm.getAttribute('data-variant')).toBe('primary');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.getAttribute('aria-describedby')).toBe('myday-reason');
    expect(screen.getByText('Pick a work item for 2 entries first.')).toBeTruthy();
    fireEvent.click(confirm);
    expect(api.timeConfirm).not.toHaveBeenCalled();
  });

  it('hides Refresh on a confirmed day', async () => {
    api.timeDay.mockResolvedValue(day({ status: 'confirmed', revision: 2 }));
    await shown();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('moves between days, never past today or before the earliest day', async () => {
    api.timeStatus.mockResolvedValue(status({ today: '2026-11-27', earliest: '2026-11-26' }));
    await shown();
    expect(screen.getByRole('button', { name: 'Next day' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() => expect(api.timeDay).toHaveBeenCalledWith('2026-11-26'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Previous day' }).getAttribute('aria-disabled')).toBe('true'),
    );
  });

  it('Refresh re-reads the chats', async () => {
    api.timeRefresh.mockResolvedValue(day({ captureNotes: ['Read again.'] }));
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Read again.');
    expect(api.timeRefresh).toHaveBeenCalledWith('2026-11-28');
  });
});

describe('confirming', () => {
  const answer = (a: ConfirmAnswer) => api.timeConfirm.mockResolvedValue(a);

  it('says so when the day is confirmed', async () => {
    answer({ outcome: 'confirmed', day: day({ status: 'confirmed', revision: 1 }), repeated: false });
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm day' }));
    await screen.findByText('Day confirmed.');
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it.each([
    ['conflict', 'This day was changed somewhere else. Check it, then confirm again.'],
    ['invalid', 'Toolbox could not accept some entries. Check the notes on each one.'],
    ['locked', 'This month is closed in Toolbox.'],
  ] as const)('shows the %s notice', async (outcome, text) => {
    const d = day({ status: outcome === 'conflict' ? 'conflict' : 'not-confirmed' });
    answer(
      outcome === 'conflict'
        ? { outcome, day: d, stored: { personId: 'p', workDate: d.workDate, revision: 3, entries: [] } }
        : { outcome, day: d },
    );
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm day' }));
    await screen.findByText(text);
  });

  it('keeps the day and says "Not sent" when the send fails', async () => {
    answer({ outcome: 'not-sent', day: day({ status: 'not-sent' }), message: 'x' });
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm day' }));
    await screen.findByText('Not sent. Your day is kept on this Mac; try again.');
    expect(screen.getByText('Not sent', { selector: '.badge' })).toBeTruthy();
  });
});

describe('connecting', () => {
  it('with no address, points to Settings', async () => {
    api.timeStatus.mockResolvedValue(
      status({ connection: { state: 'no-address' }, address: { url: null, source: 'default' } }),
    );
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledWith('general', 'toolbox-address');
  });

  it('not connected: shows the day and a Connect to Toolbox button', async () => {
    api.timeStatus.mockResolvedValue(
      status({ connection: { state: 'not-connected', origin: 'https://toolbox.example', pending: false } }),
    );
    api.timeConnect.mockResolvedValue({ url: 'https://toolbox.example/time-connect?x=1' });
    await shown();
    api.timeStatus.mockResolvedValue(
      status({ connection: { state: 'not-connected', origin: 'https://toolbox.example', pending: true } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Toolbox' }));
    await screen.findByText('Waiting for you to press Allow in Toolbox.');
    expect(screen.getByRole('link', { name: 'Open Toolbox yourself' }).getAttribute('href')).toBe(
      'https://toolbox.example/time-connect?x=1',
    );
  });

  it('while pending, asks every 2 seconds and reloads work items and the day once allowed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.timeStatus.mockResolvedValue(
      status({ connection: { state: 'not-connected', origin: 'https://toolbox.example', pending: true } }),
    );
    await shown();
    expect(screen.getByText('Waiting for you to press Allow in Toolbox.')).toBeTruthy();
    api.timeStatus.mockResolvedValue(status());
    api.timeDay.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await screen.findByText('Connected to https://toolbox.example');
    expect(api.timeWorkItems).toHaveBeenCalled();
    expect(api.timeDay).toHaveBeenCalled();
    expect(screen.queryByText('Waiting for you to press Allow in Toolbox.')).toBeNull();
  });

  it('lost: says why and offers Reconnect', async () => {
    api.timeStatus.mockResolvedValue(
      status({ connection: { state: 'lost', origin: 'https://toolbox.example', reason: 'expired' } }),
    );
    await shown();
    expect(screen.getByText(/Your connection to Toolbox has run out/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });

  it('connected with a connection running out: a quiet note', async () => {
    api.timeStatus.mockResolvedValue(
      status({
        connection: {
          state: 'connected',
          origin: 'https://toolbox.example',
          expiresAt: '2026-12-01T00:00:00Z',
          reconnectSoon: true,
        },
      }),
    );
    await shown();
    expect(screen.getByText(/runs out soon/)).toBeTruthy();
  });

  it('disconnects after a confirm', async () => {
    api.timeDisconnect.mockResolvedValue(
      status({ connection: { state: 'not-connected', origin: 'https://toolbox.example', pending: false } }),
    );
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(api.timeDisconnect).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: 'Disconnect from Toolbox' });
    fireEvent.click(within(group).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(api.timeDisconnect).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Connect to Toolbox' });
  });
});

describe('the edit panel', () => {
  const open = async () => {
    await shown();
    fireEvent.click(screen.getByText('Planning the launch'));
    return screen.findByRole('form', { name: 'Edit entry' });
  };

  it('opens from a row, with every field labelled and Remember on by default', async () => {
    const form = await open();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'set-panel', open: true }); // the panel is already open
    const f = within(form);
    expect((f.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Planning the launch');
    expect((f.getByLabelText('Work item') as HTMLSelectElement).value).toBe('wi-1');
    expect((f.getByLabelText('Start time') as HTMLInputElement).value).toBe('09:00');
    expect((f.getByLabelText('Minutes') as HTMLInputElement).value).toBe('45');
    expect((f.getByLabelText('Billable') as HTMLInputElement).checked).toBe(true);
    expect((f.getByLabelText('Remember for Acme website') as HTMLInputElement).checked).toBe(true);
    expect(f.queryByLabelText('This removes private detail')).toBeNull();
  });

  it('sends only what changed, with the private flag and the remember choice', async () => {
    api.timeChangeEntry.mockResolvedValue(day());
    const form = await open();
    const f = within(form);
    fireEvent.change(f.getByLabelText('Description'), { target: { value: 'Planning' } });
    fireEvent.click(f.getByLabelText('This removes private detail'));
    fireEvent.change(f.getByLabelText('Work item'), { target: { value: 'wi-2' } });
    fireEvent.click(f.getByLabelText('Remember for Acme website'));
    fireEvent.change(f.getByLabelText('Minutes'), { target: { value: '60' } });
    fireEvent.click(f.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.timeChangeEntry).toHaveBeenCalled());
    expect(api.timeChangeEntry).toHaveBeenCalledWith('2026-11-28', ID, {
      description: 'Planning',
      workItemId: 'wi-2',
      minutes: 60,
      privateEdit: true,
      remember: false,
    });
  });

  it('rejects minutes out of range without calling the server', async () => {
    const form = await open();
    fireEvent.change(within(form).getByLabelText('Minutes'), { target: { value: '0' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/whole minutes, from 1 to 1440/);
    expect(api.timeChangeEntry).not.toHaveBeenCalled();
  });

  it('after the first confirmation: no private option, and a quiet note on a changed description', async () => {
    api.timeDay.mockResolvedValue(day({ revision: 1, privateAllowed: false, status: 'confirmed' }));
    const form = await open();
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'New wording' } });
    expect(within(form).queryByLabelText('This removes private detail')).toBeNull();
    expect(within(form).getByText('Toolbox already holds the earlier wording.')).toBeTruthy();
  });

  it('Delete asks first, and offers Remove as private only while allowed', async () => {
    api.timeDeleteEntry.mockResolvedValue(day({ entries: [] }));
    const form = await open();
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }));
    const group = screen.getByRole('group', { name: 'Delete this entry' });
    expect(api.timeDeleteEntry).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole('button', { name: 'Remove as private' }));
    await waitFor(() => expect(api.timeDeleteEntry).toHaveBeenCalledWith('2026-11-28', ID, true));
  });

  it('Add entry opens an empty form and adds a manual entry', async () => {
    api.timeAddEntry.mockResolvedValue(day());
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    const form = await screen.findByRole('form', { name: 'Add entry' });
    const f = within(form);
    expect((f.getByLabelText('Billable') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(f.getByLabelText('Description'), { target: { value: 'Phone call' } });
    fireEvent.change(f.getByLabelText('Work item'), { target: { value: 'wi-1' } });
    fireEvent.change(f.getByLabelText('Start time'), { target: { value: '10:30' } });
    fireEvent.click(f.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.timeAddEntry).toHaveBeenCalled());
    expect(api.timeAddEntry).toHaveBeenCalledWith('2026-11-28', {
      values: {
        startAt: '2026-11-28T10:30:00+00:00',
        minutes: 30,
        workItemId: 'wi-1',
        description: 'Phone call',
        billable: true,
      },
    });
  });

  it('asks to choose an entry when none is open', async () => {
    await shown();
    expect(screen.getByText('Choose an entry to edit it, or press Add entry.')).toBeTruthy();
  });
});
