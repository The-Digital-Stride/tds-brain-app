import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  type ClientInfo,
  type Identity,
  type TeamMember,
  TODO_ASSIGNEE_MAX,
  TODO_ATTACHMENTS_MAX,
  TODO_DETAILS_MAX,
  TODO_PERSONAL_DIR,
  TODO_SKILL,
  TODO_TITLE_MAX,
  TODO_UPLOAD_TYPES,
  TODO_VERSION_PATTERN,
  type TodoAction,
  type TodoAttachment,
  TodoChangeError,
  type TodoChangeErrorCode,
  type TodoHandover,
  type TodoItem,
  type TodoList,
  type TodoScope,
  type TodoSkillAccess,
} from '../../shared/contract.ts';
import { FilesChangeError, PROTECTED_CLIENT_FILES, PROTECTED_NAMES } from '../../shared/files-contract.ts';
import {
  LEGACY_PROJECTS_SCOPE,
  PROJECT_KEY_PATTERN,
  PROJECT_STAGE_MAX,
  TODO_PROJECT_CAPABILITY,
} from '../../shared/projects-contract.ts';
import { parseTodoFiles, resolveTodoFilePath, splitTodoFiles } from '../../shared/todo-files.ts';
import { stampDone } from './done-record.ts';
import { FILES_ADD_CAPABILITY, FILES_SKILL, type FilesSkillRunner, findFilesSkill } from './files-skill.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { type Member, readMembers } from './identity.ts';
import { idFor } from './library.ts';
import { classify, extOf, isHiddenInTemplates, isNeverListed } from './library-rules.ts';
import type { ProjectsIndex } from './projects.ts';
import { skillAccess } from './skills.ts';
import type { GitAuthor, TodoHistory } from './todo-history.ts';
import {
  APP_VIA,
  findTodoSkill,
  TODO_ATTACH_CAPABILITY,
  TODO_PRIVATE_PROJECT_MESSAGE,
  type TodoRunAction,
  type TodoSkillRunner,
  type TodoTickAction,
  todoChangeError,
} from './todo-skill.ts';
import { humanise, readBytes } from './util.ts';

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);
/** A to-do file name the app reads or ticks itself: no spaces, no path, `.md`. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `due` as YYYY-MM-DD, else null. */
export function dueOf(data: Record<string, string | string[]>): string | null {
  const due = asString(data.due).trim();
  return DATE.test(due) ? due : null;
}

/** The frontmatter `title`, else the first `# heading`, else the file name made readable. */
export function todoTitle(data: Record<string, string | string[]>, body: string, id: string): string {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return asString(data.title).trim() || heading || humanise(id);
}

