// @vitest-environment jsdom
// Leaving a page with unsaved form work asks first (plan 2026-11-23-ux-follow-ups, decision 1; design system,
// Actions rule 9). The whole app with the real store, shell, Ads Manager and Projects and a fake server: the rail,
// Home and the palette all ask before typed work is thrown away.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdsApprovals,
  AdsSummary,
  ProposalFull,
  ProposalSummary,
} from '../../../shared/ads-contract.ts';
import { projectList } from '../apps/projects/testing.ts';
import { projectPageRequest } from '../state/client-choice.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  updatePrefs: vi.fn(),
  adsAccounts: vi.fn(),
  adsApprovals: vi.fn(),
  adsBoard: vi.fn(),
  adsProposal: vi.fn(),
  adsStandupBrief: vi.fn(),
  projects: vi.fn(),
  librarySearch: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));
const summary = vi.hoisted(() => ({ loadAdsSummary: vi.fn() }));
vi.mock('../tools/ad-manager/summary.ts', () => summary);
vi.mock('../tools/ad-manager/use-ads-due.ts', () => ({ useAdsDue: () => {} }));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

const { App } = await import('../App.tsx');
const { adStore } = await import('../tools/ad-manager/store.ts');
const { projectsStore } = await import('../state/projects.ts');

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [{ slug: 'acme', name: 'Acme Heating' }],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false, tourSeen: 1 },
};
const adsSummary: AdsSummary = {
  visible: true,
  me: { slug: 'sam', name: 'Sam', role: 'owner' } as AdsSummary['me'],
  sameIdentity: true,
  waiting: 1,
  clients: [],
};
const flags = {
  canDecide: true,
  canDryRun: false,
  canApply: false,
  canClientDraft: false,
  canRecordClientApproval: false,
  canRecordDecision: false,
};
const p1: ProposalSummary = {
  id: '20261110-01-raise-budget',
  file: 'clients/acme/proposals/20261110-01-raise-budget.md',
  fm: {
    id: '20261110-01-raise-budget',
    client: 'acme',
    type: 'change',
    tier: 1,
    status: 'proposed',
    title: 'Raise the budget',
    expected_effect: 'More leads',
  },
  warnings: [],
  flags,
};
const approvals: AdsApprovals = {
  me: { slug: 'sam', name: 'Sam', role: 'owner' },
  generatedAt: '2026-11-16T09:00:00Z',
  waiting: 1,
  toApply: 0,
  clients: [
    {
      slug: 'acme',
      name: 'Acme Heating',
      reviewer: 'sam',
      owner: 'ian',
      mine: true,
      open: [p1],
      recent: [],
      pack: null,
      monthly: null,
    },
  ],
};

const strip = () => screen.queryByRole('group', { name: 'Discard your changes' });
const press = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Discard your changes' })).getByRole('button', { name }),
  );
const rail = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pageTitle = () => screen.getByRole('heading', { level: 1 }).textContent ?? '';

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  // Wide enough that the right panel pushes the sheet and the rail stays live beside it.
  vi.stubGlobal('innerWidth', 1700);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
  api.adsAccounts.mockResolvedValue([
    { key: 'acme', name: 'Acme Heating', currency: 'GBP', waiting: 1, supervised: true },
  ]);
  api.adsApprovals.mockResolvedValue(approvals);
  api.adsBoard.mockRejectedValue(new Error('no board in this test'));
  api.adsProposal.mockImplementation(async (): Promise<ProposalFull> => ({ ...p1, body: 'Body' }));
  api.adsStandupBrief.mockResolvedValue(null);
  api.projects.mockResolvedValue(projectList([]));
  api.librarySearch.mockResolvedValue({ items: [], hidden: 0 });
  summary.loadAdsSummary.mockResolvedValue(adsSummary);
  adStore.reset();
  projectsStore.reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

/** Ads Manager from the rail, the proposal open in the right panel, and a note typed into it. */
async function adsNoteTyped(note: string) {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  rail(/^Workbench/);
  // The drawer's row (Home has an Ads card of its own while proposals wait).
  const drawer = document.getElementById('drawer') as HTMLElement;
  fireEvent.click(await within(drawer).findByRole('button', { name: /Ads Manager/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Details: Raise the budget' }));
  const box = (await screen.findByLabelText(/Reason or note/)) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: note } });
}
const noteBox = () => screen.getByLabelText(/Reason or note/) as HTMLTextAreaElement;

