// @vitest-environment jsdom
// The right panel asks "Discard your changes?" before typed work is thrown away (design system, Actions rule 9).
// These run against the real ShellProvider, so the hold is the shell's own.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsApprovals, ProposalFull, ProposalSummary } from '../../../../shared/ads-contract.ts';
import type { ShellApi } from '../../shell/contract.ts';
import { pickOption } from '../../test/pick.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
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
  ApiFailure: class ApiFailure extends Error {},
}));
vi.mock('../../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: store.current.ads ?? null, adsDue: null }),
}));

const { ShellProvider, useShell } = await import('../../shell/ShellProvider.tsx');
const { AdManagerSheet } = await import('./AdManagerSheet.tsx');
const { AdManagerBar } = await import('./AdManagerBar.tsx');
const { ProposalPanel } = await import('./ProposalPanel.tsx');
const { RateCalls } = await import('./RateCalls.tsx');
const { adStore } = await import('./store.ts');

let shell: ShellApi;
function Probe() {
  shell = useShell();
  return null;
}

const flags = {
  canDecide: true,
  canDryRun: false,
  canApply: false,
  canClientDraft: false,
  canRecordClientApproval: false,
  canRecordDecision: false,
};
const proposal = (id: string, title: string): ProposalSummary => ({
  id,
  file: `clients/acme/proposals/${id}.md`,
  fm: { id, client: 'acme', type: 'change', tier: 1, status: 'proposed', title, expected_effect: title },
  warnings: [],
  flags,
});
const p1 = proposal('20261110-01-raise-budget', 'Raise the budget');
const p2 = proposal('20261110-02-add-negatives', 'Add negatives');
const approvals = (): AdsApprovals => ({
  me: { slug: 'sam', name: 'Sam', role: 'owner' },
  generatedAt: '2026-11-16T09:00:00Z',
  waiting: 2,
  toApply: 0,
  clients: ['acme', 'nw'].map((slug) => ({
    slug,
    name: slug === 'acme' ? 'Acme Heating' : 'Northwind',
    reviewer: 'sam',
    owner: 'ian',
    mine: true,
    open: slug === 'acme' ? [p1, p2] : [],
    recent: [],
    pack: null,
    monthly: null,
  })),
});

const closed = () => shell.state.panelOpen === false;
const noteBox = () => screen.getByLabelText(/Reason or note/) as HTMLTextAreaElement;
const ask = () => screen.queryByRole('group', { name: 'Discard your changes' });
const press = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Discard your changes' })).getByRole('button', { name }),
  );

async function mountSheet() {
  render(
    <ShellProvider>
      <Probe />
      <AdManagerBar />
      <AdManagerSheet />
      <ProposalPanel />
    </ShellProvider>,
  );
  await screen.findByRole('heading', { name: 'Waiting for a decision' });
  await screen.findByRole('heading', { name: 'Raise the budget' });
  act(() => shell.dispatch({ type: 'set-panel', open: true }));
}

beforeEach(() => {
  window.localStorage.clear();
  adStore.reset();
  store.current = {
    boot: {
      identity: { role: 'owner', slug: 'sam' },
      prefs: { adsFolds: {}, adsAccount: null },
    },
    view: 'chat',
    activeChat: { kind: 'new' },
    chats: {},
    ads: {
      visible: true,
      me: { slug: 'sam', name: 'Sam', role: 'owner' },
      sameIdentity: true,
      waiting: 2,
      clients: [],
    },
    toolArg: null,
    clearToolArg: vi.fn(),
    openTool: vi.fn(),
    setAdsDue: vi.fn(),
    updatePrefs: vi.fn(async () => {}),
    reloadAds: vi.fn(async () => {}),
    openChat: vi.fn(),
    sessions: null,
  };
  api.adsAccounts.mockResolvedValue([
    { key: 'acme', name: 'Acme Heating', currency: 'GBP', waiting: 2, supervised: true },
    { key: 'nw', name: 'Northwind', currency: 'GBP', waiting: 0, supervised: true },
  ]);
  api.adsApprovals.mockResolvedValue(approvals());
  api.adsBoard.mockRejectedValue(new Error('no board in this test'));
  api.adsProposal.mockImplementation(
    async (_c: string, id: string): Promise<ProposalFull> => ({
      ...(id === p1.id ? p1 : p2),
      body: 'Body',
    }),
  );
  api.adsStandupBrief.mockResolvedValue({
    ymd: '2026-11-16',
    date: '16 Nov',
    headline: null,
    recommendations: [
      { campaign: 'Brand', action_category: 'budget', reason: 'Spend is low', priority: 1 },
      { campaign: 'Search', action_category: 'bid', reason: 'CPC is up', priority: 2 },
    ],
  });
  api.adsChange.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Ads proposal panel: closing with a note typed', () => {
  it('asks first; Keep editing keeps the panel open and the note', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Too high for March' } });
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    const group = screen.getByRole('group', { name: 'Discard your changes' });
    expect(group.textContent).toContain('Discard your changes?');
    const keep = within(group).getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);
    expect(within(group).getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    expect(closed()).toBe(false);
    fireEvent.click(keep);
    expect(ask()).toBeNull();
    expect(closed()).toBe(false);
    expect(noteBox().value).toBe('Too high for March');
  });

  it('Discard changes closes the panel', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Draft' } });
    act(() => shell.dispatch({ type: 'toggle-panel' }));
    expect(closed()).toBe(false);
    press('Discard changes');
    expect(closed()).toBe(true);
    expect(ask()).toBeNull();
  });

  it('Esc on the question keeps editing', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Draft' } });
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
    expect(ask()).toBeNull();
    expect(closed()).toBe(false);
    expect(noteBox().value).toBe('Draft');
  });

  it('closes at once with nothing typed, and after the note is cleared again', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'x' } });
    fireEvent.change(noteBox(), { target: { value: '  ' } });
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    expect(ask()).toBeNull();
    expect(closed()).toBe(true);
  });

  it('closes at once after the note was sent with a decision', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Needs a rethink' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await waitFor(() => expect(api.adsChange).toHaveBeenCalled());
    await waitFor(() => expect(shell.panelHold.dirty).toBe(false));
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    expect(ask()).toBeNull();
    expect(closed()).toBe(true);
  });
});

