// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADS_ERROR_MESSAGES,
  type AdsApprovals,
  type AdsBoard,
  type ProposalFull,
  type ProposalSummary,
} from '../../../../shared/ads-contract.ts';
import { pickerText, pickOption } from '../../test/pick.ts';

const store = vi.hoisted(() => ({
  ads: {
    visible: true,
    me: { slug: 'sam', name: 'Sam', role: 'owner' },
    sameIdentity: true,
    waiting: 2,
    clients: [],
  } as unknown,
  boot: {
    identity: { role: 'owner', slug: 'sam' },
    prefs: { adsFolds: {} as Record<string, boolean>, adsAccount: null as string | null },
  },
  toolArg: null as string | null,
  clearToolArg: vi.fn(),
  updatePrefs: vi.fn(async () => {}),
  startChat: vi.fn(async () => 'chat-1' as string | null),
  reloadAds: vi.fn(async () => {}),
  openChat: vi.fn(),
  sessions: null as unknown,
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn(), state: { panelOpen: true, singleKeys: true } }));
const api = vi.hoisted(() => ({
  adsAccounts: vi.fn(),
  adsApprovals: vi.fn(),
  adsBoard: vi.fn(),
  adsProposal: vi.fn(),
  adsChange: vi.fn(),
  adsClearInflight: vi.fn(),
  adsStandupBrief: vi.fn(),
  adsFile: vi.fn(),
}));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    code: string;
    status: number;
    output?: string;
    constructor(code: string, message: string, status: number, output?: string) {
      super(message);
      this.code = code;
      this.status = status;
      this.output = output;
    }
  },
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: {} }),
}));

const { AdManagerSheet } = await import('./AdManagerSheet.tsx');
const { AdManagerBar } = await import('./AdManagerBar.tsx');
const { ProposalPanel } = await import('./ProposalPanel.tsx');
const { adStore } = await import('./store.ts');

const flags = {
  canDecide: true,
  canDryRun: false,
  canApply: false,
  canClientDraft: false,
  canRecordClientApproval: false,
  canRecordDecision: false,
};
const proposal = (
  id: string,
  title: string,
  over: Partial<ProposalSummary['flags']> = {},
  status = 'proposed',
): ProposalSummary => ({
  id,
  file: `clients/acme/proposals/${id}.md`,
  fm: { id, client: 'acme', type: 'change', tier: 1, status, title, expected_effect: `Effect of ${title}` },
  warnings: [],
  flags: { ...flags, ...over },
});
const full = (p: ProposalSummary, status = p.fm.status): ProposalFull => ({
  ...p,
  fm: { ...p.fm, status },
  body: `Body of ${p.fm.title}`,
});

const p1 = proposal('20261110-01-raise-budget', 'Raise the budget');
const p2 = proposal('20261110-02-add-negatives', 'Add negatives');
const approvals = (open: ProposalSummary[]): AdsApprovals => ({
  me: { slug: 'sam', name: 'Sam', role: 'owner' },
  generatedAt: '2026-11-16T09:00:00Z',
  waiting: open.length,
  toApply: 0,
  clients: [
    {
      slug: 'acme',
      name: 'Acme Heating',
      reviewer: 'sam',
      owner: 'ian',
      mine: true,
      open,
      recent: [],
      pack: null,
      monthly: null,
    },
    {
      slug: 'nw',
      name: 'Northwind',
      reviewer: 'sam',
      owner: 'ian',
      mine: true,
      open: [],
      recent: [],
      pack: null,
      monthly: null,
    },
  ],
});
const board = (key: string): AdsBoard => ({
  key,
  name: key,
  currency: 'GBP',
  health: {
    dir: `clients/${key}/context`,
    files: [
      {
        file: 'summary.csv',
        group: 'daily',
        powers: 'x',
        status: 'ok',
        latest: '2026-11-15',
        missingCols: [],
      },
    ],
    ok: 1,
    na: 0,
    applicable: 1,
    total: 1,
    freshThrough: '2026-11-15',
    fetch: null,
  },
  tables: [],
  wastePct: 0,
  cards: [
    {
      id: 'd-spend',
      cadence: 'daily',
      kind: 'report',
      title: 'Spend check',
      description: 'Is spend normal?',
      badge: null,
      prompt: 'PROMPT {{kept}} as is',
    },
  ],
  standup: {
    hasStandup: true,
    verdict: null,
    enabledCampaigns: [],
    prompt: 'STANDUP PROMPT',
    actionLabels: {},
  },
  triage: { key, name: key, hasStandup: true, verdict: null },
  setupPrompts: { discover: 'd', sheet: 's', proxy: 'p', contractPath: 'x' },
});

