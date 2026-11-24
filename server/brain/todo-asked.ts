/**
 * "Asked of others" (plan 2026-11-16-asked-of-others, decisions 2–4): the TDS to-dos this person passed
 * on that someone else has or has finished. Reads `todo/` and `todo/done/` on every call, plus one
 * read-only `git log` over `todo/`, parsed once per HEAD commit. Writes nothing.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  ASKED_DONE_DAYS,
  type AskedTodo,
  type AskedTodoList,
  type Identity,
  type TeamMember,
  type TodoActor,
} from '../../shared/contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { type Member, readMembers } from './identity.ts';
import type { ProjectsIndex } from './projects.ts';
import { type GitLogRunner, runGit } from './todo-history.ts';
import {
  authorSlug,
  createAttachmentReader,
  dueOf,
  isSelf,
  lower,
  readTeam,
  SAFE_ID,
  surfaceDate,
  todoTitle,
} from './todos.ts';
import { readBytes } from './util.ts';

export const ASKED_LOG_MAX_OUTPUT = 2 * 1024 * 1024;
export const ASKED_LOG_TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;

/** One commit author, as the log prints them. */
interface Author {
  name: string;
  email: string;
  at: string;
}

/** What the log says about one file name. */
export interface LogFacts {
  /** The newest commit that added or changed `todo/<id>`'s `assignee:` line (never a D: the tick). */
  ask: Author | null;
  /** The newest commit that added `todo/done/<id>` (with an `assignee:` line). */
  doneAdd: Author | null;
}

type ParsedLog = Map<string, LogFacts>;

/**
 * Every commit whose diff adds or removes an `assignee:` line under `todo/`, with only those files
 * listed. The move to `done/` adds one, so the same run gives the tick's commit too.
 */
export function askedLogArgs(): string[] {
  return [
    'log',
    '--no-renames',
    '--no-follow',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '-G',
    '^assignee:',
    '--name-status',
    '--format=%x1e%an%x00%ae%x00%aI',
    '--',
    'todo',
  ];
}

/**
 * Every commit that added a file to `todo/done/`, with only those files listed: the tick's commit for
 * the Done list (done-todos plan, decision 2). Unlike `askedLogArgs` it doesn't need an `assignee:` line,
 * so a to-do that was open to anyone is found too.
 */
export function doneLogArgs(): string[] {
  return [
    'log',
    '--no-renames',
    '--no-follow',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--diff-filter=A',
    '--name-status',
    '--format=%x1e%an%x00%ae%x00%aI',
    '--',
    'todo/done',
  ];
}

const TOP = /^todo\/([^/]+)$/;
const DONE = /^todo\/done\/([^/]+)$/;

export function parseAskedLog(stdout: string): ParsedLog {
  const facts: ParsedLog = new Map();
  const get = (id: string): LogFacts => {
    let f = facts.get(id);
    if (!f) {
      f = { ask: null, doneAdd: null };
      facts.set(id, f);
    }
    return f;
  };
  // Newest first, so the first entry seen for a file is its newest.
  for (const record of stdout.split('\x1e')) {
    const lines = record.split('\n');
    const [name, email, at] = (lines[0] ?? '').split('\0');
    if (!name || !at || Number.isNaN(Date.parse(at))) continue;
    const author: Author = { name: name.trim(), email: (email ?? '').trim(), at: at.trim() };
    for (const line of lines.slice(1)) {
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      const status = line.slice(0, tab).trim();
      const path = line.slice(tab + 1).trim();
      const top = TOP.exec(path);
      if (top?.[1] && (status === 'A' || status === 'M')) {
        const f = get(top[1]);
        if (!f.ask) f.ask = author;
        continue;
      }
      const done = DONE.exec(path);
      if (done?.[1] && status === 'A') {
        const f = get(done[1]);
        if (!f.doneAdd) f.doneAdd = author;
      }
    }
  }
  return facts;
}

interface TodoFile {
  id: string;
  state: AskedTodo['state'];
  data: Record<string, string | string[]>;
  body: string;
  version: string;
  mtime: string;
}

