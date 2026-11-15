import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ChatKind } from '../../shared/contract.ts';
import {
  KIT_IDS,
  KIT_SHADOW_FILE,
  KIT_SHADOW_LIMITS,
  type KitId,
  type KitPickHow,
  type KitShadowRecord,
  STARTUP_GROUPS,
  type StartupGroup,
  USE_MAX,
} from '../../shared/kits-contract.ts';
import { isLevelTier } from '../../shared/levels-contract.ts';

/**
 * One shadow record per chat in the app's own data folder (never the brain), keyed by `sdkSessionId`.
 * Follows `chat-kinds.ts`: writes are queued one at a time, only a missing file reads as empty, and any
 * other read error is not cached and the pending write is skipped, so a bad read can never wipe the
 * saved records. Capped, and records older than KIT_SHADOW_LIMITS.keepDays are dropped on write.
 *
 * The store owns `handedOffSeq`: `put` keeps whatever the store already holds, and only
 * `markHandedOff` raises it, so a hand-off that finishes late can never mark newer data as sent.
 * Personal records never hold `work`, whatever is passed in.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ID_CHARS = 200;
const MAX_NAME_CHARS = 120;
const DAY_MS = 86_400_000;

export interface KitShadowFile {
  version: 1;
  chats: Record<string, KitShadowRecord>;
}

export interface KitShadowStore {
  get(id: string): Promise<KitShadowRecord | null>;
  /** Queued; never rejects. A record with a lower `seq` than the stored one is ignored. */
  put(id: string, record: KitShadowRecord): Promise<void>;
  /** Moves a record to a new key (the session id changed). Queued; never rejects. */
  rekey(from: string, to: string): Promise<void>;
  /** Raises `handedOffSeq` to `seq` (never lowers it). Queued; never rejects. */
  markHandedOff(id: string, seq: number): Promise<void>;
  /** Every record the brain script has not accepted at its current `seq`, oldest day first. */
  pending(): Promise<{ id: string; record: KitShadowRecord }[]>;
}

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS;
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 1e12) : 0;
const names = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_NAME_CHARS)
        .slice(0, max)
    : [];
const kitId = (v: unknown): KitId | null =>
  (KIT_IDS as readonly unknown[]).includes(v) ? (v as KitId) : null;

function cleanWork(raw: unknown): KitShadowRecord['work'] | undefined {
  if (!isRec(raw)) return undefined;
  const kit = kitId(raw.kit);
  const how = raw.how;
  if (!kit || (how !== 'auto' && how !== 'rule' && how !== 'fallback')) return undefined;
  const fits = (Array.isArray(raw.fits) ? raw.fits : []).map(kitId).filter((k): k is KitId => k !== null);
  const startupRaw = raw.startup;
  let startup: NonNullable<KitShadowRecord['work']>['startup'] = null;
  if (isRec(startupRaw) && isRec(startupRaw.byGroup)) {
    const byGroup = {} as Record<StartupGroup, number>;
    for (const g of STARTUP_GROUPS) byGroup[g] = count((startupRaw.byGroup as Record<string, unknown>)[g]);
    startup = { total: count(startupRaw.total), byGroup };
  }
  const ws = raw.wouldSave;
  const wouldSave =
    isRec(ws) && typeof ws.sure === 'number' && typeof ws.approx === 'number'
      ? { sure: count(ws.sure), approx: Math.max(count(ws.approx), count(ws.sure)) }
      : null;
  const used = isRec(raw.used) ? raw.used : {};
  const peak = raw.peakPercent;
  return {
    kit,
    how: how as KitPickHow,
    fits: fits.length > 0 ? fits : ['full'],
    tier: isLevelTier(raw.tier) ? raw.tier : null,
    startup,
    wouldSave,
    used: {
      skills: names(used.skills, USE_MAX.skills),
      connectors: names(used.connectors, USE_MAX.connectors),
    },
    peakPercent: typeof peak === 'number' && Number.isFinite(peak) ? Math.min(Math.max(peak, 0), 100) : null,
    summaries: count(raw.summaries),
  };
}

export function cleanRecord(raw: unknown): KitShadowRecord | null {
  if (!isRec(raw) || raw.v !== 1) return null;
  if (typeof raw.day !== 'string' || !DAY.test(raw.day)) return null;
  const kind: ChatKind | null = raw.kind === 'tds' || raw.kind === 'personal' ? raw.kind : null;
  if (!kind) return null;
  const rec: KitShadowRecord = {
    v: 1,
    day: raw.day,
    kind,
    seq: count(raw.seq),
    handedOffSeq:
      typeof raw.handedOffSeq === 'number' && raw.handedOffSeq >= 0 ? Math.round(raw.handedOffSeq) : null,
    turns: count(raw.turns),
    compacted: count(raw.compacted),
    cacheRead: count(raw.cacheRead),
  };
  if (kind === 'tds') {
    const work = cleanWork(raw.work);
    if (work) rec.work = work;
  }
  return rec;
}

