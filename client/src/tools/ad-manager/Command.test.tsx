// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsBoard } from '../../../../shared/ads-contract.ts';

const store = vi.hoisted(() => ({
  ads: {
    visible: true,
    me: { slug: 'sam', name: 'Sam', role: 'owner' },
    sameIdentity: true,
    clients: [],
  } as unknown,
  boot: { prefs: { adsAccount: null as string | null } },
  toolArg: null as string | null,
  clearToolArg: vi.fn(),
  updatePrefs: vi.fn(async () => {}),
  setAdsDue: vi.fn(),
  startChat: vi.fn(async () => 'chat-1' as string | null),
  openChat: vi.fn(),
  openPast: vi.fn(async () => true),
  sessions: null as unknown,
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn() }));
const api = vi.hoisted(() => ({
  adsAccounts: vi.fn(),
  adsApprovals: vi.fn(),
  adsBoard: vi.fn(),
  adsStandupBrief: vi.fn(),
  adsChange: vi.fn(),
  adsTaskRun: vi.fn(async () => ({ ok: true })),
  adsTriage: vi.fn(),
  adsFile: vi.fn(),
}));
vi.mock('../../api.ts', () => ({ api, ApiFailure: class extends Error {} }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: { panelOpen: false }, dispatch: shell.dispatch, modes: {} }),
}));

const { CommandSheet } = await import('./CommandSheet.tsx');
const { adStore } = await import('./store.ts');
const { taskRuns } = await import('./task-runs.ts');

type Health = AdsBoard['health'];
type Card = AdsBoard['cards'][number];

const file = (name: string, status: string, group = 'daily') => ({
  file: name,
  group,
  powers: name,
  status,
  latest: status === 'ok' ? '2026-11-18' : null,
  missingCols: [],
});
const health = (files: ReturnType<typeof file>[], fetch: Health['fetch'] = null): Health => {
  const req = files.filter((f) => f.status !== 'na');
  return {
    dir: 'clients/x/context',
    files,
    ok: req.filter((f) => f.status === 'ok').length,
    na: files.length - req.length,
    applicable: req.length,
    total: files.length,
    freshThrough: '2026-11-18',
    fetch,
  };
};
const card = (id: string, cadence: Card['cadence'], kind: Card['kind'], over: Partial<Card> = {}): Card => ({
  id,
  cadence,
  kind,
  title: `Title ${id}`,
  description: `Description ${id}`,
  badge: null,
  prompt: `PROMPT ${id}`,
  ...over,
});
const CARDS: Card[] = [
  card('d-spend', 'daily', 'report'),
  card('w-terms', 'weekly', 'insight'),
  card('f-assets', 'fortnightly', 'action'),
  card('m-audit', 'monthly', 'report'),
  card('q-structure', 'quarterly', 'insight'),
];
const VERDICT = {
  date: '2026-11-18',
  headline: null,
  flagged: 2,
  anomalies: 0,
  topCampaign: 'Shopping',
  topAction: null,
};

let n = 0;
let key = '';
let current: AdsBoard;
const makeBoard = (over: Partial<AdsBoard> = {}): AdsBoard => ({
  key,
  name: key,
  currency: 'GBP',
  health: health([file('a.csv', 'ok'), file('b.csv', 'ok', 'search'), file('c.csv', 'na', 'deep')]),
  tables: [],
  wastePct: 0,
  cards: CARDS,
  standup: { hasStandup: true, verdict: VERDICT, enabledCampaigns: [], prompt: 'STANDUP', actionLabels: {} },
  triage: { key, name: key, hasStandup: true, verdict: null },
  setupPrompts: { discover: 'd', sheet: 's', proxy: 'p', contractPath: 'x' },
  ...over,
});

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
/** A run of `task` that finished well: recorded, then marked good from the live chat list. */
function finishedRun(task: string, when: string, sdk = 'sdk-1') {
  taskRuns.record(key, task, `chat-${task}`, new Date(when));
  taskRuns.reconcile([{ id: `chat-${task}`, sdkSessionId: sdk, lastTurn: 'ok' }] as never);
}
const live = (...s: object[]) => {
  store.sessions = { live: s };
};

