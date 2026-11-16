/**
 * Runs the brain's `tdsapp-ads` bridge for Ad Manager (plan 2026-11-16-workbench-ad-manager, decisions 7, 11 and
 * 12). The app never changes an ads file itself: it sends one JSON object and reads the bridge's one-line reply.
 *
 * - Reads run unqueued; identical reads in flight (same action and input) share one run. A read past its limit is
 *   stopped.
 * - Changes run one at a time (`createQueue`). `apply`, `dry-run` and `sign-monthly` are started detached and are
 *   NEVER stopped: their limit only ends the wait (`unknown-outcome` for apply, `internal` for the others) and the
 *   queue stays held until the process exits, so nothing else changes ads files under a live write.
 * - Every apply is recorded in ADS_INFLIGHT_FILE in the app's own data folder before the bridge starts, and the
 *   entry is removed only when the bridge answers with a known outcome. While listed, apply is refused here and
 *   `canApply` is false. After a restart the file is read again; an entry clears itself once its process has gone
 *   and the proposal shows `applied_at`; otherwise the person clears it ("I've checked the account").
 * - Nothing here retries anything.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  ADS_CAPABILITY,
  ADS_CLIENT_SLUG,
  ADS_INFLIGHT_FILE,
  ADS_MAX_OUTPUT_BYTES,
  ADS_PROPOSAL_ID,
  ADS_SKILL,
  ADS_TIMEOUT_MS,
  type AdsAction,
  type AdsCapabilities,
  type AdsChangeAction,
  type AdsErrorCode,
  type AdsReadAction,
} from '../../shared/ads-contract.ts';
import { parseFrontmatter } from './frontmatter.ts';
import {
  createCapabilityProbe,
  createQueue,
  locateScript,
  type Outcome,
  parseReply,
  runScript,
  runScriptDetached,
  type ScriptOptions,
  withDefaults,
} from './skill-runner.ts';

/** Longer than any real apply takes (they run in seconds to a few minutes). */
const APPLY_MAX_AGE_MS = 60 * 60 * 1000;

export class AdsError extends Error {
  readonly code: AdsErrorCode;
  /** What the run printed (already trimmed and with secrets hidden by the bridge). Sent only for unknown-outcome. */
  readonly output?: string;
  constructor(code: AdsErrorCode, message?: string, output?: string) {
    super(message ?? code);
    this.name = 'AdsError';
    this.code = code;
    if (output !== undefined) this.output = output;
  }
}

export interface AdsInflightEntry {
  client: string;
  id: string;
  /** The bridge's pid; null when it never started. */
  pid: number | null;
  startedAt: string;
}

