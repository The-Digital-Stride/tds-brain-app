/**
 * One to-do's history (plan 2026-11-16-asked-of-others, decisions 5 and 6): one read-only `git log -p
 * -U0` over the to-do's three possible paths, turned into TodoEvents. No rename following: a tick shows
 * as a D of `todo/<id>` and an A of `todo/done/<id>` in one commit, which is read as a move. Keys are
 * checked and the file must be a real file before git runs; git trouble is 'unavailable', never a throw.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type AskedTodoList,
  type Identity,
  type TeamMember,
  TODO_HISTORY_MAX,
  type TodoActor,
  TodoChangeError,
  type TodoEvent,
  type TodoEventKind,
  type TodoHistoryResponse,
} from '../../shared/contract.ts';
import { asString, type FrontmatterValue, parseFrontmatter } from './frontmatter.ts';
import { type Member, readMembers } from './identity.ts';
import type { ProjectsIndex } from './projects.ts';
import { GIT_MAX_PARALLEL, type GitLogRunner, runGit } from './todo-history.ts';
import { todoChangeError } from './todo-skill.ts';
import {
  authorSlug,
  dueOf,
  lower,
  readTaskIndex,
  readTeam,
  SAFE_ID,
  taskRule,
  usableIndex,
} from './todos.ts';
import { readBytes } from './util.ts';

export const HISTORY_MAX_OUTPUT = 512 * 1024;
const KEY_MAX = 255;
const BAD_KEY = "That task wasn't understood.";

export type HistoryKey =
  | { kind: 'personal'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'asked'; id: string; folder: 'todo' | 'done' };
// `done:` keys map onto these: `done:todo/done/<id>` is an asked-style done-folder key, and
// `done:personal/todo/done/<id>` an ordinary personal one (no git history).

/** `^(personal/)?<SAFE_ID>$`, `^asked:todo/(done/)?<SAFE_ID>$` or `^done:(personal/)?todo/done/<SAFE_ID>$`; anything else is null. */
export function parseHistoryKey(key: unknown): HistoryKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > KEY_MAX + 20) return null;
  const ok = (id: string) => id.length <= KEY_MAX && SAFE_ID.test(id);
  const asked = /^asked:todo\/(done\/)?([^/]+)$/.exec(key);
  if (asked) {
    const id = asked[2] ?? '';
    return ok(id) ? { kind: 'asked', id, folder: asked[1] ? 'done' : 'todo' } : null;
  }
  const done = /^done:(personal\/)?todo\/done\/([^/]+)$/.exec(key);
  if (done) {
    const id = done[2] ?? '';
    if (!ok(id)) return null;
    return done[1] ? { kind: 'personal', id } : { kind: 'asked', id, folder: 'done' };
  }
  if (key.startsWith('personal/')) {
    const id = key.slice('personal/'.length);
    return ok(id) ? { kind: 'personal', id } : null;
  }
  return ok(key) ? { kind: 'item', id: key } : null;
}

/** The git arguments; the id has already been checked against SAFE_ID. */
export function historyArgs(id: string): string[] {
  return [
    'log',
    '--no-renames',
    '--no-follow',
    '--no-merges',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-p',
    '-U0',
    '-n',
    String(TODO_HISTORY_MAX + 1),
    '--format=%x1e%an%x00%ae%x00%aI',
    '--',
    `todo/${id}`,
    `todo/done/${id}`,
    `todo/deleted/${id}`,
  ];
}

// ---------------------------------------------------------------------------
// Parsing `git log -p -U0`
// ---------------------------------------------------------------------------

interface Author {
  name: string;
  email: string;
  at: string;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newCount: number;
  removed: string[];
  added: string[];
}

interface FileDiff {
  path: string;
  status: 'A' | 'D' | 'M';
  hunks: Hunk[];
  /** False for a binary change or a hunk that didn't read cleanly: its text isn't known. */
  readable: boolean;
}

