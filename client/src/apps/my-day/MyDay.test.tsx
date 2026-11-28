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
const openPast = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());
const shellModes = vi.hoisted(() => ({ panelOverlays: false }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => ({ openSettings, openPast }) }));
// A small stand-in for the shell's panel hold: typed work makes guardPanel ask instead of run.
const hold = vi.hoisted(() => ({ dirty: false, asking: false, held: null as null | (() => void) }));
const guardPanel = vi.hoisted(() => vi.fn());
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({
    state: { panelOpen: true, singleKeys: true },
    dispatch,
    modes: { panelOverlays: shellModes.panelOverlays },
    guardPanel,
    panelHold: { dirty: hold.dirty, asking: hold.asking },
  }),
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
  openPast.mockReset();
  openPast.mockResolvedValue(true);
  dispatch.mockReset();
  dispatch.mockImplementation((a: { type: string; dirty?: boolean }) => {
    if (a.type === 'set-panel-dirty') hold.dirty = a.dirty === true;
  });
  hold.dirty = false;
  shellModes.panelOverlays = false;
  hold.asking = false;
  hold.held = null;
  guardPanel.mockReset();
  guardPanel.mockImplementation((run: () => void) => {
    if (hold.dirty) hold.held = run;
    else run();
  });
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
    expect(screen.getByRole('heading', { level: 2, name: 'Today, Saturday 28 November' })).toBeTruthy();
    expect(screen.getByText('Not confirmed')).toBeTruthy();
    expect(screen.getByText('1:30')).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    // Time order: the morning entry, the quiet gap, then the afternoon one.
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Planning the launch'),
      expect.stringContaining('09:45–13:00 · Nothing recorded (3:15'),
      expect.stringContaining('Afternoon call'),
    ]);
    expect(within(rows[0] as HTMLElement).getByText('09:00–09:45')).toBeTruthy();
    // The evidence line already says where it came from, so there is no source chip.
    expect(within(rows[0] as HTMLElement).queryByText('From chat')).toBeNull();
    expect(within(rows[0] as HTMLElement).getByText('Strong')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Acme retainer')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Billable')).toBeTruthy();
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
    expect(late.getByText('Check').getAttribute('data-tone')).toBe('warn');
  });

  it('says a duration in words as well as digits', async () => {
    await shown();
    expect(screen.getAllByText('45 minutes').length).toBeGreaterThan(0);
    expect(document.querySelector('.myday-mins [aria-hidden="true"]')?.textContent).toBe('0:45');
  });

  it('marks the open row as current', async () => {
    await shown();
    fireEvent.click(screen.getByText('Planning the launch'));
    await screen.findByRole('form', { name: 'Edit entry' });
    expect(document.querySelector('.myday-row')?.getAttribute('aria-current')).toBe('true');
  });

  it('shows a placeholder, not data, for an empty description, and counts what needs attention', async () => {
    api.timeDay.mockResolvedValue(
      day({ entries: [entry({ values: { ...entry().values, description: '', workItemId: null } })] }),
    );
    render(screenUi());
    const placeholder = await screen.findByText('Add a description');
    expect(placeholder.className).toBe('myday-placeholder');
    expect(screen.getByText('1 of 1 need a description or work item')).toBeTruthy();
    expect(screen.queryByText('No work item')).toBeNull();
  });

  it('has no Today button on today, and drops the year for this year', async () => {
    await shown();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await screen.findByRole('heading', { level: 2, name: 'Friday 27 November' });
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
  });

  it('shows plain text on today and a warn badge on a past day that was never confirmed', async () => {
    await shown();
    expect(screen.getByText('Not confirmed').className).toBe('myday-sum');
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() => expect(screen.getByText('Not confirmed').getAttribute('data-tone')).toBe('warn'));
  });

  it('explains an empty day without mentioning Refresh when the day is confirmed', async () => {
    api.timeDay.mockResolvedValue(day({ entries: [], status: 'confirmed', totals: [], totalMinutes: 0 }));
    render(screenUi());
    const text = await screen.findByText(/Nothing recorded for this day/);
    expect(text.textContent).not.toMatch(/refresh/i);
    cleanup();
    myDay.reset();
    api.timeDay.mockResolvedValue(day({ entries: [], totals: [], totalMinutes: 0 }));
    render(screenUi());
    expect((await screen.findByText(/Nothing recorded for this day yet/)).textContent).toMatch(/refresh/i);
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

  it('not connected: one notice, with its button, and no second reason line or raw address', async () => {
    api.timeDay.mockResolvedValue(day({ confirmBlocked: 'Connect to Toolbox to confirm this day.' }));
    api.timeStatus.mockResolvedValue(
      status({ connection: { state: 'not-connected', origin: 'http://localhost:3999', pending: false } }),
    );
    await shown();
    const notices = document.querySelectorAll('.notice[data-level="info"]');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toContain('Connect to Toolbox to pick work items and confirm your day.');
    expect(
      within(notices[0] as HTMLElement).getByRole('button', { name: 'Connect to Toolbox' }),
    ).toBeTruthy();
    expect(screen.queryByText('Connect to Toolbox to confirm this day.')).toBeNull();
    expect(document.body.textContent).not.toContain('localhost:3999');
    expect(document.querySelector('.myday > .card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm day' }).getAttribute('aria-describedby')).toBe(
      'myday-connect',
    );
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
    await screen.findByText('Connected to Toolbox.');
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
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Disconnect' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Disconnect from Toolbox' })).getByRole('button', {
        name: 'Disconnect',
      }),
    );
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

  it('rejects minutes out of range: one error tied to the field, focus on it, no server call', async () => {
    const form = await open();
    const mins = within(form).getByLabelText('Minutes') as HTMLInputElement;
    fireEvent.change(mins, { target: { value: '0' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/whole minutes, from 1 to 1440/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(mins.getAttribute('aria-invalid')).toBe('true');
    expect(mins.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(mins);
    expect(api.timeChangeEntry).not.toHaveBeenCalled();
    fireEvent.change(mins, { target: { value: '20' } });
    expect(mins.getAttribute('aria-invalid')).toBeNull();
  });

  it('puts the cursor in Description when the form opens, and shows the entry times and a label', async () => {
    const form = await open();
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Description')));
    expect(within(form).getByText('09:00–09:45')).toBeTruthy();
    expect(within(form).getByRole('heading', { name: 'Edit entry' })).toBeTruthy();
  });

  it('labels the add form "Add an entry"', async () => {
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Add an entry' }));
    expect(await screen.findByRole('form', { name: 'Add an entry' })).toBeTruthy();
  });

  it('after Save, opens the next entry still short of a description or work item; with none left, closes', async () => {
    const second = entry({
      id: 'b0000000-0000-4000-8000-000000000002',
      values: { ...entry().values, startAt: '2026-11-27T13:00:00+00:00', description: '', workItemId: null },
    });
    api.timeDay.mockResolvedValue(day({ entries: [entry(), second] }));
    const fixed = entry({
      id: second.id,
      values: { ...second.values, description: 'Call', workItemId: 'wi-1' },
    });
    api.timeChangeEntry.mockResolvedValueOnce(day({ entries: [entry(), second] }));
    render(screenUi());
    await screen.findByText('Planning the launch');
    fireEvent.click(screen.getByText('Planning the launch'));
    const form = await screen.findByRole('form', { name: 'Edit entry' });
    fireEvent.change(within(form).getByLabelText('Minutes'), { target: { value: '50' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    // The second entry needs attention, so it opens.
    await waitFor(() => expect(myDay.get().editing).toBe(second.id));
    api.timeChangeEntry.mockResolvedValueOnce(day({ entries: [entry(), fixed] }));
    const form2 = await screen.findByRole('form', { name: 'Edit entry' });
    fireEvent.change(within(form2).getByLabelText('Description'), { target: { value: 'Call' } });
    fireEvent.change(within(form2).getByLabelText('Work item'), { target: { value: 'wi-1' } });
    fireEvent.click(within(form2).getByRole('button', { name: 'Save' }));
    // Nothing is left to fix: the form closes and focus returns to the row.
    await waitFor(() => expect(myDay.get().editing).toBeNull());
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-focus')).toBe(`myday:${second.id}`),
    );
  });

  it('steps between entries with the buttons and with N, not while typing', async () => {
    const second = entry({
      id: 'b0000000-0000-4000-8000-000000000002',
      values: { ...entry().values, startAt: '2026-11-27T13:00:00+00:00', description: 'Afternoon call' },
    });
    api.timeDay.mockResolvedValue(day({ entries: [entry(), second] }));
    render(screenUi());
    await screen.findByText('Planning the launch');
    fireEvent.click(screen.getByText('Planning the launch'));
    const form = await screen.findByRole('form', { name: 'Edit entry' });
    expect(within(form).getByRole('button', { name: 'Previous entry' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.keyDown(within(form).getByLabelText('Description'), { key: 'n' });
    expect(myDay.get().editing).toBe(ID);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'n' });
    await waitFor(() => expect(myDay.get().editing).toBe(second.id));
    fireEvent.click(await screen.findByRole('button', { name: 'Previous entry' }));
    await waitFor(() => expect(myDay.get().editing).toBe(ID));
  });

  it('asks before leaving unsaved typing: another row, and Cancel', async () => {
    const second = entry({
      id: 'b0000000-0000-4000-8000-000000000002',
      values: { ...entry().values, startAt: '2026-11-27T13:00:00+00:00', description: 'Afternoon call' },
    });
    api.timeDay.mockResolvedValue(day({ entries: [entry(), second] }));
    render(screenUi());
    await screen.findByText('Planning the launch');
    fireEvent.click(screen.getByText('Planning the launch'));
    const form = await screen.findByRole('form', { name: 'Edit entry' });
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Changed' } });
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'set-panel-dirty', dirty: true }));
    fireEvent.click(screen.getByText('Afternoon call'));
    // Held: the form has not switched, and the shell has the move to run if "Discard changes" is pressed.
    expect(myDay.get().editing).toBe(ID);
    expect(hold.held).not.toBeNull();
    hold.held = null;
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(myDay.get().editing).toBe(ID);
    expect(hold.held).not.toBeNull();
  });

  it('saves on Cmd+Enter', async () => {
    api.timeChangeEntry.mockResolvedValue(day());
    const form = await open();
    fireEvent.change(within(form).getByLabelText('Minutes'), { target: { value: '50' } });
    fireEvent.keyDown(within(form).getByLabelText('Minutes'), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(api.timeChangeEntry).toHaveBeenCalled());
  });

  it('Cancel returns focus to the row it was opened from', async () => {
    const form = await open();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-focus')).toBe(`myday:${ID}`));
  });

  it('keeps Delete on the left, neutral, and returns focus to it when the question is cancelled', async () => {
    const form = await open();
    const del = within(form).getByRole('button', { name: 'Delete' });
    expect(del.getAttribute('data-variant')).toBeNull();
    fireEvent.click(del);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Delete this entry' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(within(form).getByRole('button', { name: 'Delete' })),
    );
  });

  it('after a delete, focus goes to the Add button', async () => {
    api.timeDeleteEntry.mockResolvedValue(day({ entries: [], totals: [], totalMinutes: 0 }));
    const form = await open();
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Delete this entry' })).getByRole('button', {
        name: 'Remove as private',
      }),
    );
    await waitFor(() => expect(document.activeElement?.getAttribute('data-focus')).toBe('myday:add'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add an entry' }));
    const form = await screen.findByRole('form', { name: 'Add an entry' });
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
    expect(screen.getByText('Choose an entry to edit it, or add a new one.')).toBeTruthy();
  });
});

