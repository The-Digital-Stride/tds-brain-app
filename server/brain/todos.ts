import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type Identity,
  type TeamMember,
  TODO_ASSIGNEE_MAX,
  TODO_DETAILS_MAX,
  TODO_PERSONAL_DIR,
  TODO_SKILL,
  TODO_TITLE_MAX,
  TODO_VERSION_PATTERN,
  type TodoAction,
  type TodoHandover,
  type TodoItem,
  type TodoList,
  type TodoScope,
  type TodoSkillAccess,
} from '../../shared/contract.ts';
import { stampDone } from './done-record.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { readMembers } from './identity.ts';
import { skillAccess } from './skills.ts';
import type { GitAuthor, TodoHistory } from './todo-history.ts';
import {
  APP_VIA,
  findTodoSkill,
  type TodoRunAction,
  type TodoSkillRunner,
  type TodoTickAction,
  todoChangeError,
} from './todo-skill.ts';
import { humanise, readBytes } from './util.ts';

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function surfaceDate(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Whether `path` is a real folder, not a symlink and not missing. */
async function isRealDir(path: string): Promise<boolean> {
  try {
    const st = await fs.lstat(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

const lower = (v: string | string[] | undefined) => asString(v).trim().toLowerCase();

/**
 * The handover recorded in the file's `assigned_*` lines. Only trusted when `assigned_to` is the
 * current assignee (`open` for none): the Workbench and hand edits change `assignee:` without restamping.
 */
function stampHandover(
  data: Record<string, string | string[]>,
  assignee: string | null,
  team: TeamMember[],
): TodoHandover | null {
  const to = lower(data.assigned_to);
  const at = asString(data.assigned_at).trim();
  if (!to || !at || to !== (assignee ?? 'open')) return null;
  const by = lower(data.assigned_by) || null;
  const from = lower(data.assigned_from) || null;
  return {
    by,
    byName: by ? (team.find((m) => m.slug === by)?.name ?? null) : null,
    at,
    from,
    via: asString(data.assigned_via).trim() || null,
    source: 'stamp',
  };
}

/** One folder's to-dos. Personal files need an `assignee:` equal to `me`; TDS files are all listed. */
async function readFolder(
  root: string,
  scope: TodoScope,
  me: string,
  team: TeamMember[],
): Promise<TodoItem[]> {
  const rel = scope === 'personal' ? TODO_PERSONAL_DIR : 'todo';
  const dir = join(root, rel);
  if (scope === 'personal' && !((await isRealDir(join(root, 'personal'))) && (await isRealDir(dir))))
    return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: TodoItem[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || SKIP.has(e.name)) continue;
    // Read once as bytes: the version hashes exactly what is on disk, then the text is decoded for parsing.
    const bytes = await readBytes(join(dir, e.name));
    if (bytes === null) continue;
    const version = createHash('sha256').update(bytes).digest('hex');
    const text = bytes.toString('utf8');
    const { data, body } = parseFrontmatter(text);
    const assignee = lower(data.assignee) || null;
    if (scope === 'personal' && assignee !== me) continue;
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const due = asString(data.due).trim();
    items.push({
      id: e.name,
      scope,
      key: scope === 'personal' ? `personal/${e.name}` : e.name,
      path: `${rel}/${e.name}`,
      handover: scope === 'personal' ? null : stampHandover(data, assignee, team),
      createdBy: lower(data.created_by) || null,
      title: asString(data.title).trim() || heading || humanise(e.name),
      assignee,
      due: DATE.test(due) ? due : null,
      surfaceDate: surfaceDate(e.name),
      project: asString(data.project).trim() || null,
      client: asString(data.client).trim() || null,
      created: asString(data.created).trim() || null,
      source: asString(data.source).trim() || null,
      details: body.trim(),
      version,
    });
  }
  return items;
}

async function readAll(root: string, me: string, team: TeamMember[]): Promise<TodoItem[]> {
  const [tds, personal] = await Promise.all([
    readFolder(root, 'tds', me, team),
    readFolder(root, 'personal', me, team),
  ]);
  return [...tds, ...personal];
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
async function changeAccess(
  root: string,
  identity: Identity,
): Promise<{ changes: TodoSkillAccess; canAddOpen: boolean }> {
  const found = await findTodoSkill(root);
  if (!found) return { changes: 'no-skill', canAddOpen: false };
  const access = await skillAccess(root, identity, found.skill);
  if (access === 'restricted') return { changes: 'restricted', canAddOpen: false };
  if (access === 'allowed' && found.script !== null)
    return { changes: 'on', canAddOpen: found.skill === TODO_SKILL };
  return { changes: 'no-skill', canAddOpen: false };
}

/** Most git lookups one `listTodos` call starts that aren't already cached. */
const HISTORY_LOOKUPS_PER_LIST = 30;

/** What `listTodos` may use beyond the brain's files. Both are optional, so a bare call reads files only. */
export interface TodoListDeps {
  /** The git-history fallback for handovers (decision 5). Without it, only stamps are used. */
  history?: TodoHistory;
  /** The script's `capabilities` features (decision 4). Without it, personal to-dos can't be changed. */
  capabilities?: () => Promise<readonly string[]>;
}

/** The handover from git for a TDS to-do in `mine`: who last changed `assignee:`, unless that is the person. */
async function historyHandover(
  root: string,
  item: TodoItem,
  identity: Identity,
  team: TeamMember[],
  author: GitAuthor | null,
): Promise<TodoHandover | null> {
  if (!author || !SAFE_ID.test(item.id)) return null;
  const members = await readMembers(root);
  const email = author.email.toLowerCase();
  const byEmail = email
    ? members.find((m) => typeof m.email === 'string' && m.email.toLowerCase() === email)
    : undefined;
  let by: string | null = null;
  if (byEmail && typeof byEmail.name === 'string') by = workbenchSlug(byEmail.name) || null;
  else {
    const slug = workbenchSlug(author.name);
    by = team.some((m) => m.slug === slug) ? slug : null;
  }
  if (by !== null ? by === identity.slug : identity.email !== null && email === identity.email.toLowerCase())
    return null;
  return {
    by,
    byName: (by ? team.find((m) => m.slug === by)?.name : null) ?? (author.name || null),
    at: author.at,
    from: null,
    via: null,
    source: 'history',
  };
}

export async function listTodos(
  root: string,
  identity: Identity,
  deps: TodoListDeps = {},
): Promise<TodoList> {
  const [team, access] = await Promise.all([readTeam(root), changeAccess(root, identity)]);
  const items = await readAll(root, identity.slug, team);
  const isMine = (t: TodoItem) => t.assignee !== null && t.assignee === identity.slug;
  const history = deps.history;
  // Uncached git lookups are capped per call; the rest wait for a later load (their nulls aren't cached).
  let budget = HISTORY_LOOKUPS_PER_LIST;
  const mine = await Promise.all(
    items.filter(isMine).map(async (t) => {
      if (!history || t.scope !== 'tds') return t;
      if (!history.isCached(root, t.id, t.version)) {
        if (budget <= 0) return t;
        budget -= 1;
      }
      const author = await history.lastAssigneeEdit(root, t.id, t.version);
      // A stamp is only as fresh as the last `assignee:` change: if that commit didn't stamp, the
      // assignee changed outside the app since (e.g. a round trip through the Workbench).
      // A stamp newer than the commit is newer than anything git knows (not committed yet): keep it.
      if (
        t.handover !== null &&
        (author === null || author.addsStamp || Date.parse(t.handover.at) > Date.parse(author.at))
      )
        return t;
      return { ...t, handover: await historyHandover(root, t, identity, team, author) };
    }),
  );
  mine.sort(bySoonest);
  // Personal to-dos are never open and never counted among other people's.
  const open = items.filter((t) => t.scope === 'tds' && t.assignee === null).sort(bySoonest);
  const tdsOthers = items.filter((t) => t.scope === 'tds' && t.assignee !== null && !isMine(t)).length;
  let canUsePersonal = false;
  if (access.changes === 'on' && deps.capabilities) {
    try {
      canUsePersonal = (await deps.capabilities()).includes('scope');
    } catch {
      canUsePersonal = false;
    }
  }
  return {
    mine,
    open,
    othersCount: tdsOthers,
    team,
    changes: access.changes,
    canAddOpen: access.canAddOpen,
    canUsePersonal,
  };
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
const okExpect = (v: unknown) => typeof v === 'string' && TODO_VERSION_PATTERN.test(v);
const okId = (v: unknown) => typeof v === 'string' && v.length <= 255 && CHANGE_ID.test(v);

const okScope = (v: unknown) => v === 'tds' || v === 'personal';

/** The contract's route checks on the values (the route has already checked the shape). */
function validAction(a: TodoAction | TodoTickAction, canAddOpen: boolean): boolean {
  if ('expect' in a && a.expect !== undefined && !okExpect(a.expect)) return false;
  if ('scope' in a && a.scope !== undefined && !okScope(a.scope)) return false;
  switch (a.kind) {
    case 'add':
      return okTitle(a.title) && okDue(a.due) && (a.assignee === null ? canAddOpen : okAssignee(a.assignee));
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
    case 'tick':
      return okId(a.id) && okScope(a.scope);
    case 'move':
      return okId(a.id) && okScope(a.scope) && okScope(a.to) && a.scope !== a.to;
    default:
      return false;
  }
}

/** What a change tells the route beyond "it worked". */
export interface TodoChangeResult {
  /** Set after a `move`: the to-do's key before and after (a name clash renames it). */
  moved?: { from: string; to: string };
}

const keyOf = (scope: TodoScope, id: string) => (scope === 'personal' ? `personal/${id}` : id);

/**
 * One change, run by the brain's `todo` skill script. Refuses `not-allowed` unless `changes` is
 * 'on' (and, for anything personal, `canUsePersonal`), `bad-request` for values outside the
 * Workbench's rules (and personal changes without `expect`), `not-found` for an id that is
 * not listed for this person in that scope (theirs or open) and `changed` when `expect` is not the
 * listed version, all before anything runs.
 */
export async function changeTodo(
  root: string,
  action: TodoAction | TodoTickAction,
  identity: Identity,
  runner: TodoSkillRunner,
  deps: Pick<TodoListDeps, 'history'> = {},
): Promise<TodoChangeResult> {
  const list = await listTodos(root, identity, {
    history: deps.history,
    capabilities: () => runner.capabilities(),
  });
  if (list.changes !== 'on') throw todoChangeError('not-allowed');
  if (typeof action !== 'object' || action === null || !validAction(action, list.canAddOpen))
    throw todoChangeError('bad-request');
  const personal = action.kind === 'move' || action.scope === 'personal';
  if (personal && !list.canUsePersonal) throw todoChangeError('not-allowed');
  if (personal) {
    // A personal to-do belongs to its person alone: no passing it on, and an add is always theirs.
    if (action.kind === 'assignee') throw todoChangeError('bad-request');
    if (action.kind === 'add' && action.assignee !== identity.slug) throw todoChangeError('bad-request');
    if ('id' in action && action.expect === undefined) throw todoChangeError('bad-request');
  }
  if ('id' in action) {
    const scope: TodoScope = action.scope ?? 'tds';
    const listed = [...list.mine, ...list.open].find((t) => t.id === action.id && t.scope === scope);
    if (!listed) throw todoChangeError('not-found');
    if (action.expect !== undefined && listed.version !== action.expect) throw todoChangeError('changed');
  }
  const result = await runner.run(action as TodoRunAction, { name: identity.name, slug: identity.slug });
  if (action.kind !== 'move') return {};
  const file = result.file !== null && okId(result.file) ? result.file : action.id;
  return { moved: { from: keyOf(action.scope, action.id), to: keyOf(action.to, file) } };
}

/** What the app writes as the place a to-do was ticked. */
export const TICKED_VIA = APP_VIA;

export async function completeTodo(root: string, id: string, by: Identity, at: Date): Promise<void> {
  if (typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('That is not a to-do the app can tick off.');
  const live = await readFolder(root, 'tds', '', []);
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
