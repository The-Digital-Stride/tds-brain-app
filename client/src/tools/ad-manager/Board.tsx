import { useState } from 'react';
import type { AdsBoard } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Fold } from '../../shell/Fold.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { Confirm } from './Confirm.tsx';
import { useRestoreFocus } from './focus.ts';
import { adStore, loadBoard, useAd } from './store.ts';
import {
  type HealthFile,
  readHealth,
  readSetupPrompts,
  readStandup,
  readTables,
  type Table,
} from './types.ts';
import { actionLabel, adsErrorText, ageDays, fmt, sortRows } from './words.ts';

const CADENCES = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['fortnightly', 'Fortnightly'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
] as const;
const KIND_WORDS = { report: 'Report', insight: 'Insight', action: 'Action' } as const;

function fileNote(f: HealthFile): string {
  if (f.status === 'ok') return f.latest ? `through ${f.latest}` : 'ok';
  if (f.status === 'na') return 'not applicable';
  if (f.status === 'missing') return 'missing';
  if (f.status === 'stale') return `stale, last ${f.latest ?? '?'}`;
  if (f.status === 'wrong-shape') return `wrong shape, needs ${(f.missingCols ?? []).join(', ')}`;
  return f.status;
}

function CopyPrompts({ board }: { board: AdsBoard }) {
  const prompts = readSetupPrompts(board);
  const [copied, setCopied] = useState<string | null>(null);
  const options: { id: 'discover' | 'sheet' | 'proxy'; title: string; text: string }[] = [
    {
      id: 'discover',
      title: 'Not sure what you have? Let your Brain look.',
      text: 'Paste this into a Claude chat in your Brain. It works out how your Google Ads data is collected today, tells you what it found, then sets up the files and a daily refresh.',
    },
    {
      id: 'sheet',
      title: 'You run the 8020 script into Google Sheets.',
      text: 'This prompt pulls each sheet tab down to the files the board reads, then refreshes them daily.',
    },
    {
      id: 'proxy',
      title: 'You have the Google Ads proxy connected.',
      text: 'This prompt fetches the data straight from Google Ads through your proxy and refreshes it daily.',
    },
  ];
  const copy = async (id: 'discover' | 'sheet' | 'proxy') => {
    const text = prompts[id];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };
  return (
    <ul className="am-opts">
      {options.map((o) => (
        <li key={o.id}>
          <p>
            <strong>{o.title}</strong>
          </p>
          <p className="am-sub">{o.text}</p>
          <button
            type="button"
            className="btn"
            data-size="small"
            disabled={!prompts[o.id]}
            onClick={() => void copy(o.id)}
          >
            {copied === o.id ? 'Copied' : 'Copy prompt'}
            <span className="visually-hidden">: {o.title}</span>
          </button>
        </li>
      ))}
      <li aria-live="polite" className="am-sub">
        {copied ? 'Copied. Paste it into a Claude chat in your Brain.' : ''}
      </li>
    </ul>
  );
}

/** The data health line, or the set-up card when no data has arrived yet. */
export function DataHealth({ board }: { board: AdsBoard }) {
  const h = readHealth(board);
  const noData = !h || h.ok === 0 || h.files.every((f) => f.status === 'missing' || f.status === 'na');
  if (noData)
    return (
      <section className="card" aria-labelledby="am-setup">
        <div className="card-head">
          <h2 id="am-setup">Get your account data flowing</h2>
        </div>
        <p className="card-note">
          Every card below starts a Claude chat either way, but the tables, badges and the Daily standup need
          this account's data files. One pasted prompt sets it up.
        </p>
        <CopyPrompts board={board} />
      </section>
    );
  const bad = h.files.filter((f) => f.status !== 'ok' && f.status !== 'na');
  const fx = h.fetch;
  const fetchBad = Boolean(fx?.problem);
  const allGood = bad.length === 0 && !fetchBad;
  const fetchLine = !fx
    ? ''
    : fetchBad
      ? fx.errors
        ? `Daily fetch at ${fx.lastRun.slice(0, 16).replace('T', ' ')} failed on ${fx.errors} of ${fx.total} datasets. The data is from the last clean run. `
        : `No fetch for ${Math.round(fx.ageHours / 24)} day${fx.ageHours >= 48 ? 's' : ''} (last ${fx.lastRun.slice(0, 10)}). `
      : `Fetched ${fx.lastRun.slice(0, 16).replace('T', ' ')}. `;
  const title = fetchBad
    ? 'Account data: daily fetch problem'
    : bad.length === 0
      ? 'Account data'
      : `Account data: ${h.ok} of ${h.applicable} files ready`;
  const sum =
    fetchLine +
    (bad.length === 0
      ? `All ${h.applicable} applicable data files present${h.freshThrough ? `, fresh through ${h.freshThrough}` : ''}. Every card has what it needs.`
      : 'Cards that read the missing or misshapen files stay dark. The rest of the board still works.');
  return (
    <section className="card" aria-labelledby="am-health" data-tone={allGood ? undefined : 'warn'}>
      <div className="card-head">
        <h2 id="am-health">{title}</h2>
      </div>
      <p className="card-note">{sum}</p>
      <Fold key={`${board.key}-${allGood}`} title="Files" defaultOpen={!allGood}>
        <p className="am-sub">
          Reading from <code>{h.dir}</code>
        </p>
        <ul className="am-health">
          {h.files.map((f) => (
            <li key={f.file}>
              <span className="am-dot" data-status={f.status} aria-hidden="true" />
              <span className="am-file">{f.file}</span>
              <span className="am-dim">{fileNote(f)}</span>
              {f.powers ? <span className="am-meta">{f.powers}</span> : null}
            </li>
          ))}
        </ul>
        {bad.length > 0 ? <CopyPrompts board={board} /> : null}
      </Fold>
    </section>
  );
}

