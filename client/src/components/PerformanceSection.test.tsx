// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CodeModeSide,
  PerformanceReport,
  PeriodDays,
  PeriodFigures,
  PeriodView,
  UsageTotals,
} from '../../../shared/performance-contract.ts';

const api = vi.hoisted(() => ({ performance: vi.fn(), performanceRefresh: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../shell/HelpLink.tsx', () => ({ HelpLink: () => null }));

import { PerformanceSection, POLL_MS } from './PerformanceSection.tsx';

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  requests: 120,
  input: 4_000,
  cacheWrite5m: 10_000,
  cacheWrite1h: 5_000,
  cacheRead: 2_500_000,
  output: 30_000,
  costUsd: 12.5,
  unpricedRequests: 0,
  ...over,
});
const side = (sessions: number): CodeModeSide => ({
  sessions,
  requests: sessions * 10,
  inputPerRequest: sessions === 25 ? 8_000 : 10_000,
  costPerSession: sessions === 25 ? 0.5 : 0.6,
});
const figures = (over: Partial<PeriodFigures> = {}): PeriodFigures => ({
  totals: totals(),
  sessions: 9,
  agentsStarted: 4,
  byProject: [{ key: 'a', label: 'tds-brain-app', count: 5, totals: totals() }],
  byModel: [{ key: 'm', label: 'Opus 5.5', count: 5, totals: totals() }],
  byAgentType: [{ key: 'r', label: 'reviewer', count: 3, totals: totals() }],
  codeMode: { on: side(3), off: side(6) },
  daily: [
    { date: '2026-11-27', costUsd: 4, requests: 40 },
    { date: '2026-11-28', costUsd: 0, requests: 0 },
  ],
  ...over,
});
const view = (days: PeriodDays, over: Partial<PeriodView> = {}): PeriodView => ({
  days,
  from: '2026-11-27',
  to: '2026-11-28',
  current: figures(),
  previous: figures({ totals: totals({ costUsd: 10 }) }),
  ...over,
});
const report = (over: Partial<PerformanceReport> = {}): PerformanceReport => ({
  status: 'ready',
  refreshing: false,
  updatedAt: new Date().toISOString(),
  historyFrom: '2026-10-01',
  completeFrom: '2026-10-01',
  pricesChecked: '2026-11-28',
  views: { '7': view(7), '30': view(30), '90': view(90) },
  ...over,
});

beforeEach(() => {
  api.performance.mockReset();
  api.performanceRefresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async (r: PerformanceReport) => {
  api.performance.mockResolvedValue(r);
  render(<PerformanceSection />);
  await screen.findByRole('heading', { name: 'Summary' });
};

describe('PerformanceSection', () => {
  it('shows the sections in order, with tokens last and each kind on its own line', async () => {
    await open(report());
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(['Summary', 'Daily', 'Where it goes', 'Code Mode', 'Tokens']);
    expect(screen.getByText('This Mac only · Updated Today', { exact: false })).toBeTruthy();
    for (const name of ['Fresh input', 'Cache written', 'Cache read', 'Output']) {
      expect(screen.getByText(name).tagName).toBe('DT');
    }
    expect(screen.getByText('15k').tagName).toBe('DD');
    expect(screen.getByText(/estimated at API list prices; not your bill/i)).toBeTruthy();
  });

  it('switches the range', async () => {
    const r = report();
    r.views = {
      '7': view(7, { current: figures({ sessions: 7 }) }),
      '30': view(30, { current: figures({ sessions: 30 }) }),
      '90': view(90, { current: figures({ sessions: 90 }) }),
    };
    await open(r);
    expect(screen.getByText('30', { selector: 'dd' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    expect(screen.getByText('7', { selector: 'dd' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    expect(screen.getByText('90', { selector: 'dd' })).toBeTruthy();
  });

  it('shows the change only when there is a previous period', async () => {
    await open(report());
    expect(screen.getByText(/25% up from US\$10\.00 in the previous 30 days/)).toBeTruthy();
    expect(screen.queryByText('No earlier figures yet')).toBeNull();
    cleanup();
    await open(
      report({
        views: {
          '7': view(7, { previous: null }),
          '30': view(30, { previous: null }),
          '90': view(90, { previous: null }),
        },
      }),
    );
    expect(screen.getByText('No earlier figures yet')).toBeTruthy();
    expect(screen.queryByText(/in the previous/)).toBeNull();
  });

  it('gives a Code Mode verdict only when both sides have enough sessions', async () => {
    await open(report());
    expect(screen.getByText('Too few Code Mode sessions to compare yet')).toBeTruthy();
    cleanup();
    const enough = figures({
      codeMode: { on: side(25), off: { ...side(30), inputPerRequest: 10_000, costPerSession: 0.6 } },
    });
    await open(
      report({
        views: {
          '7': view(7, { current: enough }),
          '30': view(30, { current: enough }),
          '90': view(90, { current: enough }),
        },
      }),
    );
    expect(
      screen.getByText(
        /Code Mode sessions averaged 20% less input per request and 17% less cost per session\. The two groups did different work, so treat this as a rough guide\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Too few Code Mode sessions to compare yet')).toBeNull();
  });

  it('notes requests with no price', async () => {
    const f = figures({ totals: totals({ unpricedRequests: 7 }) });
    await open(
      report({
        views: {
          '7': view(7, { current: f }),
          '30': view(30, { current: f }),
          '90': view(90, { current: f }),
        },
      }),
    );
    expect(screen.getByText(/7 requests on models with no price aren't in the cost/)).toBeTruthy();
  });

  it('lists the three tables without token columns', async () => {
    await open(report());
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(3);
    for (const t of tables) expect(within(t).queryByText(/tokens|input|cache/i)).toBeNull();
    expect(screen.getByText('reviewer')).toBeTruthy();
  });

  it('starts the first build when it has never run, then shows it when done', async () => {
    vi.useFakeTimers();
    api.performance.mockResolvedValueOnce(
      report({
        status: 'never-run',
        updatedAt: null,
        views: undefined,
        historyFrom: null,
        completeFrom: null,
      }),
    );
    api.performanceRefresh.mockResolvedValue(
      report({
        status: 'building',
        refreshing: true,
        updatedAt: null,
        views: undefined,
        historyFrom: null,
        completeFrom: null,
      }),
    );
    render(<PerformanceSection />);
    await act(async () => {});
    expect(api.performanceRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Building the first report…')).toBeTruthy();
    api.performance.mockResolvedValue(report());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeTruthy();
    expect(screen.queryByText('Building the first report…')).toBeNull();
  });

  it('says why an update failed and keeps the last good figures', async () => {
    const at = new Date(Date.now() - 86_400_000).toISOString();
    await open(report({ status: 'failed', error: 'logs-missing', updatedAt: at }));
    expect(
      screen.getByText(
        /^This Mac only · Couldn't update \(Claude Code's logs weren't found on this Mac\)\. Showing figures from Yesterday, \d\d:\d\d\.$/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeTruthy();
  });

  it('Update now asks for a refresh and shows the new figures', async () => {
    await open(report());
    api.performanceRefresh.mockResolvedValue(report({ refreshing: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await waitFor(() => expect(api.performanceRefresh).toHaveBeenCalledTimes(1));
    await screen.findByText(/Updating…/);
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(api.performanceRefresh).toHaveBeenCalledTimes(1);
  });

  it('says so when Update now cannot start, and keeps the button usable', async () => {
    await open(report());
    api.performanceRefresh.mockRejectedValue(new Error('x'));
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await screen.findByText("Couldn't start the update. Try again.");
    expect(screen.getAllByRole('status')).toHaveLength(1);
    api.performanceRefresh.mockResolvedValue(report());
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await waitFor(() => expect(api.performanceRefresh).toHaveBeenCalledTimes(2));
    await screen.findByText(/Updated Today/);
  });

  it('offers Try again when the first build fails to start', async () => {
    api.performance.mockResolvedValue(
      report({
        status: 'never-run',
        updatedAt: null,
        views: undefined,
        historyFrom: null,
        completeFrom: null,
      }),
    );
    api.performanceRefresh.mockRejectedValueOnce(new Error('x'));
    render(<PerformanceSection />);
    await screen.findByText("Couldn't build the first report.");
    expect(screen.queryByText('Building the first report…')).toBeNull();
    api.performanceRefresh.mockResolvedValue(
      report({
        status: 'building',
        refreshing: true,
        updatedAt: null,
        views: undefined,
        historyFrom: null,
        completeFrom: null,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Building the first report…');
  });

  it('shows a stalled refresh when the poll fails', async () => {
    vi.useFakeTimers();
    api.performance.mockResolvedValueOnce(report({ refreshing: true }));
    render(<PerformanceSection />);
    await act(async () => {});
    api.performance.mockRejectedValue(new Error('x'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(screen.getByText("Couldn't start the update. Try again.")).toBeTruthy();
  });

  it('writes money to the same decimals in a column, by its largest figure', async () => {
    const f = (a: number, b: number) =>
      figures({
        daily: [
          { date: '2026-11-27', costUsd: a, requests: 1 },
          { date: '2026-11-28', costUsd: b, requests: 1 },
        ],
      });
    await open(report({ views: { '7': view(7, { current: f(4, 150) }), '30': view(30), '90': view(90) } }));
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    const list = within(screen.getByRole('list'));
    expect(list.getByText('US$4')).toBeTruthy();
    expect(list.getByText('US$150')).toBeTruthy();
  });

  it('shows 90 days as 13 weekly rows that sum their days', async () => {
    const daily = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 1 + i));
      return { date: d.toISOString().slice(0, 10), costUsd: 1, requests: 1 };
    });
    await open(
      report({
        completeFrom: '2026-09-01',
        views: {
          '7': view(7),
          '30': view(30),
          '90': view(90, { from: '2026-09-01', current: figures({ daily }) }),
        },
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(13);
    expect(items[0]?.textContent).toContain('Week of 1 Sept');
    expect(items[0]?.textContent).toContain('US$7.00');
    expect(items[12]?.textContent).toContain('US$6.00');
  });

  it('says where the figures start and leaves earlier days blank', async () => {
    const f = figures({
      daily: [
        { date: '2026-11-27', costUsd: 0, requests: 0 },
        { date: '2026-11-28', costUsd: 3, requests: 4 },
      ],
    });
    await open(
      report({
        completeFrom: '2026-11-28',
        views: { '7': view(7), '30': view(30, { current: f }), '90': view(90) },
      }),
    );
    expect(screen.getByText('Figures start 28 Nov')).toBeTruthy();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('—');
    expect(items[0]?.textContent).not.toContain('US$0');
    expect(items[1]?.textContent).toContain('US$3.00');
  });

  it('offers Try again when the report cannot be loaded', async () => {
    api.performance.mockRejectedValueOnce(new Error('x'));
    render(<PerformanceSection />);
    await screen.findByRole('alert');
    api.performance.mockResolvedValue(report());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Summary' });
  });
});
