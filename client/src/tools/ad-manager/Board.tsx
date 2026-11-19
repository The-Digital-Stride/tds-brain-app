import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { AdsBoard, AdsTaskRun } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Fold } from '../../shell/Fold.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import type { DueState, FileDot, Readiness } from './ads-tools-contract.ts';
import { Confirm } from './Confirm.tsx';
import { useRestoreFocus } from './focus.ts';
import { dueState, readiness } from './logic.ts';
import { adStore, loadBoard, useAd } from './store.ts';
import { lastRunText, runKey, runStatus, shownRun, taskRuns, useTaskRuns } from './task-runs.ts';
import { type HealthFile, readHealth, readSetupPrompts, readStandup } from './types.ts';
import { actionLabel, adsErrorText, ageDays, dateWords, whenWords } from './words.ts';

const CADENCES = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['fortnightly', 'Fortnightly'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
] as const;
const KIND_WORDS = { report: 'Report', insight: 'Insight', action: 'Action', standup: 'Standup' } as const;
type Kind = keyof typeof KIND_WORDS;
/** The key under "What I run on": the type, and what it does (the original board's notes). */
const KEY_NOTES: [Kind, string][] = [
  ['report', 'pulls useful info together'],
  ['insight', 'finds what to do about it'],
  ['action', 'makes the change (with your sign-off)'],
  ['standup', 'multi-agent debate → today’s call'],
];
/** The Daily standup's id in the run record (task card ids are words, so this can't clash). */
const STANDUP_TASK = 'standup:daily';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  const lastTurn = run?.chat ? sessions?.live?.find((l) => l.id === run.chat)?.lastTurn : undefined;
  return { run, status: runStatus(run, sessions?.live), lastTurn };
}

/** "Due", "Overdue 3 days" or "Due Mon 1 Dec", as the badge's words and tone. */
function dueBadge(d: DueState): { text: string; tone: 'info' | 'bad' | 'muted' } | null {
  if (!d) return null;
  if (d.kind === 'due') return { text: 'Due', tone: 'info' };
  if (d.kind === 'overdue')
    return { text: `Overdue ${d.days} ${d.days === 1 ? 'day' : 'days'}`, tone: 'bad' };
  const [y, m, day] = d.on.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, day);
  return { text: `Due ${DAYS[date.getDay()]} ${day} ${MONTHS[m - 1]}`, tone: 'muted' };
}

/** "Today, 09:30" reads as "today, 09:30" after a word. */
const lower = (t: string) => t.replace(/^(Today|Yesterday|Tomorrow)/, (w) => w.toLowerCase());

/** "1 day", "2 days": whole days since the last fetch, with the plural matching the number shown. */
const dayCount = (hours: number) => {
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
};

/** A fetch time in words: "today, 05:00", "yesterday, 05:00" or "Tue 18 Nov, 05:00". Raw text when it isn't a date. */
const fetchWords = (iso: string) => {
  const day = whenWords(iso);
  return day ? `${lower(day)}, ${iso.slice(11, 16)}` : iso.slice(0, 16).replace('T', ' ');
};

/**
 * What a card says about its last run, and the badge for "due" or "stopped". The status is spoken from a hidden
 * region that is always in the page (one added already holding text is often not announced).
 * - Running or waiting: the live state and when it started.
 * - My newest run stopped or failed: "Stopped today, 09:30" and "Last good run <link>" to the last one that finished.
 * - Otherwise "Last run <link>", the link opening the last finished run's chat in the drawer.
 * - A teammate's run is text only: their chat is on their computer.
 */