describe('chat titles and the chat link (decisions 32 and A)', () => {
  const CHAT = '5d0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
  const fromChat = (over: Parameters<typeof entry>[0] = {}) =>
    entry({ chatId: CHAT, titleHint: 'Homepage audit', hintAcceptable: true, ...over });

  it("keeps a chat row's meta short: the place name only, and Billable only when it is", async () => {
    const unbilled = fromChat({
      id: 'b0000000-0000-4000-8000-000000000002',
      values: {
        ...entry().values,
        startAt: '2026-11-27T13:00:00+00:00',
        description: 'Call',
        billable: false,
      },
      placeLabel: null,
      evidence: 'Cortex chat',
    });
    api.timeDay.mockResolvedValue(day({ entries: [fromChat(), unbilled] }));
    await shown();
    const [first, second] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement];
    const meta = (row: HTMLElement) => row.querySelector('.line-meta')?.textContent;
    expect(meta(first)).toBe('Acme retainer · Billable · Acme website');
    // No place, and the chat button already says it came from a chat.
    expect(meta(second)).toBe('Acme retainer');
    expect(screen.queryByText('Not billable')).toBeNull();
  });

  it('closes an empty docked panel when the window narrows so it would overlay, never one being edited', async () => {
    const view = render(screenUi());
    await screen.findByText('Planning the launch');
    dispatch.mockClear();
    shellModes.panelOverlays = true;
    view.rerender(screenUi());
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: false });

    shellModes.panelOverlays = false;
    view.rerender(screenUi());
    fireEvent.click(screen.getByText('Planning the launch'));
    await screen.findByRole('form', { name: 'Edit entry' });
    dispatch.mockClear();
    shellModes.panelOverlays = true;
    view.rerender(screenUi());
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'set-panel', open: false });
  });

  it('opens the chat in the drawer from a button beside the row, never writing a prompt', async () => {
    api.timeDay.mockResolvedValue(day({ entries: [fromChat()] }));
    await shown();
    const button = screen.getByRole('button', { name: 'Open chat: Homepage audit' });
    // A sibling of the row's main button, not inside it.
    expect(button.closest('.myday-open')).toBeNull();
    expect(button.closest('li')?.querySelector('.myday-open')).not.toBeNull();
    fireEvent.click(button);
    expect(openPast).toHaveBeenCalledWith(CHAT, { in: 'drawer' });
    expect(myDay.get().editing).toBeNull();
    expect(api.timeChangeEntry).not.toHaveBeenCalled();
  });

  it('names the button plainly when the chat has no title, and has none without a chat', async () => {
    const other = entry({
      id: 'b0000000-0000-4000-8000-000000000002',
      values: { ...entry().values, startAt: '2026-11-27T13:00:00+00:00', description: 'Afternoon call' },
    });
    api.timeDay.mockResolvedValue(day({ entries: [fromChat({ titleHint: null }), other] }));
    await shown();
    expect(screen.getAllByRole('button', { name: /Open (chat|the chat)/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open the chat this came from' })).toBeTruthy();
  });

  it('shows the title as a quiet second line only while the description is empty', async () => {
    const empty = fromChat({ values: { ...entry().values, description: '' } });
    api.timeDay.mockResolvedValue(day({ entries: [empty] }));
    render(screenUi());
    expect(await screen.findByText('Chat title: Homepage audit')).toBeTruthy();
    cleanup();
    api.timeDay.mockResolvedValue(day({ entries: [fromChat()] }));
    await shown();
    expect(screen.queryByText('Chat title: Homepage audit')).toBeNull();
  });

  it('"Use as description" saves the title as an ordinary description edit', async () => {
    api.timeDay.mockResolvedValue(day({ entries: [fromChat()] }));
    api.timeChangeEntry.mockResolvedValue(
      day({ entries: [fromChat({ values: { ...entry().values, description: 'Homepage audit' } })] }),
    );
    await shown();
    fireEvent.click(screen.getByText('Planning the launch'));
    const form = within(await screen.findByRole('form', { name: 'Edit entry' }));
    expect(form.getByText('Chat title: Homepage audit')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Use as description' }));
    await waitFor(() =>
      expect(api.timeChangeEntry).toHaveBeenCalledWith('2026-11-28', ID, { description: 'Homepage audit' }),
    );
    // Saved and in step: the box shows the title and the form holds no unsaved work.
    await waitFor(() =>
      expect((form.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Homepage audit'),
    );
    expect(hold.dirty).toBe(false);
    expect(form.queryByRole('button', { name: 'Use as description' })).toBeNull();
  });

  it('asks before "Use as description" drops unsaved typing', async () => {
    api.timeDay.mockResolvedValue(day({ entries: [fromChat()] }));
    api.timeChangeEntry.mockResolvedValue(day({ entries: [fromChat()] }));
    await shown();
    fireEvent.click(screen.getByText('Planning the launch'));
    const form = within(await screen.findByRole('form', { name: 'Edit entry' }));
    fireEvent.change(form.getByLabelText('Minutes'), { target: { value: '50' } });
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'set-panel-dirty', dirty: true }));
    fireEvent.click(form.getByRole('button', { name: 'Use as description' }));
    expect(hold.held).not.toBeNull();
    expect(api.timeChangeEntry).not.toHaveBeenCalled();
  });

  it('a restricted project: the title is shown, with no one-click use', async () => {
    api.timeDay.mockResolvedValue(day({ entries: [fromChat({ hintAcceptable: false })] }));
    await shown();
    fireEvent.click(screen.getByText('Planning the launch'));
    const form = within(await screen.findByRole('form', { name: 'Edit entry' }));
    expect(form.getByText('Chat title: Homepage audit')).toBeTruthy();
    expect(form.queryByRole('button', { name: 'Use as description' })).toBeNull();
    expect(form.getByText(/restricted project/)).toBeTruthy();
  });
});
