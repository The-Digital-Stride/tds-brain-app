/**
 * Start-up kits in shadow mode (plan 2026-11-15-startup-kits). Nothing here changes the engine's
 * options: it only works out which kit a chat would have needed, reads what its start-up loaded, notes
 * what the chat used, and keeps score. The pure functions come first; `createKitTracker` at the end is
 * the one facade the session manager calls. No clock, disk or engine is reached for except through the
 * injected dependencies, so tests need none.
 *
 * Never stored or logged: anything typed, `LevelPick.reason`, any chat content. Only identifiers
 * (skill names, server names), counts and ids from the fixed kit list.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ChatKind } from '../../shared/contract.ts';
import {
  BUILT_IN_KITS,
  type FitsFn,
  KEEP_ALL,
  type KeepRules,
  KIT_FALLBACK,
  KIT_IDS,
  KITS_FILE,
  type Kit,
  type KitId,
  type KitPick,
  type KitShadowRecord,
  type KitTracker,
  type NormNameFn,
  type SavingsEntry,
  STARTUP_GROUPS,
  type StartupGroup,
  type StartupReading,
  type StartupReadingFn,
  USE_MAX,
  type WouldSave,
  type WouldSaveFn,
} from '../../shared/kits-contract.ts';
import type { LevelTier } from '../../shared/levels-contract.ts';
import type { AppUsageResult } from '../brain/app-usage.ts';
import type { KitShadowStore } from '../store/kit-shadow.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

// ---------------------------------------------------------------------------
// Names (decision 8)
// ---------------------------------------------------------------------------

/**
 * Lower case, letters and digits only. So `claude.ai Google Calendar`, `claude_ai_Google_Calendar`
 * (a tool-name segment) and the pattern `googlecalendar` all meet: a pattern keeps a server when it is
 * a substring of the server's normalised name.
 */
export const normName: NormNameFn = (raw) =>
  String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * The key a connector goes by everywhere (rows, `ChatUse.connectors`): `normName(server)` for a user,
 * project or claude.ai server, and `plugin:<plugin>:<server>` (both normalised) for a plugin's own server.
 */
export function connectorKey(server: string, plugin?: string): string {
  return plugin ? `plugin:${normName(plugin)}:${normName(server)}` : normName(server);
}

/** Makes any connector name a key. Already-keyed names pass through unchanged. */
function asKey(name: string): string {
  const m = /^plugin:([^:]+):(.+)$/i.exec(name);
  return m ? connectorKey(m[2] as string, m[1] as string) : normName(name);
}

/**
 * `mcp__claude_ai_Gmail__send` → server `claude_ai_Gmail`; `mcp__plugin_<plugin>_<server>__x` →
 * plugin + server (plugin names may hold dashes but no underscore, so the first `_` splits them);
 * `mcp__8020mcp__x` → `8020mcp`. Null when the name isn't an MCP tool name.
 */
export function parseToolName(name: string): { server: string; plugin?: string } | null {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const rest = name.slice(5);
  const end = rest.indexOf('__');
  if (end <= 0) return null;
  const seg = rest.slice(0, end);
  if (seg.startsWith('plugin_')) {
    const after = seg.slice(7);
    const u = after.indexOf('_');
    if (u > 0 && u < after.length - 1) return { server: after.slice(u + 1), plugin: after.slice(0, u) };
  }
  return { server: seg };
}

/** The key of the server behind an MCP tool name, or null. */
export function toolConnectorKey(name: string): string | null {
  const p = parseToolName(name);
  return p ? connectorKey(p.server, p.plugin) : null;
}

/** The plugin of a `plugin:skill` name; null for a skill that isn't a plugin's. */
export function pluginOfSkill(name: string): string | null {
  const i = name.indexOf(':');
  return i > 0 && i < name.length - 1 ? name.slice(0, i) : null;
}

/** A skill name as a `Skill` tool input or a typed `/name` gives it; null when it isn't a plain name. */
function cleanSkill(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/^\/+/, '').split(/\s/)[0] ?? '';
  return /^[A-Za-z0-9][\w.:-]{0,99}$/.test(name) ? name : null;
}

// ---------------------------------------------------------------------------
// Kits: built-ins merged with the brain's file (decision 5)
// ---------------------------------------------------------------------------

const KIT_FILE_MAX_BYTES = 200_000;
const KIT_LIST_MAX = 120;
const KIT_ITEM_MAX = 60;

