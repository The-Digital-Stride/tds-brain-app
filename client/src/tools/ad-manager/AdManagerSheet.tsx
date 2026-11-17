import { useEffect, useState } from 'react';
import { useStore } from '../../store.tsx';
import { Proposals, StatusCard } from './Approvals.tsx';
import { Cadence, DataHealth, Standup } from './Board.tsx';
import { DeepDive } from './DeepDive.tsx';
import { identityLine } from './ProposalPanel.tsx';
import {
  adStore,
  findProposal,
  loadApprovals,
  loadBoard,
  selectAccount,
  useAd,
  waitingFor,
} from './store.ts';
import { isWaiting } from './words.ts';

/** The Ad Manager sheet: the account's status, what waits for a decision, then the ads board. */
export function AdManagerSheet() {
  const { ads, boot, toolArg, clearToolArg, updatePrefs } = useStore();
  const s = useAd();
  const [started, setStarted] = useState<string | null>(null);

  // Load on arrival, on the ads summary changing (the `ads-changed` event) and on Refresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ads` and `refresh` are the triggers
  useEffect(() => {
    void loadApprovals();
  }, [ads, s.refresh]);

  // The account: from the caller (Home, search), else the one used last, else the first with something waiting.
  const keys = s.accounts?.map((a) => a.key);
  const savedAccount = boot?.prefs.adsAccount ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list or the caller's choice arrives
  useEffect(() => {
    if (!s.accounts || !keys) return;
    if (toolArg) {
      clearToolArg();
      if (keys.includes(toolArg)) {
        selectAccount(toolArg);
        void updatePrefs({ adsAccount: toolArg });
        return;
      }
    }
    if (s.account && keys.includes(s.account)) return;
    const first =
      (savedAccount && keys.includes(savedAccount) ? savedAccount : null) ??
      s.accounts.find((a) => waitingFor(ads, a) > 0)?.key ??
      s.accounts[0]?.key;
    if (first) selectAccount(first);
  }, [s.accounts, toolArg]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ads` and `refresh` are the triggers
  useEffect(() => {
    if (s.account) void loadBoard(s.account);
  }, [s.account, ads, s.refresh]);

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
  const name = account?.name ?? s.account ?? '';

  return (
    <div className="am">
      {/* One status region, always mounted, so a started chat is announced when it happens. */}
      <p className="visually-hidden" role="status">
        {started ?? ''}
      </p>
      {mismatch ? <p className="am-line">{identityLine(ads?.me?.name)}</p> : null}
      {s.loadError ? (
        <p className="am-line" role="alert">
          {s.loadError}
        </p>
      ) : null}
      {started ? <p className="am-line">{started}</p> : null}
      {!s.accounts && !s.loadError ? <p className="card-note">Loading</p> : null}
      {s.accounts && s.accounts.length === 0 ? <p className="card-note">No accounts found.</p> : null}

      {account && s.approvals ? (
        client ? (
          client.mine ? (
            <>
              <div className="tray am-tray" data-cols="1">
                <StatusCard client={client} />
              </div>
              <Proposals client={client} />
            </>
          ) : (
            <p className="am-line">
              {client.name}'s proposals are reviewed by {client.reviewer || client.owner || 'someone else'}.
            </p>
          )
        ) : (
          <p className="am-line">
            {account.name} is not on the supervised ads-manager yet, so it has no proposals.
          </p>
        )
      ) : null}

      {s.boardError ? (
        <p className="am-line" role="alert">
          {s.boardError}
        </p>
      ) : null}
      {s.board && s.boardFor === s.account && account ? (
        <>
          <h2 className="am-h">What I run on {name}</h2>
          <div className="tray am-tray" data-cols="1">
            <DataHealth board={s.board} />
          </div>
          <Cadence board={s.board} name={name} onStarted={setStarted} />
          <Standup board={s.board} name={name} canAct={!mismatch} onStarted={setStarted} />
          <DeepDive board={s.board} currency={account.currency} />
        </>
      ) : s.account && !s.boardError ? (
        <p className="card-note">Loading the board</p>
      ) : null}
    </div>
  );
}