export interface AdsServiceOptions extends ScriptOptions {
  /** The app's own data folder, for ADS_INFLIGHT_FILE. Missing: kept in memory only. Never the brain. */
  dataDir?: string | null;
  /** Per-action limits instead of ADS_TIMEOUT_MS (tests). */
  timeouts?: Partial<Record<AdsAction, number>>;
  /** Whether a process is still running. Default: `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  now?: () => Date;
}

export type AdsBridgeRead = Exclude<AdsReadAction, 'capabilities' | 'file'>;

export interface AdsService {
  /** The bridge's capabilities, or null when the skill is missing, unusable or too old to know `ads-v1`. */
  capabilities(): Promise<AdsCapabilities | null>;
  /** One read. Resolves to the bridge's reply without `ok` and `action`; rejects with AdsError. */
  read(action: AdsBridgeRead, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** One change, queued. Same reply and errors as `read`. */
  change(action: AdsChangeAction, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Applies whose outcome isn't known yet (cleaned of entries that have cleared themselves). */
  inflight(): Promise<AdsInflightEntry[]>;
  /** The person checked the account: forget this proposal's entry. */
  clearInflight(client: string, id: string): Promise<void>;
  /** Called when ads state the app holds changes (the in-flight list) or the watcher sees ads files change. */
  onChange(listener: () => void): () => void;
  /** Tell the listeners (the brain watcher calls this for ads paths). */
  changed(): void;
}

/** Spawned detached and never stopped (decision 12). */
const DETACHED: ReadonlySet<AdsChangeAction> = new Set(['apply', 'dry-run', 'sign-monthly']);
/** Changes that run at once, outside the queue: `task-run` is a one-line append whose time must not wait behind an apply. */
const UNQUEUED: ReadonlySet<AdsChangeAction> = new Set(['task-run']);

const CODES: ReadonlySet<string> = new Set<AdsErrorCode>([
  'bad-request',
  'not-found',
  'not-allowed',
  'changed',
  'no-access',
  'unknown-outcome',
  'unavailable',
  'internal',
]);

/** The reply of a run that worked, or the error it means. Anything unexpected is `internal`. */
function judge(outcome: Outcome): Record<string, unknown> {
  if (outcome.failed) throw new AdsError('internal', 'the bridge failed or ran too long');
  const reply = parseReply(outcome.stdout);
  if (reply === null) throw new AdsError('internal', 'the bridge gave no reply');
  if (outcome.code === 0 && reply.ok === true) {
    const { ok: _ok, action: _action, ...rest } = reply;
    return rest;
  }
  if (outcome.code === 2 && reply.ok === false && typeof reply.code === 'string' && CODES.has(reply.code)) {
    throw new AdsError(
      reply.code as AdsErrorCode,
      typeof reply.error === 'string' ? reply.error : undefined,
      typeof reply.output === 'string' ? reply.output : undefined,
    );
  }
  throw new AdsError('internal', 'the bridge failed');
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isEntry(v: unknown): v is AdsInflightEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.client === 'string' &&
    ADS_CLIENT_SLUG.test(e.client) &&
    typeof e.id === 'string' &&
    ADS_PROPOSAL_ID.test(e.id) &&
    (e.pid === null || (Number.isInteger(e.pid) && (e.pid as number) > 0)) &&
    typeof e.startedAt === 'string'
  );
}

export function createAdsService(root: string, options: AdsServiceOptions = {}): AdsService {
  const opts = withDefaults(options, ADS_TIMEOUT_MS.capabilities, ADS_MAX_OUTPUT_BYTES);
  const limit = (action: AdsAction) => options.timeouts?.[action] ?? ADS_TIMEOUT_MS[action];
  const isAlive = options.isAlive ?? defaultIsAlive;
  const now = options.now ?? (() => new Date());
  const dataDir = options.dataDir ?? null;
  const queue = createQueue();
  const listeners = new Set<() => void>();
  const reads = new Map<string, Promise<Record<string, unknown>>>();

  const changed = () => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // a listener must not stop the others
      }
    }
  };

  async function findScript(): Promise<string | null> {
    return (await locateScript(root, ADS_SKILL.skill, ADS_SKILL.script)).script;
  }
  async function ready(): Promise<{ script: string; realRoot: string }> {
    const script = await findScript();
    if (!script) throw new AdsError('unavailable', 'the tdsapp-ads skill is missing');
    try {
      return { script, realRoot: await fs.realpath(root) };
    } catch {
      throw new AdsError('unavailable', 'the brain folder is missing');
    }
  }

  // ── the in-flight file ──────────────────────────────────────────────────────────────────────
  let memory: AdsInflightEntry[] = [];
  let fileLock: Promise<unknown> = Promise.resolve();
  const inflightFile = dataDir ? join(dataDir, ADS_INFLIGHT_FILE) : null;

  async function readEntries(): Promise<AdsInflightEntry[]> {
    if (!inflightFile) return [...memory];
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(inflightFile, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }
  async function writeEntries(entries: AdsInflightEntry[]): Promise<void> {
    if (!inflightFile || !dataDir) {
      memory = [...entries];
      return;
    }
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${inflightFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, inflightFile);
  }
  /** Read, change and write the list under one lock. Tells listeners when it changed. */
  function editEntries(
    edit: (entries: AdsInflightEntry[]) => AdsInflightEntry[] | Promise<AdsInflightEntry[]>,
  ) {
    const next = fileLock.then(async () => {
      const before = await readEntries();
      const after = await edit(before);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        await writeEntries(after);
        changed();
      }
      return after;
    });
    fileLock = next.catch(() => {});
    return next;
  }
  const same = (e: AdsInflightEntry, client: string, id: string) => e.client === client && e.id === id;
  /** Running, as far as "I've checked" is concerned: the pid is alive and the apply is young enough to still be it.
   *  After a restart the saved pid can belong to another process; past this age the person can clear it. */
  const stillRunning = (e: AdsInflightEntry) =>
    e.pid !== null && isAlive(e.pid) && Date.now() - Date.parse(e.startedAt) < APPLY_MAX_AGE_MS;

  async function appliedNow(client: string, id: string): Promise<boolean> {
    try {
      const text = await fs.readFile(join(root, 'clients', client, 'proposals', `${id}.md`), 'utf8');
      const v = parseFrontmatter(text).data.applied_at;
      return typeof v === 'string' && v !== '' && v !== 'null' && v !== '~';
    } catch {
      return false;
    }
  }
  /** Entries still in doubt: a process still running, or one that ended without the proposal showing applied. */
  const inflight = () =>
    editEntries(async (entries) => {
      const keep: AdsInflightEntry[] = [];
      for (const e of entries) {
        const running = e.pid !== null && isAlive(e.pid);
        if (!running && (await appliedNow(e.client, e.id))) continue;
        keep.push(e);
      }
      return keep;
    });

  // ── runs ────────────────────────────────────────────────────────────────────────────────────
  async function runRead(
    action: AdsAction,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { script, realRoot } = await ready();
    return judge(
      await runScript(script, realRoot, action, JSON.stringify(input), { ...opts, timeoutMs: limit(action) }),
    );
  }

  function read(action: AdsBridgeRead, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const key = `${action}\0${JSON.stringify(input)}`;
    const running = reads.get(key);
    if (running) return running;
    const p = runRead(action, input).finally(() => reads.delete(key));
    reads.set(key, p);
    return p;
  }

  function change(action: AdsChangeAction, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (UNQUEUED.has(action)) return runRead(action, input);
    return new Promise((resolve, reject) => {
      void queue(async () => {
        try {
          if (!DETACHED.has(action)) {
            resolve(await runRead(action, input));
            return;
          }
          const { script, realRoot } = await ready();
          const client = String(input.client ?? '');
          const id = String(input.id ?? '');
          const isApply = action === 'apply';
          if (isApply) {
            // Refused while its outcome is unknown: nothing ever applies the same proposal twice from here.
            if ((await inflight()).some((e) => same(e, client, id))) {
              throw new AdsError('unknown-outcome', 'an apply of this proposal has no known outcome yet');
            }
            await editEntries((entries) => [
              ...entries.filter((e) => !same(e, client, id)),
              { client, id, pid: null, startedAt: now().toISOString() },
            ]);
          }
          const run = runScriptDetached(script, realRoot, action, JSON.stringify(input), opts);
          if (isApply) {
            await editEntries((entries) =>
              entries.map((e) => (same(e, client, id) ? { ...e, pid: run.pid } : e)),
            );
          }
          let timer: NodeJS.Timeout | undefined;
          const waited = await Promise.race([
            run.exited,
            new Promise<'timeout'>((r) => {
              timer = setTimeout(() => r('timeout'), limit(action));
            }),
          ]);
          clearTimeout(timer);
          if (waited === 'timeout') {
            // The script goes on. The person is told the outcome isn't known; the queue waits for it to end.
            reject(new AdsError(isApply ? 'unknown-outcome' : 'internal', `${action} is still running`));
            await run.exited;
            return;
          }
          let reply: Record<string, unknown>;
          try {
            reply = judge(waited);
          } catch (err) {
            // A refusal means apply.cjs never wrote; anything else (a crash, no reply, unknown-outcome) stays listed.
            const known =
              err instanceof AdsError && err.code !== 'internal' && err.code !== 'unknown-outcome';
            if (isApply && known) await editEntries((entries) => entries.filter((e) => !same(e, client, id)));
            if (isApply && !known)
              throw new AdsError(
                'unknown-outcome',
                'the apply ended without a clear outcome',
                err instanceof AdsError ? err.output : undefined,
              );
            throw err;
          }
          if (isApply) await editEntries((entries) => entries.filter((e) => !same(e, client, id)));
          resolve(reply);
        } catch (err) {
          reject(err instanceof AdsError ? err : new AdsError('internal', String(err)));
        }
      });
    });
  }

  // An older script that doesn't know `capabilities` refuses it: a settled "no features", cached too.
  const probe = createCapabilityProbe(
    root,
    findScript,
    { ...opts, timeoutMs: limit('capabilities') },
    (r) => r.ok === false && r.code === 'bad-request',
  );

  async function capabilities(): Promise<AdsCapabilities | null> {
    let features: readonly string[];
    try {
      features = await probe();
    } catch {
      return null;
    }
    if (!features.includes(ADS_CAPABILITY)) return null;
    let reply: Record<string, unknown>;
    try {
      reply = await read('capabilities' as AdsBridgeRead, {});
    } catch {
      return null;
    }
    const me = reply.me as Record<string, unknown> | null | undefined;
    return {
      features: [...features],
      version: typeof reply.version === 'string' ? reply.version : '',
      adsAccess: reply.adsAccess === true,
      adsManager: reply.adsManager === true,
      me:
        me && typeof me.slug === 'string' && me.slug !== ''
          ? { slug: me.slug, name: String(me.name ?? me.slug), role: String(me.role ?? '') }
          : null,
    };
  }

  return {
    capabilities,
    read,
    change,
    inflight,
    clearInflight: async (client, id) => {
      // Never while that apply is still running: clearing then would let a second press queue behind it and
      // write again once it ends without stamping applied_at (security review, finding 1).
      let running = false;
      await editEntries((entries) => {
        running = entries.some((e) => same(e, client, id) && stillRunning(e));
        return running ? entries : entries.filter((e) => !same(e, client, id));
      });
      if (running) throw new AdsError('unknown-outcome', 'that apply is still running');
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changed,
  };
}
