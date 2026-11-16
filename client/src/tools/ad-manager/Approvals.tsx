import { useState } from 'react';
import type { ClientApprovals, ProposalSummary } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Fold } from '../../shell/Fold.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useAdsRunner } from './actions.ts';
import { Confirm } from './Confirm.tsx';
import { useRestoreFocus } from './focus.ts';
import { OpenFile } from './OpenFile.tsx';
import { adStore, useAd } from './store.ts';
import { readMonthly, readPack } from './types.ts';
import { decisionWords, statusWords } from './words.ts';

function useFolds(client: string) {
  const { boot, updatePrefs } = useStore();
  const folds = boot?.prefs.adsFolds ?? {};
  return {
    isOpen: (kind: 'open' | 'recent', fallback: boolean) => folds[`${client}:${kind}`] ?? fallback,
    save: (kind: 'open' | 'recent', open: boolean) =>
      void updatePrefs({ adsFolds: { ...folds, [`${client}:${kind}`]: open } }),
  };
}

function SignOff({ client }: { client: ClientApprovals }) {
  const { ads } = useStore();
  const { busy } = useAd();
  const run = useAdsRunner();
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState('');
  useRestoreFocus(ask ? 'sign' : null);
  const m = readMonthly(client);
  if (!m || !client.mine || m.signed || m.partial || !m.files.body || m.canSign === false) return null;
  if (ads && ads.sameIdentity === false) return null;
  if (ask)
    return (
      <Confirm
        label="Sign off the report"
        text={`Sign off the ${m.monthName} report for ${client.name} in your name? Only do this after reading the draft PDF. The final PDF is built from the report as it is now.`}
        action="Sign off"
        variant="primary"
        busy={busy !== null}
        onCancel={() => setAsk(false)}
        onConfirm={() =>
          void run({
            client: client.slug,
            id: m.month,
            label: 'Signing off',
            reload: true,
            call: () =>
              api.adsChange('sign-monthly', {
                client: client.slug,
                month: m.month,
                ...(note.trim() ? { note: note.trim() } : {}),
              }),
          }).then(() => setAsk(false))
        }
      />
    );
  return (
    <div className="am-actions am-sign">
      <label className="am-field am-grow">
        <span>Sign-off note (optional)</span>
        <input className="field" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn"
        data-variant="primary"
        data-size="small"
        data-am-opener="sign"
        aria-disabled={busy !== null || undefined}
        onClick={() => busy === null && setAsk(true)}
      >
        Sign off the report
      </button>
    </div>
  );
}

