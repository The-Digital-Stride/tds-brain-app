import { type ReactNode, useState } from 'react';
import type { AdsBoard, ClientApprovals, ProposalSummary } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Fold } from '../../shell/Fold.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useAdsRunner } from './actions.ts';
import { Confirm } from './Confirm.tsx';
import { useRestoreFocus } from './focus.ts';
import { needsYou } from './logic.ts';
import { OpenFile } from './OpenFile.tsx';
import { adStore, useAd } from './store.ts';
import { readMonthly, readPack } from './types.ts';
import {
  dateWords,
  decisionWords,
  isWaiting,
  nextStepWords,
  relativeWords,
  statusWords,
  whenWords,
} from './words.ts';

function useFolds(client: string) {
  const { boot, updatePrefs } = useStore();
  const folds = boot?.prefs.adsFolds ?? {};
  return {
    isOpen: (kind: 'open' | 'recent', fallback: boolean) => folds[`${client}:${kind}`] ?? fallback,
    save: (kind: 'open' | 'recent', open: boolean) =>
      void updatePrefs({ adsFolds: { ...folds, [`${client}:${kind}`]: open } }),
  };
}

// ---------- Jump to the Monthly close card ----------

let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** How long the Monthly close card stays outlined after a jump, in ms. */
export const FLASH_MS = 1600;

/**
 * Scrolls to the Monthly close card, moves focus to its heading and outlines the card for 1.6 s. With reduced
 * motion the scroll is instant. Used by the Needs you line, the Monthly close fact tile and an incoming `close` jump.
 */
export function goToClose(): void {
  const card = document.getElementById('am-close');
  if (!card) return;
  const calm =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  document.getElementById('am-close-h')?.focus({ preventScroll: true });
  clearTimeout(flashTimer);
  card.classList.add('am-flash');
  flashTimer = setTimeout(() => card.classList.remove('am-flash'), FLASH_MS);
}

// ---------- Header: the account and four fact tiles ----------

/** Plain words for where the month stands. */
function monthStatus(m: NonNullable<ReturnType<typeof readMonthly>>): { text: string; tone: 'ok' | 'draft' } {
  if (m.signed) {
    const day = dateWords(m.reviewedAt);
    return { text: `Signed off by ${m.reviewedBy ?? 'someone'}${day ? ` on ${day}` : ''}`, tone: 'ok' };
  }
  if (m.partial)
    return {
      text: `Draft, month to date${m.dataTo ? ` to ${dateWords(m.dataTo) || m.dataTo}` : ''}. Can't be signed yet`,
      tone: 'draft',
    };
  return { text: `Draft, not reviewed${m.stale && m.reason ? `. ${m.reason}` : ''}`, tone: 'draft' };
}

/** The account's name and currency; the reviewer chip only when the account is on the supervised ads-manager. */
export function AccountHead({
  client,
  reviewer,
  name,
  currency,
  children,
}: {
  client?: ClientApprovals;
  /** A reviewer name to show when there is no `client` (the Command Centre). */
  reviewer?: string;
  name: string;
  currency?: string;
  /** Anything that belongs at the end of the head, such as the Summary's period. */
  children?: ReactNode;
}) {
  const who = client ? client.reviewer || client.owner || 'not set' : reviewer;
  return (
    <header className="am-head">
      <h2 id="am-account-h">{name}</h2>
      {who ? <span className="chip">Reviewer: {who}</span> : null}
      {currency ? <span className="chip">{currency}</span> : null}
      {children}
    </header>
  );
}

