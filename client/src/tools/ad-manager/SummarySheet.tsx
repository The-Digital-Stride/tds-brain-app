import { useEffect } from 'react';
import type { AdsBoard } from '../../../../shared/ads-contract.ts';
import { AccountHead } from './Approvals.tsx';
import type { AdsBoardRelease2, AdsTotals, AdsTotalsFigures } from './ads-tools-contract.ts';
import { DeepDive } from './DeepDive.tsx';
import { worthALook } from './logic.ts';
import { adStore, useAd } from './store.ts';
import { useAdsAccount } from './use-ads-account.ts';

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Scrolls to a table's heading and focuses it. Returns false when that table isn't on the page. */
function goToTable(id: string): boolean {
  const h = document.querySelector<HTMLElement>(`[data-table="${CSS.escape(id)}"]`);
  if (!h) return false;
  h.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  h.focus({ preventScroll: true });
  return true;
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const plain = (n: number | null, suffix = '') => (n === null ? 'n/a' : `${n.toFixed(2)}${suffix}`);
const change = (now: number | null, was: number | null) =>
  now === null || was === null || was === 0
    ? null
    : `${now >= was ? '+' : '−'}${Math.abs(Math.round(((now - was) / was) * 100))}%`;

/** Release 2: headline figures against the period before. Drawn only when the board carries `totals`. */
function TotalsStrip({ totals, currency }: { totals: AdsTotals; currency: string }) {
  const rows: { label: string; key: keyof AdsTotalsFigures; show: (n: number | null) => string }[] = [
    { label: 'Spend', key: 'spend', show: (n) => money(n ?? 0, currency) },
    { label: 'Conversions', key: 'conversions', show: (n) => String(Math.round(n ?? 0)) },
    { label: 'Conv. value', key: 'value', show: (n) => money(n ?? 0, currency) },
    { label: 'ROAS', key: 'roas', show: (n) => plain(n, 'x') },
    { label: 'CPA', key: 'cpa', show: (n) => (n === null ? 'n/a' : money(n, currency)) },
    { label: 'Wasted spend', key: 'wastedSpend', show: (n) => money(n ?? 0, currency) },
  ];
  return (
    <dl className="sm-totals" aria-label="Headline figures against the 30 days before">
      {rows.map((r) => {
        const d = change(totals.current[r.key], totals.previous[r.key]);
        return (
          <div className="sm-fact" key={r.key}>
            <dt>{r.label}</dt>
            <dd>
              {r.show(totals.current[r.key])}
              <small>
                {d
                  ? `${d} vs ${r.show(totals.previous[r.key])}`
                  : `before: ${r.show(totals.previous[r.key])}`}
              </small>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Ads Account Summary (plan 2026-11-19-ads-workbench-sections, decision 8): the account, what is worth a look, then
 * the six original deep-dive tables. The period is fixed at the last 30 days.
 */
export function SummarySheet() {
  const { account, loading } = useAdsAccount();
  const s = useAd();
  const acct = s.accounts?.find((a) => a.key === account);
  const name = acct?.name ?? account ?? '';
  const board: AdsBoard | null = s.board && s.boardFor === account ? s.board : null;
  const totals = (board as (AdsBoard & AdsBoardRelease2) | null)?.totals;
  const worth = board ? worthALook(board) : [];

  // A jump from search (`table:<id>`): once the tables have drawn, focus that heading, then clear it.
  const jump = s.jump;
  useEffect(() => {
    if (!jump || !board) return;
    if (jump.startsWith('table:')) goToTable(jump.slice(6));
    adStore.set({ jump: null });
  }, [jump, board]);

  return (
    <div className="am sm">
      <AccountHead name={name || (loading ? 'Loading…' : 'Choose an account')} currency={acct?.currency}>
        {board ? <span className="sm-period">Last 30 days</span> : null}
      </AccountHead>
      {s.boardError ? (
        <p className="am-line" role="alert">
          {s.boardError}
        </p>
      ) : null}
      {board && acct ? (
        <>
          {totals ? <TotalsStrip totals={totals} currency={acct.currency} /> : null}
          <div className="tray am-tray" data-cols="1">
            <section className="card sm-worth" aria-labelledby="sm-worth-h">
              <div className="card-head">
                <h3 id="sm-worth-h">Worth a look</h3>
                {worth.length > 0 ? <span className="count">{worth.length}</span> : null}
              </div>
              {worth.length === 0 ? (
                <p className="card-note">Nothing stands out in the tables right now.</p>
              ) : (
                <ul>
                  {worth.map((w) => (
                    <li key={w.id}>
                      <span className="dot" data-tone={w.tone} aria-hidden="true" />
                      <span className="status-tag" data-tone={w.tone}>
                        {w.tone === 'bad' ? 'Act' : 'Watch'}
                      </span>
                      <p>{w.text}</p>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => goToTable(w.table)}
                      >
                        {w.tableTitle}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <DeepDive board={board} currency={acct.currency} />
        </>
      ) : account && !s.boardError ? (
        <p className="card-note">Loading the board</p>
      ) : null}
    </div>
  );
}
