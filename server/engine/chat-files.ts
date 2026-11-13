/**
 * One chat's files: which brain files it read, made, changed or named, where its attachments went,
 * and the web addresses it used. Fed the engine's raw messages (live) or Claude Code's stored history
 * (a reopened chat), so the same code builds both. Plan: docs/plans/2026-11-13-chat-files.md.
 *
 * CONTRACT FILE: signatures fixed by the lead; bodies are Builder B's (tests first).
 *
 * Read-only: never touches the brain. Every path goes through `resolve` (the library), so a file the
 * person could not open in Documents is never reported, and nothing outside the brain is either.
 */
import { basename } from 'node:path';
import { findPathMentions, findWebLinks, normaliseBrainPath } from '../../shared/chat-files.ts';
import type {
  ChatFile,
  ChatFileAction,
  ChatFileChanges,
  ChatFilesSnapshot,
  LibraryItem,
  LibraryScope,
} from '../../shared/contract.ts';
import {
  CHAT_FILE_CHANGES_BUDGET,
  CHAT_FILE_CHANGES_MAX,
  CHAT_FILE_TOOL_IDS_MAX,
  CHAT_FILES_MAX,
  CHAT_LINK_MAX_CHARS,
  CHAT_LINKS_MAX,
} from '../../shared/contract.ts';
import { proposedChange } from './file-change.ts';

export type ResolvePath = (
  rel: string,
) => Promise<{ key: string; scope: LibraryScope; item: LibraryItem | null } | null>;

/** An attachment as the session knows it. `stagedPath` is absolute and never leaves the server. */
export interface TrackedAttachment {
  name: string;
  kind: 'image' | 'document';
  stagedPath: string;
}

export interface ChatFilesOptions {
  /**
   * The brain root as configured and as its real path (they differ when it sits behind a symbolic
   * link; Claude's tool paths use the real one). Each tool path is normalised against each in turn.
   */
  brainRoots: readonly string[];
  resolve: ResolvePath;
  /** Stamps live edits for `changes`. */
  now?: () => Date;
}

export interface ChatFilesTracker {
  /**
   * One raw engine message (`assistant` with text / tool_use blocks, `user` with tool_result blocks)
   * or one stored history message of the same shape. Anything else is ignored. Never throws.
   * - tool_use Read / Write / Edit / MultiEdit / NotebookEdit (any parent: a helper's steps count):
   *   path from `file_path` or `notebook_path`, normalised with `normaliseBrainPath`; counted when its
   *   tool_result arrives without `is_error`. Write/Edit/MultiEdit inputs are kept for `changes`: at
   *   most CHAT_FILE_CHANGES_MAX per file and CHAT_FILE_CHANGES_BUDGET bytes per chat, oldest dropped
   *   first (then `truncated`); kept inputs of a path that resolves to null are dropped.
   * - tool_use Bash whose `command` contains a tracked attachment's `stagedPath`: every other token
   *   that normalises to a brain path is a candidate destination, and so is `<token>/<staged file
   *   name>` (for a folder). On a successful result, candidates that resolve to a listed item are
   *   marked `filed` and the attachment's `filedKey` set (the last one wins).
   * - tool_use WebFetch: its `url`, when http(s), without credentials and at most
   *   CHAT_LINK_MAX_CHARS, is added to `links` on success.
   * - text blocks of an `assistant` message with no parent (never a helper's text):
   *   `findPathMentions` → `mentioned`; `findWebLinks` → links (same URL rules).
   * Marks the tracker dirty when anything changed. `history: true`: a stored message, so its kept
   * edits get `at: null`.
   */
  observe(message: unknown, opts?: { history?: boolean }): void;
  /** The person attached these to the message just sent (or found in history). Marks dirty. */
  addAttachments(files: readonly TrackedAttachment[]): void;
  /**
   * The turn ended: forget tool uses still waiting for a result, and make the next `snapshot`
   * re-resolve every path (not just the touched ones). Marks dirty.
   */
  endTurn(): void;
  /**
   * Null when not dirty. Otherwise clears the dirty flag FIRST (so an `observe` during the await makes
   * the next call run again), resolves the paths touched since the last snapshot (all of them after
   * `endTurn` or on the first call), and returns the whole snapshot. A file that is only `mentioned`
   * and/or `filed` and resolves to `item: null` is left out; one that was read or edited stays, as
   * "No longer there". Ordered by `order`, newest first, capped per CHAT_FILES_MAX / CHAT_LINKS_MAX.
   */
  snapshot(): Promise<ChatFilesSnapshot | null>;
  /**
   * The kept edits for one key, via `proposedChange` (file-change.ts; a `created` file's first Write
   * as `fileExists: false`, every other Write as true). Null unless the key's latest resolution has an
   * item and it has kept edits.
   */
  changes(key: string): ChatFileChanges | null;
}