function mount() {
  return render(
    <>
      <AdManagerBar />
      <AdManagerSheet />
      <ProposalPanel />
    </>,
  );
}
async function ready() {
  mount();
  await screen.findByText(/Waiting for a decision/);
}

beforeEach(() => {
  adStore.reset();
  store.toolArg = null;
  store.sessions = null;
  store.ads = {
    visible: true,
    me: { slug: 'sam', name: 'Sam', role: 'owner' },
    sameIdentity: true,
    waiting: 2,
    clients: [],
  };
  store.boot.prefs = { adsFolds: {}, adsAccount: null };
  api.adsAccounts.mockResolvedValue([
    { key: 'nw', name: 'Northwind', currency: 'GBP', waiting: 0, supervised: true },
    { key: 'acme', name: 'Acme Heating', currency: 'GBP', waiting: 2, supervised: true },
  ]);
  api.adsApprovals.mockResolvedValue(approvals([p1, p2]));
  api.adsBoard.mockImplementation(async (k: string) => board(k));
  api.adsProposal.mockImplementation(async (_c: string, id: string) => full(id === p1.id ? p1 : p2));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account', () => {
  it('opens on the first account with something waiting, and says how many wait', async () => {
    await ready();
    expect(pickerText('Account')).toBe('Acme Heating (2 waiting)');
  });

  it('opens on the account Home or search asked for, then clears the argument', async () => {
    store.toolArg = 'nw';
    mount();
    await waitFor(() => expect(pickerText('Account')).toBe('Northwind'));
    expect(store.clearToolArg).toHaveBeenCalled();
    expect(store.updatePrefs).toHaveBeenCalledWith({ adsAccount: 'nw' });
  });

  it('uses the remembered account, and remembers a new choice', async () => {
    store.boot.prefs.adsAccount = 'nw';
    await ready();
    expect(pickerText('Account')).toBe('Northwind');
    pickOption('Account', 'Acme Heating (2 waiting)');
    expect(store.updatePrefs).toHaveBeenCalledWith({ adsAccount: 'acme' });
  });
});