interface Commit {
  author: Author;
  diffs: FileDiff[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF = /^diff --git a\/(\S+) b\/(\S+)$/;

function parseCommit(record: string): Commit | null {
  const lines = record.split('\n');
  const [name, email, at] = (lines[0] ?? '').split('\0');
  if (!name || !at || Number.isNaN(Date.parse(at))) return null;
  const author: Author = { name: name.trim(), email: (email ?? '').trim(), at: at.trim() };
  const diffs: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of lines.slice(1)) {
    if (line.startsWith('diff --git ')) {
      const m = DIFF.exec(line);
      file = m ? { path: m[2] ?? '', status: 'M', hunks: [], readable: true } : null;
      if (file) diffs.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith('-') && oldLeft > 0) {
        hunk.removed.push(line.slice(1));
        oldLeft -= 1;
      } else if (line.startsWith('+') && newLeft > 0) {
        hunk.added.push(line.slice(1));
        newLeft -= 1;
      } else if (!line.startsWith('\\')) {
        file.readable = false;
        hunk = null;
      }
      continue;
    }
    if (line.startsWith('new file mode')) file.status = 'A';
    else if (line.startsWith('deleted file mode')) file.status = 'D';
    else if (line.startsWith('Binary files ')) file.readable = false;
    else if (line.startsWith('@@ ')) {
      const m = HUNK.exec(line);
      if (!m) {
        file.readable = false;
        continue;
      }
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      hunk = { oldStart: Number(m[1]), oldCount: oldLeft, newCount: newLeft, removed: [], added: [] };
      file.hunks.push(hunk);
    }
  }
  for (const d of diffs)
    if (d.hunks.some((h) => h.removed.length !== h.oldCount || h.added.length !== h.newCount))
      d.readable = false;
  return { author, diffs };
}

/** Whole commits only: a cut log loses its last (half) record; past TODO_HISTORY_MAX is `more`. */
export function parseHistoryLog(stdout: string, cut: boolean): { commits: Commit[]; more: boolean } {
  let records = stdout.split('\x1e').slice(1);
  let more = cut;
  if (cut) records.pop();
  if (records.length > TODO_HISTORY_MAX) {
    more = true;
    records = records.slice(0, TODO_HISTORY_MAX);
  }
  const commits: Commit[] = [];
  for (const r of records) {
    const c = parseCommit(r);
    if (c) commits.push(c);
  }
  return { commits, more };
}

// ---------------------------------------------------------------------------
// Commits → events
// ---------------------------------------------------------------------------

type Folder = 'todo' | 'done' | 'deleted';

function folderOf(path: string): Folder {
  if (path.startsWith('todo/done/')) return 'done';
  if (path.startsWith('todo/deleted/')) return 'deleted';
  return 'todo';
}

/** The whole text of an added (A) or removed (D) file. */
const wholeText = (d: FileDiff, side: 'added' | 'removed'): string[] | null =>
  d.readable ? d.hunks.flatMap((h) => h[side]) : null;

/** Applies -U0 hunks to the known text, checking every removed line; null when they don't fit. */
function applyHunks(before: string[], hunks: Hunk[]): string[] | null {
  const out: string[] = [];
  let pos = 0;
  for (const h of hunks) {
    const start = h.oldCount === 0 ? h.oldStart : h.oldStart - 1;
    if (start < pos || start + h.oldCount > before.length) return null;
    out.push(...before.slice(pos, start));
    for (let i = 0; i < h.oldCount; i++) if (before[start + i] !== h.removed[i]) return null;
    out.push(...h.added);
    pos = start + h.oldCount;
  }
  out.push(...before.slice(pos));
  return out;
}

type Data = Record<string, FrontmatterValue>;
const KEY_LINE = /^[A-Za-z0-9_-]+\s*:/;
/** Lines the app and the skill write alongside another change; never an event of their own. */
const STAMP_KEY = /^(assigned_|completed|deleted_|created_by$|created_at$|status$)/;

// ---------------------------------------------------------------------------
// The `## Updates` log (task updates plan, decision 10): the script appends one line per action and the
// Updates list shows them properly, so a commit that only added log lines (or a `created_at` line) is no
// History event, and in a mixed commit the log lines never make a 'details' event of their own.
// ---------------------------------------------------------------------------

