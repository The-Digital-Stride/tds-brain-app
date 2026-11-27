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
import { parseTodoHandovers } from '../../shared/todo-updates.ts';
import type { TodoUpdate } from '../../shared/todo-updates-contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { type Member, readMembers } from './identity.ts';
import type { ProjectsIndex } from './projects.ts';
import { type GitLogRunner, runGit } from './todo-history.ts';
import {
  authorSlug,
  createAttachmentReader,
  dueOf,
  hiddenPathOf,
  isSelf,
  lower,
  maskTask,
  readTaskIndex,
  readTeam,
  SAFE_ID,
  surfaceDate,
  taskRule,
  timelineFields,
  todoTitle,
  usableIndex,
  workbenchSlug,
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

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** The slug at the end of a handover line: "passed it from a to b", "handed it back to b". */
const HANDOVER_TO = new RegExp(` to (${SLUG})$`);
/** Who had it before: "passed it from a to b" (never "the open list"), "made it open to anyone; it was with a". */
const HANDOVER_FROM = new RegExp(`^passed it from (${SLUG}) to `);
const WAS_WITH = new RegExp(`; it was with (${SLUG})$`);

/**
 * A slug a line names, as a person: `open` is the open list (a file whose `assignee:` is the word "open" makes
 * the script write "passed it from open to b"), so it is nobody.
 */
const person = (slug: string | undefined): string | null => (slug && slug !== 'open' ? slug : null);

/** Who a handover line left the task with: a slug, or null for the open list or a line that doesn't say. */
function wentTo(entry: TodoUpdate, actor: string | null): string | null {
  if (/^made it open\b/.test(entry.text)) return null;
  if (/^picked it up\b/.test(entry.text)) return actor;
  return person(HANDOVER_TO.exec(entry.text)?.[1]);
}

/** Who had the task before a handover line: a slug, or null for the open list or a line that doesn't say. */
function cameFrom(entry: TodoUpdate, actor: string | null): string | null {
  // Only the holder hands a task back.
  if (entry.action === 'handback') return actor;
  return person(HANDOVER_FROM.exec(entry.text)?.[1] ?? WAS_WITH.exec(entry.text)?.[1]);
}

/**
 * Change notices follow-ups: the ask this person still has in a task that someone else has since passed on.
 * Read from the script's `## Handover history` lines, oldest first:
 * - a line of theirs that passes it to someone else is an ask (a hand back or a move to the open list is not);
 * - a line that brings it back to them, or says it was with them, ends whatever they asked before;
 * - adding a task for someone writes no line, so `created_by` is their first ask when the oldest line shows
 *   it was with someone else from the start.
 * A line carries a name, not a slug: it is theirs when the name's slug is their own. Null when they have no
 * such ask (and for a task with no history lines: the stamp, git and `created_by` already cover that).
 * With the ask comes `reached`: when the task got to `holder`, when the newest line is the one that left it with them.
 */
export function followedAsk(
  file: Pick<TodoFile, 'id' | 'data' | 'body' | 'mtime'>,
  identity: Identity,
  team: readonly TeamMember[],
  /** Who has it now. */
  holder: string,
): { ask: TodoActor; reached: string | null } | null {
  const me = identity.slug;
  const mine = (at: string): TodoActor => ({
    slug: me,
    name: team.find((m) => m.slug === me)?.name ?? identity.name,
    at,
    source: 'stamp',
  });
  // Stable sort: lines in the same minute keep the file's order. A merge can leave them out of order.
  const lines = parseTodoHandovers(file.body)
    .map((entry) => {
      const actor = workbenchSlug(entry.byName) || null;
      return {
        entry,
        actor,
        to: wentTo(entry, actor),
        from: cameFrom(entry, actor),
        at: Date.parse(entry.at),
      };
    })
    .filter((l) => !Number.isNaN(l.at))
    .sort((a, b) => a.at - b.at);
  const first = lines[0];
  if (!first) return null;
  let ask: TodoActor | null = null;
  if (lower(file.data.created_by) === me && first.from !== null && first.from !== me) {
    const { data } = file;
    ask = mine(
      asString(data.created_at).trim() || asString(data.created).trim() || surfaceDate(file.id) || file.mtime,
    );
  }
  for (const l of lines) {
    // Back with them: whatever they asked before is over.
    if (l.to === me) ask = null;
    else if (l.actor === me && l.entry.action === 'assignee' && l.to !== null) ask = mine(l.entry.at);
    // It was with them and left another way (the open list, or moved on by someone else).
    else if (l.from === me) ask = null;
  }
  if (!ask) return null;
  // The file's own record, never a git sync date: only when the newest line is the one that left it with the
  // holder (an older arrival is not this one).
  const last = lines[lines.length - 1];
  const reached = last && last.to === holder ? last.entry.at : null;
  return { ask, reached };
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
  /**
   * `projects` (projects R1) fills each row's `projectMatch`; without it, or if it fails, none is set. A row
   * in a project hidden from this person is still theirs (they asked), so it is masked, never left out.
   */
  list(
    root: string,
    identity: Identity,
    now: Date,
    projects?: () => Promise<ProjectsIndex>,
    /** Task updates: this person may add an update to a waiting row (changes on, script lists updates-v1). */
    canUpdate?: boolean,
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
    async list(root, identity, now, projects, canUpdate = false) {
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
      const read = await readTaskIndex(projects);
      const index = usableIndex(read);
      const attachments = createAttachmentReader(root, identity.slug, hiddenPathOf(read));
      for (const file of files) {
        const assignee = lower(file.data.assignee);
        if (!assignee || assignee === 'open' || assignee === identity.slug) continue;
        const facts = log === 'unread' ? null : (log.get(file.id) ?? null);
        const ask = whoAsked(file, assignee, facts, roster, identity);
        // Not the one who gave it to its holder: still theirs if they asked earlier and it was passed on.
        const earlier = ask?.self ? null : followedAsk(file, identity, team, assignee);
        if (!ask?.self && !earlier) continue;
        const asked = earlier?.ask ?? (ask as NonNullable<typeof ask>).actor;
        const finished = file.state === 'done' ? whoFinished(file, facts, roster) : null;
        if (finished) {
          const at = time(finished.at);
          if (Number.isNaN(at) || at < cutoff) continue;
        }
        const path = file.state === 'done' ? `todo/done/${file.id}` : `todo/${file.id}`;
        const client = asString(file.data.client).trim() || null;
        const project = asString(file.data.project).trim() || null;
        // Everything in `todo/` is TDS: a personal project never matches here.
        const projectMatch = index ? index.resolve(project, client, 'tds') : undefined;
        // THE task rule: every row here is one this person asked for, so a hidden project's is masked.
        const seen = taskRule(read, { project, projectMatch }, true);
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
          client,
          project,
          ...(projectMatch ? { projectMatch } : {}),
          ...timelineFields(file.data, file.body, team),
          // When it reached whoever has it now: only on a row followed through someone else's pass-on.
          ...(earlier
            ? {
                // The live stamp, else the newest history line; never a git sync date.
                passedOnAt:
                  (lower(file.data.assigned_to) === assignee ? asString(file.data.assigned_at).trim() : '') ||
                  earlier.reached,
              }
            : {}),
          // The current stamp is this person's hand back (only a waiting row has a live stamp).
          ...(file.state === 'waiting' &&
          lower(file.data.assigned_to) === assignee &&
          asString(file.data.assigned_at).trim() !== '' &&
          lower(file.data.assigned_by) === identity.slug &&
          lower(file.data.assigned_back) === 'true'
            ? { handedBack: true as const }
            : {}),
          // Only a waiting row, and never one in a hidden project (or any project while the index can't be read).
          canUpdate:
            canUpdate &&
            file.state === 'waiting' &&
            seen === 'show' &&
            !(read === 'unread' && project !== null),
        };
        (file.state === 'done' ? done : waiting).push(seen === 'mask' ? maskTask(item) : item);
      }
      waiting.sort(byAskedOldest);
      done.sort(byDoneNewest);
      return { waiting, done, historyRead: log !== 'unread' };
    },
  };
}
