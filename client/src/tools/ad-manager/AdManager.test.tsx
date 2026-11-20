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
  openTool: vi.fn(),
  setAdsDue: vi.fn(),
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
  adsTaskRun: vi.fn(async () => ({ ok: true })),
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
  await screen.findByRole('heading', { name: 'Waiting for a decision' });
}

beforeEach(() => {
  adStore.reset();
  shell.state.panelOpen = true;
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

  it("counts only proposals waiting for a decision, from the rail's summary, not the bridge's older count", async () => {
    store.ads = { ...(store.ads as object), clients: [{ slug: 'acme', name: 'Acme Heating', waiting: 1 }] };
    await ready();
    expect(pickerText('Account')).toBe('Acme Heating (1 waiting)');
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
  it('shuts Recent decisions by default, and saves a change per client', async () => {
    await ready();
    const recent = screen.getByRole('button', { name: /Recent decisions, last 14 days.*0/ });
    expect(recent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(recent);
    expect(store.updatePrefs).toHaveBeenCalledWith({ adsFolds: { 'acme:recent': true } });
  });

  it('starts as the person left it', async () => {
    store.boot.prefs.adsFolds = { 'acme:open': false, 'acme:recent': true };
    await ready();
    expect(screen.getByRole('button', { name: /Recent decisions/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    // The waiting list is a card now, not a fold: an old saved "open" choice does nothing.
    expect(screen.getByRole('heading', { name: 'Waiting for a decision' })).toBeTruthy();
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

  it("doesn't show the first proposal as chosen while the panel is shut", async () => {
    shell.state.panelOpen = false;
    await ready();
    const details = await screen.findByRole('button', { name: 'Details: Raise the budget' });
    expect(details.getAttribute('aria-pressed')).toBe('false');
    expect(details.closest('tr')?.hasAttribute('data-current')).toBe(false);
  });

  it('Details moves focus to the proposal title, and the status badge matches the table', async () => {
    await ready();
    await screen.findByRole('heading', { name: 'Raise the budget' });
    const details = screen.getByRole('button', { name: 'Details: Add negatives' });
    details.focus(); // a real click focuses the button, so the panel's "focus fell to the page" rule doesn't apply
    fireEvent.click(details);
    const title = await screen.findByRole('heading', { name: 'Add negatives' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    const badge = within(title.parentElement as HTMLElement)
      .getAllByText('Proposed')
      .find((b) => b.classList.contains('badge'));
    expect(badge?.getAttribute('data-tone')).toBe('waiting');
  });

  it('leaves focus to the Dock when Details opens a shut panel, so closing it can return to Details', async () => {
    shell.state.panelOpen = false;
    await ready();
    const details = await screen.findByRole('button', { name: 'Details: Add negatives' });
    details.focus();
    fireEvent.click(details);
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });
    await screen.findByRole('heading', { name: 'Add negatives' });
    expect(adStore.get().focusTitle).toBe(false);
    expect(document.activeElement).toBe(details);
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
    expect(store.openChat).toHaveBeenCalledWith('chat-1', { in: 'drawer' });
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

describe('Ads Manager page', () => {
  const approved = (): ProposalSummary => ({
    ...proposal('20261110-03-raise-cap', 'Raise the cap', {}, 'approved'),
    fm: {
      ...proposal('x', 'Raise the cap').fm,
      id: '20261110-03-raise-cap',
      status: 'approved',
      approved_by: 'ian',
      approved_at: '2026-11-18',
      campaigns: ['Shopping – Bags'],
    },
  });
  const monthly = {
    month: '2026-10',
    monthName: 'October',
    partial: false,
    dataTo: null,
    generatedAt: null,
    signed: false,
    stale: false,
    reason: null,
    reviewedBy: null,
    reviewedAt: null,
    note: null,
    files: { close: 'c.md', body: 'b.md', draftPdf: 'd.pdf', pdf: null, email: null, review: null },
    canSign: true,
  };
  const withMonth = (open: ProposalSummary[]) => {
    const a = approvals(open);
    const acme = a.clients[0];
    if (acme) acme.monthly = monthly as never;
    api.adsApprovals.mockResolvedValue(a);
  };

  it('has two proposal cards: waiting, and approved with their own columns', async () => {
    withMonth([p1, p2, approved()]);
    await ready();
    const waiting = screen.getByRole('heading', { name: 'Waiting for a decision' }).closest('section');
    const ready2 = screen.getByRole('heading', { name: 'Approved, ready to apply' }).closest('section');
    expect(
      within(waiting as HTMLElement)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Proposal', 'Tier', 'Expires', 'Status', 'Details']);
    expect(within(waiting as HTMLElement).getByText('Raise the budget')).toBeTruthy();
    expect(within(waiting as HTMLElement).queryByText('Raise the cap')).toBeNull();
    const table = within(ready2 as HTMLElement);
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Next step');
    expect(table.getByText('Raise the cap')).toBeTruthy();
    expect(table.getByText('Shopping – Bags')).toBeTruthy();
    expect(table.getByText('by ian')).toBeTruthy();
    // Id, type and section left the table for the panel.
    expect(within(waiting as HTMLElement).queryByText('20261110-01-raise-budget')).toBeNull();
  });

  it('jumps to Monthly close from the Needs you line: focus on its heading and an outline for 1.6 s', async () => {
    withMonth([p1]);
    await ready();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'Go to monthly close' }));
      const heading = screen.getByRole('heading', { name: 'Monthly close' });
      const card = heading.closest('section') as HTMLElement;
      expect(document.activeElement).toBe(heading);
      expect(card.classList.contains('am-flash')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1700);
      });
      expect(card.classList.contains('am-flash')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the Monthly close fact tile does the same jump, and an incoming close jump is honoured once', async () => {
    withMonth([p1]);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Monthly close\s*October/ }));
    const heading = screen.getByRole('heading', { name: 'Monthly close' });
    expect(document.activeElement).toBe(heading);
    (document.activeElement as HTMLElement).blur();
    act(() => adStore.set({ jump: 'close' }));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(adStore.get().jump).toBeNull();
  });

  it('opens Ads Command Centre on the data panel from a data problem', async () => {
    withMonth([p1]);
    api.adsBoard.mockImplementation(async (k: string) => {
      const b = board(k);
      return {
        ...b,
        health: {
          ...(b.health as NonNullable<AdsBoard['health']>),
          files: [
            {
              file: 'products.csv',
              group: 'products',
              powers: 'Product tables',
              status: 'missing',
              latest: null,
              missingCols: [],
            },
          ],
        },
      } as AdsBoard;
    });
    await ready();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ads Command Centre' }))[0] as HTMLElement);
    expect(adStore.get().jump).toBe('readiness');
    expect(store.openTool).toHaveBeenCalledWith('workbench', 'ads-command-centre', 'acme');
  });

  it('sign-off is one button that opens the confirm step with its note', async () => {
    withMonth([p1]);
    api.adsChange.mockResolvedValue({ ok: true });
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign off the report…' }));
    fireEvent.change(screen.getByLabelText('Sign-off note (optional)'), { target: { value: 'Read it' } });
    const group = screen.getByRole('group', { name: 'Sign off the report' });
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Sign off' }));
    await waitFor(() =>
      expect(api.adsChange).toHaveBeenCalledWith('sign-monthly', {
        client: 'acme',
        month: '2026-10',
        note: 'Read it',
      }),
    );
  });

  it('an account that is not on the supervised ads-manager still gets its needs, the line and both tool buttons', async () => {
    store.boot.prefs.adsAccount = 'nw';
    api.adsApprovals.mockResolvedValue({ ...approvals([]), clients: [] });
    api.adsBoard.mockImplementation(async (k: string) => {
      const b = board(k);
      return {
        ...b,
        health: {
          ...(b.health as NonNullable<AdsBoard['health']>),
          files: [
            {
              file: 'p.csv',
              group: 'products',
              powers: 'Products',
              status: 'missing',
              latest: null,
              missingCols: [],
            },
          ],
        },
      } as AdsBoard;
    });
    mount();
    expect(await screen.findByText(/Northwind is not on the supervised ads-manager yet/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Northwind' })).toBeTruthy();
    expect(await screen.findByText('1 data file is missing')).toBeTruthy();
    expect(screen.getByText('Act')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Waiting for a decision' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ads Account Summary' })[0] as HTMLElement);
    expect(store.openTool).toHaveBeenCalledWith('workbench', 'ads-account-summary', 'nw');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ads Command Centre' }).at(-1) as HTMLElement);
    expect(store.openTool).toHaveBeenCalledWith('workbench', 'ads-command-centre', 'nw');
  });

  it("someone else's account shows who reviews it, no proposals, and both tool buttons", async () => {
    store.boot.prefs.adsAccount = 'nw';
    const a = approvals([]);
    api.adsApprovals.mockResolvedValue({
      ...a,
      clients: a.clients.map((c) => (c.slug === 'nw' ? { ...c, mine: false, reviewer: 'pat' } : c)),
    });
    mount();
    expect(await screen.findByText(/Northwind's proposals are reviewed by pat/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Monthly close' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ads Account Summary' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ads Command Centre' })).toBeTruthy();
  });

  it('shows a board error as an alert', async () => {
    api.adsBoard.mockRejectedValue(new Error('no board'));
    mount();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('no longer shows the board or the report tables', async () => {
    await ready();
    expect(screen.queryByText(/What I run on/)).toBeNull();
    expect(screen.queryByText('Spend check')).toBeNull();
  });

  it('still opens an old tool:workbench/ad-manager view, now titled Ads Manager', async () => {
    const { toolFor } = await import('../../shell/sections.ts');
    const found = toolFor('tool:workbench/ad-manager');
    expect(found?.tool.id).toBe('ad-manager');
    expect(found?.tool.title).toBe('Ads Manager');
  });
});

describe('Release 2: Record and draft the change', () => {
  const rec = proposal('20261110-04-pause', 'Pause the ad group', {
    canDecide: false,
    canRecordDecision: true,
  });
  const open = async (features: string[] | undefined) => {
    store.ads = { ...(store.ads as object), features };
    api.adsApprovals.mockResolvedValue(approvals([rec]));
    api.adsProposal.mockResolvedValue(full(rec));
    await ready();
    await screen.findByRole('heading', { name: 'Pause the ad group' });
  };

  it('shows only with the feature, next to Record decision', async () => {
    await open(undefined);
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record and draft the change' })).toBeNull();
    cleanup();
    await open(['draft-change-v1']);
    expect(screen.getByRole('button', { name: 'Record and draft the change' })).toBeTruthy();
  });

  it('needs the same note, then records with draftChange and starts the chat from draftPrompt', async () => {
    await open(['draft-change-v1']);
    fireEvent.click(screen.getByRole('button', { name: 'Record and draft the change' }));
    expect(screen.getByText('Write what was decided first.')).toBeTruthy();
    expect(api.adsChange).not.toHaveBeenCalled();
    api.adsChange.mockResolvedValue({
      message:
        'Decision recorded. A chat is drafting the change proposal: open it to follow along. It may ask you a question, or stop if no change is needed.',
      proposal: full(rec),
      draftPrompt: 'DRAFT it',
    });
    fireEvent.change(screen.getByLabelText('What was decided'), { target: { value: 'Pause it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record and draft the change' }));
    await screen.findByRole('button', { name: 'Open chat' });
    expect(api.adsChange).toHaveBeenCalledWith('decided', {
      client: 'acme',
      id: rec.id,
      note: 'Pause it',
      draftChange: true,
    });
    expect(store.startChat).toHaveBeenCalledWith('DRAFT it', 'acme', { open: false });
  });

  it("says plainly when the drafting chat couldn't start", async () => {
    await open(['draft-change-v1']);
    store.startChat.mockResolvedValueOnce(null);
    api.adsChange.mockResolvedValue({
      message: 'Decision recorded.',
      proposal: full(rec),
      draftPrompt: 'DRAFT it',
    });
    fireEvent.change(screen.getByLabelText('What was decided'), { target: { value: 'Pause it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record and draft the change' }));
    await screen.findAllByText(/The drafting chat couldn't start/);
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull();
  });

  it('Record decision alone sends no draftChange', async () => {
    await open(['draft-change-v1']);
    api.adsChange.mockResolvedValue({ message: 'Decision recorded.', proposal: full(rec) });
    fireEvent.change(screen.getByLabelText('What was decided'), { target: { value: 'Pause it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(api.adsChange).toHaveBeenCalledWith('decided', { client: 'acme', id: rec.id, note: 'Pause it' }),
    );
  });
});

describe('Release 2: Earlier months', () => {
  const month = (m: string, name: string, over: object = {}) => ({
    month: m,
    monthName: name,
    partial: false,
    dataTo: null,
    generatedAt: null,
    signed: false,
    stale: false,
    reason: null,
    reviewedBy: null,
    reviewedAt: null,
    note: null,
    files: {
      close: `${m}-close.json`,
      body: 'b.md',
      draftPdf: `${m}-draft.pdf`,
      pdf: null,
      email: null,
      review: null,
    },
    canSign: true,
    ...over,
  });
  const withEarlier = (earlier: unknown) => {
    const a = approvals([p1]);
    const acme = a.clients[0];
    if (acme) {
      acme.monthly = month('2026-10', 'October') as never;
      (acme as { earlierMonths?: unknown }).earlierMonths = earlier;
    }
    api.adsApprovals.mockResolvedValue(a);
  };

  it('has no fold when the list is missing or empty', async () => {
    withEarlier(undefined);
    await ready();
    expect(screen.queryByRole('button', { name: /Earlier months/ })).toBeNull();
    cleanup();
    withEarlier([]);
    await ready();
    expect(screen.queryByRole('button', { name: /Earlier months/ })).toBeNull();
  });

  it('lists each month with its status in words and its file buttons', async () => {
    withEarlier([
      month('2026-09', 'September', {
        signed: true,
        reviewedBy: 'Pete',
        reviewedAt: '2026-10-03',
        canSign: false,
      }),
      month('2026-08', 'August'),
      month('2026-07', 'July', { signed: false, stale: true }),
      month('2026-06', 'June', { partial: true, canSign: false }),
    ]);
    await ready();
    const fold = await screen.findByRole('button', { name: /Earlier months/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(screen.getByText(/Signed off by Pete on/)).toBeTruthy();
    expect(screen.getByText('Not signed off')).toBeTruthy();
    expect(screen.getByText('Changed after sign-off, sign again')).toBeTruthy();
    expect(screen.getByText('Month-to-date draft')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Open draft PDF' }).length).toBeGreaterThanOrEqual(4);
    // Sign off… only where the bridge says canSign.
    expect(screen.getAllByRole('button', { name: /^Sign off…/ })).toHaveLength(2);
  });

  it('signs a late month through the same confirm step', async () => {
    withEarlier([month('2026-08', 'August')]);
    api.adsChange.mockResolvedValue({ ok: true });
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Earlier months/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Sign off…: August/ }));
    const group = screen.getByRole('group', { name: 'Sign off the report' });
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Cancel' }));
    expect(within(group).getByText(/Sign off the August report for Acme Heating/)).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Sign off' }));
    await waitFor(() =>
      expect(api.adsChange).toHaveBeenCalledWith('sign-monthly', { client: 'acme', month: '2026-08' }),
    );
  });
});
