import { useEffect, useId } from 'react';
import {
  ADS_TOTALS_DAYS,
  type AdsBoard,
  type AdsTotals,
  type AdsTotalsDays,
} from '../../../../shared/ads-contract.ts';
import { AccountHead } from './Approvals.tsx';
import { DeepDive } from './DeepDive.tsx';
import { worthALook } from './logic.ts';
import { adStore, useAd } from './store.ts';
import { useAdsAccount } from './use-ads-account.ts';
import { rangeWords, shortDate, type TotalsKey, totalsChange, totalsValue } from './words.ts';

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

const FIGURES: { label: string; key: TotalsKey }[] = [
  { label: 'Spend', key: 'spend' },
  { label: 'Conversions', key: 'conversions' },
  { label: 'Conv. value', key: 'value' },
  { label: 'ROAS', key: 'roas' },
  { label: 'CPA', key: 'cpa' },
];

/**
 * Release 2: headline figures for the last 7, 30 or 90 days against the days before. Drawn only when the board
 * carries `totalRanges`. The switch starts at 30 on each visit; only these figures follow it, the tables stay at 30.
 */
function TotalsStrip({ totals, currency }: { totals: AdsTotals; currency: string }) {
  const days = useAd().totalsDays;
  const setDays = (d: AdsTotalsDays) => adStore.set({ totalsDays: d });
  const name = useId();
  const range = totals.ranges.find((r) => r.days === days);
  const wasted = totals.wastedSpend;
  return (
    <section className="card sm-totals" aria-labelledby="sm-totals-h">
      <div className="card-head">
        <h3 id="sm-totals-h">Headline figures</h3>
        <fieldset className="sm-switch">
          <legend>Show the last</legend>
          {ADS_TOTALS_DAYS.map((d) => (
            <label key={d} className="sm-switch-opt">
              <input
                type="radio"
                className="tick"
                name={name}
                checked={days === d}
                onChange={() => setDays(d)}
              />
              {d} days
            </label>
          ))}
        </fieldset>
      </div>
      {range ? (
        <>
          <p className="card-note" id="sm-totals-label">
            Last {range.days} days, {rangeWords(range.from, range.to)}, against the {range.days} days before.
            Google basis: as Google Ads reports them, which can differ from the client's own records.
            {range.partial
              ? range.dataFrom
                ? ` Data starts ${shortDate(range.dataFrom)}, so it covers fewer days.`
                : ' The data starts part-way through this period, so it covers fewer days.'
              : ''}
          </p>
          <dl className="sm-facts" aria-labelledby="sm-totals-label">
            {FIGURES.map((f) => {
              const change = totalsChange(
                f.key,
                range.current[f.key],
                range.previous ? { value: range.previous[f.key] } : null,
                currency,
              );
              return (
                <div className="sm-fact" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {totalsValue(f.key, range.current[f.key], currency)}
                    <small data-tone={change.tone === 'neutral' ? undefined : change.tone}>
                      {change.text}
                      {change.hidden ? <span className="visually-hidden">{change.hidden}</span> : null}
                    </small>
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : (
        <p className="card-note">No daily figures for this account yet.</p>
      )}
      {wasted !== null ? (
        <p className="sm-wasted">
          <strong>Wasted spend {totalsValue('spend', wasted, currency)}</strong>
          <span className="am-sub"> search terms with no conversions in the last 30 days (Google basis)</span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Ads Account Summary (plan 2026-11-19-ads-workbench-sections, decision 8): the account, what is worth a look, then
 * the six original deep-dive tables. The tables are fixed at the last 30 days.
 */
export function SummarySheet() {
  const { account, loading } = useAdsAccount();
  const s = useAd();
  // A new visit starts at 30 days; the choice is kept while the account changes.
  useEffect(() => {
    adStore.set({ totalsDays: 30 });
  }, []);
  const acct = s.accounts?.find((a) => a.key === account);
  const name = acct?.name ?? account ?? '';
  const board: AdsBoard | null = s.board && s.boardFor === account ? s.board : null;
  const totals = board?.totalRanges;
  const worth = board ? worthALook(board) : [];
  // Top products is missing because the account doesn't run Shopping: every products file is "not needed".
  const productFiles = (board?.health?.files ?? []).filter((f) => f.group === 'products');
  const noProducts =
    board !== null &&
    !board.tables.some((t) => t.id === 'products') &&
    productFiles.length > 0 &&
    productFiles.every((f) => f.status === 'na');

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
        {board && !totals ? <span className="sm-period">Last 30 days</span> : null}
      </AccountHead>
      {s.boardError ? (
        <p className="am-line" role="alert">
          {s.boardError}
        </p>
      ) : null}
      {board && acct ? (
        <>
          {totals && Array.isArray(totals.ranges) ? (
            <TotalsStrip totals={totals} currency={acct.currency} />
          ) : null}
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
          <DeepDive
            board={board}
            currency={acct.currency}
            note={noProducts ? "Top products isn't shown: this account doesn't run Shopping." : null}
          />
        </>
      ) : account && !s.boardError ? (
        <p className="card-note">Loading the board</p>
      ) : null}
    </div>
  );
}