function clean(raw: unknown): KitShadowFile {
  const out: KitShadowFile = { version: 1, chats: {} };
  const chats = (raw as { chats?: unknown } | null)?.chats;
  if (!isRec(chats)) return out;
  for (const [id, r] of Object.entries(chats)) {
    if (!validId(id)) continue;
    const rec = cleanRecord(r);
    if (rec) out.chats[id] = rec;
  }
  return out;
}

function trim(data: KitShadowFile, nowMs: number): void {
  const cutoff = new Date(nowMs - KIT_SHADOW_LIMITS.keepDays * DAY_MS).toISOString().slice(0, 10);
  for (const [id, rec] of Object.entries(data.chats)) if (rec.day < cutoff) delete data.chats[id];
  const ids = Object.keys(data.chats);
  if (ids.length <= KIT_SHADOW_LIMITS.maxChats) return;
  // Oldest day first, then lowest seq.
  ids.sort((a, b) => {
    const x = data.chats[a] as KitShadowRecord;
    const y = data.chats[b] as KitShadowRecord;
    return x.day === y.day ? x.seq - y.seq : x.day < y.day ? -1 : 1;
  });
  for (const id of ids.slice(0, ids.length - KIT_SHADOW_LIMITS.maxChats)) delete data.chats[id];
}

export function createKitShadowStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
  now: () => number = Date.now,
): KitShadowStore {
  const file = dataDir ? join(dataDir, KIT_SHADOW_FILE) : null;
  let memory: KitShadowFile | null = file ? null : { version: 1, chats: {} };
  let queue: Promise<void> = Promise.resolve();
  let loading: Promise<KitShadowFile> | null = null;

  /** Read once and shared; throws on any read error except a missing file, and caches nothing then. */
  function load(): Promise<KitShadowFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<KitShadowFile> {
    const path = file as string;
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        memory = { version: 1, chats: {} };
        return memory;
      }
      throw err;
    }
    try {
      memory = clean(JSON.parse(text));
    } catch {
      try {
        await fs.copyFile(path, `${path}.broken`);
      } catch {
        // a failed copy must not stop the app reading the file as empty
      }
      log('The saved start-up kit records could not be read. A copy was kept and they start empty.');
      memory = { version: 1, chats: {} };
    }
    return memory;
  }

  async function save(data: KitShadowFile): Promise<void> {
    if (!file || !dataDir) return;
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(data)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /** Runs one change on the loaded data, then saves. A failed read skips the change entirely. */
  function change(fn: (data: KitShadowFile) => boolean): Promise<void> {
    const job = queue.then(async () => {
      let data: KitShadowFile;
      try {
        data = await load();
      } catch {
        log('The saved start-up kit records could not be read, so this change was not saved.');
        return;
      }
      if (!fn(data)) return;
      trim(data, now());
      try {
        await save(data);
      } catch {
        log('Could not save the start-up kit records.');
      }
    });
    queue = job.catch(() => {});
    return job.catch(() => {});
  }

  return {
    async get(id) {
      if (!validId(id)) return null;
      await queue;
      try {
        const rec = (await load()).chats[id];
        return rec ? structuredClone(rec) : null;
      } catch {
        return null;
      }
    },
    put(id, record) {
      const rec = validId(id) ? cleanRecord(record) : null;
      if (!rec) return Promise.resolve();
      return change((data) => {
        const old = data.chats[id];
        if (old && old.seq > rec.seq) return false;
        rec.handedOffSeq = old?.handedOffSeq ?? null;
        data.chats[id] = rec;
        return true;
      });
    },
    rekey(from, to) {
      if (!validId(from) || !validId(to) || from === to) return Promise.resolve();
      return change((data) => {
        const rec = data.chats[from];
        if (!rec) return false;
        delete data.chats[from];
        // The brain keys its copy by a hash of the id, so a new id is a new chat there: send it again.
        data.chats[to] = { ...rec, handedOffSeq: null };
        return true;
      });
    },
    markHandedOff(id, seq) {
      if (!validId(id) || !Number.isFinite(seq)) return Promise.resolve();
      return change((data) => {
        const rec = data.chats[id];
        if (!rec || (rec.handedOffSeq !== null && rec.handedOffSeq >= seq)) return false;
        rec.handedOffSeq = Math.min(seq, rec.seq);
        return true;
      });
    },
    async pending() {
      await queue;
      try {
        const data = await load();
        return Object.entries(data.chats)
          .filter(([, r]) => r.handedOffSeq !== r.seq)
          .sort(([, a], [, b]) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.seq - b.seq))
          .map(([id, r]) => ({ id, record: structuredClone(r) }));
      } catch {
        return [];
      }
    },
  };
}
