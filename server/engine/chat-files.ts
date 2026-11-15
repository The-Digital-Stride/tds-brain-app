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
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, resolve as resolvePath } from 'node:path';
import {
  findPathMentions,
  findWebLinks,
  normaliseBrainPath,
  replyFolders,
  shortPathPlaces,
} from '../../shared/chat-files.ts';
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
import { artifactPublish, artifactPublishResult, isRealPage, pageTitle } from '../../shared/pages.ts';
import {
  type ArtifactPublish,
  CHAT_PAGES_MAX,
  type ChatPage,
  PAGE_VERSIONS_MAX,
} from '../../shared/pages-contract.ts';
import { sourceShapeOk } from '../store/page-copies.ts';
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

/** Kept copies removed to make room, by page key and the tool use that names them. */
export type EvictedCopies = { key: string; id: string }[];

/**
 * Where the chat's page copies live (`server/store/page-copies.ts`, bound to the chat). Without it
 * pages are still listed (from what the history shows), with no copies.
 */
export interface PageCopyPort {
  /** The real spelling of a written path when it may be a page source (shape, allowed roots), else null. Reads nothing. */
  locate(filePath: string): Promise<string | null>;
  /**
   * Copies the file as page `key`'s in-progress copy for tool use `id` (replacing the earlier one).
   * With `mustBePage`, a file that isn't a real page is left uncopied (`page: false`). Null when unreadable.
   */
  draft(
    key: string,
    id: string,
    filePath: string,
    mustBePage: boolean,
  ): Promise<{ title: string; page: boolean } | null>;
  /** In-progress copy `id` becomes the kept copy of a version; null when there is none. */
  keep(key: string, id: string): Promise<{ evicted: EvictedCopies } | null>;
  /** Copies the file straight to kept copy `id`; null when it could not be copied. */
  copy(key: string, id: string, filePath: string): Promise<{ title: string; evicted: EvictedCopies } | null>;
  /** The kept copy on disk ('' title when untitled), or null. */
  held(key: string, id: string): Promise<{ title: string } | null>;
  /** Whether the file as it is now is a real page; null when it can't be read. */
  isPage(filePath: string): Promise<boolean | null>;
}