/** Where the client stands: latest weekly pack, monthly close, open count, verification findings. */
export function StatusCard({ client }: { client: ClientApprovals }) {
  const pack = readPack(client);
  const m = readMonthly(client);
  return (
    <section className="card" aria-labelledby="am-status">
      <div className="card-head">
        <h2 id="am-status">{client.name}</h2>
        <span className="chip">Reviewer: {client.reviewer || client.owner || 'not set'}</span>
      </div>
      <dl className="kv am-status">
        <dt>Latest weekly pack</dt>
        <dd>
          {pack ? (
            <>
              {pack.date}, {pack.act} act, {pack.watch} watch{pack.provisional ? ', provisional' : ''}{' '}
              {pack.report ? <OpenFile path={pack.report} label="Open report" /> : null}
            </>
          ) : (
            'No weekly pack yet'
          )}
        </dd>
        <dt>Monthly close</dt>
        <dd>
          {m ? (
            <>
              {m.monthName}:{' '}
              {m.signed ? (
                <span className="badge">
                  Signed off by {m.reviewedBy} {m.reviewedAt?.slice(0, 10)}
                </span>
              ) : m.partial ? (
                <span className="badge" data-tone="draft">
                  Draft, month to date{m.dataTo ? ` to ${m.dataTo}` : ''}. Can't be signed yet
                </span>
              ) : (
                <span className="badge" data-tone="draft">
                  Draft, not reviewed{m.stale && m.reason ? `. ${m.reason}` : ''}
                </span>
              )}{' '}
              {m.files.pdf ? (
                <OpenFile path={m.files.pdf} label="Open final PDF" />
              ) : m.files.draftPdf ? (
                <OpenFile path={m.files.draftPdf} label="Open draft PDF" />
              ) : null}{' '}
              {m.files.close ? <OpenFile path={m.files.close} label="Close notes" /> : null}{' '}
              {m.files.email ? <OpenFile path={m.files.email} label="Email draft" /> : null}
              <SignOff client={client} />
            </>
          ) : (
            'None yet'
          )}
        </dd>
        <dt>Open proposals</dt>
        <dd>{client.open.length}</dd>
        {readPack(client)?.verification?.length ? (
          <>
            <dt>Verification</dt>
            <dd>
              {(readPack(client)?.verification ?? []).map((f) => (
                <span key={f.title} className="am-block">
                  {f.title}. {f.detail}
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

const Tier = ({ n }: { n: number }) => (
  <span className="badge" data-tier={n} title={`Tier ${n}`} role="img" aria-label={`Tier ${n}`}>
    T{n}
  </span>
);

function WaitingTable({ client, rows }: { client: ClientApprovals; rows: ProposalSummary[] }) {
  const { selected } = useAd();
  const { dispatch } = useShell();
  if (rows.length === 0) return <p className="card-note">Nothing open.</p>;
  return (
    <div className="am-scroll">
      <table className="am-table">
        <thead>
          <tr>
            {['ID', 'Tier', 'Type', 'Proposal', 'Section', 'Campaigns', 'Expires', 'Status', ''].map((h) => (
              <th key={h || 'details'} scope="col">
                {h || <span className="visually-hidden">Details</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const camps = Array.isArray(p.fm.campaigns) ? (p.fm.campaigns as string[]) : [];
            const current = selected?.client === client.slug && selected.id === p.id;
            return (
              <tr key={p.id} data-current={current ? 'true' : undefined}>
                <td>
                  <code>{p.id}</code>
                </td>
                <td>
                  <Tier n={p.fm.tier} />
                </td>
                <td>{p.fm.type}</td>
                <td className="am-wide">{p.fm.title}</td>
                <td>{String(p.fm.framework_section ?? '')}</td>
                <td>
                  {camps.length ? (
                    camps.map((c) => (
                      <span key={c} className="am-block">
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="am-dim">account</span>
                  )}
                </td>
                <td className="am-nowrap">{String(p.fm.expires ?? '')}</td>
                <td>
                  <span className="badge" data-tone={p.fm.status === 'approved' ? undefined : 'waiting'}>
                    {statusWords(p.fm.status)}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    aria-pressed={current}
                    aria-label={`Details: ${p.fm.title}`}
                    onClick={() => {
                      adStore.set({ selected: { client: client.slug, id: p.id }, panelMode: 'proposal' });
                      dispatch({ type: 'set-panel', open: true });
                    }}
                  >
                    Details
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentTable({ rows }: { rows: ProposalSummary[] }) {
  if (rows.length === 0) return <p className="card-note">None yet.</p>;
  return (
    <div className="am-scroll">
      <table className="am-table">
        <thead>
          <tr>
            {['Date', 'ID', 'Tier', 'Proposal', 'Decision', 'By', 'Reason or outcome'].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const d = decisionWords(p.fm);
            return (
              <tr key={p.id}>
                <td className="am-nowrap">{d.when}</td>
                <td>
                  <code>{p.id}</code>
                </td>
                <td>
                  <Tier n={p.fm.tier} />
                </td>
                <td className="am-wide">{p.fm.title}</td>
                <td className="am-nowrap">
                  <span className="badge">{d.decision}</span>
                </td>
                <td className="am-nowrap">{d.by}</td>
                <td>{d.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The two folds: what waits for a decision (open) and what was decided lately (shut). Fold state is saved per client. */
export function Proposals({ client }: { client: ClientApprovals }) {
  const folds = useFolds(client.slug);
  return (
    <div className="tray am-tray" data-cols="1">
      <section className="card" aria-label="Waiting for a decision">
        <Fold
          key={`${client.slug}-open`}
          title="Waiting for a decision"
          count={client.open.length}
          defaultOpen={folds.isOpen('open', true)}
          onToggle={(o) => folds.save('open', o)}
        >
          <WaitingTable client={client} rows={client.open} />
        </Fold>
      </section>
      <section className="card" aria-label="Recent decisions">
        <Fold
          key={`${client.slug}-recent`}
          title="Recent decisions, last 14 days"
          count={client.recent.length}
          defaultOpen={folds.isOpen('recent', false)}
          onToggle={(o) => folds.save('recent', o)}
        >
          <RecentTable rows={client.recent} />
        </Fold>
      </section>
    </div>
  );
}