type Rec = Record<string, unknown>;
type Resolved = Awaited<ReturnType<ResolvePath>>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** The tools `proposedChange` can show. */
const KEPT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
/** Paths tracked per chat; the least recently touched go first. */
export const TRACKED_MAX = 1000;
/** Tool uses waiting for a result (a long history can leave some unanswered). */
export const PENDING_MAX = 500;
/** Destinations tried per attachment in one Bash command. */
const CANDIDATES_MAX = 50;
const RESOLVE_CONCURRENCY = 8;

interface Kept {
  tool: string;
  input: Rec;
  at: string | null;
  /** The Write that made the file: shown as a new file. */
  created: boolean;
  size: number;
  seq: number;
}

interface Tracked {
  path: string;
  actions: ChatFileAction[];
  toolUseIds: string[];
  edits: number;
  order: number;
  kept: Kept[];
  truncated: boolean;
}

interface Attachment extends TrackedAttachment {
  filedKey: string | null;
}

type Pending =
  | { kind: 'file'; tool: string; path: string; input: Rec; history: boolean }
  | { kind: 'bash'; filings: { att: Attachment; candidates: string[] }[] }
  | { kind: 'web'; url: string };

interface Filing {
  att: Attachment;
  candidates: string[];
  order: number;
}

/** An http(s) address without a user name or password, short enough to keep. */
function okLink(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > CHAT_LINK_MAX_CHARS) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Shell words, roughly: quotes and backslashes honoured, operators split words. Good enough to find paths. */
export function shellWords(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < command.length) {
      cur += command[++i];
      has = true;
    } else if (/[\s;&|()<>]/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

async function pool<T>(items: T[], size: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await job(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

export function createChatFiles(opts: ChatFilesOptions): ChatFilesTracker {
  const roots = opts.brainRoots.length > 0 ? opts.brainRoots : [''];
  const now = opts.now ?? (() => new Date());
  const tracked = new Map<string, Tracked>();
  /** The latest resolution of each tracked path. */
  const resolutions = new Map<string, Resolved>();
  const pending = new Map<string, Pending>();
  const attachments: Attachment[] = [];
  const filings: Filing[] = [];
  /** Insertion order is age: the newest is last. */
  const links = new Map<string, true>();
  const touched = new Set<string>();
  let counter = 0;
  let editSeq = 0;
  let keptBytes = 0;
  let dirty = false;
  let resolveAll = true;

  function normalise(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    for (const root of roots) {
      const p = normaliseBrainPath(raw, root);
      if (p) return p;
    }
    return null;
  }

  function dropKept(t: Tracked, k: Kept): void {
    const i = t.kept.indexOf(k);
    if (i >= 0) t.kept.splice(i, 1);
    keptBytes -= k.size;
  }

  function forget(t: Tracked): void {
    for (const k of [...t.kept]) dropKept(t, k);
    tracked.delete(t.path);
    resolutions.delete(t.path);
    touched.delete(t.path);
  }

  /** The file at `path`, created if new. */
  function ensure(path: string): Tracked {
    let t = tracked.get(path);
    if (!t) {
      t = { path, actions: [], toolUseIds: [], edits: 0, order: 0, kept: [], truncated: false };
      tracked.set(path, t);
      if (tracked.size > TRACKED_MAX) {
        let oldest: Tracked | null = null;
        for (const x of tracked.values()) if (x !== t && (!oldest || x.order < oldest.order)) oldest = x;
        if (oldest) forget(oldest);
      }
    }
    return t;
  }

  /** The file at `path`, created if new, marked touched and newest. */
  function touch(path: string): Tracked {
    const t = ensure(path);
    t.order = ++counter;
    touched.add(path);
    dirty = true;
    return t;
  }

  function addAction(t: Tracked, a: ChatFileAction): void {
    if (!t.actions.includes(a)) t.actions.push(a);
  }

  function addLink(url: unknown): void {
    if (!okLink(url)) return;
    links.delete(url);
    links.set(url, true);
    while (links.size > CHAT_LINKS_MAX) {
      const first = links.keys().next().value;
      if (first === undefined) break;
      links.delete(first);
    }
    dirty = true;
  }

  function keep(t: Tracked, k: Omit<Kept, 'size' | 'seq'>): void {
    let size: number;
    try {
      size = Buffer.byteLength(JSON.stringify(k.input), 'utf8');
    } catch {
      return;
    }
    if (size > CHAT_FILE_CHANGES_BUDGET) {
      t.truncated = true;
      return;
    }
    t.kept.push({ ...k, size, seq: ++editSeq });
    keptBytes += size;
    while (t.kept.length > CHAT_FILE_CHANGES_MAX) {
      dropKept(t, t.kept[0] as Kept);
      t.truncated = true;
    }
    while (keptBytes > CHAT_FILE_CHANGES_BUDGET) {
      let owner: Tracked | null = null;
      for (const x of tracked.values()) {
        const first = x.kept[0];
        if (first && (!owner || first.seq < (owner.kept[0] as Kept).seq)) owner = x;
      }
      if (!owner) break;
      dropKept(owner, owner.kept[0] as Kept);
      owner.truncated = true;
    }
  }

  function text(body: string): void {
    for (const raw of findPathMentions(body)) {
      const p = normalise(raw);
      if (p) addAction(touch(p), 'mentioned');
    }
    for (const url of findWebLinks(body)) addLink(url);
  }

  function toolUse(id: string, name: string, input: Rec, history: boolean): void {
    if (FILE_TOOLS.has(name)) {
      const path = normalise(input.file_path ?? input.notebook_path);
      if (path) setPending(id, { kind: 'file', tool: name, path, input, history });
    } else if (name === 'Bash' && typeof input.command === 'string') {
      const command = input.command;
      const words = shellWords(command);
      const named = attachments.filter(
        (a) => command.includes(a.stagedPath) || words.some((w) => w.includes(a.stagedPath)),
      );
      if (named.length === 0) return;
      const dests: string[] = [];
      for (const w of words) {
        if (attachments.some((a) => w.includes(a.stagedPath))) continue;
        const p = normalise(w);
        if (p) dests.push(p);
      }
      if (dests.length === 0) return;
      const filingsHere = named.map((att) => {
        const name = basename(att.stagedPath);
        const candidates = [...new Set(dests.flatMap((d) => [d, `${d}/${name}`]))].slice(-CANDIDATES_MAX);
        return { att, candidates };
      });
      setPending(id, { kind: 'bash', filings: filingsHere });
    } else if (name === 'WebFetch' && okLink(input.url)) {
      setPending(id, { kind: 'web', url: input.url });
    }
  }

  function setPending(id: string, p: Pending): void {
    pending.delete(id);
    pending.set(id, p);
    while (pending.size > PENDING_MAX) {
      const first = pending.keys().next().value;
      if (first === undefined) break;
      pending.delete(first);
    }
  }

  function toolResult(id: string, failed: boolean): void {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (failed) return;
    if (p.kind === 'web') {
      addLink(p.url);
    } else if (p.kind === 'bash') {
      const order = ++counter;
      for (const f of p.filings) filings.push({ ...f, order });
      dirty = true;
    } else {
      const known = tracked.get(p.path);
      const seen = known?.actions.some((a) => a === 'read' || a === 'created' || a === 'changed') ?? false;
      const t = touch(p.path);
      const action: ChatFileAction =
        p.tool === 'Read' ? 'read' : p.tool === 'Write' && !seen ? 'created' : 'changed';
      addAction(t, action);
      t.toolUseIds.push(id);
      if (t.toolUseIds.length > CHAT_FILE_TOOL_IDS_MAX)
        t.toolUseIds.splice(0, t.toolUseIds.length - CHAT_FILE_TOOL_IDS_MAX);
      if (p.tool === 'Read') return;
      t.edits++;
      if (KEPT_TOOLS.has(p.tool)) {
        keep(t, {
          tool: p.tool,
          input: p.input,
          at: p.history ? null : now().toISOString(),
          created: action === 'created',
        });
      }
    }
  }

  async function safeResolve(rel: string): Promise<Resolved> {
    try {
      const r = await opts.resolve(rel);
      return r && typeof r.key === 'string' && isRec(r.scope) ? r : null;
    } catch {
      return null;
    }
  }

  /** The tracked files whose latest resolution has `key` and an item. */
  function listedWith(key: string): Tracked[] {
    const out: Tracked[] = [];
    for (const t of tracked.values()) {
      const r = resolutions.get(t.path);
      if (r?.key === key && r.item) out.push(t);
    }
    return out;
  }

  async function build(): Promise<ChatFilesSnapshot> {
    const wasAll = resolveAll;
    const paths = resolveAll ? [...tracked.keys()] : [...touched];
    resolveAll = false;
    touched.clear();
    const filed = filings.splice(0);
    const wanted = [...new Set([...paths, ...filed.flatMap((f) => f.candidates)])];
    try {
      return await resolveAndList(paths, filed, wanted);
    } catch (err) {
      // Put the work back, so the next snapshot tries these paths again instead of waiting for the turn end.
      if (wasAll) resolveAll = true;
      for (const p of paths) if (tracked.has(p)) touched.add(p);
      filings.unshift(...filed);
      throw err;
    }
  }

  async function resolveAndList(
    paths: string[],
    filed: Filing[],
    wanted: string[],
  ): Promise<ChatFilesSnapshot> {
    const found = new Map<string, Resolved>();
    await pool(wanted, RESOLVE_CONCURRENCY, async (p) => {
      found.set(p, await safeResolve(p));
    });
    for (const p of paths) {
      const t = tracked.get(p);
      if (!t) continue; // forgotten while resolving
      const r = found.get(p) ?? null;
      resolutions.set(p, r);
      // Never shown, so never kept.
      if (!r) for (const k of [...t.kept]) dropKept(t, k);
    }
    for (const f of filed) {
      for (const c of f.candidates) {
        const r = found.get(c);
        if (!r?.item) continue;
        const t = ensure(c);
        t.order = Math.max(t.order, f.order);
        addAction(t, 'filed');
        resolutions.set(c, r);
        f.att.filedKey = r.key;
      }
    }

    const byKey = new Map<string, { file: ChatFile; newest: number }>();
    for (const t of tracked.values()) {
      const r = resolutions.get(t.path);
      if (!r) continue;
      if (!r.item && t.actions.every((a) => a === 'mentioned' || a === 'filed')) continue;
      const same = byKey.get(r.key);
      if (!same) {
        byKey.set(r.key, {
          newest: t.order,
          file: {
            key: r.key,
            path: r.item?.path ?? t.path,
            item: r.item,
            scope: { id: r.scope.id, name: r.scope.name, kind: r.scope.kind },
            actions: [...t.actions],
            toolUseIds: [...t.toolUseIds],
            edits: t.edits,
            order: t.order,
          },
        });
        continue;
      }
      // Two spellings of one file (case): one row.
      const f = same.file;
      for (const a of t.actions) if (!f.actions.includes(a)) f.actions.push(a);
      f.toolUseIds = [...f.toolUseIds, ...t.toolUseIds].slice(-CHAT_FILE_TOOL_IDS_MAX);
      f.edits += t.edits;
      if (t.order > same.newest) {
        same.newest = t.order;
        f.order = t.order;
        f.item = r.item;
        f.path = r.item?.path ?? t.path;
      }
    }
    const files = [...byKey.values()]
      .map((v) => v.file)
      .sort((a, b) => b.order - a.order)
      .slice(0, CHAT_FILES_MAX);
    const shown = new Set(files.map((f) => f.key));
    return {
      files,
      attachments: attachments.map((a) => ({
        name: a.name,
        kind: a.kind,
        filedKey: a.filedKey && shown.has(a.filedKey) ? a.filedKey : null,
      })),
      links: [...links.keys()]
        .reverse()
        .slice(0, CHAT_LINKS_MAX)
        .map((url) => ({ url })),
    };
  }

  return {
    observe(message, o) {
      try {
        if (!isRec(message)) return;
        const history = o?.history === true;
        const parent = typeof message.parent_tool_use_id === 'string' && message.parent_tool_use_id !== '';
        const content = isRec(message.message) ? message.message.content : undefined;
        if (message.type === 'assistant') {
          if (typeof content === 'string') {
            if (!parent) text(content);
            return;
          }
          if (!Array.isArray(content)) return;
          for (const b of content) {
            if (!isRec(b)) continue;
            if (b.type === 'text' && typeof b.text === 'string') {
              if (!parent) text(b.text);
            } else if (
              b.type === 'tool_use' &&
              typeof b.id === 'string' &&
              typeof b.name === 'string' &&
              isRec(b.input)
            ) {
              toolUse(b.id, b.name, b.input, history);
            }
          }
        } else if (message.type === 'user' && Array.isArray(content)) {
          for (const b of content) {
            if (isRec(b) && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
              toolResult(b.tool_use_id, b.is_error === true);
            }
          }
        }
      } catch {
        // never throws: a message it cannot read is skipped
      }
    },

    addAttachments(files) {
      try {
        for (const f of files) {
          if (!isRec(f) || typeof f.name !== 'string' || typeof f.stagedPath !== 'string' || !f.stagedPath) {
            continue;
          }
          if (f.kind !== 'image' && f.kind !== 'document') continue;
          if (attachments.some((a) => a.stagedPath === f.stagedPath)) continue;
          attachments.push({ name: f.name, kind: f.kind, stagedPath: f.stagedPath, filedKey: null });
          dirty = true;
        }
      } catch {
        // ignored
      }
    },

    endTurn() {
      pending.clear();
      resolveAll = true;
      dirty = true;
    },

    async snapshot() {
      if (!dirty) return null;
      dirty = false;
      try {
        return await build();
      } catch {
        dirty = true;
        return null;
      }
    },

    changes(key) {
      try {
        const kept = listedWith(key)
          .flatMap((t) => t.kept)
          .sort((a, b) => a.seq - b.seq);
        if (kept.length === 0) return null;
        const changes: ChatFileChanges['changes'] = [];
        for (const k of kept.slice(-CHAT_FILE_CHANGES_MAX)) {
          const s = proposedChange(k.tool, k.input, !k.created);
          if (s.change)
            changes.push({
              at: k.at,
              tool: k.tool,
              change: s.change,
              cut: s.cut,
              hiddenChars: s.hiddenChars,
            });
        }
        if (changes.length === 0) return null;
        const truncated = kept.length > CHAT_FILE_CHANGES_MAX || listedWith(key).some((t) => t.truncated);
        return { changes, truncated };
      } catch {
        return null;
      }
    },
  };
}