function RunInfo({
  client,
  task,
  title,
  cadence,
  shared,
}: {
  client: string;
  task: string;
  title: string;
  cadence: AdsBoard['cards'][number]['cadence'] | null;
  /** The brain's latest run by anyone (`lastRun`), when the skill shares runs. */
  shared?: AdsTaskRun | null;
}) {
  const { ads, openPast } = useStore();
  const { run: local, status, lastTurn } = useTaskRun(client, task);
  const [gone, setGone] = useState(false);
  const run = shownRun(local, shared, ads?.me?.slug ?? null, status !== null);
  const words = status === 'running' ? 'Running' : status === 'waiting' ? 'Needs your answer' : null;
  const mine = run !== null && run.by === null;
  const stopped = mine && !words && (lastTurn === 'stopped' || lastTurn === 'failed');
  const good = local?.good ?? null;
  const due =
    stopped || words ? null : dueBadge(cadence ? dueState(cadence, run?.at ?? null, new Date()) : null);

  const open = async (sdk: string) => {
    setGone(false);
    const opened = await openPast(sdk, { in: 'drawer' });
    if (!opened) setGone(true);
  };
  const link = (sdk: string, at: string) => (
    <button type="button" className="cc-link" onClick={() => void open(sdk)}>
      {lastRunText(at)}
      <span className="visually-hidden">: open the chat for {title}</span>
    </button>
  );

  let line: ReactNode = null;
  if (run && words) {
    line = (
      <>
        <span className="am-run-state" aria-hidden="true">
          <span className="dot" data-attention={status === 'running' ? 'working' : 'asking'} />
          {words}
        </span>
        <span aria-hidden="true"> · </span>
        <time dateTime={run.at}>started {lastRunText(run.at)}</time>
      </>
    );
  } else if (run && stopped) {
    line = (
      <>
        <time dateTime={run.at}>
          {lastTurn === 'failed' ? 'Failed' : 'Stopped'} {lower(lastRunText(run.at))}
        </time>
        {good ? (
          <>
            {' · Last good run '}
            {link(good.sdk, good.at)}
          </>
        ) : null}
      </>
    );
  } else if (run?.by) {
    line = (
      <time dateTime={run.at}>
        Last run {lastRunText(run.at)} by {run.by}
      </time>
    );
  } else if (run && good && good.at === run.at) {
    line = <>Last run {link(good.sdk, good.at)}</>;
  } else if (run) {
    line = (
      <>
        <time dateTime={run.at}>Last run {lastRunText(run.at)}</time>
        {good ? (
          <>
            {' · Last good run '}
            {link(good.sdk, good.at)}
          </>
        ) : null}
      </>
    );
  } else if (!words) {
    line = <>Never run here</>;
  }
  return (
    <>
      <span role="status" className="visually-hidden">
        {words ? `${title}: ${words}` : ''}
      </span>
      {due || stopped ? (
        <span className="cc-due">
          {stopped ? (
            <span className="badge" data-tone="bad">
              Stopped
            </span>
          ) : due ? (
            <span className="badge" data-tone={due.tone}>
              {due.text}
            </span>
          ) : null}
        </span>
      ) : null}
      {line ? <p className="am-run">{line}</p> : null}
      {gone ? (
        <p className="am-hint" role="alert">
          That chat can't be opened any more.
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
      <button
        type="button"
        className="btn"
        data-size="small"
        onClick={() => openChat(chat, { in: 'drawer' })}
      >
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
  if (f.status === 'ok') return f.latest ? `through ${dateWords(f.latest) || f.latest}` : 'ok';
  if (f.status === 'na') return 'not needed for this account';
  if (f.status === 'missing') return 'missing';
  if (f.status === 'stale') return `stale, last ${(f.latest && dateWords(f.latest)) || f.latest || '?'}`;
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

const DOT_WORDS: Record<FileDot, string> = {
  ok: 'ready',
  na: 'not needed',
  warn: 'stale or wrong shape',
  bad: 'missing',
};

/**
 * The account data panel. Green with one line when every required file is ready; otherwise the files nested by
 * group, a dot and words per file, and the copy-prompt fixes. With no data at all, the set-up card instead.
 * A jump to `readiness` (from Ads Manager's "Needs you") focuses the heading once it has drawn, then clears.
 */
export function ReadinessPanel({ board }: { board: AdsBoard }) {
  const { jump } = useAd();
  const head = useRef<HTMLHeadingElement>(null);
  const h = readHealth(board);
  const noData = !h || h.ok === 0 || h.files.every((f) => f.status === 'missing' || f.status === 'na');
  const r: Readiness | null = noData ? null : readiness(board.health);

  // The heading exists once this has drawn, so this runs after it and can focus it.
  useEffect(() => {
    if (jump !== 'readiness') return;
    head.current?.focus();
    adStore.set({ jump: null });
  }, [jump]);

  if (noData || !r || !h)
    return (
      <section className="card" aria-labelledby="cc-ready-h">
        <div className="card-head">
          <h2 id="cc-ready-h" ref={head} tabIndex={-1}>
            Get your account data flowing
          </h2>
        </div>
        <p className="card-note">
          Every card below starts a Claude chat either way, but the tables, badges and the Daily standup need
          this account's data files. One pasted prompt sets it up.
        </p>
        <CopyPrompts board={board} />
      </section>
    );

  const fx = h.fetch;
  const fetchBad = Boolean(fx?.problem);
  const fetchLine = !fx
    ? ''
    : fetchBad
      ? fx.errors
        ? `Daily fetch ${fetchWords(fx.lastRun)} failed on ${fx.errors} of ${fx.total} datasets. The data is from the last clean run. `
        : `No fetch for ${dayCount(fx.ageHours)} (last${dateWords(fx.lastRun) || fx.lastRun.slice(0, 10)}). `
      : `Fetched ${fetchWords(fx.lastRun)}. `;

  if (r.tone === 'ok')
    return (
      <section className="cc-ready" data-tone="ok" aria-labelledby="cc-ready-h">
        <span className="cc-dot" data-s="ok" aria-hidden="true" />
        <h2 id="cc-ready-h" ref={head} tabIndex={-1}>
          Account data ready
        </h2>
        <p className="am-sub">
          {fetchLine}All {r.required} required files are ready
          {h.freshThrough ? `, fresh through ${dateWords(h.freshThrough) || h.freshThrough}` : ''}.
        </p>
      </section>
    );

  const title =
    fetchBad && r.ready === r.required
      ? 'Account data: daily fetch problem'
      : `Account data: ${r.ready} of ${r.required} required files ready`;
  const anyBad = r.groups.some((g) => g.files.some((f) => f.dot === 'bad' || f.dot === 'warn'));
  return (
    <section className="cc-ready" data-tone={r.tone} aria-labelledby="cc-ready-h">
      <div className="cc-ready-head">
        <span className="cc-dot" data-s={r.tone} aria-hidden="true" />
        <h2 id="cc-ready-h" ref={head} tabIndex={-1}>
          {title}
        </h2>
      </div>
      <p className="card-note">
        {fetchLine}
        Tasks and tables that read the files marked amber or red will have gaps until they are fixed. The rest
        still works.
      </p>
      <Fold key={board.key} title="Files" defaultOpen>
        <p className="am-sub am-inset">
          Reading from <code>{h.dir}</code>
        </p>
        <div className="cc-groups">
          {r.groups.map((g) => (
            <div key={g.group} className="cc-group">
              <h3 className="cc-group-h">
                <span className="cc-dot" data-s={g.tone} aria-hidden="true" />
                {g.label}
                <span className="am-sub cc-count">
                  {g.ready} of {g.required} ready
                </span>
              </h3>
              <ul>
                {g.files.map(({ file, dot }) => (
                  <li key={file.file}>
                    <span className="cc-dot" data-s={dot} aria-hidden="true" />
                    <span className="cc-file">
                      {file.file}
                      <span className="visually-hidden">, {DOT_WORDS[dot]}</span>
                    </span>
                    <span className="am-sub cc-note">{fileNote(file)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="am-sub am-inset cc-key" aria-hidden="true">
          Key: <span className="cc-dot" data-s="ok" /> ready · <span className="cc-dot" data-s="na" /> not
          needed · <span className="cc-dot" data-s="warn" /> stale or wrong shape ·{' '}
          <span className="cc-dot" data-s="bad" /> missing
        </p>
        {anyBad ? <CopyPrompts board={board} /> : null}
      </Fold>
    </section>
  );
}

/** The key: each type in the same fill its cards have, with the original notes. */
export function TypeKey() {
  return (
    <ul className="cc-key-list" aria-label="Task types">
      {KEY_NOTES.map(([kind, note]) => (
        <li key={kind}>
          <span className="cc-tkey" data-type={kind}>
            {KIND_WORDS[kind]}
          </span>{' '}
          {note}
        </li>
      ))}
    </ul>
  );
}

/** One task card: filled by its type, the type word on it, then title, description, badges, run info and Run. */
function TaskCard({
  board,
  card,
  starting,
  anyStarting,
  onRun,
}: {
  board: AdsBoard;
  card: AdsBoard['cards'][number];
  starting: boolean;
  anyStarting: boolean;
  onRun: () => void;
}) {
  return (
    <li className="am-task cc-task" data-type={card.kind}>
      <p className="cc-top">
        <span className="cc-type">{KIND_WORDS[card.kind]}</span>
        {card.badge ? (
          <span className="badge" data-tone="waiting">
            {card.badge}
          </span>
        ) : null}
      </p>
      <h4 className="am-camp">{card.title}</h4>
      <p className="am-sub">{card.description}</p>
      <RunInfo
        client={board.key}
        task={card.id}
        title={card.title}
        cadence={card.cadence}
        shared={card.lastRun}
      />
      <RunButton
        client={board.key}
        task={card.id}
        title={card.title}
        starting={starting}
        disabled={anyStarting}
        onRun={onRun}
      />
    </li>
  );
}

/** The Daily standup: leads Daily, filled in the standup colour, with Run and Rate calls. */
function StandupCard({
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
    const chat = await startChat(s.prompt, board.key, { open: true, in: 'drawer' });
    setStarting(false);
    if (!chat) return;
    taskRuns.record(board.key, STANDUP_TASK, chat);
    shareRun(board, STANDUP_TASK);
    onStarted(`Started a chat: Daily standup, ${name}.`);
  };

  return (
    <li className="am-task cc-task" data-type="standup">
      <p className="cc-top">
        <span className="cc-type">Standup</span>
        <span className="chip">Multi-agent</span>
      </p>
      <h4 className="am-camp">Daily standup</h4>
      <p className="am-sub">
        {s.hasStandup
          ? 'One recommended action per campaign, with the debate that produced it. Read-only.'
          : v
            ? 'This is the last standup on file, but the account has no standup set-up yet. Set it up to run it from here. Read-only.'
            : 'A bull and a bear argue your account, then an account director makes one call per campaign with the reasoning shown. Read-only.'}
      </p>
      {v ? (
        <p className="am-sub cc-verdict" data-stale={stale ? 'true' : undefined}>
          <strong>{call}</strong> as of {whenWords(v.date) || v.date}
          {stale ? ', stale: run it again' : ''}
          {v.flagged > 0 && v.topCampaign ? <span className="am-block">{v.topCampaign}</span> : null}
        </p>
      ) : null}
      {s.hasStandup && s.prompt ? (
        <RunInfo
          client={board.key}
          task={STANDUP_TASK}
          title="Daily standup"
          cadence="daily"
          shared={s.lastRun}
        />
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
        <span className="cc-actions">
          {!s.hasStandup ? (
            canAct ? (
              <button
                type="button"
                className="btn"
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
                  onClick={() => dispatch({ type: 'set-panel', open: true })}
                >
                  Rate calls
                </button>
              ) : null}
            </>
          )}
        </span>
      )}
      {error ? (
        <p className="am-hint" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * "What I run on <account>": five cadence columns of cards, the Daily standup first in Daily. Run starts a new
 * chat with the card's prompt, unchanged.
 */
export function Cadence({
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
  const [starting, setStarting] = useState<string | null>(null);
  const run = async (id: string, title: string, prompt: string) => {
    if (starting) return;
    setStarting(id);
    const chat = await startChat(prompt, board.key, { open: true, in: 'drawer' });
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
        const lead = key === 'daily';
        return (
          <section key={key} className="card" aria-labelledby={`am-cad-${key}`}>
            <div className="card-head">
              <h3 id={`am-cad-${key}`}>{label}</h3>
              <span className="count">{cards.length + (lead ? 1 : 0)}</span>
            </div>
            <ul className="am-tasks">
              {lead ? <StandupCard board={board} name={name} canAct={canAct} onStarted={onStarted} /> : null}
              {cards.map((c) => (
                <TaskCard
                  key={c.id}
                  board={board}
                  card={c}
                  starting={starting === c.id}
                  anyStarting={starting !== null}
                  onRun={() => void run(c.id, c.title, c.prompt)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