export function FactTiles({ client }: { client: ClientApprovals }) {
  const now = new Date();
  const waiting = client.open.filter(isWaiting);
  const approved = client.open.filter((p) => !isWaiting(p));
  const firstExpiry = waiting
    .map((p) => String(p.fm.expires ?? '').slice(0, 10))
    .filter(Boolean)
    .sort()[0];
  const dryRuns = approved.filter((p) => nextStepWords(p).text === 'Dry run passed').length;
  const pack = readPack(client);
  const m = readMonthly(client);
  const ms = m ? monthStatus(m) : null;
  return (
    <ul className="am-facts" aria-label="Where this account stands">
      <li className="am-fact" data-tone={waiting.length > 0 ? 'waiting' : undefined}>
        <span className="am-fact-l">Waiting for a decision</span>
        <span className="am-fact-v">{waiting.length}</span>
        <span className="am-fact-d">
          {firstExpiry ? `first expires ${dateWords(firstExpiry, now)}` : 'Nothing waiting'}
        </span>
      </li>
      <li className="am-fact">
        <span className="am-fact-l">Approved, ready to apply</span>
        <span className="am-fact-v">{approved.length}</span>
        <span className="am-fact-d">
          {dryRuns > 0 ? `${dryRuns} dry ${dryRuns === 1 ? 'run' : 'runs'} passed` : ' '}
        </span>
      </li>
      <li className="am-fact">
        <span className="am-fact-l">Latest weekly pack</span>
        {pack ? (
          <>
            <span className="am-fact-v">
              {pack.act} act · {pack.watch} watch
            </span>
            <span className="am-fact-d">
              {dateWords(pack.date, now) || pack.date}
              {pack.provisional ? ', provisional' : ''}
            </span>
          </>
        ) : (
          <>
            <span className="am-fact-v">None yet</span>
            <span className="am-fact-d">&nbsp;</span>
          </>
        )}
      </li>
      <li className="am-fact">
        {m ? (
          <button type="button" className="am-fact-jump" title="Go to monthly close" onClick={goToClose}>
            <span className="am-fact-l">Monthly close</span>
            <span className="am-fact-v">{m.monthName || m.month}</span>
            <span className="am-fact-d">{ms?.text}</span>
          </button>
        ) : (
          <>
            <span className="am-fact-l">Monthly close</span>
            <span className="am-fact-v">None yet</span>
            <span className="am-fact-d">&nbsp;</span>
          </>
        )}
      </li>
    </ul>
  );
}

// ---------- Needs you ----------

/**
 * What needs you now, one action per line. `board` is this account's board once it has loaded. `client` is null when
 * the account isn't on the supervised ads-manager (or isn't yours), so only the board's data problems show.
 */