async function readTodoFiles(root: string, state: AskedTodo['state']): Promise<TodoFile[]> {
  const dir = state === 'done' ? join(root, 'todo', 'done') : join(root, 'todo');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: TodoFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !SAFE_ID.test(e.name) || e.name === 'AGENTS.md' || e.name === 'README.md') continue;
    if (e.name === 'CLAUDE.md') continue;
    const path = join(dir, e.name);
    const bytes = await readBytes(path);
    if (bytes === null) continue;
    const { data, body } = parseFrontmatter(bytes.toString('utf8'));
    let mtime = '';
    try {
      mtime = (await fs.stat(path)).mtime.toISOString();
    } catch {
      // Gone since the listing: the version and text above still stand.
    }
    files.push({
      id: e.name,
      state,
      data,
      body,
      version: createHash('sha256').update(bytes).digest('hex'),
      mtime,
    });
  }
  return files;
}

export interface Roster {
  team: TeamMember[];
  members: Member[];
}

export const rosterName = (team: TeamMember[], slug: string) =>
  team.find((m) => m.slug === slug)?.name ?? null;

/** A slug a stamp wrote: matched to the roster where it can be, else kept as written. */
export function stampActor(team: TeamMember[], written: string, at: string): TodoActor {
  const slug = written.toLowerCase();
  const name = rosterName(team, slug);
  return { slug: name === null ? null : slug, name: name ?? (written || null), at, source: 'stamp' };
}

export function historyActor(roster: Roster, author: Author): TodoActor {
  const slug = authorSlug(roster.members, roster.team, author);
  return {
    slug,
    name: (slug ? rosterName(roster.team, slug) : null) ?? (author.name || null),
    at: author.at,
    source: 'history',
  };
}

/**
 * Decision 2: who passed it on (null when no one can be named), and whether that is this person:
 * a stamp's slug, or a git author matched by email then name (by email alone when not on the roster).
 */
function whoAsked(
  file: TodoFile,
  assignee: string,
  facts: LogFacts | null,
  roster: Roster,
  identity: Identity,
): { actor: TodoActor; self: boolean } | null {
  const { data } = file;
  const to = lower(data.assigned_to);
  const at = asString(data.assigned_at).trim();
  if (to && at && to === assignee) {
    const by = lower(data.assigned_by);
    if (!by) return null;
    return { actor: stampActor(roster.team, by, at), self: by === identity.slug };
  }
  if (facts?.ask) {
    const actor = historyActor(roster, facts.ask);
    return { actor, self: isSelf(actor.slug, facts.ask.email, identity) };
  }
  const createdBy = lower(data.created_by);
  if (createdBy && !to) {
    const created = asString(data.created).trim();
    const actor = stampActor(roster.team, createdBy, created || surfaceDate(file.id) || file.mtime);
    return { actor, self: createdBy === identity.slug };
  }
  return null;
}

/** Decision 3: who finished it. */
function whoFinished(file: TodoFile, facts: LogFacts | null, roster: Roster): TodoActor {
  const { data } = file;
  const completed = asString(data.completed).trim();
  const by = lower(data.completed_by);
  if (by) {
    const at = asString(data.completed_at).trim() || completed || facts?.doneAdd?.at || file.mtime;
    return stampActor(roster.team, by, at);
  }
  if (facts?.doneAdd) return historyActor(roster, facts.doneAdd);
  return { slug: null, name: null, at: completed || file.mtime, source: 'stamp' };
}

const time = (at: string) => Date.parse(at);

function byAskedOldest(a: AskedTodo, b: AskedTodo): number {
  const d = (time(a.asked.at) || 0) - (time(b.asked.at) || 0);
  return d !== 0 ? d : a.id.localeCompare(b.id);
}

function byDoneNewest(a: AskedTodo, b: AskedTodo): number {
  const d = (time(b.done?.at ?? '') || 0) - (time(a.done?.at ?? '') || 0);
  return d !== 0 ? d : a.id.localeCompare(b.id);
}

export interface AskedTodos {
  /** `projects` (projects R1) fills each row's `projectMatch`; without it, or if it fails, none is set. */
  list(
    root: string,
    identity: Identity,
    now: Date,
    projects?: () => Promise<ProjectsIndex>,
  ): Promise<AskedTodoList>;
}

/** The parsed log for one brain at one HEAD, or 'unread' when git couldn't give the whole log. */
export type LogResult = ParsedLog | 'unread';

/** One reader of the `todo/` git log per brain and HEAD: shared by the Asked and Done lists. */
export interface AskedLog {
  read(root: string): Promise<LogResult>;
}