describe('folds', () => {
  it('opens Waiting and shuts Recent by default, and saves a change per client', async () => {
    await ready();
    const waiting = screen.getByRole('button', { name: /Waiting for a decision.*2/ });
    const recent = screen.getByRole('button', { name: /Recent decisions, last 14 days.*0/ });
    expect(waiting.getAttribute('aria-expanded')).toBe('true');
    expect(recent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(recent);
    expect(store.updatePrefs).toHaveBeenCalledWith({ adsFolds: { 'acme:recent': true } });
  });

  it('starts as the person left it', async () => {
    store.boot.prefs.adsFolds = { 'acme:open': false, 'acme:recent': true };
    await ready();
    expect(screen.getByRole('button', { name: /Waiting for a decision/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: /Recent decisions/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});

describe('panel', () => {
  it('shows the first waiting proposal, and Details opens the panel on the one chosen', async () => {
    await ready();
    expect(await screen.findByRole('heading', { name: 'Raise the budget' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Details: Add negatives' }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });
    expect(await screen.findByRole('heading', { name: 'Add negatives' })).toBeTruthy();
    expect(screen.getByText('Effect of Add negatives')).toBeTruthy();
  });

  it('fetches the full text only when its fold opens', async () => {
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    expect(api.adsProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Full proposal text' }));
    expect(await screen.findByText('Body of Raise the budget')).toBeTruthy();
    expect(api.adsProposal).toHaveBeenCalledWith('acme', p1.id);
  });

  it('shows only the buttons the flags allow', async () => {
    api.adsApprovals.mockResolvedValue(
      approvals([
        proposal(
          '20261110-01-raise-budget',
          'Raise the budget',
          { canDecide: false, canDryRun: true, canApply: true },
          'approved',
        ),
      ]),
    );
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Details: Raise the budget' }));
    await screen.findByRole('heading', { name: 'Raise the budget' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dry run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply now' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('asks before approving (Cancel focused, Esc cancels), then opens the next waiting proposal', async () => {
    api.adsChange.mockResolvedValue({ message: 'Approved.', proposal: full(p1, 'approved') });
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const group = screen.getByRole('group', { name: 'Approve this proposal' });
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(group, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Approve this proposal' })).toBeNull();
    expect(api.adsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Approve this proposal' })).getByRole('button', {
        name: 'Approve',
      }),
    );
    await screen.findByRole('heading', { name: 'Add negatives' });
    expect(api.adsChange).toHaveBeenCalledWith('decide', { client: 'acme', id: p1.id, action: 'approve' });
    expect(screen.getAllByText('Approved.', { exact: false }).length).toBeGreaterThan(0);
    expect(store.reloadAds).toHaveBeenCalled();
  });

  it('needs a note to reject, then asks', async () => {
    api.adsChange.mockResolvedValue({ message: 'Rejected.', proposal: full(p1, 'rejected') });
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/note is needed/);
    expect(screen.queryByRole('group', { name: 'Reject this proposal' })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Reason or note/), { target: { value: 'Not now' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Reject this proposal' })).getByRole('button', {
        name: 'Reject',
      }),
    );
    await waitFor(() =>
      expect(api.adsChange).toHaveBeenCalledWith('decide', {
        client: 'acme',
        id: p1.id,
        action: 'reject',
        note: 'Not now',
      }),
    );
  });

  it('request changes starts the revising chat in the background and offers Open chat', async () => {
    api.adsChange.mockResolvedValue({
      message: 'Changes requested.',
      proposal: full(p1, 'changes-requested'),
      revisePrompt: 'REVISE p1',
    });
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.change(screen.getByLabelText(/Reason or note/), { target: { value: 'Lower it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await screen.findByRole('button', { name: 'Open chat' });
    expect(store.startChat).toHaveBeenCalledWith('REVISE p1', 'acme', { open: false });
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(store.openChat).toHaveBeenCalledWith('chat-1');
  });

  it('gives focus back to the button that opened the question', async () => {
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const group = screen.getByRole('group', { name: 'Approve this proposal' });
    expect(
      within(group).getByRole('button', { name: 'Approve' }).getAttribute('aria-describedby'),
    ).toBeTruthy();
    fireEvent.keyDown(group, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve' })));
  });

  it("says plainly when the revising chat couldn't start", async () => {
    store.startChat.mockResolvedValueOnce(null);
    api.adsChange.mockResolvedValue({
      message: 'Changes requested. A chat is revising the proposal.',
      proposal: full(p1, 'changes-requested'),
      revisePrompt: 'REVISE p1',
    });
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.change(screen.getByLabelText(/Reason or note/), { target: { value: 'Lower it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await screen.findAllByText(/revision chat couldn't start/);
    expect(screen.queryByText(/A chat is revising/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull();
  });

  it('offers Show output when an apply has an unknown outcome and the server sent its output', async () => {
    const { ApiFailure } = await import('../../api.ts');
    api.adsChange.mockRejectedValue(
      new ApiFailure(
        'unknown-outcome' as never,
        ADS_ERROR_MESSAGES['unknown-outcome'],
        504,
        'RAW RUN OUTPUT',
      ),
    );
    api.adsApprovals.mockResolvedValue(
      approvals([
        proposal(
          '20261110-01-raise-budget',
          'Raise the budget',
          { canDecide: false, canApply: true },
          'approved',
        ),
      ]),
    );
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Details: Raise the budget' }));
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Apply this change to the live account' })).getByRole(
        'button',
        { name: 'Apply now' },
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Show output' }));
    expect(screen.getByText('RAW RUN OUTPUT')).toBeTruthy();
  });

  it('keeps Apply busy and unretried from press to reply', async () => {
    let finish: (v: unknown) => void = () => {};
    api.adsChange.mockReturnValue(new Promise((r) => (finish = r)));
    api.adsApprovals.mockResolvedValue(
      approvals([
        proposal(
          '20261110-01-raise-budget',
          'Raise the budget',
          { canDecide: false, canApply: true },
          'approved',
        ),
      ]),
    );
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Details: Raise the budget' }));
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Apply this change to the live account' })).getByRole(
        'button',
        { name: 'Apply now' },
      ),
    );
    const busy = await screen.findByRole('button', { name: 'Applying…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(busy);
    expect(api.adsChange).toHaveBeenCalledTimes(1);
    await act(async () => finish({ message: 'Applied.', proposal: full(p1, 'applied') }));
  });

  it('says the outcome is unknown when apply fails to reach the app, and then hides Apply', async () => {
    const { ApiFailure } = await import('../../api.ts');
    api.adsChange.mockRejectedValue(new ApiFailure('network', 'down', 0));
    api.adsApprovals.mockResolvedValue(
      approvals([
        proposal(
          '20261110-01-raise-budget',
          'Raise the budget',
          { canDecide: false, canApply: true },
          'approved',
        ),
      ]),
    );
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Details: Raise the budget' }));
    await screen.findByRole('heading', { name: 'Raise the budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Apply this change to the live account' })).getByRole(
        'button',
        { name: 'Apply now' },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(ADS_ERROR_MESSAGES['unknown-outcome'], { exact: false }).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByRole('button', { name: 'Apply now' })).toBeNull();
    expect(screen.getByRole('button', { name: "I've checked the account" })).toBeTruthy();
  });

  it('shows the in-flight line from the server, hides Apply, and clears it on request', async () => {
    api.adsApprovals.mockResolvedValue(
      approvals([
        proposal(
          '20261110-01-raise-budget',
          'Raise the budget',
          { canDecide: false, canApply: false, inflight: true },
          'approved',
        ),
      ]),
    );
    api.adsClearInflight.mockResolvedValue({});
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Details: Raise the budget' }));
    await screen.findByRole('heading', { name: 'Raise the budget' });
    expect(screen.getByText(ADS_ERROR_MESSAGES['unknown-outcome'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "I've checked the account" }));
    await waitFor(() => expect(api.adsClearInflight).toHaveBeenCalledWith('acme', p1.id));
  });

  it('hides every action and says whose name it would act in when the identity differs', async () => {
    store.ads = {
      visible: true,
      me: { slug: 'pete', name: 'Pete', role: 'owner' },
      sameIdentity: false,
      waiting: 2,
      clients: [],
    };
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    expect(screen.getAllByText(/Cortex and the Brain disagree about who you are/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});

describe('board', () => {
  it('Run starts a new chat with the card prompt as it is, for the account', async () => {
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Run: Spend check' }));
    await waitFor(() =>
      expect(store.startChat).toHaveBeenCalledWith('PROMPT {{kept}} as is', 'acme', { open: true }),
    );
  });

  it('a run shows when it ran, then Running and Open chat while its chat works', async () => {
    store.sessions = { live: [], past: [] };
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Run: Spend check' }));
    await waitFor(() => expect(store.startChat).toHaveBeenCalled());
    const task = () => screen.getByText('Spend check').closest('li') as HTMLElement;
    await waitFor(() => expect(within(task()).getByText(/^Last run Today, \d\d:\d\d$/)).toBeTruthy());

    cleanup();
    store.sessions = { live: [{ id: 'chat-1', state: 'working' }], past: [] };
    await ready();
    const open = await screen.findByRole('button', { name: 'Open chat: Spend check' });
    expect(within(task()).getByRole('status').textContent).toBe('Spend check: Running');
    expect(within(task()).getByText(/^started Today/)).toBeTruthy();
    expect(within(task()).queryByRole('button', { name: /^Run/ })).toBeNull();
    fireEvent.click(open);
    expect(store.openChat).toHaveBeenCalledWith('chat-1');

    cleanup();
    store.sessions = { live: [{ id: 'chat-1', state: 'waiting' }], past: [] };
    await ready();
    await screen.findByRole('button', { name: 'Open chat: Spend check' });
    expect(within(task()).getByRole('status').textContent).toBe('Spend check: Needs your answer');

    cleanup();
    store.sessions = { live: [{ id: 'chat-1', state: 'idle' }], past: [] };
    await ready();
    await screen.findByRole('button', { name: 'Run: Spend check' });
    expect(within(task()).getByRole('status').textContent).toBe('');
  });

  it('a task with no run shows no run line, but keeps its (empty) status region', async () => {
    await ready();
    const run = await screen.findByRole('button', { name: /^Run: Daily standup/ });
    const card = run.closest('section') as HTMLElement;
    expect(within(card).queryByText(/^Last run/)).toBeNull();
    expect(within(card).getByRole('status').textContent).toBe('');
  });

  it('the standup Run uses the standup prompt', async () => {
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /^Run: Daily standup/ }));
    await waitFor(() =>
      expect(store.startChat).toHaveBeenCalledWith('STANDUP PROMPT', 'acme', { open: true }),
    );
  });
});

describe('deep dive tables', () => {
  const KEY = 'tds.adManager.tableLayout.v1';
  const table = (id: string, title: string, n: number) => ({
    id,
    title,
    subtitle: `${title} subtitle`,
    cols: [
      { key: 'name', label: 'Name', type: 'text' as const },
      { key: 'spend', label: 'Spend', type: 'money' as const },
    ],
    rows: Array.from({ length: n }, (_, i) => [`${title} row ${i + 1}`, 10 + i]),
    defaultSort: 1,
  });
  const withTables = () =>
    api.adsBoard.mockImplementation(async (k: string) => ({
      ...board(k),
      tables: [table('a', 'Alpha', 8), table('b', 'Beta', 3), table('c', 'Gamma', 3)],
    }));
  const handles = () =>
    screen.getAllByRole('button', { name: /^Move / }).map((b) => b.getAttribute('aria-label'));
  const saved = () => JSON.parse(localStorage.getItem(KEY) ?? '{}');

  beforeEach(() => {
    localStorage.clear();
    withTables();
  });
  afterEach(() => localStorage.clear());

  it('flags a low ROAS only on a row that spent, and draws a Spend bar to scale', async () => {
    api.adsBoard.mockImplementation(async (k: string) => ({
      ...board(k),
      tables: [
        {
          id: 'kw',
          title: 'Keywords',
          subtitle: '',
          cols: [
            { key: 'kw', label: 'Keyword', type: 'text' as const },
            { key: 'cost', label: 'Spend', type: 'money' as const },
            { key: 'roas', label: 'ROAS', type: 'x' as const },
          ],
          rows: [
            ['good', 200, 4],
            ['poor', 100, 0.5],
            ['idle', 0, 0],
          ],
          defaultSort: 1,
        },
      ],
    }));
    await ready();
    const t = await screen.findByRole('region', { name: 'Keywords' });
    const cell = (row: string, text: string) =>
      within(within(t).getByText(row).closest('tr') as HTMLElement).getByText(text);
    expect(cell('poor', '0.50x').getAttribute('data-low')).toBe('true');
    expect(within(t).getByText(', low')).toBeTruthy();
    expect(cell('idle', '0.00x').getAttribute('data-low')).toBeNull();
    expect(cell('idle', '0.00x').getAttribute('data-zero')).toBe('true');
    expect(cell('good', '4.00x').getAttribute('data-low')).toBeNull();
    const bars = Array.from(t.querySelectorAll<HTMLElement>('.am-bar')).map((b) => b.style.width);
    expect(bars).toEqual(['100%', '50%']);
  });

  it('shows five rows, then Show all and Show fewer', async () => {
    await ready();
    const alpha = screen.getByRole('region', { name: 'Alpha' });
    expect(within(alpha).getAllByRole('row')).toHaveLength(6);
    const more = within(alpha).getByRole('button', { name: 'Show all 8' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(within(alpha).getAllByRole('row')).toHaveLength(9);
    expect(within(alpha).getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(
      within(screen.getByRole('region', { name: 'Beta' })).queryByRole('button', { name: /Show/ }),
    ).toBeNull();
  });

  it('moves a table with the keyboard, announces it and saves the order', async () => {
    await ready();
    expect(handles()).toEqual(['Move Alpha, 1 of 3', 'Move Beta, 2 of 3', 'Move Gamma, 3 of 3']);
    const grip = screen.getByRole('button', { name: 'Move Alpha, 1 of 3' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(handles()).toEqual(['Move Beta, 1 of 3', 'Move Alpha, 2 of 3', 'Move Gamma, 3 of 3']);
    expect(screen.getByText('Alpha moved to 2 of 3').getAttribute('role')).toBe('status');
    expect(saved()).toEqual({ order: ['b', 'a', 'c'], wide: [] });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Alpha, 2 of 3' })),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(saved().order).toEqual(['b', 'c', 'a']);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(saved().order).toEqual(['a', 'b', 'c']);
  });

  it('starts in the saved order', async () => {
    localStorage.setItem(KEY, JSON.stringify({ order: ['c', 'a'], wide: [] }));
    await ready();
    expect(handles()).toEqual(['Move Gamma, 1 of 3', 'Move Alpha, 2 of 3', 'Move Beta, 3 of 3']);
  });

  it('toggles full width and saves it', async () => {
    await ready();
    const wide = screen.getByRole('button', { name: 'Full width: Beta' });
    expect(wide.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(wide);
    expect(wide.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: 'Beta' }).getAttribute('data-wide')).toBe('true');
    expect(saved().wide).toEqual(['b']);
    fireEvent.click(wide);
    expect(saved().wide).toEqual([]);
  });

  it('offers Reset layout only once the layout differs, and puts it back', async () => {
    await ready();
    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Full width: Beta' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Gamma, 3 of 3' }), { key: 'Home' });
    expect(handles()[0]).toBe('Move Gamma, 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(handles()).toEqual(['Move Alpha, 1 of 3', 'Move Beta, 2 of 3', 'Move Gamma, 3 of 3']);
    expect(saved()).toEqual({ order: [], wide: [] });
    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull();
  });
});
