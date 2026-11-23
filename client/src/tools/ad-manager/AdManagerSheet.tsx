import { useEffect, useRef } from 'react';
import { useShell } from '../../shell/ShellProvider.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { useStore } from '../../store.tsx';
import { AccountHead, FactTiles, goToClose, MonthlyClose, NeedsYou, Proposals } from './Approvals.tsx';
import { identityLine } from './ProposalPanel.tsx';
import { adStore, findProposal, useAd } from './store.ts';
import { useAdsAccount } from './use-ads-account.ts';
import { isWaiting, personName } from './words.ts';

/** The Ads Manager sheet: the account's facts, what needs you, the proposals, then the monthly close. */
export function AdManagerSheet() {
  const { ads } = useStore();
  const s = useAd();
  useAdsAccount();
  const { state, dispatch } = useShell();

  // The right panel opens when a proposal is chosen (Details, a row), not on arrival with nothing to show. A panel
  // left open from another visit is put away once, when this sheet comes up with no proposal chosen; the sheet
  // bar's toggle still opens it whenever the person wants.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (state.panelOpen && !findProposal(s.approvals, s.selected))
      dispatch({ type: 'set-panel', open: false });
  }, [state.panelOpen, s.approvals, s.selected, dispatch]);

  // The panel shows a proposal as soon as there is one waiting for this account.
  useEffect(() => {
    const client = s.approvals?.clients.find((c) => c.slug === s.account);
    if (!client || findProposal(s.approvals, s.selected)?.client.slug === client.slug) return;
    const first = client.open.find(isWaiting);
    if (first) adStore.set({ selected: { client: client.slug, id: first.id } });
  }, [s.approvals, s.account, s.selected]);

  const account = s.accounts?.find((a) => a.key === s.account);
  const client = s.approvals?.clients.find((c) => c.slug === s.account);
  const mismatch = ads?.sameIdentity === false;
  const board = s.boardFor === s.account ? s.board : null;
  const shown = Boolean(account && s.approvals && client?.mine);

  // A jump to the monthly close (from another tool, or search): once the card has drawn, go there, then clear it.
  const jump = s.jump;
  useEffect(() => {
    if (jump !== 'close' || !shown) return;
    goToClose();
    adStore.set({ jump: null });
  }, [jump, shown]);

  return (
    <div className="am">
      {mismatch ? (
        <p className="notice" data-level="info" data-shape="box">
          {identityLine(ads?.me?.name)}
        </p>
      ) : null}
      {s.loadError ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {s.loadError}
        </p>
      ) : null}
      {!s.accounts && !s.loadError ? <StateNote kind="loading" /> : null}
      {s.accounts && s.accounts.length === 0 ? <StateNote kind="empty">No accounts found.</StateNote> : null}

      {s.boardError ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {s.boardError}
        </p>
      ) : null}

      {account && s.approvals ? (
        <>
          <AccountHead client={client} name={account.name} currency={account.currency} />
          {client?.mine ? <FactTiles client={client} /> : null}
          <div className="tray am-tray" data-cols="1">
            <NeedsYou slug={account.key} client={client?.mine ? client : null} board={board} />
          </div>
          {client ? (
            client.mine ? null : (
              <p className="notice" data-level="info" data-shape="box">
                {client.name}'s proposals are reviewed by{' '}
                {personName(client.reviewer || client.owner, s.approvals?.people) || 'someone else'}.
              </p>
            )
          ) : (
            <p className="notice" data-level="info" data-shape="box">
              {account.name} is not on the supervised ads-manager yet, so it has no proposals.
            </p>
          )}
          {client?.mine ? (
            <>
              <Proposals client={client} />
              <div className="tray am-tray" data-cols="1">
                <MonthlyClose client={client} />
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
