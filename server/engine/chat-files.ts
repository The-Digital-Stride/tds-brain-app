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
/** Destinations tried per attachment in one Bash command, and files taken from one Bash command. */
const CANDIDATES_MAX = 50;
/** Short names looked up per reply, folders a reply names, and client folders kept as places to look. */
const SHORT_MAX = 50;
const FOLDERS_MAX = 10;
const PLACES_MAX = 10;
/** Names a file keeps for linking. */
const ALIASES_MAX = 10;
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
  /** Shorter names a reply gave it (`context/business.md`), sent so those link too. */
  aliases: string[];
}

interface Attachment extends TrackedAttachment {
  filedKey: string | null;
}

type Pending =
  | { kind: 'file'; tool: string; path: string; input: Rec; history: boolean }
  | {
      kind: 'bash';
      filings: { att: Attachment; candidates: string[] }[];
      reads: string[];
      changes: string[];
      /** Whose shell (the chat's, or a helper's), and its folder once the command has run. */
      shell: string;
      cwd: string | null;
    }
  | { kind: 'web'; url: string };

interface Filing {
  att: Attachment;
  candidates: string[];
  order: number;
}

/**
 * Something seen that only counts once its paths resolve to listed files: the files a shell command
 * named, or a short name in a reply with the places it could mean, most likely first.
 */
type Sighting =
  | { kind: 'shell'; reads: string[]; changes: string[]; toolUseId: string; order: number }
  | { kind: 'short'; alias: string; tiers: string[][]; order: number };

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

/** One simple command of a shell line: its words, and the files its output goes to (`>`, `>>`). */
export interface ShellSegment {
  words: string[];
  outputs: string[];
}

/**
 * A shell line split into simple commands (at `;`, `&`, `|`, brackets and new lines), roughly: quotes
 * and backslashes honoured, `> file` kept apart as an output, here-document bodies and here-strings
 * skipped (their text is data, not paths). Good enough to find the files a command touches.
 */