async function mount(over: Partial<AdsBoard> = {}) {
  current = makeBoard(over);
  render(<CommandSheet />);
  await screen.findByRole('heading', { name: /What I run on/ });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 19, 12, 0));
  key = `acct${++n}`;
  adStore.reset();
  store.sessions = null;
  store.toolArg = null;
  store.openPast.mockResolvedValue(true);
  store.boot.prefs = { adsAccount: key };
  store.ads = {
    visible: true,
    me: { slug: 'sam', name: 'Sam', role: 'owner' },
    sameIdentity: true,
    clients: [],
  };
  store.updatePrefs.mockClear();
  api.adsAccounts.mockImplementation(async () => [
    { key, name: 'Acme Heating', currency: 'GBP', waiting: 0, supervised: true },
  ]);
  api.adsApprovals.mockResolvedValue({ me: null, generatedAt: '', waiting: 0, toApply: 0, clients: [] });
  api.adsBoard.mockImplementation(async () => current);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('columns and types', () => {
  it('shows five frequency columns in order, with the standup first in Daily', async () => {
    await mount();
    const heads = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
      .filter((t) => /^(Daily|Weekly|Fortnightly|Monthly|Quarterly)$/.test(t ?? ''));
    expect(heads).toEqual(['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly']);
    const daily = screen.getByRole('heading', { name: 'Daily' }).closest('section') as HTMLElement;
    const titles = within(daily)
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent);
    expect(titles).toEqual(['Daily standup', 'Title d-spend']);
  });

  it('keeps the original title and description exactly, and names the type on every card', async () => {
    await mount();
    expect(screen.getByText('Title w-terms')).toBeTruthy();
    expect(screen.getByText('Description w-terms')).toBeTruthy();
    const weekly = screen.getByRole('heading', { name: 'Weekly' }).closest('section') as HTMLElement;
    expect(within(weekly).getByText('Insight')).toBeTruthy();
  });

  it('fills each card by its type, and the key shows the same four types', async () => {
    await mount();
    const types = (k: string) => document.querySelectorAll(`.cc-task[data-type="${k}"]`).length;
    expect([types('report'), types('insight'), types('action'), types('standup')]).toEqual([2, 2, 1, 1]);
    const key4 = screen.getByRole('list', { name: 'Task types' });
    const keyed = Array.from(key4.querySelectorAll('.cc-tkey')).map((e) => [
      e.textContent,
      e.getAttribute('data-type'),
    ]);
    expect(keyed).toEqual([
      ['Report', 'report'],
      ['Insight', 'insight'],
      ['Action', 'action'],
      ['Standup', 'standup'],
    ]);
    expect(within(key4).getByText(/pulls useful info together/)).toBeTruthy();
  });
});

