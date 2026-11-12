import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type Identity,
  type TeamMember,
  TODO_ASSIGNEE_MAX,
  TODO_DETAILS_MAX,
  TODO_SKILL,
  TODO_TITLE_MAX,
  type TodoAction,
  type TodoItem,
  type TodoList,
  type TodoSkillAccess,
} from '../../shared/contract.ts';
import { stampDone } from './done-record.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { readMembers } from './identity.ts';
import { skillAccess } from './skills.ts';
import { APP_VIA, findTodoScript, type TodoSkillRunner, todoChangeError } from './todo-skill.ts';
import { humanise, readText } from './util.ts';

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function surfaceDate(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

async function readAll(root: string): Promise<TodoItem[]> {
  const dir = join(root, 'todo');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: TodoItem[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || SKIP.has(e.name)) continue;
    const text = await readText(join(dir, e.name));
    if (text === null) continue;
    const { data, body } = parseFrontmatter(text);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const due = asString(data.due).trim();
    items.push({
      id: e.name,
      title: asString(data.title).trim() || heading || humanise(e.name),
      assignee: asString(data.assignee).trim().toLowerCase() || null,
      due: DATE.test(due) ? due : null,
      surfaceDate: surfaceDate(e.name),
      project: asString(data.project).trim() || null,
      client: asString(data.client).trim() || null,
      created: asString(data.created).trim() || null,
      source: asString(data.source).trim() || null,
      details: body.trim(),
    });
  }
  return items;
}

const sortKey = (t: TodoItem) => t.due ?? t.surfaceDate;

function bySoonest(a: TodoItem, b: TodoItem): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka === kb) return a.id.localeCompare(b.id);
  if (ka === null) return 1;
  if (kb === null) return -1;
  return ka < kb ? -1 : 1;
}

/**
 * The Workbench's slug rule (`/api/todos/roster`): lower-case, every run of characters other than
 * a–z and 0–9 becomes one dash, no dash at either end.
 */
export function workbenchSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Everyone in `.team-config/roles.json` with a name, in file order, once per slug. */
async function readTeam(root: string): Promise<TeamMember[]> {
  const team: TeamMember[] = [];
  const seen = new Set<string>();
  for (const m of await readMembers(root)) {
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    const slug = workbenchSlug(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    team.push({ slug, name });
  }
  return team;
}

/** Whether this person may change to-dos through the brain's `todo` skill (before the Settings switch). */
async function changeAccess(root: string, identity: Identity): Promise<TodoSkillAccess> {
  const access = await skillAccess(root, identity, TODO_SKILL);
  if (access === 'restricted') return 'restricted';
  if (access === 'allowed' && (await findTodoScript(root)) !== null) return 'on';
  return 'no-skill';
}

export async function listTodos(root: string, identity: Identity): Promise<TodoList> {
  const [items, team, changes] = await Promise.all([
    readAll(root),
    readTeam(root),
    changeAccess(root, identity),
  ]);
  const mine = items.filter((t) => t.assignee !== null && t.assignee === identity.slug).sort(bySoonest);
  const open = items.filter((t) => t.assignee === null).sort(bySoonest);
  return { mine, open, othersCount: items.length - mine.length - open.length, team, changes };
}

// ---------------------------------------------------------------------------
// Changes through the brain's `todo` skill (Workbench to-dos plan, decisions 2 and 3). Nothing here
// writes a file: every change is the script's.
// ---------------------------------------------------------------------------

/** The Workbench's file rule, kept literally (spaces allowed). */
const CHANGE_ID = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/;
const ASSIGNEE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const okTitle = (v: unknown) =>
  typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= TODO_TITLE_MAX;
const okDue = (v: unknown) => v === null || (typeof v === 'string' && isDate(v));
const okAssignee = (v: unknown) => typeof v === 'string' && v.length <= TODO_ASSIGNEE_MAX && ASSIGNEE.test(v);
const okId = (v: unknown) => typeof v === 'string' && v.length <= 255 && CHANGE_ID.test(v);

/** The contract's route checks on the values (the route has already checked the shape). */
function validAction(a: TodoAction): boolean {
  switch (a.kind) {
    case 'add':
      return okTitle(a.title) && okDue(a.due) && okAssignee(a.assignee);
    case 'edit':
      return (
        okId(a.id) &&
        okTitle(a.title) &&
        (a.details === undefined || (typeof a.details === 'string' && a.details.length <= TODO_DETAILS_MAX))
      );
    case 'due':
      return okId(a.id) && okDue(a.due);
    case 'assignee':
      return okId(a.id) && (a.assignee === null || okAssignee(a.assignee));
    case 'delete':
      return okId(a.id);
    default:
      return false;
  }
}

/**
 * One change, run by the brain's `todo` skill script. Refuses `not-allowed` unless `changes` is
 * 'on', `bad-request` for values outside the Workbench's rules, and `not-found` for an id that is
 * not listed for this person (theirs or open), all before anything runs.
 */
export async function changeTodo(
  root: string,
  action: TodoAction,
  identity: Identity,
  runner: TodoSkillRunner,
): Promise<void> {
  const list = await listTodos(root, identity);
  if (list.changes !== 'on') throw todoChangeError('not-allowed');
  if (typeof action !== 'object' || action === null || !validAction(action))
    throw todoChangeError('bad-request');
  if ('id' in action && ![...list.mine, ...list.open].some((t) => t.id === action.id)) {
    throw todoChangeError('not-found');
  }
  await runner.run(action, { name: identity.name, slug: identity.slug });
}

/** What the app writes as the place a to-do was ticked. */
export const TICKED_VIA = APP_VIA;

export async function completeTodo(root: string, id: string, by: Identity, at: Date): Promise<void> {
  if (typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('That is not a to-do the app can tick off.');
  const live = await readAll(root);
  if (!live.some((t) => t.id === id))
    throw new Error('That to-do could not be found. It may already be done.');
  const source = join(root, 'todo', id);
  const doneDir = join(root, 'todo', 'done');
  const target = join(doneDir, id);
  const stamped = stampDone(await fs.readFile(source, 'utf8'), { by, at, via: TICKED_VIA });
  await fs.mkdir(doneDir, { recursive: true });
  try {
    // 'wx' fails if the name is taken, so an earlier finished to-do is never overwritten.
    await fs.writeFile(target, stamped, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('A finished to-do with that name already exists, so nothing was moved.');
    throw err;
  }
  try {
    await fs.unlink(source);
  } catch (err) {
    // Never leave the to-do both open and finished.
    await fs.rm(target, { force: true });
    throw err;
  }
}
