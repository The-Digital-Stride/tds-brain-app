import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type AppPrefs,
  type AppStore,
  DEFAULT_PREFS,
  EFFORT_LEVELS,
  type EffortLevel,
  FAVOURITE_CHATS_MAX,
  FAVOURITE_TODOS_MAX,
  MODEL_PREF_MAX,
  MODEL_PREF_PATTERN,
  SESSION_UUID_PATTERN,
  TODO_KEY_MAX,
  TODO_NEW_DAYS,
  TODO_SEEN_MAX,
} from '../../shared/contract.ts';
import type { LevelMode } from '../../shared/levels-contract.ts';

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

/** Valid session ids once each, in the order given; over the cap, the newest-starred (the last) are kept. */
function cleanFavouriteChats(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && SESSION_UUID_PATTERN.test(x)) seen.add(x);
  }
  return [...seen].slice(-FAVOURITE_CHATS_MAX);
}

/** To-do keys once each, in the order given; over the cap, the newest-starred (the last) are kept. */
function cleanFavouriteTodos(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && x !== '' && x.length <= TODO_KEY_MAX) seen.add(x);
  }
  return [...seen].slice(-FAVOURITE_TODOS_MAX);
}

const SEEN_KEY_MAX = TODO_KEY_MAX;
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

function isLevelMode(v: unknown): v is LevelMode {
  return v === 'auto' || v === 'manual';
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
    model:
      o.model === null ||
      (typeof o.model === 'string' && o.model.length <= MODEL_PREF_MAX && MODEL_PREF_PATTERN.test(o.model))
        ? (o.model as string | null)
        : base.model,
    effort:
      o.effort === null || (EFFORT_LEVELS as readonly unknown[]).includes(o.effort)
        ? (o.effort as EffortLevel | null)
        : base.effort,
    // A missing or invalid value keeps `base`: the current choice on a patch. `read` replaces it
    // with the old-file rule when the file itself had none.
    levelMode: isLevelMode(o.levelMode) ? o.levelMode : base.levelMode,
    favouriteChats: cleanFavouriteChats(o.favouriteChats) ?? [...(base.favouriteChats ?? [])],
    favouriteTodos: cleanFavouriteTodos(o.favouriteTodos) ?? [...(base.favouriteTodos ?? [])],
  };
}

export function createAppStore(dataDir: string, now: () => Date = () => new Date()): AppStore {
  const file = join(dataDir, 'prefs.json');
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<AppPrefs> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      const prefs = sanitise(raw, DEFAULT_PREFS);
      // A file from before levels: whoever picked a model or effort keeps that choice (plan decision 2).
      const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).levelMode : undefined;
      if (!isLevelMode(given))
        prefs.levelMode = prefs.model !== null || prefs.effort !== null ? 'manual' : 'auto';
      return prefs;
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