describe('account data panel', () => {
  it('when every required file is ready, still shows each group and opens the files on request', async () => {
    await mount();
    const head = screen.getByRole('heading', { name: 'Account data ready' });
    const panel = head.closest('section') as HTMLElement;
    expect(panel.getAttribute('data-tone')).toBe('ok');
    expect(within(panel).getByText(/All 2 required files are in/)).toBeTruthy();
    expect(within(panel).getByText(/Every task has what it needs\./)).toBeTruthy();
    expect(within(panel).getAllByText(/\d+ of \d+ ready/).length).toBeGreaterThan(0);
    expect(within(panel).queryByText('a.csv')).toBeNull();
    const show = within(panel).getByRole('button', { name: 'Show files' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(within(panel).getByText('a.csv')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Hide files' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('is amber with the fetch message when the daily fetch has a problem', async () => {
    await mount({
      health: health([file('a.csv', 'ok')], {
        lastRun: '2026-11-17T06:00:00Z',
        errors: 2,
        total: 9,
        ageHours: 30,
        problem: true,
      }),
    });
    const head = screen.getByRole('heading', { name: 'Account data: daily fetch problem' });
    expect(head.closest('section')?.getAttribute('data-tone')).toBe('warn');
    expect(screen.getByText(/failed on 2 of 9 datasets/)).toBeTruthy();
  });

  it('says "2 days" without a fetch for 37 to 47 hours, never "2 day"', async () => {
    await mount({
      health: health([file('a.csv', 'ok')], {
        lastRun: '2026-11-17T06:00:00Z',
        errors: 0,
        total: 9,
        ageHours: 40,
        problem: true,
      }),
    });
    expect(screen.getByText(/No fetch for 2 days \(/)).toBeTruthy();
  });

  it('is red with the files nested by group when one is missing', async () => {
    await mount({
      health: health([
        file('a.csv', 'ok'),
        file('b.csv', 'missing', 'search'),
        file('c.csv', 'stale', 'deep'),
      ]),
    });
    const head = screen.getByRole('heading', { name: 'Account data: 1 of 3 required files ready' });
    expect(head.closest('section')?.getAttribute('data-tone')).toBe('bad');
    expect(screen.getByRole('heading', { name: /Search/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Deep dive/ })).toBeTruthy();
    expect(document.querySelector('.cc-group .cc-dot[data-s="bad"]')).toBeTruthy();
    expect(document.querySelector('.cc-group .cc-dot[data-s="warn"]')).toBeTruthy();
    expect(screen.getByText('missing')).toBeTruthy();
  });

  it('shows the set-up card when there is no data at all', async () => {
    await mount({ health: health([file('a.csv', 'missing')]) });
    expect(screen.getByRole('heading', { name: 'Get your account data flowing' })).toBeTruthy();
  });

  it('writes dates in words, not as raw dates', async () => {
    await mount({
      health: health([file('a.csv', 'ok')], {
        lastRun: '2026-11-19T05:00:00Z',
        errors: 0,
        total: 9,
        ageHours: 3,
        problem: false,
      }),
    });
    expect(screen.getByText(/Fetched today, 05:00/)).toBeTruthy();
    expect(screen.getByText(/fresh to [A-Z][a-z]{2} 18 Nov/)).toBeTruthy();
  });

  it('clears a pending jump when the board fails to load, so it cannot fire on a later visit', async () => {
    api.adsBoard.mockRejectedValue(new Error('no board'));
    adStore.set({ jump: 'readiness' });
    render(<CommandSheet />);
    await waitFor(() => expect(adStore.get().boardError).toBeTruthy());
    await waitFor(() => expect(adStore.get().jump).toBeNull());
  });

  it('focuses its heading on a jump to readiness, then clears the jump', async () => {
    adStore.set({ jump: 'readiness' });
    await mount();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Account data ready' })),
    );
    expect(adStore.get().jump).toBeNull();
  });
});

describe('the standup card', () => {
  it('opens Rate calls in the side panel', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Rate calls' }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });
  });

  it('runs the standup in the drawer chat', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Run: Daily standup/ }));
    await waitFor(() =>
      expect(store.startChat).toHaveBeenCalledWith('STANDUP', key, { open: true, in: 'drawer' }),
    );
  });
});

describe('due badges', () => {
  it('says Due, Overdue N days and Due on a date', async () => {
    taskRuns.record(key, 'd-spend', null, new Date(2026, 10, 17, 9));
    taskRuns.record(key, 'w-terms', null, new Date(2026, 10, 1, 9));
    taskRuns.record(key, 'm-audit', null, new Date(2026, 10, 3, 9));
    await mount();
    const of = (t: string) => (screen.getByText(t).closest('li') as HTMLElement).textContent ?? '';
    expect(of('Title d-spend')).toContain('Due');
    expect(of('Title w-terms')).toContain('Overdue 11 days');
    expect(of('Title m-audit')).toContain('Due Tue 1 Dec');
  });
});