export function shellSegments(command: string): ShellSegment[] {
  const segs: ShellSegment[] = [];
  let seg: ShellSegment = { words: [], outputs: [] };
  let cur = '';
  let has = false;
  let quote: string | null = null;
  let next: 'word' | 'output' | 'heredoc' | 'drop' = 'word';
  let dash = false;
  const heredocs: { delim: string; dash: boolean }[] = [];
  const endWord = () => {
    if (has) {
      if (next === 'output') seg.outputs.push(cur);
      else if (next === 'heredoc') heredocs.push({ delim: cur, dash });
      else if (next === 'word') seg.words.push(cur);
      next = 'word';
    }
    cur = '';
    has = false;
  };
  const endSeg = () => {
    endWord();
    next = 'word';
    if (seg.words.length > 0 || seg.outputs.length > 0) segs.push(seg);
    seg = { words: [], outputs: [] };
  };
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
    } else if (c === '\\' && command[i + 1] === '\n') {
      i++; // a line carried on
    } else if (c === '\\' && i + 1 < command.length) {
      cur += command[++i];
      has = true;
    } else if (c === '\n') {
      endSeg();
      if (heredocs.length > 0) {
        i = skipHeredocs(command, i + 1, heredocs) - 1;
        heredocs.length = 0;
      }
    } else if (c === '>') {
      endWord();
      if (command[i + 1] === '>' || command[i + 1] === '|') i++;
      if (command[i + 1] === '&') {
        i++;
        next = 'drop'; // >&2: a stream, not a file
      } else next = 'output';
    } else if (c === '<') {
      endWord();
      if (command[i + 1] === '<') {
        i++;
        if (command[i + 1] === '<') {
          i++;
          next = 'drop'; // <<< here-string
        } else {
          dash = command[i + 1] === '-';
          if (dash) i++;
          next = 'heredoc';
        }
      }
      // `< file` reads the file: it stays a word.
    } else if (/[;&|()`]/.test(c)) {
      endSeg();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      cur += c;
      has = true;
    }
  }
  endSeg();
  return segs;
}

// The index just past the last here-document body that starts at `start`, or the end of the command.
function skipHeredocs(command: string, start: number, docs: { delim: string; dash: boolean }[]): number {
  let i = start;
  for (const d of docs) {
    for (;;) {
      if (i >= command.length) return command.length;
      let end = command.indexOf('\n', i);
      if (end < 0) end = command.length;
      let line = command.slice(i, end);
      i = end + 1;
      if (d.dash) line = line.replace(/^\t+/, '');
      if (line.trimEnd() === d.delim) break;
    }
  }
  return Math.min(i, command.length);
}

/** Words that run the next word as the command. */
const SHELL_PREFIXES = new Set(['sudo', 'command', 'time', 'nice', 'env', 'xargs', 'nohup', 'exec']);

/** What one simple command does with the words in it: reads them, changes them, or moves to a folder. */
function shellUse(seg: ShellSegment): { reads: string[]; changes: string[]; cd?: string } {
  const words = seg.words;
  let k = 0;
  while (
    k < words.length &&
    (SHELL_PREFIXES.has(words[k] as string) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k] as string))
  )
    k++;
  const verb = words[k] ?? '';
  const rest = words.slice(k + 1);
  const args = rest.filter((w) => !w.startsWith('-'));
  const out: { reads: string[]; changes: string[]; cd?: string } = { reads: [], changes: [...seg.outputs] };
  switch (verb) {
    case 'cd':
    case 'pushd':
      out.cd = args[0] ?? '~';
      break;
    // Removed, or not a file of the brain's: nothing to show.
    case 'rm':
    case 'rmdir':
    case 'unlink':
    case 'trash':
    case 'mkdir':
    case 'ln':
      break;
    case 'mv':
      out.changes.push(...args.slice(-1));
      break;
    case 'cp':
    case 'install':
    case 'rsync':
      out.reads.push(...args.slice(0, -1));
      out.changes.push(...args.slice(-1));
      break;
    case 'tee':
    case 'touch':
      out.changes.push(...args);
      break;
    case 'sed':
    case 'perl':
      if (rest.some((w) => /^-[A-Za-z]*i/.test(w))) out.changes.push(...args);
      else out.reads.push(...args);
      break;
    case 'git':
      if (args[0] === 'rm') break;
      if (args[0] === 'mv') out.changes.push(...args.slice(-1));
      else out.reads.push(...args.slice(1));
      break;
    default:
      out.reads.push(...args);
  }
  return out;
}

/** A word that names one file: a file extension, and no spaces, variables or wildcards. */
const FILE_WORD = /\.[A-Za-z0-9]{1,8}$/;
function fileWord(w: string): boolean {
  return w.length > 0 && w.length <= 500 && !/[\s$*?[\]{}`]/.test(w) && FILE_WORD.test(w);
}

