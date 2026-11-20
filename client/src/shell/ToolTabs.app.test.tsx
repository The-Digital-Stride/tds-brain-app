// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsSummary } from '../../../shared/ads-contract.ts';
import { pickerText, pickOption } from '../test/pick.ts';

// The whole app, with the real store, real Ads tools and a fake server: what the Ads tab strip does to the sheet.
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
  adsStandupBrief: vi.fn(),
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
const { adsCommandTool } = await import('../tools/ad-manager/command-slot.ts');
const { adsSummaryTool } = await import('../tools/ad-manager/summary-slot.ts');

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false, tourSeen: 1 },
};
const adsSummary = (visible: boolean): AdsSummary => ({
  visible,
  me: { slug: 'sam', name: 'Sam', role: 'owner' } as AdsSummary['me'],
  sameIdentity: true,
  waiting: 0,
  clients: [],
});
const board = (key: string) => ({
  key,
  name: key,
  currency: 'GBP',
  health: {
    dir: 'x',
    files: [],
    ok: 0,
    na: 0,
    applicable: 0,
    total: 0,
    freshThrough: null,
    fetch: null,
  },
  tables: [],
  wastePct: 0,
  cards: [],
  standup: { hasStandup: false, verdict: null, enabledCampaigns: [], prompt: '', actionLabels: {} },
  triage: { key, name: key, hasStandup: false, verdict: null },
  setupPrompts: { discover: 'd', sheet: 's', proxy: 'p', contractPath: 'x' },
});

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
  api.adsAccounts.mockResolvedValue([
    { key: 'nw', name: 'Northwind', currency: 'GBP', waiting: 0, supervised: true },
    { key: 'acme', name: 'Acme Heating', currency: 'GBP', waiting: 0, supervised: true },
  ]);
  api.adsApprovals.mockResolvedValue({ me: null, generatedAt: '', waiting: 0, toApply: 0, clients: [] });
  api.adsBoard.mockImplementation(async (k: string) => board(k));
  api.adsStandupBrief.mockResolvedValue(null);
  summary.loadAdsSummary.mockResolvedValue(adsSummary(true));
  adStore.reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

/** Opens Ads Manager the way a person does: the Workbench on the rail, then its row in the drawer. */
async function openAdsManager() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  const rail = await screen.findByRole('button', { name: /^Workbench/ });
  fireEvent.click(rail);
  fireEvent.click(await screen.findByRole('button', { name: /Ads Manager/ }));
  await screen.findByRole('heading', { level: 1, name: /Workbench · Ads/ });
}

describe('the sheet title with the Ads tab strip', () => {
  it('reads "Workbench · Ads" with the tool name hidden, and the full text on hover', async () => {
    await openAdsManager();
    fireEvent.click(await screen.findByRole('button', { name: /^Command Centre/ }));
    const h1 = await screen.findByRole('heading', { level: 1, name: /Workbench · Ads/ });
    // What shows is the group; the tool's name is for screen readers only.
    expect(Array.from(h1.childNodes).find((n) => n.nodeType === 3)?.textContent).toBe('Workbench · Ads');
    const hidden = h1.querySelector('.visually-hidden');
    expect(hidden?.textContent).toBe(': Ads Command Centre');
    expect(h1.textContent).toBe('Workbench · Ads: Ads Command Centre');
    expect(h1.getAttribute('title')).toBe('Workbench · Ads: Ads Command Centre');
  });

  it('reads "Workbench · {tool}" with no hidden text and no tab strip when the group has one visible tool', async () => {
    const was = [adsCommandTool.visible, adsSummaryTool.visible];
    adsCommandTool.visible = () => false;
    adsSummaryTool.visible = () => false;
    try {
      render(<App />);
      await screen.findByRole('heading', { level: 1, name: 'Home' });
      fireEvent.click(await screen.findByRole('button', { name: /^Workbench/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Ads Manager/ }));
      const h1 = await screen.findByRole('heading', { level: 1, name: 'Workbench · Ads Manager' });
      expect(h1.querySelector('.visually-hidden')).toBeNull();
      expect(h1.getAttribute('title')).toBe('Workbench · Ads Manager');
      expect(screen.queryByRole('navigation', { name: 'Ads tools' })).toBeNull();
    } finally {
      adsCommandTool.visible = was[0] as typeof adsCommandTool.visible;
      adsSummaryTool.visible = was[1] as typeof adsSummaryTool.visible;
    }
  });

  it('keeps the account chosen in Ads Manager when the Command Centre tab is pressed', async () => {
    await openAdsManager();
    await waitFor(() => expect(adStore.get().accounts?.length).toBe(2));
    pickOption('Account', 'Acme Heating');
    expect(adStore.get().account).toBe('acme');
    fireEvent.click(await screen.findByRole('button', { name: /^Command Centre/ }));
    await screen.findByRole('heading', { level: 1, name: /Workbench · Ads/ });
    expect(adStore.get().account).toBe('acme');
    expect(pickerText('Account')).toBe('Acme Heating');
  });
});
