import { useEffect, useState } from 'react';
import { useStore } from '../../store.tsx';
import { AccountHead } from './Approvals.tsx';
import { Cadence, ReadinessPanel, TypeKey } from './Board.tsx';
import { identityLine } from './ProposalPanel.tsx';
import { adStore, useAd } from './store.ts';
import { useAdsAccount } from './use-ads-account.ts';

/**
 * Ads Command Centre (plan 2026-11-19-ads-workbench-sections, decision 6): the account head, the account data
 * panel, then "What I run on <account>" with its key and the five frequency columns.
 */
export function CommandSheet() {
  const { ads } = useStore();
  const { account, loading } = useAdsAccount();
  const s = useAd();
  const [started, setStarted] = useState<string | null>(null);
  const acct = s.accounts?.find((a) => a.key === account);
  const name = acct?.name ?? account ?? '';
  const reviewer = s.approvals?.clients.find((c) => c.slug === account)?.reviewer;
  const mismatch = ads?.sameIdentity === false;
  const board = s.board && s.boardFor === account ? s.board : null;

  // A jump to the data panel can't land when the board failed to load; clear it so it can't fire on a later visit.
  const boardError = s.boardError;
  const jump = s.jump;
  useEffect(() => {
    if (boardError && jump === 'readiness') adStore.set({ jump: null });
  }, [boardError, jump]);

  return (
    <div className="am cc">
      {/* One status region, always mounted, so a started chat is announced when it happens. */}
      <p className="visually-hidden" role="status">
        {started ?? ''}
      </p>
      <AccountHead
        name={name || (loading ? 'Loading…' : 'Choose an account')}
        reviewer={reviewer || undefined}
        currency={acct?.currency}
      />
      {mismatch ? <p className="am-line">{identityLine(ads?.me?.name)}</p> : null}
      {s.loadError ? (
        <p className="am-line" role="alert">
          {s.loadError}
        </p>
      ) : null}
      {s.boardError ? (
        <p className="am-line" role="alert">
          {s.boardError}
        </p>
      ) : null}
      {started ? <p className="am-line">{started}</p> : null}
      {!s.accounts && !s.loadError ? <p className="card-note">Loading</p> : null}
      {s.accounts && s.accounts.length === 0 ? <p className="card-note">No accounts found.</p> : null}
      {board && acct ? (
        <>
          <ReadinessPanel board={board} />
          <div className="cc-board-head">
            <h2 className="am-h cc-h">What I run on {name}</h2>
            <p className="am-sub">
              Your Google Ads operating rhythm. Every card runs a fresh Claude session with the brief and the
              data already in hand. Colour tells you what it does: pull a report, find an insight, or take an
              action.
            </p>
            <TypeKey />
          </div>
          <Cadence board={board} name={name} canAct={!mismatch} onStarted={setStarted} />
        </>
      ) : account && !s.boardError ? (
        <p className="card-note">Loading the board</p>
      ) : null}
    </div>
  );
}