describe('Ads proposal panel: choosing another proposal from the table', () => {
  it('asks first; Keep editing stays on the same proposal with the note', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Details: Add negatives' }));
    expect(ask()).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Raise the budget' })).toBeTruthy();
    press('Keep editing');
    expect(screen.getByRole('heading', { name: 'Raise the budget' })).toBeTruthy();
    expect(noteBox().value).toBe('Mine');
    expect(closed()).toBe(false);
  });

  it('Discard changes shows the chosen proposal with an empty note', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Details: Add negatives' }));
    press('Discard changes');
    expect(await screen.findByRole('heading', { name: 'Add negatives' })).toBeTruthy();
    expect(noteBox().value).toBe('');
    expect(ask()).toBeNull();
    expect(closed()).toBe(false);
  });

  it('Details on the proposal already shown asks nothing', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Details: Raise the budget' }));
    expect(ask()).toBeNull();
    expect(noteBox().value).toBe('Mine');
  });

  it('with nothing typed, another proposal opens at once', async () => {
    await mountSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Details: Add negatives' }));
    expect(ask()).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Add negatives' })).toBeTruthy();
  });

  it('switching account asks first too', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Mine' } });
    pickOption('Account', 'Northwind');
    expect(ask()).not.toBeNull();
    expect((screen.getByRole('combobox', { name: 'Account' }) as HTMLInputElement).value).toBe(
      'Acme Heating (2 waiting)',
    );
    press('Keep editing');
    expect(noteBox().value).toBe('Mine');
    expect((store.current.updatePrefs as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('stepping with Next asks through the same single strip', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Mine' } });
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Proposals' })).getByRole('button', {
        name: 'Next proposal',
      }),
    );
    expect(screen.getAllByRole('group', { name: 'Discard your changes' })).toHaveLength(1);
    press('Discard changes');
    expect(await screen.findByRole('heading', { name: 'Add negatives' })).toBeTruthy();
  });

  it('Previous on the first proposal asks nothing and keeps the note held', async () => {
    await mountSheet();
    fireEvent.change(noteBox(), { target: { value: 'Mine' } });
    const nav = () => within(screen.getByRole('navigation', { name: 'Proposals' }));
    fireEvent.click(nav().getByRole('button', { name: 'Previous proposal' }));
    expect(screen.queryByRole('group', { name: 'Discard your changes' })).toBeNull();
    // The note still counts as unsaved: the next real step asks.
    fireEvent.click(nav().getByRole('button', { name: 'Next proposal' }));
    expect(screen.getByRole('group', { name: 'Discard your changes' })).toBeTruthy();
    expect(noteBox().value).toBe('Mine');
  });
});

describe('Rate calls panel', () => {
  async function mountRate() {
    render(
      <ShellProvider>
        <Probe />
        <RateCalls />
      </ShellProvider>,
    );
    // The panel needs an account to load the brief for.
    act(() => adStore.set({ account: 'acme' }));
    await screen.findByLabelText('Rating for Brand');
    act(() => shell.dispatch({ type: 'set-panel', open: true }));
  }

  it('asks before closing with a changed rating; Keep editing keeps it, Discard closes', async () => {
    await mountRate();
    fireEvent.change(screen.getByLabelText('Rating for Brand'), { target: { value: '4' } });
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    expect(ask()).not.toBeNull();
    expect(closed()).toBe(false);
    press('Keep editing');
    expect((screen.getByLabelText('Rating for Brand') as HTMLSelectElement).value).toBe('4');
    act(() => shell.dispatch({ type: 'toggle-panel' }));
    press('Discard changes');
    expect(closed()).toBe(true);
  });

  it('asks for a typed note alone', async () => {
    await mountRate();
    fireEvent.change(screen.getByLabelText('Note for Search (optional)'), { target: { value: 'Fine' } });
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    expect(ask()).not.toBeNull();
  });

  it('closes at once with nothing changed', async () => {
    await mountRate();
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    expect(ask()).toBeNull();
    expect(closed()).toBe(true);
  });

  it('closes at once once the ratings are saved', async () => {
    await mountRate();
    fireEvent.change(screen.getByLabelText('Rating for Brand'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findAllByText('Saved 1 of 1 rating.');
    await waitFor(() => expect(shell.panelHold.dirty).toBe(false));
    act(() => shell.dispatch({ type: 'set-panel', open: false }));
    expect(ask()).toBeNull();
    expect(closed()).toBe(true);
  });
});