const UPDATES_HEADING = /^##\s+updates\s*$/i;
const ANY_HEADING = /^#{1,2}\s/;
const FENCE = /^\s*(```|~~~)/;
/** The start of one log entry: `- 27 Nov 2026, 14:05 UK: `. */
const LOG_ENTRY = /^- \d{1,2} [A-Za-z]{3} \d{4}, \d{1,2}:\d{2} UK: /;

/** A body without its `## Updates` section(s), outside code fences. */
function withoutUpdates(body: string): string {
  const kept: string[] = [];
  let fenced = false;
  let inLog = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (!fenced && ANY_HEADING.test(line)) inLog = UPDATES_HEADING.test(line);
    if (!inLog) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Changed lines (from hunks that don't say where they sit) without the log's: the `## Updates` heading,
 * entry lines and their two-space continuation lines. Everything else stays.
 */
function withoutLogLines(lines: string[]): string[] {
  const kept: string[] = [];
  let inLog = false;
  for (const line of lines) {
    if (UPDATES_HEADING.test(line) || LOG_ENTRY.test(line)) inLog = true;
    else if (!(inLog && /^ {2}\S/.test(line))) {
      inLog = false;
      kept.push(line);
    }
  }
  return kept;
}

/** `key: value` lines read as frontmatter on their own. */
const keyData = (lines: string[]): Data =>
  parseFrontmatter(['---', ...lines.filter((l) => KEY_LINE.test(l)), '---'].join('\n')).data;

type Change = Omit<TodoEvent, 'actor'>;

function compare(before: Data, after: Data, detailsChanged: boolean): Change[] {
  const changes: Change[] = [];
  const fromAssignee = lower(before.assignee) || 'open';
  const toAssignee = lower(after.assignee) || 'open';
  if (fromAssignee !== toAssignee) changes.push({ kind: 'passed-on', from: fromAssignee, to: toAssignee });
  const fromTitle = asString(before.title).trim() || null;
  const toTitle = asString(after.title).trim() || null;
  if (fromTitle !== toTitle) changes.push({ kind: 'retitled', from: fromTitle, to: toTitle });
  const fromDue = dueOf(before);
  const toDue = dueOf(after);
  if (fromDue !== toDue) changes.push({ kind: 'due', from: fromDue, to: toDue });
  if (detailsChanged) changes.push({ kind: 'details' });
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'assignee' || k === 'title' || k === 'due' || STAMP_KEY.test(k)) continue;
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      changes.push({ kind: 'changed' });
      break;
    }
  }
  return changes;
}

/** What an edit (M) changed: from the whole text when it is known, else from the hunks' own lines. */
function editChanges(before: string[] | null, diff: FileDiff): { changes: Change[]; after: string[] | null } {
  const after = before && diff.readable ? applyHunks(before, diff.hunks) : null;
  if (before && after) {
    const b = parseFrontmatter(before.join('\n'));
    const a = parseFrontmatter(after.join('\n'));
    const detailsChanged = withoutUpdates(b.body).trim() !== withoutUpdates(a.body).trim();
    return { changes: compare(b.data, a.data, detailsChanged), after };
  }
  const removed = diff.hunks.flatMap((h) => withoutLogLines(h.removed));
  const added = diff.hunks.flatMap((h) => withoutLogLines(h.added));
  const isDetail = (l: string) => !KEY_LINE.test(l) && l.trim() !== '' && l.trim() !== '---';
  const details = removed.some(isDetail) || added.some(isDetail);
  return { changes: compare(keyData(removed), keyData(added), details), after: null };
}

/** The stamp lines this commit added (lines in its + side that its − side doesn't have). */
function addedStamps(diffs: FileDiff[]): Data {
  const minus = new Set(diffs.flatMap((d) => d.hunks.flatMap((h) => h.removed)));
  return keyData(diffs.flatMap((d) => d.hunks.flatMap((h) => h.added)).filter((l) => !minus.has(l)));
}

interface Roster {
  team: TeamMember[];
  members: Member[];
}

const rosterName = (team: TeamMember[], slug: string) => team.find((m) => m.slug === slug)?.name ?? null;
const validTime = (at: string) => at !== '' && !Number.isNaN(Date.parse(at));