describe('run links', () => {
  it('opens the last good run in the drawer chat', async () => {
    finishedRun('d-spend', at(19, 8, 14));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Today, 08:14/ }));
    await waitFor(() => expect(store.openPast).toHaveBeenCalledWith('sdk-1', { in: 'drawer' }));
    expect(screen.queryByText(/can't be opened any more/)).toBeNull();
  });

  it("says so on the card when the chat can't be opened", async () => {
    store.openPast.mockResolvedValue(false);
    finishedRun('d-spend', at(19, 8, 14));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Today, 08:14/ }));
    expect(await screen.findByText("That chat can't be opened any more.")).toBeTruthy();
  });

  it('shows a stopped newest run with a link to the last good one', async () => {
    finishedRun('w-terms', at(10, 10), 'sdk-good');
    taskRuns.record(key, 'w-terms', 'chat-new', new Date(at(19, 9, 30)));
    live({ id: 'chat-new', state: 'idle', lastTurn: 'stopped' });
    await mount();
    const li = screen.getByText('Title w-terms').closest('li') as HTMLElement;
    expect(within(li).getByText('Stopped', { selector: '.badge' })).toBeTruthy();
    expect(li.textContent).toContain('Stopped today, 09:30');
    fireEvent.click(within(li).getByRole('button', { name: /10 Nov/ }));
    await waitFor(() => expect(store.openPast).toHaveBeenCalledWith('sdk-good', { in: 'drawer' }));
  });

  it("shows a teammate's run as text only", async () => {
    await mount({
      cards: [
        card('d-spend', 'daily', 'report', {
          lastRun: { at: at(19, 7, 58), by: 'pete', byName: 'Pete Smith' },
        }),
      ],
    });
    const li = screen.getByText('Title d-spend').closest('li') as HTMLElement;
    expect(li.textContent).toContain('Last run Today, 07:58 by Pete');
    expect(within(li).queryByRole('button', { name: /07:58/ })).toBeNull();
  });
});

describe('running a task', () => {
  const runBtn = (title: string) => screen.findByRole('button', { name: `Run: ${title}` });
  const taskOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

  it("Run starts a new chat with the card's prompt as it is, for the account", async () => {
    await mount({ cards: [card('d-spend', 'daily', 'report', { prompt: 'PROMPT {{kept}} as is' })] });
    fireEvent.click(await runBtn('Title d-spend'));
    await waitFor(() =>
      expect(store.startChat).toHaveBeenCalledWith('PROMPT {{kept}} as is', key, {
        open: true,
        in: 'drawer',
      }),
    );
  });

  it('shows when it ran, then Running and Open chat while its chat works', async () => {
    store.sessions = { live: [] };
    await mount();
    fireEvent.click(await runBtn('Title d-spend'));
    await waitFor(() => expect(store.startChat).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(taskOf('Title d-spend')).getByText(/^Last run Today, \d\d:\d\d$/)).toBeTruthy(),
    );

    cleanup();
    live({ id: 'chat-d-spend', state: 'working' });
    taskRuns.record(key, 'd-spend', 'chat-d-spend', new Date(at(19, 12)));
    await mount();
    const open = await screen.findByRole('button', { name: 'Open chat: Title d-spend' });
    const li = taskOf('Title d-spend');
    expect(within(li).getByRole('status').textContent).toBe('Title d-spend: Running');
    expect(within(li).getByText(/^started Today/)).toBeTruthy();
    expect(within(li).queryByRole('button', { name: /^Run/ })).toBeNull();
    fireEvent.click(open);
    expect(store.openChat).toHaveBeenCalledWith('chat-d-spend', { in: 'drawer' });

    cleanup();
    live({ id: 'chat-d-spend', state: 'waiting' });
    await mount();
    await screen.findByRole('button', { name: 'Open chat: Title d-spend' });
    expect(within(taskOf('Title d-spend')).getByRole('status').textContent).toBe(
      'Title d-spend: Needs your answer',
    );

    cleanup();
    live({ id: 'chat-d-spend', state: 'idle' });
    await mount();
    await runBtn('Title d-spend');
    expect(within(taskOf('Title d-spend')).getByRole('status').textContent).toBe('');
  });

  it('a task with no run says "Never run here" in the run line, and keeps its (empty) status region', async () => {
    await mount({ standup: { ...makeBoard().standup, verdict: null } });
    const run = await runBtn('Daily standup');
    const li = run.closest('li') as HTMLElement;
    expect(within(li).queryByText(/^Last run/)).toBeNull();
    expect(within(li).getByText('Never run here').closest('.am-run')).toBeTruthy();
    expect(within(li).getByRole('status').textContent).toBe('');
  });

  it('a standup verdict on file with no run record never says "Never run here", and counts for due', async () => {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await mount({ standup: { ...makeBoard().standup, verdict: { ...VERDICT, date: ymd } } });
    const li = (await runBtn('Daily standup')).closest('li') as HTMLElement;
    expect(within(li).queryByText('Never run here')).toBeNull();
    // Today's verdict: not due.
    expect(within(li).queryByText(/^Due/)).toBeNull();
  });

  it("shows a teammate's run from the brain with their first name, mine without a name", async () => {
    const shared = (by: string, byName: string) => ({ at: at(19, 7, 58), by, byName });
    await mount({
      cards: [card('d-spend', 'daily', 'report', { lastRun: shared('pete-smith', 'Pete Smith') })],
    });
    expect(within(taskOf('Title d-spend')).getByText(/by Pete$/)).toBeTruthy();

    cleanup();
    await mount({ cards: [card('d-spend', 'daily', 'report', { lastRun: shared('sam', 'Sam') })] });
    const li = taskOf('Title d-spend');
    expect(within(li).getByText(/Last run/)).toBeTruthy();
    expect(within(li).queryByText(/by Sam/)).toBeNull();
  });

  it('the standup Run records standup:daily in the brain', async () => {
    await mount({ cards: CARDS.map((c) => ({ ...c, lastRun: null })) });
    fireEvent.click(await runBtn('Daily standup'));
    await waitFor(() => expect(api.adsTaskRun).toHaveBeenCalledWith({ account: key, task: 'standup:daily' }));
  });

  it('records a run in the brain only when the skill shares runs', async () => {
    await mount();
    fireEvent.click(await runBtn('Title d-spend'));
    await waitFor(() => expect(store.startChat).toHaveBeenCalled());
    // No card carries lastRun: an older skill, so the run stays in this browser.
    expect(api.adsTaskRun).not.toHaveBeenCalled();

    cleanup();
    await mount({ cards: CARDS.map((c) => ({ ...c, lastRun: null })) });
    fireEvent.click(await runBtn('Title w-terms'));
    await waitFor(() => expect(api.adsTaskRun).toHaveBeenCalledWith({ account: key, task: 'w-terms' }));
  });
});