/** `rel` from the brain-relative folder `base` (`''` is the root), or null when `..` climbs out. */
function joinRel(base: string, rel: string): string | null {
  const out = base ? base.split('/') : [];
  for (const s of rel.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(s);
  }
  return out.join('/');
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
  const sightings: Sighting[] = [];
  /** Each shell's folder, brain-relative (`''` the root; null once it has left the brain or can't be followed). */
  const cwds = new Map<string, string | null>();
  /** Client folders (and `personal`) this chat has worked in; insertion order is age, the newest last. */
  const places = new Map<string, true>();
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
      t = { path, actions: [], toolUseIds: [], edits: 0, order: 0, kept: [], truncated: false, aliases: [] };
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

  /** Remembers the client folder (or `personal`) a brain path is in, as a place short names may mean. */
  function notePlace(path: string | null): void {
    if (!path) return;
    const parts = path.split('/');
    const place =
      parts[0] === 'clients' && parts.length > 2
        ? `clients/${parts[1]}`
        : parts[0] === 'personal'
          ? 'personal'
          : null;
    if (!place) return;
    places.delete(place);
    places.set(place, true);
    while (places.size > PLACES_MAX) {
      const first = places.keys().next().value;
      if (first === undefined) break;
      places.delete(first);
    }
  }

  const scoped = (p: string) => p.startsWith('clients/') || p.startsWith('personal/');

  function text(body: string): void {
    const folders: string[] = [];
    const short: string[] = [];
    for (const raw of findPathMentions(body)) {
      const p = normalise(raw);
      if (!p) continue;
      const isFile = FILE_WORD.test(p.split('/').pop() ?? '');
      if (scoped(p)) {
        if (!isFile && folders.length < FOLDERS_MAX) folders.push(p);
        addAction(touch(p), 'mentioned');
      } else if (isFile && short.length < SHORT_MAX) {
        short.push(p);
      }
    }
    // A short name (`context/business.md`, or `audit.md` under "all in `clients/acme/reports/`") may mean
    // several places; each tier is tried in turn, and it counts only when one file in a tier fits.
    const cwd = cwds.get('') ?? '';
    const placesNewest = [...places.keys()].reverse();
    for (const p of short) {
      const tiers = [
        [p, `clients/${p}`, `personal/${p}`],
        folders.map((f) => `${f}/${p}`),
        cwd && scoped(cwd) ? [`${cwd}/${p}`] : [],
        placesNewest.map((place) => `${place}/${p}`),
      ].filter((tier) => tier.length > 0);
      sightings.push({ kind: 'short', alias: p, tiers, order: ++counter });
      dirty = true;
    }
    for (const url of findWebLinks(body)) addLink(url);
  }

  /** The brain path a shell word names from folder `cwd`, or null. */
  function shellPath(word: string, cwd: string | null): string | null {
    if (!fileWord(word) || word.startsWith('~')) return null;
    if (word.startsWith('/')) return normalise(word);
    if (cwd === null) return null;
    const joined = joinRel(cwd, word);
    return joined ? normalise(joined) : null;
  }

  /** The shell's folder after `cd target` from `cwd`. */
  function cdTo(target: string, cwd: string | null): string | null {
    if (!target || target.startsWith('~') || /[$`*?]/.test(target)) return null;
    if (target.startsWith('/')) {
      const t = target.replace(/\/+$/, '');
      for (const root of roots) if (root && t === root.trim().replace(/\/+$/, '')) return '';
      return normalise(target);
    }
    return cwd === null ? null : joinRel(cwd, target);
  }

  function toolUse(id: string, name: string, input: Rec, history: boolean, shell: string): void {
    if (FILE_TOOLS.has(name)) {
      const path = normalise(input.file_path ?? input.notebook_path);
      if (path) setPending(id, { kind: 'file', tool: name, path, input, history });
    } else if (name === 'Bash' && typeof input.command === 'string') {
      const command = input.command;
      const words = shellWords(command);
      const staged = (w: string) => attachments.some((a) => w.includes(a.stagedPath));
      const named = attachments.filter(
        (a) => command.includes(a.stagedPath) || words.some((w) => w.includes(a.stagedPath)),
      );
      const dests: string[] = [];
      if (named.length > 0) {
        for (const w of words) {
          if (staged(w)) continue;
          const p = normalise(w);
          if (p) dests.push(p);
        }
      }
      const filingsHere =
        dests.length === 0
          ? []
          : named.map((att) => {
              const name = basename(att.stagedPath);
              const candidates = [...new Set(dests.flatMap((d) => [d, `${d}/${name}`]))].slice(
                -CANDIDATES_MAX,
              );
              return { att, candidates };
            });

      // The files the command reads or writes, from the folder its shell is in (`cd` carries over).
      const before = cwds.has(shell) ? (cwds.get(shell) as string | null) : '';
      let cwd = before;
      const reads = new Set<string>();
      const changes = new Set<string>();
      for (const seg of shellSegments(command)) {
        const use = shellUse(seg);
        if (use.cd !== undefined) {
          cwd = cdTo(use.cd, cwd);
          continue;
        }
        for (const w of use.changes) {
          const p = staged(w) ? null : shellPath(w, cwd);
          if (p) changes.add(p);
        }
        for (const w of use.reads) {
          const p = staged(w) ? null : shellPath(w, cwd);
          if (p) reads.add(p);
        }
      }
      for (const p of changes) reads.delete(p);
      // Where an attachment was copied to is the filing's to report (as Attached, not as a change).
      for (const f of filingsHere) {
        for (const c of f.candidates) {
          changes.delete(c);
          reads.delete(c);
        }
      }
      const changed = [...changes].slice(0, CANDIDATES_MAX);
      const read = [...reads].slice(0, Math.max(0, CANDIDATES_MAX - changed.length));
      if (filingsHere.length === 0 && read.length === 0 && changed.length === 0 && cwd === before) return;
      setPending(id, { kind: 'bash', filings: filingsHere, reads: read, changes: changed, shell, cwd });
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
      // The shell keeps a folder only when the command worked.
      cwds.set(p.shell, p.cwd);
      if (p.cwd) notePlace(p.cwd);
      if (p.filings.length === 0 && p.reads.length === 0 && p.changes.length === 0) return;
      const order = ++counter;
      for (const f of p.filings) filings.push({ ...f, order });
      if (p.reads.length > 0 || p.changes.length > 0) {
        sightings.push({ kind: 'shell', reads: p.reads, changes: p.changes, toolUseId: id, order });
        for (const path of [...p.reads, ...p.changes]) notePlace(path);
      }
      dirty = true;
    } else {
      notePlace(p.path);
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
    const seen = sightings.splice(0);
    const wanted = [
      ...new Set([
        ...paths,
        ...filed.flatMap((f) => f.candidates),
        ...seen.flatMap((s) => (s.kind === 'shell' ? [...s.reads, ...s.changes] : s.tiers.flat())),
      ]),
    ];
    try {
      return await resolveAndList(paths, filed, seen, wanted);
    } catch (err) {
      // Put the work back, so the next snapshot tries these paths again instead of waiting for the turn end.
      if (wasAll) resolveAll = true;
      for (const p of paths) if (tracked.has(p)) touched.add(p);
      filings.unshift(...filed);
      sightings.unshift(...seen);
      throw err;
    }
  }

  /** The file at `path` (now known to be listed as `r`), shown as of `order` at the latest. */
  function listAs(path: string, r: NonNullable<Resolved>, order: number): Tracked {
    const t = ensure(path);
    t.order = Math.max(t.order, order);
    resolutions.set(path, r);
    return t;
  }

  function settle(s: Sighting, resolved: Map<string, Resolved>): void {
    if (s.kind === 'shell') {
      const hits: Tracked[] = [];
      for (const [paths, action] of [
        [s.reads, 'read'],
        [s.changes, 'changed'],
      ] as const) {
        for (const c of paths) {
          const r = resolved.get(c);
          if (!r?.item) continue;
          const t = listAs(c, r, s.order);
          addAction(t, action);
          hits.push(t);
        }
      }
      // A step opens its file only when it named just the one.
      const only = hits[0];
      if (
        only &&
        hits.length === 1 &&
        s.reads.length + s.changes.length === 1 &&
        !only.toolUseIds.includes(s.toolUseId)
      ) {
        only.toolUseIds.push(s.toolUseId);
        if (only.toolUseIds.length > CHAT_FILE_TOOL_IDS_MAX)
          only.toolUseIds.splice(0, only.toolUseIds.length - CHAT_FILE_TOOL_IDS_MAX);
      }
      return;
    }
    for (const tier of s.tiers) {
      const keys = new Map<string, string>();
      for (const c of tier) {
        const r = resolved.get(c);
        if (r?.item && !keys.has(r.key)) keys.set(r.key, c);
      }
      if (keys.size === 0) continue;
      // Two files fit equally well: link neither rather than guess.
      if (keys.size > 1) return;
      const c = [...keys.values()][0] as string;
      const t = listAs(c, resolved.get(c) as NonNullable<Resolved>, s.order);
      addAction(t, 'mentioned');
      if (!t.aliases.includes(s.alias)) {
        t.aliases.push(s.alias);
        if (t.aliases.length > ALIASES_MAX) t.aliases.shift();
      }
      return;
    }
  }

  async function resolveAndList(
    paths: string[],
    filed: Filing[],
    seen: Sighting[],
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
    for (const s of seen) settle(s, found);

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
            ...(t.aliases.length > 0 ? { aliases: [...t.aliases] } : {}),
          },
        });
        continue;
      }
      // Two spellings of one file (case): one row.
      const f = same.file;
      for (const a of t.actions) if (!f.actions.includes(a)) f.actions.push(a);
      f.toolUseIds = [...f.toolUseIds, ...t.toolUseIds].slice(-CHAT_FILE_TOOL_IDS_MAX);
      f.edits += t.edits;
      for (const a of t.aliases) if (!f.aliases?.includes(a)) f.aliases = [...(f.aliases ?? []), a];
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
              toolUse(b.id, b.name, b.input, history, parent ? (message.parent_tool_use_id as string) : '');
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