export function surfaceDate(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Whether `path` is a real folder, not a symlink and not missing. */
export async function isRealDir(path: string): Promise<boolean> {
  try {
    const st = await fs.lstat(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** A frontmatter value as trimmed lower case ('' when missing). */
export const lower = (v: string | string[] | undefined) => asString(v).trim().toLowerCase();

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

// ---------------------------------------------------------------------------
// Files on to-dos (plan 2026-11-16-todo-attachments, decisions 1 and 7). Read only: the brain's
// `tdsapp-todo` skill is the only writer of the `## Files` section.
// ---------------------------------------------------------------------------

/** True when a to-do's project label is, or matches, a personal project. */
function inPersonalProject(t: TodoItem): boolean {
  const m = t.projectMatch;
  if (m && (m.how === 'key' || m.how === 'legacy' || m.how === 'missing') && m.key.startsWith('personal/'))
    return true;
  return (t.project ?? '').trim().toLowerCase().startsWith('personal/');
}

/** The library scope id a brain path would be listed under (as library.ts names them), or null. */
function libraryScopeOf(path: string): string | null {
  const segs = path.split('/');
  if (segs[0] === 'personal') return 'personal';
  if (segs[0] === 'templates') return 'shared:templates';
  // The older top-level projects/ folders (projects R1, decision 7); cards and updates stay hidden.
  if (segs[0] === 'projects' && segs.length >= 3 && segs[1]) return LEGACY_PROJECTS_SCOPE;
  if (segs[0] === 'clients' && segs.length >= 3 && segs[1]) return `client:${segs[1]}`;
  return null;
}

/**
 * Whether a clean brain path names a file the library would list: a type it lists, in no place it
 * never lists, and a regular file whose real path is exactly that path inside the real brain (no link
 * anywhere along it, so a client folder that is a link is refused as the library refuses it).
 * `realRoot` is the brain's real path.
 */
async function isListableFile(root: string, realRoot: string, path: string): Promise<boolean> {
  if (libraryScopeOf(path) === null || isNeverListed(path) || isHiddenInTemplates(path)) return false;
  if (!classify(extOf(path))) return false;
  const parts = path.split('/');
  try {
    if (!(await fs.lstat(join(root, ...parts))).isFile()) return false;
    return (await fs.realpath(join(root, ...parts))) === join(realRoot, ...parts);
  } catch {
    return false;
  }
}

/**
 * Reads a to-do body's `## Files` section as TodoAttachments for `me` (a team slug, '' for nobody).
 * `libraryId` is the library's own id (`<scope id>.<hash of the path>`, `idFor`), worked out without
 * walking the library: only files that are there and listable get one, and a `personal/` file only
 * when its holder is `me` (overseer S3). One reader per listing: the brain's real path is read once.
 */
export function createAttachmentReader(
  root: string,
  me: string,
): (body: string) => Promise<TodoAttachment[]> {
  let realRoot: Promise<string | null> | null = null;
  const real = () => {
    realRoot ??= fs.realpath(root).catch(() => null);
    return realRoot;
  };
  return async (body) => {
    const links = parseTodoFiles(body);
    if (links.length === 0) return [];
    return Promise.all(
      links.map(async (link): Promise<TodoAttachment> => {
        const personal = link.path.startsWith('personal/');
        const scope = libraryScopeOf(link.path);
        const mayOpen = scope !== null && (!personal || (me !== '' && link.holder === me));
        const base = mayOpen ? await real() : null;
        const listed = base !== null && (await isListableFile(root, base, link.path));
        return {
          path: link.path,
          name: link.name,
          kind: classify(extOf(link.path))?.kind ?? null,
          libraryId: listed && scope !== null ? idFor(scope, link.path) : null,
          personal,
          holder: link.holder,
        };
      }),
    );
  };
}

/** One folder's to-dos. Personal files need an `assignee:` equal to `me`; TDS files are all listed. */
async function readFolder(
  root: string,
  scope: TodoScope,
  me: string,
  team: TeamMember[],
  attachments: ((body: string) => Promise<TodoAttachment[]>) | null = null,
  projects: ProjectsIndex | null = null,
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
    items.push({
      id: e.name,
      scope,
      key: scope === 'personal' ? `personal/${e.name}` : e.name,
      path: `${rel}/${e.name}`,
      handover: scope === 'personal' ? null : stampHandover(data, assignee, team),
      createdBy: lower(data.created_by) || null,
      title: todoTitle(data, body, e.name),
      assignee,
      due: dueOf(data),
      surfaceDate: surfaceDate(e.name),
      project: asString(data.project).trim() || null,
      client: asString(data.client).trim() || null,
      stage: asString(data.stage).trim() || null,
      ...(projects
        ? {
            projectMatch: projects.resolve(
              asString(data.project).trim() || null,
              asString(data.client).trim() || null,
              scope,
            ),
          }
        : {}),
      created: asString(data.created).trim() || null,
      source: asString(data.source).trim() || null,
      details: body.trim(),
      version,
      attachments: attachments ? await attachments(body) : [],
    });
  }
  return items;
}

async function readAll(
  root: string,
  me: string,
  team: TeamMember[],
  projects: ProjectsIndex | null,
): Promise<TodoItem[]> {
  const attachments = createAttachmentReader(root, me);
  const [tds, personal] = await Promise.all([
    readFolder(root, 'tds', me, team, attachments, projects),
    readFolder(root, 'personal', me, team, attachments, projects),
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
export async function readTeam(root: string): Promise<TeamMember[]> {
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
  /** The `tdsapp-files` script's `capabilities` features (release 3). Without it, nothing can be uploaded. */
  filesCapabilities?: () => Promise<readonly string[]>;
  /** The projects index (projects R1): fills `projectMatch`. Without it, none is set. */
  projects?: () => Promise<ProjectsIndex>;
}

/** Whether this person may save uploads through `tdsapp-files`: its script is there, `roles:` allow them and it lists `add`. */
async function canUseFilesAdd(
  root: string,
  identity: Identity,
  capabilities: (() => Promise<readonly string[]>) | undefined,
): Promise<boolean> {
  if (!capabilities) return false;
  try {
    const found = await findFilesSkill(root);
    if (!found || found.script === null) return false;
    if ((await skillAccess(root, identity, FILES_SKILL)) !== 'allowed') return false;
    return (await capabilities()).includes(FILES_ADD_CAPABILITY);
  } catch {
    return false;
  }
}

/**
 * The team slug for a git author: the roles.json member with that email first, else the slug of the
 * author's name when it is on the roster, else null.
 */
export function authorSlug(
  members: Member[],
  team: TeamMember[],
  author: { name: string; email: string },
): string | null {
  const email = author.email.toLowerCase();
  const byEmail = email
    ? members.find((m) => typeof m.email === 'string' && m.email.toLowerCase() === email)
    : undefined;
  if (byEmail && typeof byEmail.name === 'string') return workbenchSlug(byEmail.name) || null;
  const slug = workbenchSlug(author.name);
  return team.some((m) => m.slug === slug) ? slug : null;
}

/** Whether a matched author is this person: by slug, or by email when the author isn't on the roster. */
export function isSelf(by: string | null, email: string, identity: Identity): boolean {
  return by !== null
    ? by === identity.slug
    : identity.email !== null && email.toLowerCase() === identity.email.toLowerCase();
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
  const by = authorSlug(await readMembers(root), team, author);
  if (isSelf(by, author.email, identity)) return null;
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
  let index: ProjectsIndex | null = null;
  if (deps.projects) {
    try {
      index = await deps.projects();
    } catch {
      index = null;
    }
  }
  const items = await readAll(root, identity.slug, team, index);
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
  let features: readonly string[] = [];
  if (access.changes === 'on' && deps.capabilities) {
    try {
      features = await deps.capabilities();
    } catch {
      features = [];
    }
  }
  const canAttach = features.includes(TODO_ATTACH_CAPABILITY);
  const canUpload = canAttach && (await canUseFilesAdd(root, identity, deps.filesCapabilities));
  return {
    mine,
    open,
    othersCount: tdsOthers,
    team,
    changes: access.changes,
    canAddOpen: access.canAddOpen,
    canUsePersonal: features.includes('scope'),
    canAttach,
    canUpload,
    canProject: features.includes(TODO_PROJECT_CAPABILITY),
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
const okDetails = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= TODO_DETAILS_MAX);
/** Longest brain path an attach or detach may name. */
const PATH_MAX = 1024;
/** A brain path exactly as the shared rules resolve it: no `../`, under clients/, templates/ or personal/. */
const okFilePath = (v: unknown) =>
  typeof v === 'string' && v.length <= PATH_MAX && resolveTodoFilePath(v) === v;

const CLIENT_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const okClientField = (v: unknown) =>
  v === null || (typeof v === 'string' && v.length <= 60 && CLIENT_SLUG.test(v));
const okProjectField = (v: unknown) =>
  v === null || (typeof v === 'string' && v.length <= 121 && PROJECT_KEY_PATTERN.test(v));
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;
const okStageField = (v: unknown) =>
  v === null ||
  (typeof v === 'string' &&
    v.trim() === v &&
    v.length >= 1 &&
    v.length <= PROJECT_STAGE_MAX &&
    !CONTROL.test(v));

/** Whether an `add` or `project` action sets client, project or stage (needs TodoList.canProject). */
function usesProjectFields(a: TodoAction | TodoTickAction): boolean {
  if (a.kind === 'project') return true;
  if (a.kind === 'move') return a.dropProject !== undefined;
  if (a.kind === 'add') return a.client !== undefined || a.project !== undefined || a.stage !== undefined;
  return false;
}

/** The three fields agree: a key's client is its first segment (null for `personal/`), and a team to-do never takes a private project. */
function projectFieldsAgree(
  scope: TodoScope,
  f: { client?: string | null; project?: string | null },
): 'ok' | 'bad' | 'private' {
  if (!f.project) return 'ok';
  const keyClient = f.project.split('/')[0] ?? '';
  if (keyClient === 'personal') {
    if (scope === 'tds') return 'private';
    return f.client === undefined || f.client === null ? 'ok' : 'bad';
  }
  return f.client === undefined || f.client === keyClient ? 'ok' : 'bad';
}

/** The contract's route checks on the values (the route has already checked the shape). */
function validAction(a: TodoAction | TodoTickAction, canAddOpen: boolean): boolean {
  if ('expect' in a && a.expect !== undefined && !okExpect(a.expect)) return false;
  if ('scope' in a && a.scope !== undefined && !okScope(a.scope)) return false;
  switch (a.kind) {
    case 'add':
      return (
        okTitle(a.title) &&
        okDue(a.due) &&
        (a.assignee === null ? canAddOpen : okAssignee(a.assignee)) &&
        okDetails(a.details) &&
        (a.client === undefined || okClientField(a.client)) &&
        (a.project === undefined || okProjectField(a.project)) &&
        (a.stage === undefined || okStageField(a.stage))
      );
    case 'edit':
      return (
        okId(a.id) &&
        okTitle(a.title) &&
        okDetails(a.details) &&
        (a.detailsOnly === undefined || a.detailsOnly === true)
      );
    case 'attach':
    case 'detach':
      return okId(a.id) && okFilePath(a.path);
    case 'due':
      return okId(a.id) && okDue(a.due);
    case 'assignee':
      return okId(a.id) && (a.assignee === null || okAssignee(a.assignee));
    case 'delete':
      return okId(a.id);
    case 'tick':
      return okId(a.id) && okScope(a.scope);
    case 'move':
      return (
        okId(a.id) &&
        okScope(a.scope) &&
        okScope(a.to) &&
        a.scope !== a.to &&
        (a.dropProject === undefined || a.dropProject === true)
      );
    case 'project':
      return (
        okId(a.id) &&
        okClientField(a.client) &&
        okProjectField(a.project) &&
        okStageField(a.stage) &&
        // A stage belongs to a project.
        (a.stage === null || a.project !== null)
      );
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
  if (typeof action !== 'object' || action === null) throw todoChangeError('bad-request');
  if ((action.kind === 'attach' || action.kind === 'detach') && !list.canAttach)
    throw todoChangeError('not-allowed');
  if (usesProjectFields(action) && !list.canProject) throw todoChangeError('not-allowed');
  if (!validAction(action, list.canAddOpen)) throw todoChangeError('bad-request');
  if (action.kind === 'add' || action.kind === 'project') {
    const agree = projectFieldsAgree(action.scope ?? 'tds', action);
    if (agree === 'private') throw todoChangeError('not-allowed');
    if (agree === 'bad') throw todoChangeError('bad-request');
  }
  // With canAttach the editor sends the details alone and the script keeps the section (overseer B1).
  if (action.kind === 'edit' && list.canAttach && action.details !== undefined) {
    if (splitTodoFiles(action.details).files !== '')
      throw new TodoChangeError('bad-request', FILES_HEADING_REFUSED);
  }
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
    if (action.kind === 'attach') await checkAttach(root, listed, action.path);
    // An older script (no canProject) moves the bytes as they are, so a private project's name would
    // reach todo/: refuse while the to-do is in one (decision 8; overseer sign-off, should 2).
    if (action.kind === 'move' && action.to === 'tds' && !list.canProject && inPersonalProject(listed)) {
      throw new TodoChangeError('not-allowed', TODO_PRIVATE_PROJECT_MESSAGE);
    }
    // A browser that saw canAttach sends details without the Files section and says so. If this check
    // now says otherwise (a capabilities probe failed), the whole body would be replaced and the links
    // lost: refuse as changed so the browser reloads instead (correctness review, release 3). An edit
    // without the flag is the whole body, as on main.
    if (
      action.kind === 'edit' &&
      action.detailsOnly === true &&
      !list.canAttach &&
      action.details !== undefined
    ) {
      throw todoChangeError('changed');
    }
  }
  // An older script would ignore `body` on add; the server only sends it when canAttach (decision 6).
  let run: TodoRunAction = action;
  if (action.kind === 'add' && action.details !== undefined && !list.canAttach) {
    const { details: _ignored, ...rest } = action;
    run = rest;
  }
  const result = await runner.run(
    run,
    { name: identity.name, slug: identity.slug },
    { keepFiles: action.kind === 'edit' && list.canAttach },
  );
  if (action.kind !== 'move') return {};
  const file = result.file !== null && okId(result.file) ? result.file : action.id;
  return { moved: { from: keyOf(action.scope, action.id), to: keyOf(action.to, file) } };
}

/** The app's own words for the release 3 refusals (UK English). */
export const TODO_FILES_MESSAGES = {
  headingInDetails:
    'The details can\'t have their own "Files" heading, because the files are listed under it. Rename that heading and try again.',
  notListable: "That file isn't in the library, so it can't be linked. It may have been moved or deleted.",
  full: `A task can have up to ${TODO_ATTACHMENTS_MAX} files. Remove one before adding another.`,
  uploadNotAllowed: "Adding new files to tasks isn't available to you in the app yet.",
  badType:
    "That kind of file can't be added to a task. Add a picture, PDF, Word document, spreadsheet, slide deck or text file.",
  saveFailed: "That file couldn't be saved to the library. Try again.",
  saveRefused: "That file couldn't be saved there in the library.",
} as const;

const FILES_HEADING_REFUSED = TODO_FILES_MESSAGES.headingInDetails;

/** Said when `add` worked and `attach` didn't: the file is in the library at `path`, just not linked. */
export function savedNotLinkedMessage(path: string): string {
  return `The file was saved to the library at ${path}, but it couldn't be linked to this task. Add it from the library instead.`;
}

/** Refuses `bad-request` unless `path` is a real, listable file and there is room on the to-do for it. */
async function checkAttach(root: string, listed: TodoItem, path: string): Promise<void> {
  const linked = listed.attachments.some((a) => a.path === path);
  if (!linked && listed.attachments.length >= TODO_ATTACHMENTS_MAX)
    throw new TodoChangeError('bad-request', TODO_FILES_MESSAGES.full);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    throw todoChangeError('internal');
  }
  if (!(await isListableFile(root, realRoot, path)))
    throw new TodoChangeError('bad-request', TODO_FILES_MESSAGES.notListable);
}

// ---------------------------------------------------------------------------
// Uploads (plan 2026-11-16-todo-attachments, decision 3): the server chooses where, the brain's
// `tdsapp-files` skill writes the file, then the to-do skill links it.
// ---------------------------------------------------------------------------

const PROTECTED = new Set<string>([...PROTECTED_NAMES, ...PROTECTED_CLIENT_FILES]);

/**
 * A staged file's name made safe to write in a `## Files` line and to save in the library: no
 * control or format characters, none of `% # ? \ / : < > " * | \``, square brackets become round ones,
 * spaces collapsed, no leading dots or dashes. The extension is kept; a name left empty becomes
 * `file.<ext>`, and a name the files skill protects (README.md, profile.md...) gets " (file)".
 */
export function cleanUploadName(raw: string): string {
  const ext = extOf(raw);
  let name = raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/[%#?\\/:<>"*|`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '');
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot).trim() : '';
  if (ext === '' || base === '' || name.slice(dot + 1).toLowerCase() !== ext) {
    return `file${ext ? `.${raw.slice(raw.length - ext.length)}` : ''}`;
  }
  name = `${base}${name.slice(dot)}`;
  // NFKC: the Mac's disk treats look-alikes (the long s, U+017F) as the plain letter (security review).
  if (PROTECTED.has(name.normalize('NFKC').toLowerCase())) name = `${base} (file)${name.slice(dot)}`;
  return name;
}

/**
 * Where an upload for this to-do goes (decision 3, overseer answer 2): a TDS to-do whose trimmed
 * `client:` is exactly a brain client's slug files under `clients/<slug>/images/` or `.../files/`
 * (by the library's kind); anything else, and every personal to-do, under `personal/images/` or
 * `personal/files/`. Null for a type not in TODO_UPLOAD_TYPES.
 */
export function uploadDestination(
  todo: Pick<TodoItem, 'scope' | 'client'>,
  clients: readonly Pick<ClientInfo, 'slug'>[],
  name: string,
): { path: string; personal: boolean } | null {
  const ext = extOf(name);
  const kind = classify(ext)?.kind;
  if (!TODO_UPLOAD_TYPES.includes(ext) || !kind) return null;
  const folder = kind === 'image' ? 'images' : 'files';
  const file = cleanUploadName(name);
  const client = todo.scope === 'tds' ? (todo.client ?? '').trim() : '';
  const slug = client !== '' ? clients.find((c) => c.slug === client)?.slug : undefined;
  if (slug !== undefined && !isNeverListed(`clients/${slug}/${folder}/${file}`))
    return { path: `clients/${slug}/${folder}/${file}`, personal: false };
  return { path: `personal/${folder}/${file}`, personal: true };
}

/** What an upload is: the staged file (its real path, outside the brain) and the to-do it goes on. */
export interface TodoUploadInput {
  stagedPath: string;
  name: string;
  id: string;
  scope: TodoScope;
  expect: string;
}

export interface TodoUploadDeps {
  history?: TodoHistory;
  /** The brain's clients (BrainReaders.clients). */
  clients: () => Promise<ClientInfo[]>;
  files: Pick<FilesSkillRunner, 'add' | 'capabilities'>;
  /** Called with the saved path once the file is in the library, so its listing can refresh. */
  onSaved?: (path: string) => void;
}

/** The files skill's refusal of an add, in the app's words. */
function saveError(err: unknown): TodoChangeError {
  const code: TodoChangeErrorCode =
    err instanceof FilesChangeError && (err.code === 'bad-request' || err.code === 'not-allowed')
      ? err.code
      : 'internal';
  return new TodoChangeError(
    code,
    code === 'not-allowed' ? TODO_FILES_MESSAGES.saveRefused : TODO_FILES_MESSAGES.saveFailed,
  );
}

/**
 * Files a staged upload into the library through `tdsapp-files add`, then links it with the to-do
 * script's `attach` (with `expect`). Every refusal the server can make comes before anything runs:
 * `not-allowed` unless canUpload (and canUsePersonal for a personal to-do), `bad-request` for bad
 * values or a type not in TODO_UPLOAD_TYPES or a full to-do, `not-found` and `changed` as changeTodo.
 * When `attach` fails after `add` worked, the error keeps attach's code and says where the file is.
 */
export async function uploadTodoFile(
  root: string,
  req: TodoUploadInput,
  identity: Identity,
  runner: TodoSkillRunner,
  deps: TodoUploadDeps,
): Promise<{ path: string; personal: boolean }> {
  const list = await listTodos(root, identity, {
    history: deps.history,
    capabilities: () => runner.capabilities(),
    filesCapabilities: () => deps.files.capabilities(),
  });
  if (list.changes !== 'on' || !list.canUpload)
    throw new TodoChangeError('not-allowed', TODO_FILES_MESSAGES.uploadNotAllowed);
  if (
    typeof req !== 'object' ||
    req === null ||
    !okId(req.id) ||
    !okScope(req.scope) ||
    !okExpect(req.expect) ||
    typeof req.stagedPath !== 'string' ||
    !isAbsolute(req.stagedPath) ||
    typeof req.name !== 'string'
  )
    throw todoChangeError('bad-request');
  if (req.scope === 'personal' && !list.canUsePersonal) throw todoChangeError('not-allowed');
  if (!TODO_UPLOAD_TYPES.includes(extOf(req.name)))
    throw new TodoChangeError('bad-request', TODO_FILES_MESSAGES.badType);
  const listed = [...list.mine, ...list.open].find((t) => t.id === req.id && t.scope === req.scope);
  if (!listed) throw todoChangeError('not-found');
  if (listed.version !== req.expect) throw todoChangeError('changed');
  if (listed.attachments.length >= TODO_ATTACHMENTS_MAX)
    throw new TodoChangeError('bad-request', TODO_FILES_MESSAGES.full);
  let clients: ClientInfo[];
  try {
    clients = await deps.clients();
  } catch {
    clients = [];
  }
  const dest = uploadDestination(listed, clients, req.name);
  if (!dest) throw new TodoChangeError('bad-request', TODO_FILES_MESSAGES.badType);
  const by = { name: identity.name, slug: identity.slug };
  let saved: string;
  try {
    saved = await deps.files.add({ source: req.stagedPath, path: dest.path, by });
  } catch (err) {
    throw saveError(err);
  }
  // The script may pick a free name, never another folder: anything else is not trusted or linked.
  const folder = dest.path.slice(0, dest.path.lastIndexOf('/') + 1);
  if (
    resolveTodoFilePath(saved) !== saved ||
    !saved.startsWith(folder) ||
    saved.slice(folder.length).includes('/')
  )
    throw todoChangeError('internal');
  deps.onSaved?.(saved);
  try {
    await runner.run({ kind: 'attach', id: req.id, path: saved, expect: req.expect, scope: req.scope }, by);
  } catch (err) {
    const code = err instanceof TodoChangeError ? err.code : 'internal';
    throw new TodoChangeError(code, savedNotLinkedMessage(saved));
  }
  return { path: saved, personal: saved.startsWith('personal/') };
}

/** What the app writes as the place a to-do was ticked. */
export const TICKED_VIA = APP_VIA;

export async function completeTodo(root: string, id: string, by: Identity, at: Date): Promise<void> {
  if (typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('That is not a task the app can tick off.');
  const live = await readFolder(root, 'tds', '', []);
  if (!live.some((t) => t.id === id))
    throw new Error('That task could not be found. It may already be done.');
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
      throw new Error('A finished task with that name already exists, so nothing was moved.');
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