/** Which stamp names the actor for the commit's main change. */
const ACTOR_STAMPS: [TodoEventKind, string, string | null][] = [
  ['done', 'completed_by', 'completed_at'],
  ['deleted', 'deleted_by', 'deleted_at'],
  ['created', 'created_by', null],
  ['passed-on', 'assigned_by', 'assigned_at'],
];

function commitActor(commit: Commit, kinds: TodoEventKind[], roster: Roster): TodoActor {
  const stamps = addedStamps(commit.diffs);
  for (const [kind, byKey, atKey] of ACTOR_STAMPS) {
    if (!kinds.includes(kind)) continue;
    const by = lower(stamps[byKey]);
    if (!by) break;
    const stampAt = atKey ? asString(stamps[atKey]).trim() : '';
    const name = rosterName(roster.team, by);
    return {
      slug: name === null ? null : by,
      name: name ?? by,
      at: validTime(stampAt) ? stampAt : commit.author.at,
      source: 'stamp',
    };
  }
  const slug = authorSlug(roster.members, roster.team, commit.author);
  return {
    slug,
    name: (slug ? rosterName(roster.team, slug) : null) ?? (commit.author.name || null),
    at: commit.author.at,
    source: 'history',
  };
}

const ORDER: TodoEventKind[] = [
  'created',
  'done',
  'deleted',
  'passed-on',
  'retitled',
  'due',
  'details',
  'changed',
];

