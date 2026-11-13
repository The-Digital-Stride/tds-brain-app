import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type AppPrefs,
  type AppStore,
  DEFAULT_PREFS,
  TODO_NEW_DAYS,
  TODO_SEEN_MAX,
} from '../../shared/contract.ts';

const MAX_PINS = 100;
const MAX_TEXT = 200;

function cleanPins(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && x !== '' && x.length <= MAX_TEXT) seen.add(x);
    if (seen.size >= MAX_PINS) break;
  }
  return [...seen];
}

const SEEN_KEY_MAX = 300;
const SEEN_VALUE_MAX = 40;
const DAY_MS = 86_400_000;

/** Valid "New to you" markers only, at most TODO_SEEN_MAX. */
function cleanSeen(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, m] of Object.entries(v)) {
    if (Object.keys(out).length >= TODO_SEEN_MAX) break;
    if (
      k !== '' &&
      k.length <= SEEN_KEY_MAX &&
      typeof m === 'string' &&
      m !== '' &&
      m.length <= SEEN_VALUE_MAX
    )
      out[k] = m;
  }
  return out;
}

/** Drops markers that are unparseable or older than TODO_NEW_DAYS: they can no longer hide anything. */
function pruneSeen(seen: Record<string, string>, now: Date): Record<string, string> {
  const cutoff = now.getTime() - TODO_NEW_DAYS * DAY_MS;
  const out: Record<string, string> = {};
  for (const [k, m] of Object.entries(seen)) {
    const t = Date.parse(m);
    if (!Number.isNaN(t) && t >= cutoff) out[k] = m;
  }
  return out;
}

/** Keeps only known keys with valid values; anything else falls back to `base`. */
function sanitise(input: unknown, base: AppPrefs): AppPrefs {
  const o =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const lastClient = o.lastClient;
  return {
    pins: cleanPins(o.pins) ?? [...base.pins],
    lastClient:
      lastClient === null ||
      (typeof lastClient === 'string' && lastClient !== '' && lastClient.length <= MAX_TEXT)
        ? (lastClient as string | null)
        : base.lastClient,
    todoPanelOpen: typeof o.todoPanelOpen === 'boolean' ? o.todoPanelOpen : base.todoPanelOpen,
    directWrites: typeof o.directWrites === 'boolean' ? o.directWrites : base.directWrites,
    todoSeen: cleanSeen(o.todoSeen) ?? { ...base.todoSeen },
  };
}

export function createAppStore(dataDir: string, now: () => Date = () => new Date()): AppStore {
  const file = join(dataDir, 'prefs.json');
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<AppPrefs> {
    try {
      return sanitise(JSON.parse(await fs.readFile(file, 'utf8')), DEFAULT_PREFS);
    } catch {
      return sanitise({}, DEFAULT_PREFS);
    }
  }

  async function write(prefs: AppPrefs): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  }

  return {
    get: () => serial(read),
    update: (patch) =>
      serial(async () => {
        const current = await read();
        const merged = sanitise({ ...current, ...(patch as object) }, current);
        const next = { ...merged, todoSeen: pruneSeen(merged.todoSeen, now()) };
        await write(next);
        return next;
      }),
  };
}