/** What the server knows of one page: never sent to the browser as is (paths and ids stay here). */
export interface PageInfo {
  title: string;
  url: string | null;
  /** The newest source, as Claude gave it. */
  filePath: string;
  /** Written since the last boundary (served as `n = 0`); `id` names its in-progress copy. */
  draft: { id: string; hasCopy: boolean } | null;
  /** Oldest first; `id` names each kept copy. */
  versions: { n: number; id: string; hasCopy: boolean }[];
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
  /** Page copies (plan 2026-11-14-artifacts-in-app, decision 2 and revision 2). */
  pages?: PageCopyPort;
  /** A file's modified time in ms, null when it can't be read (default: `fs.stat`). Tests set it. */
  modified?: (filePath: string) => Promise<number | null>;
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
   * - tool_use Write / Edit / MultiEdit (any parent) of an absolute `.html` / `.htm` path: on success,
   *   a page when `pages.locate` allows the path and it is a real page (`isRealPage`: of the file as
   *   copied, live; of a Write's content, or the file as it is now, from history). Keyed by a hash of
   *   the located path. A live write refreshes the page's in-progress copy (`pages.draft`).
   * - tool_use Artifact (any parent): `artifactPublish(input)`; a page publish only when its
   *   tool_result has no `is_error` and `artifactPublishResult(content)` is non-null. It touches the
   *   page of the same file (else the page with that address, else a new page) like a write, and
   *   gives it its claude.ai address and `remote` version.
   *   Each touched page becomes one numbered version at the next `boundary`, named by the last tool
   *   use that touched it.
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
   * Null when not dirty once the page work queued so far is done. Otherwise clears the dirty flag FIRST (so an `observe` during the await makes
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
  /**
   * A version boundary (O4): the person's next message, an interrupt, an error or a close (live), or
   * a person's message and the end of the history (replay). Every page touched since the last one
   * becomes one numbered version; live, its in-progress copy is kept (`pages.keep`).
   */
  boundary(opts?: { history?: boolean }): void;
  /** Resolves once the page work queued so far is done (tests and the page routes). */
  settled(): Promise<void>;
  /** One page by its key, with its newest source path (server only), or null. */
  page(key: string): PageInfo | null;
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
/** Short names looked up per reply. */
const SHORT_MAX = 50;
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
  | {
      kind: 'bash';
      filings: { att: Attachment; candidates: string[] }[];
      reads: string[];
      changes: string[];
      /** Whose shell (the chat's, or a helper's), and its folder once the command has run. */
      shell: string;
      cwd: string | null;
      /** Absolute `.html` / `.htm` words the command may have written, and when it started (ms). */
      pagePaths: string[];
      startedAt: number;
      history: boolean;
    }
  | { kind: 'web'; url: string }
  | { kind: 'page'; publish: ArtifactPublish; history: boolean };

/** A Write / Edit / MultiEdit of a path that may be a page, waiting for its result. */
/** Some filesystems (HFS+, exFAT, SMB) store modified times to the second, so a real write can look older than the command. */
const MTIME_SLACK_MS = 2000;

interface PageWrite {
  filePath: string;
  /** A Write's content is a real page (null for an edit, whose result is only on disk). */
  writeIsPage: boolean | null;
  /** The title from a Write's content, when it has one. */
  writeTitle: string | null;
  history: boolean;
  /** From history only: a shell word is a guess, so the page exists only when live kept a copy under this tool use. */
  heldOnly?: boolean;
}

/** The latest touch of a page since the last boundary. */
interface PageTouch {
  id: string;
  at: string | null;
  filePath: string;
  hasCopy: boolean;
  title: string | null;
}

interface PageVersionRec {
  n: number;
  /** The tool use that last touched the page before the boundary: names the kept copy. */
  id: string;
  remote: number | null;
  at: string | null;
  filePath: string;
  hasCopy: boolean;
  /** The copy's title, once known ('' when the page has none). */
  title: string | null;
  /** Whether the disk has been asked about this version. */
  checked: boolean;
  /** Only a page's newest version gets one try at a copy from its source. */
  tried: boolean;
}

interface PageRec {
  key: string;
  url: string | null;
  filePath: string;
  versions: PageVersionRec[];
  nextN: number;
  draft: PageTouch | null;
  /** claude.ai's version number from a publish since the last boundary. */
  remote: number | null;
  live: boolean;
  multiFile: boolean;
  toolUseIds: string[];
  order: number;
}

const PAGE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

/** Without a copy store: paths are taken as written, and nothing is read or kept. */
const NO_COPIES: PageCopyPort = {
  locate: async (p) => (sourceShapeOk(p) ? resolvePath(p) : null),
  draft: async () => null,
  keep: async () => null,
  copy: async () => null,
  held: async () => null,
  isPage: async () => null,
};

/** One address however it is written: no trailing slash. */
const pageUrlKey = (url: string): string => url.replace(/\/+$/, '');

interface Filing {
  att: Attachment;
  candidates: string[];
  order: number;
}

/**
 * Something seen that only counts once its paths resolve to listed files: the files a shell command
 * named, or a short name in a reply with the places it could mean, as written first.
 */
type Sighting =
  | { kind: 'shell'; reads: string[]; changes: string[]; toolUseId: string; order: number }
  | { kind: 'short'; tiers: string[][]; order: number };

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

/**
 * One simple command of a shell line: its words, the files its output goes to (`>`, `>>`), and the
 * subshells it runs in (`( … )`, `$( … )`, backticks), outermost first: a `cd` there moves only them.
 */
export interface ShellSegment {
  words: string[];
  outputs: string[];
  groups: number[];
}

/**
 * A shell line split into simple commands (at `;`, `&`, `|`, brackets and new lines), roughly: quotes
 * and backslashes honoured, `> file` kept apart as an output, here-document bodies and here-strings
 * skipped (their text is data, not paths). Good enough to find the files a command touches.
 */
export function shellSegments(command: string): ShellSegment[] {
  const segs: ShellSegment[] = [];
  let seg: Omit<ShellSegment, 'groups'> = { words: [], outputs: [] };
  let cur = '';
  let has = false;
  let quote: string | null = null;
  let next: 'word' | 'output' | 'heredoc' | 'drop' = 'word';
  let dash = false;
  const heredocs: { delim: string; dash: boolean }[] = [];
  const stack: number[] = [];
  let groupId = 0;
  let backtick: number | null = null;
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
    if (seg.words.length > 0 || seg.outputs.length > 0) segs.push({ ...seg, groups: [...stack] });
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
    } else if (c === '(') {
      if (cur === '$' && has) {
        cur = ''; // $( … )
        has = false;
      }
      endSeg();
      stack.push(++groupId);
    } else if (c === ')') {
      endSeg();
      stack.pop();
    } else if (c === '`') {
      endSeg();
      if (backtick !== null && stack.at(-1) === backtick) {
        stack.pop();
        backtick = null;
      } else {
        backtick = ++groupId;
        stack.push(backtick);
      }
    } else if (/[;&|]/.test(c)) {
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

/** grep-family flags whose value is the next word. */
const SEARCH_VALUE_FLAGS = new Set([
  '-A',
  '-B',
  '-C',
  '-m',
  '-e',
  '-f',
  '-t',
  '-T',
  '-g',
  '--max-count',
  '--regexp',
  '--file',
  '--type',
  '--glob',
]);

/** The files a grep-like command searches: the words left once flags, flag values and the pattern are gone. */
function searchFiles(rest: string[]): string[] {
  const files: string[] = [];
  let patternGiven = false;
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i] as string;
    if (SEARCH_VALUE_FLAGS.has(w)) {
      if (w === '-e' || w === '-f' || w === '--regexp' || w === '--file') patternGiven = true;
      i++;
    } else if (/^(-e|--regexp=|-f|--file=)/.test(w)) {
      patternGiven = true; // -epattern, --regexp=pattern
    } else if (!w.startsWith('-')) {
      files.push(w);
    }
  }
  return patternGiven ? files : files.slice(1);
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
    case 'popd':
      out.cd = '~'; // back to a folder not followed here
      break;
    // Text and search patterns, not files (where output goes still counts).
    case 'echo':
    case 'printf':
      break;
    case 'grep':
    case 'egrep':
    case 'fgrep':
    case 'rg':
    case 'ag':
    case 'ack':
      out.reads.push(...searchFiles(rest));
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
      if (rest.some((w) => /^-i/.test(w) || /^-[a-hj-z]{1,3}i$/.test(w) || /^--in-place(=|$)/.test(w)))
        out.changes.push(...args);
      else out.reads.push(...args);
      break;
    case 'git': {
      // Leave out flag values that are not files: a commit message, a folder or a setting.
      const gitArgs = rest.filter((w, i) => {
        const before = rest[i - 1] ?? '';
        return (
          !w.startsWith('-') &&
          !['--message', '-C', '-c', '-F', '--file'].includes(before) &&
          !/^-[A-Za-z]*m$/.test(before) // -m, -am
        );
      });
      if (gitArgs[0] === 'rm') break;
      if (gitArgs[0] === 'mv') out.changes.push(...gitArgs.slice(-1));
      else out.reads.push(...gitArgs.slice(1));
      break;
    }
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
  const modified =
    opts.modified ??
    (async (p: string): Promise<number | null> => {
      try {
        return (await fsp.stat(p)).mtimeMs;
      } catch {
        return null;
      }
    });
  const tracked = new Map<string, Tracked>();
  /** The latest resolution of each tracked path. */
  const resolutions = new Map<string, Resolved>();
  const pending = new Map<string, Pending>();
  const attachments: Attachment[] = [];
  const filings: Filing[] = [];
  const sightings: Sighting[] = [];
  /** Each shell's folder, brain-relative (`''` the root; null once it has left the brain or can't be followed). */
  const cwds = new Map<string, string | null>();
  /** Insertion order is age: the newest is last. */
  const links = new Map<string, true>();
  const touched = new Set<string>();
  let counter = 0;
  let editSeq = 0;
  let keptBytes = 0;
  let dirty = false;
  let resolveAll = true;
  const port = opts.pages ?? NO_COPIES;
  /** By key. */
  const pages = new Map<string, PageRec>();
  /** By located path: a page's own file, and any other file published to its address. */
  const pagesByPath = new Map<string, PageRec>();
  const pageWrites = new Map<string, PageWrite>();
  /** Page work runs one job at a time, in the order the messages came (boundaries included). */
  let pageQueue: Promise<void> = Promise.resolve();
  /** A page changed since the last snapshot listed them (kept apart from `dirty`: page work runs late). */
  let pagesDirty = false;

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

  const scoped = (p: string) => p.startsWith('clients/') || p.startsWith('personal/');

  function text(body: string): void {
    const paths = findPathMentions(body).map(normalise);
    const short: string[] = [];
    for (const p of paths) {
      if (!p) continue;
      const isFile = FILE_WORD.test(p.split('/').pop() ?? '');
      if (scoped(p)) addAction(touch(p), 'mentioned');
      else if (isFile && short.length < SHORT_MAX) short.push(p);
    }
    // A short name (`context/business.md`, or `audit.md` under "all in `clients/acme/reports/`") counts
    // only as written from the brain's root, or where this same reply puts it (`shortPathPlaces`), and
    // only when one file fits. Never from the folder the chat worked in or an earlier reply: a lone
    // `profile.md` may be any client's. The client links reply text by the same rule.
    const folders = replyFolders(paths);
    for (const p of short) {
      const tiers = [[p], shortPathPlaces(p, folders)];
      sightings.push({ kind: 'short', tiers, order: ++counter });
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
    if (PAGE_WRITE_TOOLS.has(name) && sourceShapeOk(input.file_path)) {
      const content = name === 'Write' && typeof input.content === 'string' ? input.content : null;
      const writeIsPage = content === null ? null : isRealPage(content);
      pageWrites.delete(id);
      pageWrites.set(id, {
        filePath: input.file_path,
        writeIsPage,
        writeTitle: content !== null && writeIsPage ? pageTitle(content, '') || null : null,
        history,
      });
      while (pageWrites.size > PENDING_MAX) {
        const first = pageWrites.keys().next().value;
        if (first === undefined) break;
        pageWrites.delete(first);
      }
    }
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
      // A subshell starts in the folder of the shell around it, and its cd ends with it.
      const sub = new Map<number, string | null>();
      const cwdIn = (groups: number[]): string | null => {
        let c = cwd;
        for (const g of groups) {
          if (!sub.has(g)) sub.set(g, c);
          c = sub.get(g) as string | null;
        }
        return c;
      };
      const reads = new Set<string>();
      const changes = new Set<string>();
      const pagePaths = new Set<string>();
      const rootAbs = roots.map((r) => r.trim().replace(/\/+$/, '')).find((r) => r.startsWith('/')) ?? null;
      // A page word as an absolute path: as written, or from the shell's brain folder.
      const absPage = (w: string, here: string | null): string | null => {
        if (!/\.html?$/i.test(w) || !fileWord(w) || w.startsWith('~')) return null;
        if (w.startsWith('/')) return w;
        if (here === null || rootAbs === null) return null;
        const joined = joinRel(here, w);
        return joined === null ? null : `${rootAbs}/${joined}`;
      };
      for (const seg of shellSegments(command)) {
        const use = shellUse(seg);
        const here = cwdIn(seg.groups);
        if (use.cd !== undefined) {
          const to = cdTo(use.cd, here);
          const inner = seg.groups.at(-1);
          if (inner === undefined) cwd = to;
          else sub.set(inner, to);
          continue;
        }
        for (const w of use.changes) {
          const p = staged(w) ? null : shellPath(w, here);
          if (p) changes.add(p);
          const a = staged(w) ? null : absPage(w, here);
          if (a) pagePaths.add(a);
        }
        for (const w of use.reads) {
          const p = staged(w) ? null : shellPath(w, here);
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
      const pageList = [...pagePaths].slice(0, CANDIDATES_MAX);
      if (
        filingsHere.length === 0 &&
        read.length === 0 &&
        changed.length === 0 &&
        pageList.length === 0 &&
        cwd === before
      )
        return;
      setPending(id, {
        kind: 'bash',
        filings: filingsHere,
        reads: read,
        changes: changed,
        shell,
        cwd,
        pagePaths: pageList,
        startedAt: Date.now(),
        history,
      });
    } else if (name === 'WebFetch' && okLink(input.url)) {
      setPending(id, { kind: 'web', url: input.url });
    } else if (name === 'Artifact') {
      const publish = artifactPublish(input);
      if (publish) setPending(id, { kind: 'page', publish, history });
    }
  }

  function pageKeyOf(located: string): string {
    return createHash('sha256').update(`page:${located}`).digest('base64url').slice(0, 22);
  }

  function queuePage(job: () => Promise<void>): void {
    pageQueue = pageQueue.then(job).catch(() => {});
  }

  async function drainPages(): Promise<void> {
    for (;;) {
      const at = pageQueue;
      await at;
      if (at === pageQueue) return;
    }
  }

  function newPage(located: string, filePath: string): PageRec {
    const page: PageRec = {
      key: pageKeyOf(located),
      url: null,
      filePath,
      versions: [],
      nextN: 1,
      draft: null,
      remote: null,
      live: false,
      multiFile: false,
      toolUseIds: [],
      order: 0,
    };
    pages.set(page.key, page);
    pagesByPath.set(located, page);
    while (pages.size > CHAT_PAGES_MAX) {
      let oldest: PageRec | null = null;
      for (const p of pages.values()) if (p !== page && (!oldest || p.order < oldest.order)) oldest = p;
      if (!oldest) break;
      pages.delete(oldest.key);
      for (const [path, p] of pagesByPath) if (p === oldest) pagesByPath.delete(path);
    }
    return page;
  }

  function dropEvicted(evicted: EvictedCopies): void {
    for (const e of evicted) {
      const p = pages.get(e.key);
      for (const v of p?.versions ?? []) if (v.id === e.id) v.hasCopy = false;
    }
  }

  /** Tool use `id` changed the page (or published it): the latest touch since the last boundary. */
  function touchPage(
    page: PageRec,
    id: string,
    filePath: string,
    history: boolean,
    copied: { title: string } | null,
    title: string | null,
  ): void {
    page.filePath = filePath;
    page.order = ++counter;
    if (!page.toolUseIds.includes(id)) page.toolUseIds.push(id);
    if (page.toolUseIds.length > CHAT_FILE_TOOL_IDS_MAX)
      page.toolUseIds.splice(0, page.toolUseIds.length - CHAT_FILE_TOOL_IDS_MAX);
    page.draft = {
      id,
      at: history ? null : now().toISOString(),
      filePath,
      hasCopy: copied !== null,
      title: copied?.title || title,
    };
    pagesDirty = true;
  }

  async function pageWritten(id: string, w: PageWrite): Promise<void> {
    const located = await port.locate(w.filePath);
    if (!located) return;
    const known = pagesByPath.get(located) ?? null;
    const key = known?.key ?? pageKeyOf(located);
    // Live: the file as it is now is exactly what this write left.
    const copied = w.history ? null : await port.draft(key, id, w.filePath, known === null);
    let isPage: boolean;
    if (known) isPage = true;
    else if (copied) isPage = copied.page;
    else if (w.writeIsPage !== null) isPage = w.writeIsPage;
    else if (!w.history) isPage = false;
    else {
      // An edit from history: the file as it is now or, when that no longer says so (the source is
      // gone), a copy live kept under this tool use, so replay finds the page the live chat had.
      const held = (await port.held(key, id).catch(() => null)) !== null;
      isPage = held || (w.heldOnly !== true && (await port.isPage(w.filePath)) === true);
    }
    if (!isPage) return;
    const page = known ?? newPage(located, w.filePath);
    touchPage(page, id, w.filePath, w.history, copied, w.writeTitle);
  }

  async function pagePublished(
    id: string,
    publish: ArtifactPublish,
    history: boolean,
    done: { url: string; remote: number | null },
  ): Promise<void> {
    const located = (await port.locate(publish.filePath)) ?? resolvePath(publish.filePath);
    const at = pageUrlKey(done.url);
    const byUrl = (url: string | null) =>
      url ? [...pages.values()].find((p) => p.url !== null && p.url === pageUrlKey(url)) : undefined;
    let page = pagesByPath.get(located) ?? byUrl(at) ?? byUrl(publish.updatesUrl);
    if (!page) page = newPage(located, publish.filePath);
    else if (!pagesByPath.has(located)) pagesByPath.set(located, page);
    page.url = at;
    page.remote = done.remote;
    // claude.ai keeps a page's capabilities and files on a redeploy that leaves them out.
    page.live ||= publish.live;
    page.multiFile ||= publish.multiFile;
    const copied = history ? null : await port.draft(page.key, id, publish.filePath, false);
    touchPage(page, id, publish.filePath, history, copied, null);
  }

  async function closePages(history: boolean): Promise<void> {
    for (const page of pages.values()) {
      const d = page.draft;
      if (!d) continue;
      page.draft = null;
      const v: PageVersionRec = {
        n: page.nextN++,
        id: d.id,
        remote: page.remote,
        at: d.at,
        filePath: d.filePath,
        hasCopy: false,
        title: d.title,
        checked: false,
        tried: false,
      };
      page.remote = null;
      if (!history && d.hasCopy) {
        const kept = await port.keep(page.key, d.id).catch(() => null);
        if (kept) {
          v.hasCopy = v.checked = v.tried = true;
          dropEvicted(kept.evicted);
        }
      }
      page.versions.push(v);
      if (page.versions.length > PAGE_VERSIONS_MAX)
        page.versions.splice(0, page.versions.length - PAGE_VERSIONS_MAX);
      pagesDirty = true;
    }
  }

  /**
   * Asks the disk about versions not yet looked up (a kept copy, or an in-progress copy left by a
   * stop, which is exactly that version), and copies a page's newest version from its source when it
   * has no copy and nothing has touched the page since (it would get later content otherwise).
   */
  async function settlePageCopies(): Promise<void> {
    for (const page of pages.values()) {
      for (const v of page.versions) {
        if (v.checked) continue;
        v.checked = true;
        let got = await port.held(page.key, v.id).catch(() => null);
        if (!got && (await port.keep(page.key, v.id).catch(() => null))) {
          got = await port.held(page.key, v.id).catch(() => null);
        }
        if (got) {
          v.hasCopy = true;
          v.title = got.title || v.title;
          v.tried = true;
        }
      }
      const newest = page.versions.at(-1);
      if (newest && !newest.hasCopy && !newest.tried && !page.draft) {
        newest.tried = true;
        const got = await port.copy(page.key, newest.id, newest.filePath).catch(() => null);
        if (got) {
          newest.hasCopy = true;
          newest.title = got.title || newest.title;
          dropEvicted(got.evicted);
        }
      }
    }
  }

  async function settlePages(): Promise<void> {
    queuePage(settlePageCopies);
    await drainPages();
  }

  function pageTitleOf(page: PageRec): string {
    if (page.draft?.title) return page.draft.title;
    for (let i = page.versions.length - 1; i >= 0; i--) {
      const t = page.versions[i]?.title;
      if (t) return t;
    }
    return pageTitle('', page.filePath);
  }

  function listPages(found: Map<string, Resolved>): ChatPage[] {
    return [...pages.values()]
      .filter((p) => p.versions.length > 0 || p.draft !== null)
      .sort((a, b) => b.order - a.order)
      .slice(0, CHAT_PAGES_MAX)
      .map((p) => {
        const rel = normalise(p.filePath);
        const r = rel ? found.get(rel) : null;
        return {
          key: p.key,
          title: pageTitleOf(p),
          url: p.url,
          versions: p.versions.map((v) => ({ n: v.n, remote: v.remote, at: v.at, hasCopy: v.hasCopy })),
          draft: p.draft !== null,
          fileKey: r?.item ? r.key : null,
          live: p.live,
          multiFile: p.multiFile,
          toolUseIds: [...p.toolUseIds],
          order: p.order,
        };
      });
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

  function toolResult(id: string, failed: boolean, content: unknown): void {
    const w = pageWrites.get(id);
    if (w) {
      pageWrites.delete(id);
      if (!failed) queuePage(() => pageWritten(id, w));
    }
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (failed) return;
    if (p.kind === 'page') {
      const done = artifactPublishResult(content);
      const { publish, history } = p;
      if (done) queuePage(() => pagePublished(id, publish, history, done));
    } else if (p.kind === 'web') {
      addLink(p.url);
    } else if (p.kind === 'bash') {
      // The shell keeps a folder only when the command worked.
      cwds.set(p.shell, p.cwd);
      // Shell words are guesses: each page word goes through Write's own checks, but only when the
      // command touched the file (its modified time is not before the command started).
      for (const filePath of p.pagePaths) {
        const { startedAt, history } = p;
        queuePage(async () => {
          if (history) {
            // Replay: no time check. A page comes back only if live kept a copy under this tool use.
            await pageWritten(id, {
              filePath,
              writeIsPage: null,
              writeTitle: null,
              history: true,
              heldOnly: true,
            });
            return;
          }
          const at = await modified(filePath);
          if (at === null || at < startedAt - MTIME_SLACK_MS) return;
          await pageWritten(id, { filePath, writeIsPage: null, writeTitle: null, history: false });
        });
      }
      if (p.filings.length === 0 && p.reads.length === 0 && p.changes.length === 0) return;
      const order = ++counter;
      for (const f of p.filings) filings.push({ ...f, order });
      if (p.reads.length > 0 || p.changes.length > 0) {
        sightings.push({ kind: 'shell', reads: p.reads, changes: p.changes, toolUseId: id, order });
      }
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
    const seen = sightings.splice(0);
    const pageRels = [...pages.values()].flatMap((p) => {
      const rel = normalise(p.filePath);
      return rel ? [rel] : [];
    });
    const wanted = [
      ...new Set([
        ...paths,
        ...pageRels,
        ...filed.flatMap((f) => f.candidates),
        ...seen.flatMap((s) => (s.kind === 'shell' ? [...s.reads, ...s.changes] : s.tiers.flat())),
      ]),
    ];
    try {
      await settlePages();
      // Everything queued so far is in this listing.
      pagesDirty = false;
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
    const listed = listPages(found);
    // A page's own address is shown as the page, not again as a web link.
    const pageUrls = new Set(listed.flatMap((p) => (p.url ? [pageUrlKey(p.url)] : [])));
    const snap: ChatFilesSnapshot = {
      files,
      attachments: attachments.map((a) => ({
        name: a.name,
        kind: a.kind,
        filedKey: a.filedKey && shown.has(a.filedKey) ? a.filedKey : null,
      })),
      links: [...links.keys()]
        .reverse()
        .filter((url) => !pageUrls.has(pageUrlKey(url)))
        .slice(0, CHAT_LINKS_MAX)
        .map((url) => ({ url })),
    };
    // Left out for a chat with none, so it looks exactly as before.
    if (listed.length > 0) snap.pages = listed;
    return snap;
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
              toolResult(b.tool_use_id, b.is_error === true, b.content);
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
      if (!dirty) {
        // Page work still queued (a write's copy, a boundary) may be what this snapshot is for.
        await drainPages();
        if (!dirty && !pagesDirty) return null;
      }
      dirty = false;
      try {
        return await build();
      } catch {
        dirty = true;
        return null;
      }
    },

    boundary(o) {
      const history = o?.history === true;
      queuePage(() => closePages(history));
    },

    settled() {
      return drainPages();
    },

    page(key) {
      const p = typeof key === 'string' ? pages.get(key) : undefined;
      if (!p || (p.versions.length === 0 && !p.draft)) return null;
      return {
        title: pageTitleOf(p),
        url: p.url,
        filePath: p.filePath,
        draft: p.draft ? { id: p.draft.id, hasCopy: p.draft.hasCopy } : null,
        versions: p.versions.map((v) => ({ n: v.n, id: v.id, hasCopy: v.hasCopy })),
      };
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