/** The events, newest first, from commits git printed newest first. */
export function historyEvents(commits: Commit[], roster: Roster): TodoEvent[] {
  const text = new Map<string, string[] | null>();
  const perCommit: TodoEvent[][] = [];
  let seen = false;
  for (const commit of [...commits].reverse()) {
    const adds = commit.diffs.filter((d) => d.status === 'A');
    const dels = commit.diffs.filter((d) => d.status === 'D');
    let changes: Change[] = [];
    const add = adds[0];
    const del = dels[0];
    if (add) {
      const dest = folderOf(add.path);
      if (dest === 'done') changes = [{ kind: 'done' }];
      else if (dest === 'deleted') changes = [{ kind: 'deleted' }];
      else if (del || seen) changes = [{ kind: 'changed' }];
      else {
        const content = wholeText(add, 'added');
        const assignee = content ? lower(parseFrontmatter(content.join('\n')).data.assignee) : '';
        changes = [{ kind: 'created', to: assignee || 'open' }];
      }
    } else if (del) {
      // Removed outright. A purge from deleted/ is not a new event.
      if (folderOf(del.path) !== 'deleted') changes = [{ kind: 'deleted' }];
    }
    // Keep each path's text up to date for the next commit; an edit's changes count only on their own.
    for (const d of commit.diffs) {
      if (d.status === 'D') text.delete(d.path);
      else if (d.status === 'A') text.set(d.path, wholeText(d, 'added'));
      else {
        const edit = editChanges(text.get(d.path) ?? null, d);
        text.set(d.path, edit.after);
        if (!add && !del) changes.push(...edit.changes);
      }
    }
    if (commit.diffs.length > 0) seen = true;
    if (changes.length === 0) continue;
    const kinds = changes.map((c) => c.kind);
    const actor = commitActor(commit, kinds, roster);
    const unique = new Map<TodoEventKind, Change>();
    for (const c of changes) if (!unique.has(c.kind)) unique.set(c.kind, c);
    perCommit.push(
      [...unique.values()]
        .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
        .map((c) => ({ ...c, actor })),
    );
  }
  return perCommit.reverse().flat();
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/** Whether `path` is a regular file, not a link and not missing. */
async function isRealFile(path: string): Promise<boolean> {
  try {
    const st = await fs.lstat(path);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The to-do's file must exist (as a real file) where its key says, before git is asked anything. Its path, or null. */
async function keyFile(root: string, key: HistoryKey): Promise<string | null> {
  const { id } = key;
  const places =
    key.kind === 'personal'
      ? [join(root, 'personal', 'todo', id), join(root, 'personal', 'todo', 'done', id)]
      : key.kind === 'asked'
        ? [key.folder === 'done' ? join(root, 'todo', 'done', id) : join(root, 'todo', id)]
        : // A TodoItem key ticked since lives in done/ now.
          [join(root, 'todo', id), join(root, 'todo', 'done', id)];
  for (const p of places) if (await isRealFile(p)) return p;
  return null;
}

const UNAVAILABLE: TodoHistoryResponse = { status: 'unavailable', events: [], more: false };

/** What a history read may use to apply THE task rule. Both optional: without them, as before. */
export interface TodoTimelineDeps {
  /** The projects index (S1 wiring: `projects.index()`). */
  projects?: () => Promise<ProjectsIndex>;
  /** This person's Asked list, so a hidden project's task they asked for still opens from there. */
  asked?: (identity: Identity) => Promise<AskedTodoList>;
}

/**
 * THE task rule for a TDS task's history (plan 2026-11-27, decision 6): served only when the task is
 * served to this person: assigned to them, or (an Asked key) on their Asked list.
 */
async function mayOpen(
  path: string,
  key: HistoryKey,
  identity: Identity,
  deps: TodoTimelineDeps,
): Promise<boolean> {
  const read = await readTaskIndex(deps.projects);
  if (read === null) return true;
  const bytes = await readBytes(path);
  if (bytes === null) return false;
  const { data } = parseFrontmatter(bytes.toString('utf8'));
  const project = asString(data.project).trim() || null;
  const client = asString(data.client).trim() || null;
  const written = lower(data.assignee);
  const mine = identity.slug !== '' && written === identity.slug;
  const projectMatch = usableIndex(read)?.resolve(project, client, 'tds');
  if (taskRule(read, { project, projectMatch }, mine) !== 'hide') return true;
  if (key.kind !== 'asked' || !deps.asked) return false;
  const state = key.folder === 'done' ? 'done' : 'waiting';
  try {
    const list = await deps.asked(identity);
    return [...list.waiting, ...list.done].some((t) => t.id === key.id && t.state === state);
  } catch {
    return false;
  }
}

export interface TodoTimeline {
  history(
    root: string,
    key: string,
    identity: Identity,
    deps?: TodoTimelineDeps,
  ): Promise<TodoHistoryResponse>;
}

export function createTodoTimeline(run: GitLogRunner = runGit): TodoTimeline {
  const cache = new Map<string, Promise<TodoHistoryResponse>>();
  let active = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= GIT_MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await job();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  const read = async (root: string, id: string): Promise<TodoHistoryResponse> => {
    const out = await slot(() => run(historyArgs(id), root, { maxOutput: HISTORY_MAX_OUTPUT }));
    const { commits, more } = parseHistoryLog(out.stdout, out.cut);
    const [team, members] = await Promise.all([readTeam(root), readMembers(root)]);
    return { status: 'ok', events: historyEvents(commits, { team, members }), more };
  };

  return {
    async history(root, rawKey, identity, deps = {}) {
      const key = parseHistoryKey(rawKey);
      if (!key) throw new TodoChangeError('bad-request', BAD_KEY);
      const path = await keyFile(root, key);
      if (path === null) throw todoChangeError('not-found');
      if (key.kind === 'personal') return { status: 'personal', events: [], more: false };
      // A hidden project's task that isn't served to this person is answered as one that isn't there.
      if (!(await mayOpen(path, key, identity, deps))) throw todoChangeError('not-found');
      let head: string;
      try {
        head = (await run(['rev-parse', 'HEAD'], root)).stdout.trim();
      } catch {
        return UNAVAILABLE;
      }
      if (!/^[0-9a-f]{40,64}$/.test(head)) return UNAVAILABLE;
      const cacheKey = `${root}\0${key.id}\0${head}`;
      let hit = cache.get(cacheKey);
      if (!hit) {
        if (cache.size >= 500) cache.clear();
        hit = read(root, key.id);
        cache.set(cacheKey, hit);
      }
      try {
        return await hit;
      } catch {
        // Not kept: the next open tries again.
        if (cache.get(cacheKey) === hit) cache.delete(cacheKey);
        return UNAVAILABLE;
      }
    },
  };
}