export function NeedsYou({
  slug,
  client,
  board,
}: {
  slug: string;
  client: ClientApprovals | null;
  board: AdsBoard | null;
}) {
  const { openTool } = useStore();
  const items = needsYou({
    pack: client ? readPack(client) : null,
    monthly: client ? readMonthly(client) : null,
    health: board?.health ?? null,
    open: client?.open ?? [],
  });
  return (
    <section className="card am-needs" aria-labelledby="am-needs-h">
      <div className="card-head">
        <h2 id="am-needs-h">Needs you</h2>
        <span className="count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="card-note">Nothing needs you right now.</p>
      ) : (
        <ul className="am-needs-list">
          {items.map((i) => (
            <li key={i.id}>
              <span className="dot" data-tone={i.tone} aria-hidden="true" />
              <span className="status-tag" data-tone={i.tone}>
                {i.tone === 'bad' ? 'Act' : 'Watch'}
              </span>
              <div className="am-need-text">
                <p>{i.text}</p>
                {i.sub ? <p className="am-need-sub">{i.sub}</p> : null}
              </div>
              {i.target.kind === 'report' ? (
                <OpenFile path={i.target.path} label={i.action} />
              ) : (
                <button
                  type="button"
                  className="btn"
                  data-size="small"
                  onClick={() => {
                    const t = i.target;
                    if (t.kind === 'jump') return goToClose();
                    if (t.kind === 'tool') {
                      if (t.anchor === 'readiness') adStore.set({ jump: 'readiness' });
                      openTool('workbench', t.tool, slug);
                    }
                  }}
                >
                  {i.action}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Monthly close ----------

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
      <div className="am-sign">
        <label className="am-field am-grow">
          <span>Sign-off note (optional)</span>
          <input className="field" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
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
      </div>
    );
  return (
    <button
      type="button"
      className="btn"
      data-variant="primary"
      data-size="small"
      data-am-opener="sign"
      aria-disabled={busy !== null || undefined}
      onClick={() => busy === null && setAsk(true)}
    >
      Sign off the report…
    </button>
  );
}

/** The monthly close: status, the one Sign off button, and the month's files. */
export function MonthlyClose({ client }: { client: ClientApprovals }) {
  const m = readMonthly(client);
  const ms = m ? monthStatus(m) : null;
  return (
    <section className="card am-close" id="am-close" aria-labelledby="am-close-h">
      <div className="card-head">
        <h2 id="am-close-h" tabIndex={-1}>
          Monthly close
        </h2>
        {m && ms ? (
          <span className="badge" data-tone={ms.tone === 'draft' ? 'draft' : 'ok'}>
            {m.monthName || m.month}: {ms.text}
          </span>
        ) : null}
      </div>
      {m ? (
        <>
          {!m.signed && !m.partial ? (
            <p className="card-note">
              Only sign off after reading the draft PDF. The final PDF is built from the report as it is now.
            </p>
          ) : null}
          <SignOff client={client} />
          <div className="am-links">
            {m.files.pdf ? (
              <OpenFile path={m.files.pdf} label="Open final PDF" />
            ) : m.files.draftPdf ? (
              <OpenFile path={m.files.draftPdf} label="Open draft PDF" />
            ) : null}
            {m.files.close ? <OpenFile path={m.files.close} label="Close notes" /> : null}
            {m.files.email ? <OpenFile path={m.files.email} label="Email draft" /> : null}
          </div>
        </>
      ) : (
        <p className="card-note">No monthly close yet.</p>
      )}
    </section>
  );
}

// ---------- Proposals ----------

/** A proposal's status as a badge, the same tone in the table and the panel: amber while it waits for a decision. */
export const StatusBadge = ({ status }: { status: string }) => (
  <span
    className="badge"
    data-tone={status === 'proposed' || status === 'changes-requested' ? 'waiting' : undefined}
  >
    {statusWords(status)}
  </span>
);

const Tier = ({ n }: { n: number }) => (
  <span className="badge" data-tier={n} title={`Tier ${n}`} role="img" aria-label={`Tier ${n}`}>
    T{n}
  </span>
);

function campaignsOf(p: ProposalSummary): string {
  const camps = Array.isArray(p.fm.campaigns) ? (p.fm.campaigns as string[]) : [];
  return camps.length ? camps.join(', ') : 'Whole account';
}

/** The proposals table: title with its campaign underneath, Tier, then a date and a status column that differ per card. */
function ProposalsTable({
  client,
  rows,
  mode,
}: {
  client: ClientApprovals;
  rows: ProposalSummary[];
  mode: 'waiting' | 'approved';
}) {
  const { selected } = useAd();
  const { state, dispatch } = useShell();
  const now = new Date();
  if (rows.length === 0)
    return <p className="card-note">{mode === 'waiting' ? 'Nothing waiting.' : 'Nothing approved yet.'}</p>;
  return (
    <div className="am-scroll">
      <table className="am-table">
        <thead>
          <tr>
            <th scope="col">Proposal</th>
            <th scope="col">Tier</th>
            <th scope="col">{mode === 'waiting' ? 'Expires' : 'Approved'}</th>
            <th scope="col">{mode === 'waiting' ? 'Status' : 'Next step'}</th>
            <th scope="col">
              <span className="visually-hidden">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            // Shown as chosen only while the panel is open: the first proposal is picked for it before it opens.
            const current = state.panelOpen && selected?.client === client.slug && selected.id === p.id;
            const f = p.fm as Record<string, unknown>;
            const step = nextStepWords(p);
            return (
              <tr key={p.id} data-current={current ? 'true' : undefined}>
                <td className="am-wide am-title-cell">
                  {p.fm.title}
                  <span className="am-subline">{campaignsOf(p)}</span>
                </td>
                <td>
                  <Tier n={p.fm.tier} />
                </td>
                <td className="am-nowrap">
                  {mode === 'waiting' ? (
                    <>
                      {dateWords(f.expires, now)}
                      <span className="am-subline">{relativeWords(f.expires, now)}</span>
                    </>
                  ) : (
                    <>
                      {whenWords(f.approved_at, now)}
                      {f.approved_by ? <span className="am-subline">by {String(f.approved_by)}</span> : null}
                    </>
                  )}
                </td>
                <td>
                  {mode === 'waiting' ? (
                    <StatusBadge status={p.fm.status} />
                  ) : (
                    <span className="badge" data-tone={step.tone ?? undefined}>
                      {step.text}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    aria-pressed={current}
                    aria-label={`Details: ${p.fm.title}`}
                    onClick={() => {
                      // A shut panel takes focus to its heading as it opens (and gives it back here on close); an open
                      // one doesn't move, so focus goes to the new proposal's title.
                      adStore.set({
                        selected: { client: client.slug, id: p.id },
                        panelMode: 'proposal',
                        focusTitle: state.panelOpen,
                      });
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
  const now = new Date();
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
                <td className="am-nowrap">{dateWords(d.when, now) || d.when}</td>
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

/**
 * Two cards: what waits for a decision, and what is approved and ready to apply (with the "Recent decisions" fold
 * under it). Fold state is saved per client.
 */
export function Proposals({ client }: { client: ClientApprovals }) {
  const folds = useFolds(client.slug);
  const waiting = client.open.filter(isWaiting);
  const approved = client.open.filter((p) => !isWaiting(p));
  return (
    <div className="tray am-tray" data-cols="1">
      <section className="card" aria-labelledby="am-waiting-h">
        <div className="card-head">
          <h2 id="am-waiting-h">Waiting for a decision</h2>
          <span className="count">{waiting.length}</span>
        </div>
        <ProposalsTable client={client} rows={waiting} mode="waiting" />
      </section>
      <section className="card" aria-labelledby="am-approved-h">
        <div className="card-head">
          <h2 id="am-approved-h">Approved, ready to apply</h2>
          <span className="count">{approved.length}</span>
        </div>
        <ProposalsTable client={client} rows={approved} mode="approved" />
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
