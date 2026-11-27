/**
 * Finished to-dos (done-todos plan 2026-11-24, decisions 1-3): every TDS file in `todo/done/` plus this
 * person's own files in `personal/todo/done/`. Files are read on every call (no file cache); only the
 * git log is cached per HEAD, shared with the Asked list. Read only: writes nothing.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  DoneTodo,
  DoneTodoList,
  Identity,
  TeamMember,
  TodoActor,
  TodoScope,
} from '../../shared/contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { readMembers } from './identity.ts';
import type { ProjectsIndex } from './projects.ts';
import {
  type AskedLog,
  historyActor,
  type LogFacts,
  type LogResult,
  type Roster,
  rosterName,
  stampActor,
} from './todo-asked.ts';
import {
  createAttachmentReader,
  dueOf,
  hiddenPathOf,
  isRealDir,
  lower,
  maskTask,
  readTaskIndex,
  readTeam,
  SAFE_ID,
  taskRule,
  timelineFields,
  todoTitle,
  usableIndex,
} from './todos.ts';
import { readBytes } from './util.ts';

export interface DoneTodoDeps {
  /** The shared `todo/` git log reader (one `git log` per HEAD). */
  log: AskedLog;
  /**
   * Fills each row's `projectMatch`; without it, or if it fails, none is set. Also THE task rule: someone
   * else's task in a hidden project is left out (and, when it fails, any project-labelled one).
   */
  projects?: () => Promise<ProjectsIndex>;
}

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);

interface DoneFile {
  id: string;
  scope: TodoScope;
  data: Record<string, string | string[]>;
  body: string;
  version: string;
}

async function readDoneFolder(root: string, scope: TodoScope): Promise<DoneFile[]> {
  const rel = scope === 'personal' ? 'personal/todo/done' : 'todo/done';
  const dir = join(root, rel);
  if (scope === 'personal') {
    for (const p of ['personal', 'personal/todo', rel]) if (!(await isRealDir(join(root, p)))) return [];
  }
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: DoneFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || !SAFE_ID.test(e.name) || SKIP.has(e.name)) continue;
    const bytes = await readBytes(join(dir, e.name));
    if (bytes === null) continue;
    const { data, body } = parseFrontmatter(bytes.toString('utf8'));
    files.push({
      id: e.name,
      scope,
      data,
      body,
      version: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return files;
}

const validAt = (at: string) => at !== '' && !Number.isNaN(Date.parse(at));

/**
 * Decision 2: the done stamp, else the git commit that added the file to `todo/done/`, else null.
 * Never the file's mtime or the date in its name.
 */
export function whoDone(file: DoneFile, facts: LogFacts | null, roster: Roster): TodoActor | null {
  const { data } = file;
  const by = lower(data.completed_by);
  const stamped = asString(data.completed_at).trim() || asString(data.completed).trim();
  const stampAt = validAt(stamped) ? stamped : '';
  const git = file.scope === 'tds' ? (facts?.doneAdd ?? null) : null;
  if (by) {
    const at = stampAt || git?.at || '';
    return validAt(at) ? stampActor(roster.team, by, at) : null;
  }
  if (git) {
    const actor = historyActor(roster, git);
    // A date-only stamp is the better time; the commit still names who.
    return stampAt ? { ...actor, at: stampAt, source: 'stamp' } : actor;
  }
  return stampAt ? { slug: null, name: null, at: stampAt, source: 'stamp' } : null;
}

const time = (at: string | undefined) => (at ? Date.parse(at) : Number.NaN);

/** Newest done first, unknown dates last, ties by id. */
function byDoneNewest(a: DoneTodo, b: DoneTodo): number {
  const ta = time(a.done?.at);
  const tb = time(b.done?.at);
  const ka = Number.isNaN(ta);
  const kb = Number.isNaN(tb);
  if (ka !== kb) return ka ? 1 : -1;
  if (!ka && ta !== tb) return tb - ta;
  return a.id.localeCompare(b.id) || a.scope.localeCompare(b.scope);
}

export async function listDoneTodos(
  root: string,
  identity: Identity,
  deps: DoneTodoDeps,
): Promise<DoneTodoList> {
  const me = identity.slug;
  const [tds, personal] = await Promise.all([readDoneFolder(root, 'tds'), readDoneFolder(root, 'personal')]);
  // Personal to-dos are only ever this person's: a file for anyone else is never listed.
  const files = [...tds, ...personal.filter((f) => me !== '' && lower(f.data.assignee) === me)];
  if (files.length === 0) return { items: [], historyRead: true };
  const needsLog = files.some((f) => f.scope === 'tds');
  const [team, members, log] = await Promise.all([
    readTeam(root),
    readMembers(root),
    needsLog ? deps.log.read(root) : Promise.resolve<LogResult>(new Map()),
  ]);
  const roster: Roster = { team: team as TeamMember[], members };
  const read = await readTaskIndex(deps.projects);
  const index = usableIndex(read);
  const attachments = createAttachmentReader(root, me, hiddenPathOf(read));
  const items: DoneTodo[] = [];
  for (const file of files) {
    const facts = log === 'unread' ? null : (log.get(file.id) ?? null);
    const written = lower(file.data.assignee);
    const assignee = written === '' || written === 'open' ? null : written;
    const folder = file.scope === 'personal' ? 'personal/todo/done' : 'todo/done';
    const project = asString(file.data.project).trim() || null;
    const client = asString(file.data.client).trim() || null;
    const projectMatch = index ? index.resolve(project, client, file.scope) : undefined;
    // THE task rule: someone else's finished task in a hidden project is left out; one's own is masked.
    const seen = taskRule(read, { project, projectMatch }, assignee !== null && assignee === me);
    if (seen === 'hide') continue;
    const item: DoneTodo = {
      key: `done:${folder}/${file.id}`,
      id: file.id,
      scope: file.scope,
      path: `${folder}/${file.id}`,
      title: todoTitle(file.data, file.body, file.id),
      assignee,
      assigneeName: assignee === null ? null : (rosterName(team, assignee) ?? assignee),
      due: dueOf(file.data),
      details: file.body.trim(),
      done: whoDone(file, facts, roster),
      version: file.version,
      attachments: await attachments(file.body),
      client,
      project,
      stage: asString(file.data.stage).trim() || null,
      ...(projectMatch ? { projectMatch } : {}),
      ...timelineFields(file.data, file.body, team),
    };
    items.push(seen === 'mask' ? maskTask(item) : item);
  }
  items.sort(byDoneNewest);
  return { items, historyRead: !needsLog || log !== 'unread' };
}
