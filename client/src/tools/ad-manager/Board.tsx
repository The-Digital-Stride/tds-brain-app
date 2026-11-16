import { useState } from 'react';
import type { AdsBoard, AdsTaskRun } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Fold } from '../../shell/Fold.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { Confirm } from './Confirm.tsx';
import { useRestoreFocus } from './focus.ts';
import { adStore, loadBoard, useAd } from './store.ts';
import { lastRunText, runKey, runStatus, shownRun, taskRuns, useTaskRuns } from './task-runs.ts';
import { type HealthFile, readHealth, readSetupPrompts, readStandup } from './types.ts';
import { actionLabel, adsErrorText, ageDays } from './words.ts';

const CADENCES = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['fortnightly', 'Fortnightly'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
] as const;
const KIND_WORDS = { report: 'Report', insight: 'Insight', action: 'Action' } as const;
/** The Daily standup's id in the run record (task card ids are words, so this can't clash). */
const STANDUP_TASK = 'standup:daily';

/**
 * Records a run in the brain so the team sees it, when the skill shares runs (its board carries `lastRun`).
 * Not waited on, and a failure says nothing: the run still shows here from this browser's record.
 */
function shareRun(board: AdsBoard, task: string) {
  if (!board.cards.some((c) => 'lastRun' in c)) return;
  void api.adsTaskRun({ account: board.key, task }).catch(() => {});
}

/** A task's run on this account: its live status and when it last ran (from this app), or null. */
function useTaskRun(client: string, task: string) {
  const runs = useTaskRuns();
  const { sessions } = useStore();
  const run = runs[runKey(client, task)];
  return { run, status: runStatus(run, sessions?.live) };
}

/**
 * When a task last ran, with a status dot and words while its chat is live ("Running · started Today, 21:46",
 * "Needs your answer · …", "Last run 3 Nov, 14:00"); nothing until it has run. The status is spoken from a
 * hidden region that is always in the page (one added already holding text is often not announced).
 */
function RunLine({
  client,
  task,
  title,
  shared,
}: {
  client: string;
  task: string;
  title: string;
  /** The brain's latest run by anyone (`lastRun`), when the skill shares runs. */
  shared?: AdsTaskRun | null;
}) {
  const { ads } = useStore();
  const { run: local, status } = useTaskRun(client, task);
  const run = shownRun(local, shared, ads?.me?.slug ?? null, status !== null);
  const words = status === 'running' ? 'Running' : status === 'waiting' ? 'Needs your answer' : null;
  return (
    <>
      <span role="status" className="visually-hidden">
        {words ? `${title}: ${words}` : ''}
      </span>
      {run ? (
        <p className="am-run">
          {words ? (
            <span className="am-run-state" aria-hidden="true">
              <span className="dot" data-attention={status === 'running' ? 'working' : 'asking'} />
              {words}
            </span>
          ) : null}
          {words ? <span aria-hidden="true"> · </span> : null}
          <time dateTime={run.at}>
            {words ? 'started' : 'Last run'} {lastRunText(run.at)}
          </time>
          {run.by ? ` by ${run.by}` : null}
        </p>
      ) : null}
    </>
  );
}

/** Run, or "Open chat" while the last run's chat is still going (so a task isn't started twice by accident). */
function RunButton({
  client,
  task,
  title,
  primary,
  starting,
  disabled,
  onRun,
}: {
  client: string;
  task: string;
  title: string;
  primary?: boolean;
  starting: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const { openChat } = useStore();
  const { run, status } = useTaskRun(client, task);
  if (status && run?.chat) {
    const chat = run.chat;
    return (
      <button type="button" className="btn" data-size="small" onClick={() => openChat(chat)}>
        Open chat<span className="visually-hidden">: {title}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn"
      data-variant={primary ? 'primary' : undefined}
      data-size="small"
      aria-disabled={disabled || undefined}
      onClick={onRun}
    >
      {starting ? 'Starting…' : 'Run'}
      <span className="visually-hidden">: {title}</span>
    </button>
  );
}

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
    if (!chat) return;
    taskRuns.record(board.key, id, chat);
    shareRun(board, id);
    onStarted(`Started a chat: ${title}, ${name}.`);
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
                  <RunLine client={board.key} task={c.id} title={c.title} shared={c.lastRun} />
                  <RunButton
                    client={board.key}
                    task={c.id}
                    title={c.title}
                    starting={starting === c.id}
                    disabled={starting !== null}
                    onRun={() => void run(c.id, c.title, c.prompt)}
                  />
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
    if (!chat) return;
    taskRuns.record(board.key, STANDUP_TASK, chat);
    shareRun(board, STANDUP_TASK);
    onStarted(`Started a chat: Daily standup, ${name}.`);
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
        {s.hasStandup && s.prompt ? (
          <RunLine client={board.key} task={STANDUP_TASK} title="Daily standup" shared={s.lastRun} />
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
                  <RunButton
                    client={board.key}
                    task={STANDUP_TASK}
                    title="Daily standup"
                    primary
                    starting={starting}
                    disabled={starting}
                    onRun={() => void run()}
                  />
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