/** "What I run on <account>": five cadence columns of cards. Run starts a new chat with the card's prompt, unchanged. */
export function Cadence({
  board,
  name,
  onStarted,
}: {
  board: AdsBoard;
  name: string;
  onStarted: (text: string) => void;
}) {
  const { startChat } = useStore();
  const [starting, setStarting] = useState<string | null>(null);
  const run = async (id: string, title: string, prompt: string) => {
    if (starting) return;
    setStarting(id);
    const chat = await startChat(prompt, board.key, { open: true });
    setStarting(null);
    if (chat) onStarted(`Started a chat: ${title}, ${name}.`);
  };
  return (
    <div className="tray am-tray" data-cols="cadence">
      {CADENCES.map(([key, label]) => {
        const cards = board.cards.filter((c) => c.cadence === key);
        return (
          <section key={key} className="card" aria-labelledby={`am-cad-${key}`}>
            <div className="card-head">
              <h3 id={`am-cad-${key}`}>{label}</h3>
              <span className="count">{cards.length}</span>
            </div>
            <ul className="am-tasks">
              {cards.map((c) => (
                <li key={c.id} className="am-task">
                  <p className="am-sub">
                    <span className="chip">{KIND_WORDS[c.kind]}</span>
                    {c.badge ? (
                      <span className="badge" data-tone="waiting">
                        {c.badge}
                      </span>
                    ) : null}
                  </p>
                  <p className="am-camp">{c.title}</p>
                  <p className="am-sub">{c.description}</p>
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    aria-label={`Run: ${c.title}`}
                    aria-disabled={starting !== null || undefined}
                    onClick={() => void run(c.id, c.title, c.prompt)}
                  >
                    {starting === c.id ? 'Starting…' : 'Run'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The Daily standup card and the account's triage line. */
export function Standup({
  board,
  name,
  canAct,
  onStarted,
}: {
  board: AdsBoard;
  name: string;
  canAct: boolean;
  onStarted: (text: string) => void;
}) {
  const { startChat } = useStore();
  const { dispatch } = useShell();
  const { busy } = useAd();
  const [ask, setAsk] = useState(false);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useRestoreFocus(ask ? 'setup' : null);
  const s = readStandup(board);
  const v = s.verdict;
  const age = v ? ageDays(v.date) : null;
  const stale = age !== null && age > 2;
  const call = v
    ? v.flagged > 0
      ? `${v.flagged} flagged${v.topAction ? `, ${actionLabel(v.topAction, s.labels)}` : ''}`
      : 'All campaigns holding'
    : '';

  const setup = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.adsChange('standup-setup', { account: board.key });
      setAsk(false);
      await loadBoard(board.key);
    } catch (err) {
      setAsk(false);
      setError(adsErrorText(err));
    } finally {
      setCreating(false);
    }
  };
  const run = async () => {
    if (starting || !s.prompt) return;
    setStarting(true);
    const chat = await startChat(s.prompt, board.key, { open: true });
    setStarting(false);
    if (chat) onStarted(`Started a chat: Daily standup, ${name}.`);
  };
  const triage = v
    ? v.flagged > 0
      ? `${v.flagged} flagged, ${actionLabel(v.topAction, s.labels)}`
      : 'Holding'
    : s.hasStandup
      ? 'Not run yet'
      : 'Not set up';

  return (
    <div className="tray am-tray" data-cols="2">
      <section className="card" aria-labelledby="am-standup">
        <div className="card-head">
          <h2 id="am-standup">Daily standup</h2>
          <span className="chip">Multi-agent</span>
        </div>
        <p className="card-note">
          {s.hasStandup
            ? 'One recommended action per campaign, with the debate that produced it. Read-only.'
            : 'A bull and a bear argue your account, then an account director makes one call per campaign with the reasoning shown. Read-only.'}
        </p>
        {v ? (
          <p className="card-note am-verdict" data-stale={stale ? 'true' : undefined}>
            <strong>{call}</strong> as of {v.date}
            {stale ? ', stale: run it again' : ''}
            {v.flagged > 0 && v.topCampaign ? <span className="am-block">{v.topCampaign}</span> : null}
          </p>
        ) : null}
        {ask ? (
          <Confirm
            label="Set up the Daily standup"
            text={`Create a starter standup config from ${name}'s enabled campaigns? Each starts on a weekly cadence, and an existing config is never overwritten.`}
            action="Create config"
            variant="primary"
            busy={busy !== null || creating}
            onCancel={() => setAsk(false)}
            onConfirm={() => void setup()}
          />
        ) : (
          <div className="am-actions am-pad">
            {!s.hasStandup ? (
              canAct ? (
                <button
                  type="button"
                  className="btn"
                  data-variant="primary"
                  data-size="small"
                  data-am-opener="setup"
                  onClick={() => setAsk(true)}
                >
                  Set up
                </button>
              ) : null
            ) : (
              <>
                {s.prompt ? (
                  <button
                    type="button"
                    className="btn"
                    data-variant="primary"
                    data-size="small"
                    aria-disabled={starting || undefined}
                    onClick={() => void run()}
                  >
                    {starting ? 'Starting…' : 'Run'}
                    <span className="visually-hidden">: Daily standup</span>
                  </button>
                ) : null}
                {v && canAct ? (
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    onClick={() => {
                      adStore.set({ panelMode: 'rate' });
                      dispatch({ type: 'set-panel', open: true });
                    }}
                  >
                    Rate calls
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
        {error ? (
          <p className="am-hint" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <section className="card" aria-labelledby="am-triage">
        <div className="card-head">
          <h2 id="am-triage">Standup account triage</h2>
        </div>
        <div className="am-scroll">
          <table className="am-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Latest verdict</th>
                <th scope="col">As of</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{name}</td>
                <td>
                  <span className="badge" data-tone={v && v.flagged > 0 ? 'waiting' : undefined}>
                    {triage}
                  </span>
                </td>
                <td>{v?.date ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DeepTable({ t, currency }: { t: Table; currency: string }) {
  const [sort, setSort] = useState<{ idx: number; dir: 'asc' | 'desc' }>({
    idx: t.defaultSort ?? 0,
    dir: 'desc',
  });
  const rows = sortRows(t.rows, sort.idx, sort.dir);
  const choose = (idx: number) =>
    setSort((s) =>
      s.idx === idx
        ? { idx, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { idx, dir: t.cols[idx]?.type === 'text' ? 'asc' : 'desc' },
    );
  return (
    <section className="card" aria-labelledby={`am-t-${t.id}`}>
      <div className="card-head">
        <h3 id={`am-t-${t.id}`}>{t.title}</h3>
        {t.tone === 'warn' ? (
          <span className="badge" data-tone="waiting">
            Worth a look
          </span>
        ) : null}
      </div>
      {t.subtitle ? <p className="card-note">{t.subtitle}</p> : null}
      <div className="am-scroll">
        <table className="am-table">
          <thead>
            <tr>
              {t.cols.map((c, i) => (
                <th
                  key={c.label}
                  scope="col"
                  data-num={c.type === 'text' ? undefined : 'true'}
                  aria-sort={sort.idx === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className="am-sort" onClick={() => choose(i)}>
                    {c.label}
                    {sort.idx === i ? (
                      <span className="am-sort-icon" data-dir={sort.dir === 'asc' ? 'up' : 'down'}>
                        <Icon name="chevron" size={14} />
                      </span>
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id of their own
              <tr key={n}>
                {r.map((v, i) => (
                  <td key={`${t.cols[i]?.label}`} data-num={t.cols[i]?.type === 'text' ? undefined : 'true'}>
                    {fmt(v, t.cols[i]?.type ?? 'text', currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** "Ads account deep dive": up to six sortable tables. */
export function DeepDive({ board, currency }: { board: AdsBoard; currency: string }) {
  const tables = readTables(board);
  if (tables.length === 0)
    return (
      <div className="tray am-tray" data-cols="1">
        <section className="card" aria-labelledby="am-deep">
          <div className="card-head">
            <h2 id="am-deep">Ads account deep dive</h2>
          </div>
          <p className="card-note">
            No account data yet. Once the data files arrive, the top campaigns, search terms, wasted spend,
            keywords, products and Quality Score tables appear here.
          </p>
        </section>
      </div>
    );
  return (
    <>
      <h2 className="am-h">
        Ads account deep dive <span className="am-dim">{tables.length} tables, press a column to sort</span>
      </h2>
      <div className="tray am-tray" data-cols="2">
        {tables.map((t) => (
          <DeepTable key={t.id} t={t} currency={currency} />
        ))}
      </div>
    </>
  );
}
