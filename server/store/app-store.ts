import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ADS_ACCOUNT_KEY } from '../../shared/ads-contract.ts';
import {
  ADS_FOLDS_MAX,
  ADS_PREF_KEY_MAX,
  type AppPrefs,
  type AppStore,
  DEFAULT_PREFS,
  EFFORT_LEVELS,
  type EffortLevel,
  FAVOURITE_CHATS_MAX,
  FAVOURITE_FILES_MAX,
  FAVOURITE_TODOS_MAX,
  FILE_ID_MAX,
  HOME_HIDDEN_MAX,
  HOME_ITEM_ID_PATTERN,
  HOME_SHORTCUTS_MAX,
  type HomeShortcut,
  homeShortcutKey,
  MODEL_PREF_MAX,
  MODEL_PREF_PATTERN,
  parseHomeShortcut,
  SECTION_ID_PATTERN,
  SECTIONS_MAX,
  SESSION_UUID_PATTERN,
  SKILL_NAME_PATTERN,
  TODO_KEY_MAX,
  TODO_NEW_DAYS,
  TODO_SEEN_MAX,
  VERSION_PATTERN,
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

/** File ids once each, in the order given; over the cap, the newest-starred (the last) are kept. */
function cleanFavouriteFiles(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && x !== '' && x.length <= FILE_ID_MAX) seen.add(x);
  }
  return [...seen].slice(-FAVOURITE_FILES_MAX);
}

/** Hidden Home item ids once each, first wins, kept by pattern only so an id from a newer app survives. */
function cleanHomeHidden(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && HOME_ITEM_ID_PATTERN.test(x)) seen.add(x);
  }
  return [...seen].slice(0, HOME_HIDDEN_MAX);
}

/** One shortcut, rebuilt from known fields only; undefined for an unknown kind or a field outside its pattern. */
/** Home shortcuts once each by key, first wins, in order, at most HOME_SHORTCUTS_MAX. */
function cleanHomeShortcuts(v: unknown): HomeShortcut[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const byKey = new Map<string, HomeShortcut>();
  for (const x of v) {
    const s = parseHomeShortcut(x);
    if (s && !byKey.has(homeShortcutKey(s))) byKey.set(homeShortcutKey(s), s);
  }
  return [...byKey.values()].slice(0, HOME_SHORTCUTS_MAX);
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The last tool open in each Workbench section: valid section and tool ids only, at most SECTIONS_MAX. */
export function cleanLastTool(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) {
    if (Object.keys(out).length >= SECTIONS_MAX) break;
    if (SECTION_ID_PATTERN.test(k) && typeof t === 'string' && SECTION_ID_PATTERN.test(t)) out[k] = t;
  }
  return out;
}

/** Ad Manager's last account: null, or an account key of at most ADS_PREF_KEY_MAX characters. */
export function isAdsAccountPref(v: unknown): v is string | null {
  return v === null || (typeof v === 'string' && v.length <= ADS_PREF_KEY_MAX && ADS_ACCOUNT_KEY.test(v));
}

/** Ad Manager's folds the person changed: short keys to booleans, at most ADS_FOLDS_MAX. */
export function cleanAdsFolds(v: unknown): Record<string, boolean> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, open] of Object.entries(v)) {
    if (Object.keys(out).length >= ADS_FOLDS_MAX) break;
    if (k !== '' && k.length <= ADS_PREF_KEY_MAX && typeof open === 'boolean') out[k] = open;
  }
  return out;
}

/** Limits on `foldedGroups`: section ids, group names per section, and the length of a group name. */
export const FOLDED_SECTIONS_MAX = 20;
export const FOLDED_GROUPS_MAX = 20;
export const FOLDED_GROUP_NAME_MAX = 60;

/** True for a list of at most FOLDED_GROUPS_MAX non-empty group names, each at most FOLDED_GROUP_NAME_MAX long. */
export function isGroupNameList(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= FOLDED_GROUPS_MAX &&
    v.every((n) => typeof n === 'string' && n !== '' && n.length <= FOLDED_GROUP_NAME_MAX)
  );
}

/** Folded drawer groups per section: valid section ids and group-name lists only, within the limits. */
export function cleanFoldedGroups(v: unknown): Record<string, string[]> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, names] of Object.entries(v)) {
    if (Object.keys(out).length >= FOLDED_SECTIONS_MAX) break;
    if (SECTION_ID_PATTERN.test(k) && isGroupNameList(names)) out[k] = [...names];
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
  // Workbench and Ad Manager (plan 2026-11-16-workbench-ad-manager, decision 21). Optional: a file without them
  // (older app) reads as it always did, and they're only written once set.
  const lastTool = cleanLastTool(o.lastTool) ?? base.lastTool;
  const adsAccount = isAdsAccountPref(o.adsAccount) ? o.adsAccount : base.adsAccount;
  const adsFolds = cleanAdsFolds(o.adsFolds) ?? base.adsFolds;
  const foldedGroups = cleanFoldedGroups(o.foldedGroups) ?? base.foldedGroups;
  return {
    ...(lastTool === undefined ? {} : { lastTool: { ...lastTool } }),
    ...(adsAccount === undefined ? {} : { adsAccount }),
    ...(adsFolds === undefined ? {} : { adsFolds: { ...adsFolds } }),
    ...(foldedGroups === undefined
      ? {}
      : { foldedGroups: Object.fromEntries(Object.entries(foldedGroups).map(([k, v]) => [k, [...v]])) }),
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
    favouriteFiles: cleanFavouriteFiles(o.favouriteFiles) ?? [...(base.favouriteFiles ?? [])],
    homeHidden: cleanHomeHidden(o.homeHidden) ?? [...(base.homeHidden ?? [])],
    homeShortcuts: cleanHomeShortcuts(o.homeShortcuts) ?? (base.homeShortcuts ?? []).map((s) => ({ ...s })),
    tourSeen:
      o.tourSeen === null ||
      (Number.isInteger(o.tourSeen) && (o.tourSeen as number) >= 1 && (o.tourSeen as number) <= 1000)
        ? (o.tourSeen as number | null)
        : (base.tourSeen ?? null),
    whatsNewSeen:
      o.whatsNewSeen === null || (typeof o.whatsNewSeen === 'string' && VERSION_PATTERN.test(o.whatsNewSeen))
        ? (o.whatsNewSeen as string | null)
        : (base.whatsNewSeen ?? null),
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