describe('the due count for the menu', () => {
  it('is cleared on an account change, then set once the board arrives, counting the standup', async () => {
    await mount();
    expect(store.setAdsDue).toHaveBeenCalledWith(null);
    // The daily card has never run, and the standup's newest verdict is from 2026-11-18: both are due.
    await waitFor(() => expect(store.setAdsDue).toHaveBeenLastCalledWith(2));
  });

  it('leaves the standup out until it is set up, and counts it again after a run today', async () => {
    await mount({
      standup: { hasStandup: false, verdict: null, enabledCampaigns: [], prompt: '', actionLabels: {} },
    });
    await waitFor(() => expect(store.setAdsDue).toHaveBeenLastCalledWith(1));
    cleanup();
    store.setAdsDue.mockClear();
    adStore.reset();
    key = `acct${++n}`;
    store.boot.prefs = { adsAccount: key };
    await mount({
      standup: { ...makeBoard().standup, lastRun: { at: new Date().toISOString(), by: 'x', byName: 'X' } },
    });
    await waitFor(() => expect(store.setAdsDue).toHaveBeenLastCalledWith(1));
  });
});

describe("Release 2: all accounts' standups", () => {
  const withFeature = () => {
    store.ads = { ...(store.ads as object), features: ['triage-all-v1'] };
  };
  const rows = () => [
    {
      key: 'other',
      name: 'Other Ltd',
      hasStandup: true,
      verdict: { ...VERDICT, headline: 'Spend is up', flagged: 3, anomalies: 1 },
      stale: false,
    },
    {
      key: 'old',
      name: 'Old Co',
      hasStandup: true,
      verdict: { ...VERDICT, date: '2026-11-10', headline: 'Quiet', flagged: 0, anomalies: 0 },
      stale: true,
    },
    { key: 'new', name: 'New Co', hasStandup: true, verdict: null, stale: false },
    { key: 'none', name: 'None Co', hasStandup: false, verdict: null, stale: false },
    { key: key, name: 'Acme Heating', hasStandup: true, verdict: VERDICT, stale: false },
  ];
  const button = () => screen.getByRole('button', { name: "All accounts' standups…" });

  it('has no button without the feature', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: "All accounts' standups…" })).toBeNull();
  });

  it('opens a dialog, reads the list, words every row and marks the current account', async () => {
    withFeature();
    api.adsTriage.mockResolvedValue({ rows: rows() });
    await mount();
    fireEvent.click(button());
    const dlg = await screen.findByRole('dialog', { name: "All accounts' standups" });
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Close' }));
    await within(dlg).findByText('Other Ltd');
    expect(within(dlg).getByText('Spend is up')).toBeTruthy();
    expect(within(dlg).getByText('3 flagged').getAttribute('data-tone')).toBe('waiting');
    expect(within(dlg).getByText('Worst first. Choose an account to open it.')).toBeTruthy();
    expect(within(dlg).getByText('Old')).toBeTruthy();
    expect(within(dlg).getByText('Not run yet')).toBeTruthy();
    expect(within(dlg).getByText('No standup set up')).toBeTruthy();
    const current = dlg.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('Acme Heating');
  });

  it('reads again each time it opens', async () => {
    withFeature();
    api.adsTriage.mockResolvedValue({ rows: rows() });
    await mount();
    fireEvent.click(button());
    await screen.findByText('Other Ltd');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(button());
    await screen.findByText('Other Ltd');
    expect(api.adsTriage).toHaveBeenCalledTimes(2);
  });

  it('shows Loading… then an error with Try again', async () => {
    withFeature();
    api.adsTriage.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({ rows: rows() });
    await mount();
    fireEvent.click(button());
    expect(screen.getByText('Loading…')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('Other Ltd');
  });

  it('closes on Esc with focus back on the button, and on an outside click', async () => {
    withFeature();
    api.adsTriage.mockResolvedValue({ rows: rows() });
    await mount();
    fireEvent.click(button());
    await screen.findByRole('dialog');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button());
    fireEvent.click(button());
    await screen.findByRole('dialog');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('choosing a row switches the shared account, saves it and closes', async () => {
    withFeature();
    api.adsTriage.mockResolvedValue({ rows: rows() });
    await mount();
    fireEvent.click(button());
    fireEvent.click(await screen.findByRole('button', { name: /Other Ltd/ }));
    expect(adStore.get().account).toBe('other');
    expect(store.updatePrefs).toHaveBeenCalledWith({ adsAccount: 'other' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Release 2: Open result', () => {
  const taskOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
  const shared = (by: string, byName: string, result?: string | null) => ({
    at: at(19, 7, 58),
    by,
    byName,
    ...(result !== undefined ? { result } : {}),
  });
  it("opens a teammate's saved result through the file route", async () => {
    api.adsFile.mockResolvedValue({ id: 'f1', name: 'report.md', view: 'md' });
    await mount({
      cards: [
        card('d-spend', 'daily', 'report', {
          lastRun: shared('pete-smith', 'Pete Smith', `clients/${key}/reports/spend.md`),
        }),
      ],
    });
    fireEvent.click(
      within(taskOf('Title d-spend')).getByRole('button', { name: 'Open result: Title d-spend' }),
    );
    await waitFor(() => expect(api.adsFile).toHaveBeenCalledWith(`clients/${key}/reports/spend.md`));
    await waitFor(() =>
      expect(shell.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-viewer' })),
    );
  });

  it('shows no link without a result', async () => {
    await mount({
      cards: [card('d-spend', 'daily', 'report', { lastRun: shared('pete-smith', 'Pete Smith', null) })],
    });
    expect(
      within(taskOf('Title d-spend')).queryByRole('button', { name: 'Open result: Title d-spend' }),
    ).toBeNull();
  });

  it('keeps the chat link on my own run beside the result', async () => {
    finishedRun('d-spend', at(19, 7, 58));
    await mount({
      cards: [
        card('d-spend', 'daily', 'report', {
          lastRun: shared('sam', 'Sam', `clients/${key}/reports/spend.md`),
        }),
      ],
    });
    const li = taskOf('Title d-spend');
    expect(within(li).getByRole('button', { name: 'Open result: Title d-spend' })).toBeTruthy();
    expect(within(li).getByRole('button', { name: /open the chat/ })).toBeTruthy();
  });
});