function itemList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    // `*` is `full`'s alone: a file can't turn another kit into everything.
    if (typeof x === 'string' && x.trim() !== '' && x.length <= KIT_ITEM_MAX && x.trim() !== KEEP_ALL) {
      out.push(x.trim());
    }
    if (out.length >= KIT_LIST_MAX) break;
  }
  return out;
}

/** The kits for a parsed `.claude/tdsapp-kits.json`: contents only; ids, labels, blurbs and `full` are fixed. */
export function resolveKits(file: unknown): Readonly<Record<KitId, Kit>> {
  const kits = isRec(file) && file.version === 1 && isRec(file.kits) ? file.kits : null;
  const out = {} as Record<KitId, Kit>;
  for (const id of KIT_IDS) {
    const base = BUILT_IN_KITS[id];
    const row = id !== 'full' && kits && Object.hasOwn(kits, id) ? kits[id] : null;
    if (!isRec(row)) {
      out[id] = base;
      continue;
    }
    out[id] = {
      ...base,
      connectors: itemList(row.connectors) ?? base.connectors,
      plugins: itemList(row.plugins) ?? base.plugins,
    };
  }
  return out;
}

async function readSmallJson(path: string): Promise<unknown> {
  try {
    const st = await fs.lstat(path);
    if (!st.isFile() || st.size > KIT_FILE_MAX_BYTES) return null;
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Reads the brain's kits file fresh; a missing or bad file is the built-in kits, silently. Never throws. */
export async function loadKits(brainRoot: string): Promise<Readonly<Record<KitId, Kit>>> {
  return resolveKits(await readSmallJson(join(brainRoot, KITS_FILE)));
}

/** The server names in the brain's `.mcp.json` (`mcpServers` keys). Read only; [] when missing or bad. Never throws. */
export async function projectServers(brainRoot: string): Promise<string[]> {
  const json = await readSmallJson(join(brainRoot, '.mcp.json'));
  const servers = isRec(json) && isRec(json.mcpServers) ? json.mcpServers : null;
  return servers ? Object.keys(servers).slice(0, 500) : [];
}

// ---------------------------------------------------------------------------
// What a kit keeps
// ---------------------------------------------------------------------------

/** `@builtin` plugins are named `cc-plugin-*`: always kept. */
const isBuiltinPlugin = (plugin: string): boolean => plugin.toLowerCase().startsWith('cc-plugin-');

export function keepsPlugin(kit: Kit, plugin: string): boolean {
  if (kit.plugins.includes(KEEP_ALL) || isBuiltinPlugin(plugin)) return true;
  const n = normName(plugin);
  return n !== '' && kit.plugins.some((p) => normName(p) === n);
}

/** `key` is a connector key. A plugin's server follows its plugin; a project server is always kept. */
export function keepsConnector(kit: Kit, key: string, keep: KeepRules): boolean {
  const plugin = /^plugin:([^:]+):/.exec(key)?.[1];
  if (plugin) return keepsPlugin(kit, plugin);
  if (keep.projectServers.some((s) => normName(s) === key)) return true;
  if (kit.connectors.includes(KEEP_ALL)) return true;
  return kit.connectors.some((p) => {
    const n = normName(p);
    return n !== '' && key.includes(n);
  });
}

const keepsSkill = (kit: Kit, skill: string): boolean => {
  const plugin = pluginOfSkill(skill);
  return plugin === null || keepsPlugin(kit, plugin);
};

/**
 * Rules first (decision 6): a typed `/name` of a plugin skill picks the first kit (KIT_IDS order)
 * whose plugins keep that plugin, else `full`. A non-plugin skill (the brain's or the person's own)
 * fits every kit, so it decides nothing: null, and the picker chooses.
 */
export function rulePick(skill: string, kits: Readonly<Record<KitId, Kit>> = BUILT_IN_KITS): KitPick | null {
  const plugin = pluginOfSkill(skill);
  if (plugin === null) return null;
  const kit = KIT_IDS.find((id) => keepsPlugin(kits[id], plugin)) ?? KIT_FALLBACK;
  return { kit, how: 'rule' };
}

/** Every kit (KIT_IDS order) that keeps everything in `use`; `full` always. */
export const fits: FitsFn = (use, kits, keep) =>
  KIT_IDS.filter(
    (id) =>
      id === 'full' ||
      (use.skills.every((s) => keepsSkill(kits[id], s)) &&
        use.connectors.every((c) => keepsConnector(kits[id], asKey(c), keep))),
  );

// ---------------------------------------------------------------------------
// The start-up reading (decision 7)
// ---------------------------------------------------------------------------

function attachment(res: Rec, name: string): number {
  const rows = isRec(res.messageBreakdown) ? res.messageBreakdown.attachmentsByType : null;
  if (!Array.isArray(rows)) return 0;
  return rows.reduce<number>((n, r) => (isRec(r) && r.name === name ? n + count(r.tokens) : n), 0);
}

function category(res: Rec, ...ids: string[]): number {
  if (!Array.isArray(res.categories)) return 0;
  return res.categories.reduce<number>(
    (n, c) => (isRec(c) && typeof c.id === 'string' && ids.includes(c.id) ? n + count(c.tokens) : n),
    0,
  );
}

/**
 * Builds the reading from the raw `getContextUsage({ detail: 'full' })` reply. Deferred and loaded
 * tool schemas are never counted: a connector costs the start-up its instructions and its share of
 * the deferred tool-name list, nothing more. Null when the reply has no total.
 */
export const startupReading: StartupReadingFn = (res) => {
  if (!isRec(res)) return null;
  const total = count(res.totalTokens);
  if (total === 0) return null;

  const toolNameList = attachment(res, 'deferred_tools_delta');
  const hooks = attachment(res, 'hook_success') + attachment(res, 'hook_additional_context');
  const byGroup = Object.fromEntries(STARTUP_GROUPS.map((g) => [g, 0])) as Record<StartupGroup, number>;
  byGroup.system = category(res, 'system_prompt', 'system_tools');
  byGroup.skills = category(res, 'skills');
  byGroup.connectors = category(res, 'mcp_instructions') + toolNameList;
  byGroup.agents = category(res, 'custom_agents');
  byGroup.memory = category(res, 'memory_files');
  byGroup.hooks = hooks;
  byGroup.other = Math.max(
    0,
    total - STARTUP_GROUPS.reduce((n, g) => (g === 'other' ? n : n + byGroup[g]), 0),
  );

  const conn = new Map<string, { name: string; instructions: number; toolNameChars: number }>();
  const row = (key: string) => {
    let r = conn.get(key);
    if (!r) {
      r = { name: key, instructions: 0, toolNameChars: 0 };
      conn.set(key, r);
    }
    return r;
  };
  if (Array.isArray(res.mcpInstructions)) {
    for (const i of res.mcpInstructions) {
      if (isRec(i) && typeof i.serverName === 'string')
        row(asKey(i.serverName)).instructions += count(i.tokens);
    }
  }
  if (Array.isArray(res.mcpTools)) {
    for (const t of res.mcpTools) {
      // A loaded tool's name isn't in the deferred list, so only deferred names count.
      if (!isRec(t) || typeof t.name !== 'string' || t.isLoaded === true) continue;
      const key = toolConnectorKey(t.name) ?? (typeof t.serverName === 'string' ? asKey(t.serverName) : null);
      if (key) row(key).toolNameChars += t.name.length;
    }
  }

  const plug = new Map<string, { name: string; skills: number; agents: number }>();
  const prow = (name: string) => {
    let r = plug.get(name);
    if (!r) {
      r = { name, skills: 0, agents: 0 };
      plug.set(name, r);
    }
    return r;
  };
  const skills =
    isRec(res.skills) && Array.isArray(res.skills.skillFrontmatter) ? res.skills.skillFrontmatter : [];
  for (const s of skills) {
    if (!isRec(s) || s.source !== 'plugin' || typeof s.name !== 'string') continue;
    const p = pluginOfSkill(s.name) ?? (typeof s.pluginName === 'string' ? s.pluginName : null);
    if (p) prow(p).skills += count(s.tokens);
  }
  if (Array.isArray(res.agents)) {
    for (const a of res.agents) {
      if (!isRec(a) || a.source !== 'plugin' || typeof a.agentType !== 'string') continue;
      const p = pluginOfSkill(a.agentType);
      if (p) prow(p).agents += count(a.tokens);
    }
  }

  return {
    total,
    byGroup,
    toolNameList,
    connectors: [...conn.values()],
    plugins: [...plug.values()],
  };
};

/**
 * What the kit would have dropped from this reading. `sure`: the engine's own per-item figures
 * (instructions, plugin skills, plugin agents). `approx`: `sure` plus the kit's share of the tool-name
 * list, by tool-name characters. Hook text is in neither. Never goes in the ledger.
 */
export const wouldSave: WouldSaveFn = (reading, kit, keep) => {
  let sure = 0;
  let droppedChars = 0;
  let totalChars = 0;
  for (const c of reading.connectors) {
    totalChars += c.toolNameChars;
    if (keepsConnector(kit, c.name, keep)) continue;
    sure += c.instructions;
    droppedChars += c.toolNameChars;
  }
  for (const p of reading.plugins) {
    if (!keepsPlugin(kit, p.name)) sure += p.skills + p.agents;
  }
  const share = totalChars > 0 ? Math.round((reading.toolNameList * droppedChars) / totalChars) : 0;
  return { sure, approx: sure + share };
};

// ---------------------------------------------------------------------------
// The tracker (decisions 2, 6-10)
// ---------------------------------------------------------------------------

export interface KitContext {
  kits: Readonly<Record<KitId, Kit>>;
  keep: KeepRules;
}

export interface KitTrackerDeps {
  /** The ledger. `record` may answer false for a repeat key; a void answer counts as counted. */
  savings: { record(entry: SavingsEntry): Promise<boolean | undefined> | boolean | undefined };
  store: KitShadowStore;
  /** Runs the brain script for one chat. Never throws; 'sent' means the script accepted it. */
  handoff: (id: string, record: KitShadowRecord) => Promise<AppUsageResult>;
  /** The kits and keep rules now (read fresh from the brain). Absent or failing: built-ins, no project servers. */
  resolveKits?: () => Promise<KitContext>;
  now?: () => number;
  /** Short status lines only. Never chat content. */
  log?: (line: string) => void;
}

const CACHE_IDS_MAX = 5_000;
const FLUSH_MAX_FAILURES = 3;

const BUILT_IN_CONTEXT: KitContext = { kits: BUILT_IN_KITS, keep: { projectServers: [] } };

interface State {
  /** The key the store holds this chat under right now (moves with a re-key). */
  storeKey: string;
  kind: ChatKind;
  day: string;
  seq: number;
  turns: number;
  compacted: number;
  cacheRead: number;
  summaries: number;
  peak: number | null;
  pick: KitPick | null;
  tier: LevelTier | null;
  reading: StartupReading | null;
  /** From an earlier run of a resumed chat, kept until a new reading replaces them. */
  carried: { startup: NonNullable<KitShadowRecord['work']>['startup']; wouldSave: WouldSave | null };
  skills: Set<string>;
  connectors: Set<string>;
  /** `message.id` → highest `cache_read_input_tokens` seen. In memory only. */
  cacheIds: Map<string, number>;
  boundaries: Set<string>;
  lastSig: string | null;
  /** Everything the chat does to its record or the store, one at a time, in order. */
  q: Promise<void>;
  ledger: Promise<void>;
  closed: boolean;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function addCapped(set: Set<string>, name: string, max: number): void {
  if (set.size < max || set.has(name)) set.add(name);
}

export function createKitTracker(deps: KitTrackerDeps): KitTracker {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const states = new Map<string, State>();

  const resolve = async (): Promise<KitContext> => {
    try {
      return deps.resolveKits ? await deps.resolveKits() : BUILT_IN_CONTEXT;
    } catch {
      return BUILT_IN_CONTEXT;
    }
  };

  /** Runs `fn` after everything queued so far; never rejects. */
  function enqueue(s: State, fn: () => Promise<void>): Promise<void> {
    s.q = s.q.then(fn).catch(() => log('A start-up kit update failed.'));
    return s.q;
  }

  function build(s: State, ctx: KitContext): KitShadowRecord {
    const rec: KitShadowRecord = {
      v: 1,
      day: s.day,
      kind: s.kind,
      seq: s.seq,
      handedOffSeq: null,
      turns: s.turns,
      compacted: s.compacted,
      cacheRead: s.cacheRead,
    };
    if (s.kind !== 'tds') return rec; // personal: counts only, never any work detail
    const use = { skills: [...s.skills], connectors: [...s.connectors] };
    const pick: KitPick = s.pick ?? { kit: KIT_FALLBACK, how: 'fallback' };
    rec.work = {
      kit: pick.kit,
      how: pick.how,
      fits: fits(use, ctx.kits, ctx.keep),
      tier: s.tier,
      startup: s.reading ? { total: s.reading.total, byGroup: s.reading.byGroup } : s.carried.startup,
      wouldSave: s.reading ? wouldSave(s.reading, ctx.kits[pick.kit], ctx.keep) : s.carried.wouldSave,
      used: use,
      peakPercent: s.peak,
      summaries: s.summaries,
    };
    return rec;
  }

  /** Persists the record when it has changed (seq + 1). Chats with no finished turn aren't recorded. */
  function commit(s: State, force = false): Promise<void> {
    return enqueue(s, async () => {
      await s.ledger;
      if (s.turns === 0) return;
      const rec = build(s, await resolve());
      const sig = JSON.stringify({ ...rec, seq: 0 });
      if (!force && sig === s.lastSig) return;
      s.lastSig = sig;
      s.seq += 1;
      rec.seq = s.seq;
      await deps.store.put(s.storeKey, rec);
    });
  }

  function ledger(s: State, entry: SavingsEntry, onCounted: () => void): void {
    s.ledger = s.ledger.then(async () => {
      try {
        if ((await deps.savings.record(entry)) !== false) onCounted();
      } catch {
        // the ledger never breaks a chat
      }
    });
  }

  function fresh(kind: ChatKind): State {
    return {
      storeKey: '',
      kind,
      day: utcDay(now()),
      seq: 0,
      turns: 0,
      compacted: 0,
      cacheRead: 0,
      summaries: 0,
      peak: null,
      pick: null,
      tier: null,
      reading: null,
      carried: { startup: null, wouldSave: null },
      skills: new Set(),
      connectors: new Set(),
      cacheIds: new Map(),
      boundaries: new Set(),
      lastSig: null,
      q: Promise.resolve(),
      ledger: Promise.resolve(),
      closed: false,
    };
  }

  /** Folds an earlier run's record of a resumed chat into this run's counts. */
  function mergeOld(s: State, old: KitShadowRecord): void {
    s.day = old.day;
    s.seq = Math.max(s.seq, old.seq);
    s.turns += old.turns;
    s.compacted += old.compacted;
    s.cacheRead += old.cacheRead;
    const w = old.work;
    if (!w || s.kind !== 'tds') return;
    s.summaries += w.summaries;
    if (!s.pick) s.pick = { kit: w.kit, how: w.how };
    s.tier ??= w.tier;
    for (const x of w.used.skills) addCapped(s.skills, x, USE_MAX.skills);
    for (const x of w.used.connectors) addCapped(s.connectors, x, USE_MAX.connectors);
    if (w.peakPercent !== null) s.peak = Math.max(s.peak ?? 0, w.peakPercent);
    s.carried = { startup: w.startup, wouldSave: w.wouldSave };
  }

  function get(key: string): State | null {
    const s = states.get(key);
    return s && !s.closed ? s : null;
  }

  function noteTool(s: State, block: Rec): void {
    if (s.kind !== 'tds' || typeof block.name !== 'string') return;
    if (block.name === 'Skill') {
      const skill = isRec(block.input) ? cleanSkill(block.input.skill) : null;
      if (skill) addCapped(s.skills, skill, USE_MAX.skills);
      return;
    }
    const key = toolConnectorKey(block.name);
    if (key) addCapped(s.connectors, key, USE_MAX.connectors);
  }

  function onAssistant(s: State, raw: Rec, helper: boolean): void {
    const message = isRec(raw.message) ? raw.message : null;
    if (!message) return;
    if (Array.isArray(message.content)) {
      for (const b of message.content) if (isRec(b) && b.type === 'tool_use') noteTool(s, b);
    }
    if (helper) return;
    const id = message.id;
    const read = isRec(message.usage) ? count(message.usage.cache_read_input_tokens) : 0;
    if (typeof id !== 'string' || id === '' || read === 0) return;
    // One API message arrives as several frames sharing id and usage: count its highest figure once.
    const seen = s.cacheIds.get(id) ?? 0;
    if (read <= seen) return;
    s.cacheIds.delete(id);
    s.cacheIds.set(id, read);
    if (s.cacheIds.size > CACHE_IDS_MAX) {
      const oldest = s.cacheIds.keys().next().value;
      if (oldest !== undefined) s.cacheIds.delete(oldest);
    }
    const delta = read - seen;
    s.cacheRead += delta;
    ledger(
      s,
      { source: 'cache', measure: 'reused', tokens: delta, kind: s.kind, dedupeKey: null, at: now() },
      () => {},
    );
  }

  function onBoundary(s: State, raw: Rec): void {
    const meta = isRec(raw.compact_metadata) ? raw.compact_metadata : null;
    const uuid = typeof raw.uuid === 'string' && raw.uuid !== '' ? raw.uuid : null;
    if (!meta || !uuid || s.boundaries.has(uuid)) return;
    const pre = meta.pre_tokens;
    const post = meta.post_tokens;
    if (typeof pre !== 'number' || typeof post !== 'number' || !Number.isFinite(pre + post)) return;
    if (post <= 0 || pre <= post) return;
    s.boundaries.add(uuid);
    const tokens = Math.round(pre - post);
    ledger(
      s,
      { source: 'summary', measure: 'compacted', tokens, kind: s.kind, dedupeKey: `c:${uuid}`, at: now() },
      () => {
        s.compacted += tokens;
        s.summaries += 1;
      },
    );
  }

  function handOff(id: string): Promise<void> {
    return (async () => {
      const rec = await deps.store.get(id);
      if (!rec || rec.handedOffSeq === rec.seq) return;
      if ((await deps.handoff(id, rec)) === 'sent') await deps.store.markHandedOff(id, rec.seq);
    })();
  }

  const safe = <A extends unknown[]>(fn: (...args: A) => void) => {
    return (...args: A): void => {
      try {
        fn(...args);
      } catch {
        log('A start-up kit update failed.');
      }
    };
  };

  return {
    onStart: safe((key, info) => {
      const prev = states.get(key);
      const s = fresh(info.kind);
      s.storeKey = key;
      if (prev) s.q = prev.q; // a chat reopened while its close is still saving waits for it
      states.set(key, s);
      if (info.resumed) {
        enqueue(s, async () => {
          const old = await deps.store.get(key);
          if (old) mergeOld(s, old);
        });
      }
    }),

    onKind: safe((key, kind) => {
      const s = get(key);
      if (!s || s.kind === kind) return;
      s.kind = kind; // a personal record is built without `work`
      void commit(s);
    }),

    onRekey: safe((from, to) => {
      const s = states.get(from);
      if (!s || from === to) return;
      states.delete(from);
      states.set(to, s);
      enqueue(s, async () => {
        await deps.store.rekey(s.storeKey, to);
        s.storeKey = to;
      });
      void commit(s, true);
    }),

    onPick: safe((key, pick, tier) => {
      const s = get(key);
      if (!s || s.pick) return;
      s.pick = { kit: pick.kit, how: pick.how };
      s.tier = tier;
      void commit(s);
    }),

    onTypedSkill: safe((key, name) => {
      const s = get(key);
      const skill = cleanSkill(name);
      if (s && s.kind === 'tds' && skill) addCapped(s.skills, skill, USE_MAX.skills);
    }),

    onMessage: safe((key, raw, helper) => {
      const s = get(key);
      if (!s || !isRec(raw)) return;
      if (raw.type === 'assistant') onAssistant(s, raw, helper);
      else if (!helper && raw.type === 'system' && raw.subtype === 'compact_boundary') onBoundary(s, raw);
    }),

    onStartup: safe((key, res) => {
      const s = get(key);
      const reading = s ? startupReading(res) : null;
      if (!s || !reading) return;
      s.reading = reading;
      void commit(s);
    }),

    onTurnEnd: safe((key, info) => {
      const s = get(key);
      if (!s) return;
      s.turns += 1;
      if (typeof info.percent === 'number' && Number.isFinite(info.percent)) {
        s.peak = Math.max(s.peak ?? 0, Math.min(Math.max(info.percent, 0), 100));
      }
      void commit(s);
    }),

    onClose: safe((key) => {
      const s = states.get(key);
      if (!s || s.closed) return;
      s.closed = true; // later messages for this chat are ignored
      void commit(s).then(() => {
        return enqueue(s, () => handOff(s.storeKey)).finally(() => {
          if (states.get(key) === s) states.delete(key);
        });
      });
    }),

    async flushPending() {
      try {
        let failures = 0;
        for (const { id, record } of await deps.store.pending()) {
          const result = await deps.handoff(id, record);
          if (result === 'sent') {
            await deps.store.markHandedOff(id, record.seq);
            failures = 0;
          } else if (result === 'not-installed' || ++failures >= FLUSH_MAX_FAILURES) {
            return;
          }
        }
      } catch {
        log('Handing start-up kit records to the brain failed.');
      }
    },
  };
}