describe('leaving Ads with a note typed in the panel', () => {
  it('Home on the rail asks; Keep editing stays on Ads with the note', async () => {
    await adsNoteTyped('Too high for March');
    rail(/^Home/);
    expect(strip()).not.toBeNull();
    expect(pageTitle()).toMatch(/Workbench · Ads/);
    const keep = within(strip() as HTMLElement).getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);
    press('Keep editing');
    expect(strip()).toBeNull();
    expect(pageTitle()).toMatch(/Workbench · Ads/);
    expect(noteBox().value).toBe('Too high for March');
  });

  it('Discard changes goes Home', async () => {
    await adsNoteTyped('Draft');
    rail(/^Home/);
    press('Discard changes');
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
    expect(strip()).toBeNull();
  });

  it('another app on the rail asks, and Esc on the question keeps editing', async () => {
    await adsNoteTyped('Draft');
    rail(/^Projects/);
    expect(strip()).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
    expect(strip()).toBeNull();
    expect(pageTitle()).toMatch(/Workbench · Ads/);
    expect(noteBox().value).toBe('Draft');
  });

  it('a palette result asks too; Discard opens it', async () => {
    await adsNoteTyped('Draft');
    fireEvent.click(screen.getAllByRole('button', { name: 'Search or jump to' })[0] as HTMLElement);
    const input = await screen.findByRole('combobox', { name: 'Search or jump to' });
    fireEvent.change(input, { target: { value: 'Settings' } });
    // The Go to group's Settings comes first.
    const [option] = await screen.findAllByRole('option', { name: /^Settings/ });
    fireEvent.click(option as HTMLElement);
    expect(await screen.findByRole('group', { name: 'Discard your changes' })).toBeTruthy();
    expect(pageTitle()).toMatch(/Workbench · Ads/);
    press('Discard changes');
    await waitFor(() => expect(pageTitle()).toMatch(/^Settings/));
  });

  it('with nothing typed, the rail goes at once', async () => {
    await adsNoteTyped('');
    rail(/^Home/);
    expect(strip()).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });
});

describe('leaving a project form with changes', () => {
  async function formTyped() {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    rail(/^Projects/);
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const title = (await screen.findByLabelText('Title')) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Spring launch' } });
  }
  const form = () => screen.getByRole('form', { name: 'New project' });

  it('the rail asks with the form strip; Keep editing keeps the edits', async () => {
    await formTyped();
    rail(/^Home/);
    const group = within(form()).getByRole('group', { name: 'Discard your changes' });
    expect(group.textContent).toContain('Discard your changes?');
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getAllByRole('group', { name: 'Discard your changes' })).toHaveLength(1);
    press('Keep editing');
    expect(strip()).toBeNull();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Spring launch');
    expect(pageTitle()).toMatch(/Projects/);
  });

  it('Discard changes goes to the page asked for', async () => {
    await formTyped();
    rail(/^Settings/);
    press('Discard changes');
    await waitFor(() => expect(pageTitle()).toMatch(/^Settings/));
  });

  it('Esc on the strip keeps editing', async () => {
    await formTyped();
    rail(/^Home/);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
    expect(strip()).toBeNull();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Spring launch');
  });

  it('Cancel while the leave question shows asks about cancelling instead, and Discard then cancels', async () => {
    await formTyped();
    rail(/^Home/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('group', { name: 'Discard your changes' })).toHaveLength(1);
    press('Discard changes');
    // Back on the Projects list, not Home: the page change was dropped.
    expect(await screen.findByRole('button', { name: 'New project' })).toBeTruthy();
    expect(pageTitle()).toMatch(/Projects/);
  });

  it('a Projects search hit while Projects shows asks too; Keep keeps the form, Discard opens the hit', async () => {
    await formTyped();
    act(() => projectPageRequest.set('acme/spring'));
    expect(within(form()).getByRole('group', { name: 'Discard your changes' })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Spring launch');
    press('Keep editing');
    expect(form()).toBeTruthy();
    act(() => projectPageRequest.set('acme/spring'));
    press('Discard changes');
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New project' })).toBeNull());
  });

  it('with nothing changed, the rail goes at once', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    rail(/^Projects/);
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await screen.findByLabelText('Title');
    act(() => rail(/^Home/));
    expect(strip()).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });
});