/** One cached `git log` per brain folder and HEAD; `args` picks the log (Asked's by default, or `doneLogArgs`). */
export function createAskedLog(run: GitLogRunner = runGit, args: () => string[] = askedLogArgs): AskedLog {
  const cache = new Map<string, { head: string; log: Promise<LogResult> }>();

  const read = async (root: string): Promise<LogResult> => {
    let head: string;
    try {
      head = (await run(['rev-parse', 'HEAD'], root)).stdout.trim();
    } catch {
      return 'unread';
    }
    if (!/^[0-9a-f]{40,64}$/.test(head)) return 'unread';
    const hit = cache.get(root);
    // A shared in-flight read can still fail: every caller gets 'unread' (stamps only), never a throw.
    if (hit && hit.head === head) return hit.log.catch(() => 'unread' as const);
    const log = (async (): Promise<LogResult> => {
      const out = await run(args(), root, {
        maxOutput: ASKED_LOG_MAX_OUTPUT,
        timeoutMs: ASKED_LOG_TIMEOUT_MS,
      });
      // A cut log would silently miss the oldest asks, so it counts as unread (decision 4).
      return out.cut ? 'unread' : parseAskedLog(out.stdout);
    })();
    if (cache.size >= 8) cache.clear();
    cache.set(root, { head, log });
    try {
      return await log;
    } catch {
      // Failures aren't kept: the next call tries again.
      if (cache.get(root)?.log === log) cache.delete(root);
      return 'unread';
    }
  };
  return { read };
}

export function createAskedTodos(run: GitLogRunner = runGit, shared?: AskedLog): AskedTodos {
  const readLog = (shared ?? createAskedLog(run)).read;

  return {
    async list(root, identity, now, projects) {
      if (!identity.slug) return { waiting: [], done: [], historyRead: true };
      const [waitingFiles, doneFiles] = await Promise.all([
        readTodoFiles(root, 'waiting'),
        readTodoFiles(root, 'done'),
      ]);
      const files = [...waitingFiles, ...doneFiles];
      if (files.length === 0) return { waiting: [], done: [], historyRead: true };
      const [team, members, log] = await Promise.all([readTeam(root), readMembers(root), readLog(root)]);
      const roster: Roster = { team, members };
      const cutoff = now.getTime() - ASKED_DONE_DAYS * DAY_MS;
      const waiting: AskedTodo[] = [];
      const done: AskedTodo[] = [];
      const attachments = createAttachmentReader(root, identity.slug);
      let index: ProjectsIndex | null = null;
      if (projects) {
        try {
          index = await projects();
        } catch {
          index = null;
        }
      }
      for (const file of files) {
        const assignee = lower(file.data.assignee);
        if (!assignee || assignee === 'open' || assignee === identity.slug) continue;
        const facts = log === 'unread' ? null : (log.get(file.id) ?? null);
        const ask = whoAsked(file, assignee, facts, roster, identity);
        if (!ask?.self) continue;
        const asked = ask.actor;
        const finished = file.state === 'done' ? whoFinished(file, facts, roster) : null;
        if (finished) {
          const at = time(finished.at);
          if (Number.isNaN(at) || at < cutoff) continue;
        }
        const path = file.state === 'done' ? `todo/done/${file.id}` : `todo/${file.id}`;
        const item: AskedTodo = {
          key: `asked:${path}`,
          id: file.id,
          state: file.state,
          path,
          title: todoTitle(file.data, file.body, file.id),
          assignee,
          assigneeName: rosterName(team, assignee) ?? assignee,
          due: dueOf(file.data),
          details: file.body.trim(),
          asked,
          done: finished,
          version: file.version,
          attachments: await attachments(file.body),
          client: asString(file.data.client).trim() || null,
          project: asString(file.data.project).trim() || null,
          // Everything in `todo/` is TDS: a personal project never matches here.
          ...(index
            ? {
                projectMatch: index.resolve(
                  asString(file.data.project).trim() || null,
                  asString(file.data.client).trim() || null,
                  'tds',
                ),
              }
            : {}),
        };
        (file.state === 'done' ? done : waiting).push(item);
      }
      waiting.sort(byAskedOldest);
      done.sort(byDoneNewest);
      return { waiting, done, historyRead: log !== 'unread' };
    },
  };
}
