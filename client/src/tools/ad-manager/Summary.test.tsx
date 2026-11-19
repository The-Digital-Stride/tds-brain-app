// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsBoard, AdsTable } from '../../../../shared/ads-contract.ts';

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

const { adStore } = await import('./store.ts');

const { SummarySheet } = await import('./SummarySheet.tsx');

const IDS = [
  ['campaigns', 'Top campaigns'],
  ['searchterms', 'Top search terms'],
  ['waste', 'Wasted spend'],
  ['keywords', 'Top keywords'],
  ['products', 'Top products'],
  ['quality', 'Quality Score spread'],
] as const;
const table = (id: string, title: string): AdsTable => ({
  id,
  title,
  subtitle: `About ${title}`,
  cols: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'spend', label: 'Spend', type: 'money' },
  ],
  rows: [['One', 10]],
  defaultSort: 1,
});
const board = (key: string, extra: object = {}): AdsBoard =>
  ({
    key,
    name: key,
    currency: 'GBP',
    health: { dir: 'x', files: [], ok: 0, na: 0, applicable: 0, total: 0, freshThrough: null, fetch: null },
    tables: IDS.map(([id, title]) => table(id, title)),
    wastePct: 30,
    cards: [],
    standup: { hasStandup: false, verdict: null, enabledCampaigns: [], prompt: '', actionLabels: {} },
    triage: { key, name: key, hasStandup: false, verdict: null },
    setupPrompts: { discover: 'd', sheet: 's', proxy: 'p', contractPath: 'x' },
    ...extra,
  }) as unknown as AdsBoard;

const totals = {
  from: '2026-10-19',
  to: '2026-11-17',
  previousFrom: '2026-09-19',
  previousTo: '2026-10-18',
  current: { spend: 200, conversions: 10, value: 600, roas: 3, cpa: 20, wastedSpend: 30 },
  previous: { spend: 100, conversions: 8, value: 400, roas: 4, cpa: 12.5, wastedSpend: 10 },
};

beforeEach(() => {
  adStore.reset();
  store.toolArg = null;
  store.boot.prefs = { adsFolds: {}, adsAccount: null };
  api.adsAccounts.mockResolvedValue([
    { key: 'acme', name: 'Acme Heating', currency: 'GBP', waiting: 0, supervised: true },
  ]);
  api.adsApprovals.mockResolvedValue({
    me: { slug: 'sam', name: 'Sam', role: 'owner' },
    generatedAt: '2026-11-16T09:00:00Z',
    waiting: 0,
    toApply: 0,
    clients: [],
  });
  api.adsBoard.mockImplementation(async (k: string) => board(k));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Ads Account Summary', () => {
  it('loads the account when opened directly and draws the six tables', async () => {
    render(<SummarySheet />);
    await screen.findByRole('heading', { name: 'Acme Heating' });
    for (const [, title] of IDS) expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(api.adsBoard).toHaveBeenCalledWith('acme');
    expect(screen.getByText('Last 30 days')).toBeTruthy();
    expect(screen.getByText('About Top campaigns')).toBeTruthy();
  });

  it('a Worth a look button scrolls to its table and focuses the heading', async () => {
    render(<SummarySheet />);
    const list = (await screen.findByRole('heading', { name: 'Worth a look' })).closest(
      'section',
    ) as HTMLElement;
    fireEvent.click(within(list).getByRole('button', { name: 'Wasted spend' }));
    const h = screen.getByRole('heading', { name: 'Wasted spend', level: 3, hidden: false, ...{} });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-table')).toBe('waste'));
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('says so calmly when nothing stands out', async () => {
    api.adsBoard.mockImplementation(async (k: string) => board(k, { wastePct: 0 }));
    render(<SummarySheet />);
    await screen.findByText('Nothing stands out in the tables right now.');
  });

  it('has no totals strip without totals', async () => {
    render(<SummarySheet />);
    await screen.findByRole('heading', { name: 'Worth a look' });
    expect(screen.queryByRole('list', { name: /Headline figures/ })).toBeNull();
    expect(screen.queryByText('Conv. value')).toBeNull();
  });

  it('shows the totals strip when the board carries totals', async () => {
    api.adsBoard.mockImplementation(async (k: string) => board(k, { totals }));
    render(<SummarySheet />);
    await screen.findByText('Conv. value');
    expect(screen.getByText('+100% vs £100')).toBeTruthy();
  });

  it('opens on the account a caller named', async () => {
    store.toolArg = 'acme';
    render(<SummarySheet />);
    await screen.findByRole('heading', { name: 'Top campaigns' });
    expect(store.clearToolArg).toHaveBeenCalled();
  });
});

describe('deep dive tables', () => {
  const KEY = 'tds.adManager.tableLayout.v1';
  const sized = (id: string, title: string, n: number): AdsTable => ({
    id,
    title,
    subtitle: `${title} subtitle`,
    cols: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'spend', label: 'Spend', type: 'money' },
    ],
    rows: Array.from({ length: n }, (_, i) => [`${title} row ${i + 1}`, 10 + i]),
    defaultSort: 1,
  });
  const withTables = (tables: AdsTable[]) =>
    api.adsBoard.mockImplementation(async (k: string) => board(k, { tables, wastePct: 0 }));
  const handles = () =>
    screen.getAllByRole('button', { name: /^Move / }).map((b) => b.getAttribute('aria-label'));
  const saved = () => JSON.parse(localStorage.getItem(KEY) ?? '{}');
  const ready = async () => {
    render(<SummarySheet />);
    await screen.findByRole('heading', { name: 'Alpha' });
  };

  beforeEach(() => {
    localStorage.clear();
    withTables([sized('a', 'Alpha', 8), sized('b', 'Beta', 3), sized('c', 'Gamma', 3)]);
  });
  afterEach(() => localStorage.clear());

  it('flags a low ROAS only on a row that spent, and draws a Spend bar to scale', async () => {
    api.adsBoard.mockImplementation(async (k: string) =>
      board(k, {
        tables: [
          {
            id: 'kw',
            title: 'Keywords',
            subtitle: '',
            cols: [
              { key: 'kw', label: 'Keyword', type: 'text' },
              { key: 'cost', label: 'Spend', type: 'money' },
              { key: 'roas', label: 'ROAS', type: 'x' },
            ],
            rows: [
              ['good', 200, 4],
              ['poor', 100, 0.5],
              ['idle', 0, 0],
            ],
            defaultSort: 1,
          },
        ],
      }),
    );
    render(<SummarySheet />);
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
    render(<SummarySheet />);
    await screen.findByRole('heading', { name: 'Alpha' });
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
