import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  type AskedTodo,
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
import { outsideProjectNote } from '../../shared/project-visibility.ts';
import {
  LEGACY_PROJECTS_SCOPE,
  PROJECT_KEY_PATTERN,
  PROJECT_STAGE_MAX,
  TODO_PROJECT_CAPABILITY,
  type TodoProjectMatch,
} from '../../shared/projects-contract.ts';
import {
  parseTodoFiles,
  parseTodoLinks,
  resolveTodoFilePath,
  splitTodoFiles,
} from '../../shared/todo-files.ts';
import { handBackTarget, isTodoLinkUrl, splitTodoSections, todoTimeline } from '../../shared/todo-updates.ts';
import {
  TODO_LINK_NAME_MAX,
  TODO_LINK_URL_MAX,
  TODO_UPDATE_MAX,
  TODO_UPDATES_SHOWN_MAX,
  type TodoLastChange,
  type TodoTimelineFields,
} from '../../shared/todo-updates-contract.ts';
import { stampDone } from './done-record.ts';
import { FILES_ADD_CAPABILITY, FILES_SKILL, type FilesSkillRunner, findFilesSkill } from './files-skill.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { type Member, readMembers } from './identity.ts';
import { idFor, isHiddenCallNote } from './library.ts';
import {
  classify,
  extOf,
  isHiddenInTemplates,
  isInSharedProjectFolder,
  isNeverListed,
} from './library-rules.ts';
import { type AssignAnswer, isHiddenPath, type ProjectsIndex, type TaskPlace } from './projects.ts';
import { skillAccess } from './skills.ts';
import type { GitAuthor, TodoHistory } from './todo-history.ts';
import {
  APP_VIA,
  findTodoSkill,
  TODO_ATTACH_CAPABILITY,
  TODO_LINKS_CAPABILITY,
  TODO_PRIVATE_PROJECT_MESSAGE,
  TODO_UPDATES_CAPABILITY,
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
    // 0.7: this pass-on was a hand back.
    ...(lower(data.assigned_back) === 'true' ? { back: true } : {}),
    source: 'stamp',
  };
}

/**
 * The timeline fields every task shape carries (shared/todo-updates-contract.ts): the notes, script
 * entries and handover lines from the body, the newest TODO_UPDATES_SHOWN_MAX of them, the web links in
 * `## Files`, the newest entry as `lastChange` and `created_at`. A slug that isn't on the team is `by: null`.
 */
export function timelineFields(
  data: Record<string, string | string[]>,
  body: string,
  team: readonly TeamMember[],
): TodoTimelineFields {
  const { updates: all, extras } = todoTimeline(body);
  const known = new Set(team.map((m) => m.slug));
  // A handover line carries no slug (decision 5a): match its written name to the roster, exactly and only when
  // one member has it, so "my own pass-on" is told apart by slug, not by a name that may differ.
  const slugOfName = (name: string): string | null => {
    const hits = team.filter((m) => m.name === name);
    return hits.length === 1 && hits[0] ? hits[0].slug : null;
  };
  const withBy = all.map((u) => {
    if (u.kind === 'handover') return u.by === null ? { ...u, by: slugOfName(u.byName) } : u;
    return u.by !== null && !known.has(u.by) ? { ...u, by: null } : u;
  });
  const newest = withBy[withBy.length - 1];
  const lastChange: TodoLastChange | null = newest
    ? { at: newest.at, by: newest.by, byName: newest.byName, action: newest.action }
    : null;
  return {
    updates: withBy.slice(-TODO_UPDATES_SHOWN_MAX),
    updatesMore: withBy.length > TODO_UPDATES_SHOWN_MAX,
    updateExtras: extras,
    links: parseTodoLinks(body),
    lastChange,
    createdAt: asString(data.created_at).trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Restricted projects (plan 2026-11-27-restricted-projects, decision 6). THE task rule, applied by every
// reader and every change: a task whose project is hidden from this person is served, opened or changed
// only when it is assigned to them (Asked: only when they asked for it). It then carries
// `projectMatch: { how: 'restricted' }` with `project` and `stage` null, so nothing sent names the project.
// ---------------------------------------------------------------------------

/** The projects index as the to-do readers have it: null when none was given, 'unread' when it failed. */
export type TaskIndex = ProjectsIndex | 'unread' | null;

/** Reads the index once for one answer. A failure is kept as 'unread' so the rule can fail closed. */
export async function readTaskIndex(projects?: () => Promise<ProjectsIndex>): Promise<TaskIndex> {
  if (!projects) return null;
  try {
    return await projects();
  } catch {
    return 'unread';
  }
}

/** The index to resolve labels with, or null. */
export const usableIndex = (index: TaskIndex): ProjectsIndex | null => (index === 'unread' ? null : index);

/**
 * What the rule does with one task. `allowed`: it is assigned to this person (Asked: they asked for it).
 * With an unreadable index nobody can say which projects are hidden, so a project-labelled task that
 * isn't allowed is hidden rather than shown (decision 4). No index given (tests, older wiring): shown.
 */
export function taskRule(
  index: TaskIndex,
  task: { project?: string | null; projectMatch?: TodoProjectMatch },
  allowed: boolean,
): 'show' | 'mask' | 'hide' {
  if (index === null) return 'show';
  if (index === 'unread') return (task.project ?? null) !== null && !allowed ? 'hide' : 'show';
  if (task.projectMatch?.how !== 'restricted') return 'show';
  return allowed ? 'mask' : 'hide';
}

/** A served task in a hidden project: its own `project` and `stage` would name it, so both go. */
export function maskTask<T extends { project?: string | null }>(task: T): T {
  return { ...task, project: null, ...('stage' in task ? { stage: null } : {}) };
}

/** Which brain paths are a hidden project's: none without an index, every project folder when it failed. */
export function hiddenPathOf(index: TaskIndex): (rel: string) => boolean {
  if (index === null) return () => false;
  if (index === 'unread') return isInSharedProjectFolder;
  return (rel) => isHiddenPath(index, rel);
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
 * `hidden` (restricted projects): a file in a hidden project's folder gets no `libraryId`, as the library
 * won't open it.
 */
export function createAttachmentReader(
  root: string,
  me: string,
  hidden: (rel: string) => boolean = () => false,
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
        const mayOpen =
          scope !== null && (!personal || (me !== '' && link.holder === me)) && !hidden(link.path);
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
      ...timelineFields(data, body, team),
    });
  }
  return items;
}

async function readAll(root: string, me: string, team: TeamMember[], index: TaskIndex): Promise<TodoItem[]> {
  const attachments = createAttachmentReader(root, me, hiddenPathOf(index));
  const projects = usableIndex(index);
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
  return (await buildTodoList(root, identity, deps)).list;
}

/**
 * The list as served, plus what a change needs behind it: each served task as its file says (by key,
 * before masking, so the assign block sees a hidden project's real label) and the index it was read with.
 */
async function buildTodoList(
  root: string,
  identity: Identity,
  deps: TodoListDeps,
): Promise<{ list: TodoList; files: Map<string, TodoItem>; index: TaskIndex }> {
  const [team, access] = await Promise.all([readTeam(root), changeAccess(root, identity)]);
  const index = await readTaskIndex(deps.projects);
  const isMine = (t: TodoItem) => t.assignee !== null && t.assignee === identity.slug;
  // THE task rule before anything is counted: a hidden task isn't mine, open or among other people's.
  const files = new Map<string, TodoItem>();
  const items: TodoItem[] = [];
  for (const t of await readAll(root, identity.slug, team, index)) {
    const seen = taskRule(index, t, isMine(t));
    if (seen === 'hide') continue;
    files.set(t.key, t);
    items.push(seen === 'mask' ? maskTask(t) : t);
  }
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
  const canUpdate = features.includes(TODO_UPDATES_CAPABILITY);
  const canLink = features.includes(TODO_LINKS_CAPABILITY);
  const canUpload = canAttach && (await canUseFilesAdd(root, identity, deps.filesCapabilities));
  const list: TodoList = {
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
    canUpdate,
    canLink,
  };
  return { list, files, index };
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const NOT_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** An update's text: 1 to TODO_UPDATE_MAX characters after trimming, no control character but \n \r \t. */
const okUpdateText = (v: unknown) =>
  typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= TODO_UPDATE_MAX && !NOT_TEXT.test(v);
const okNote = (v: unknown) => v === undefined || okUpdateText(v);
/**
 * A line of an update's text that starts (after spaces) with ``` or ~~~: the script refuses it, so the
 * route does first, in the app's own words (review round 1). Lines split as the script splits them.
 */
const holdsCodeBlock = (v: unknown) =>
  typeof v === 'string' && v.split(/\r\n?|\n|[\u2028\u2029]/).some((l) => /^\s*(?:```|~~~)/.test(l));
const okLinkUrl = (v: unknown) => typeof v === 'string' && v.length <= TODO_LINK_URL_MAX && isTodoLinkUrl(v);
const okLinkName = (v: unknown) =>
  v === undefined ||
  (typeof v === 'string' &&
    v.trim().length >= 1 &&
    v.trim().length <= TODO_LINK_NAME_MAX &&
    !/[\r\n[\]]/.test(v) &&
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
      return (
        okId(a.id) &&
        (a.assignee === null || okAssignee(a.assignee)) &&
        okNote(a.note) &&
        (a.back === undefined || (a.back === true && a.assignee !== null))
      );
    case 'delete':
      return okId(a.id);
    case 'tick':
      return okId(a.id) && okScope(a.scope) && okNote(a.note);
    case 'update':
      return okId(a.id) && okUpdateText(a.text);
    case 'link':
      return okId(a.id) && okLinkUrl(a.url) && okLinkName(a.name);
    case 'unlink':
      return okId(a.id) && okLinkUrl(a.url);
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

/** What `changeTodo` may use beyond the brain's files. */
export interface TodoChangeDeps extends Pick<TodoListDeps, 'history' | 'projects'> {
  /**
   * Restricted projects (decision 7): may a task in this place be given to this person? Asked before the
   * script runs for `add`, `assignee`, `project` and `move` to TDS. Missing (tests, older wiring): no block.
   */
  assignCheck?: (place: TaskPlace, assignee: string | null) => Promise<AssignAnswer>;
  /**
   * Task updates (decision 8): this person's Asked list, so `update` (and nothing else) can reach a task
   * they passed on that is still waiting. Missing (tests, older wiring): no such task is reachable.
   */
  asked?: (who: Identity) => Promise<{ waiting: AskedTodo[] }>;
}

/**
 * The assign block (decision 7): the task's place and person as they will be after the change, read from
 * the task's file where the action doesn't set them. Null when the change can't put a task anywhere new.
 */
function placeAfter(
  action: TodoAction | TodoTickAction,
  file: TodoItem | null,
): { place: TaskPlace; assignee: string | null } | null {
  switch (action.kind) {
    case 'add':
      return {
        place: {
          project: action.project ?? null,
          client: action.client ?? null,
          scope: action.scope ?? 'tds',
        },
        assignee: action.assignee,
      };
    case 'assignee':
      return file
        ? {
            place: { project: file.project, client: file.client, scope: file.scope },
            assignee: action.assignee,
          }
        : null;
    case 'project':
      return file
        ? {
            place: { project: action.project, client: action.client, scope: file.scope },
            assignee: file.assignee,
          }
        : null;
    case 'move':
      if (action.to !== 'tds' || !file) return null;
      return {
        place: { project: action.dropProject ? null : file.project, client: file.client, scope: 'tds' },
        assignee: file.assignee,
      };
    default:
      return null;
  }
}

/**
 * Refuses, before the script runs, a change that would point a task at a project this person can't see
 * (as the script refuses one that doesn't exist: `bad-request`) or leave a restricted project's task with
 * someone who can't see it (`not-allowed`, with the note the form shows). An index or check that can't be
 * read refuses rather than guesses.
 */
async function assignBlock(
  action: TodoAction | TodoTickAction,
  file: TodoItem | null,
  index: TaskIndex,
  check: TodoChangeDeps['assignCheck'],
): Promise<void> {
  const after = placeAfter(action, file);
  if (!after || after.place.project === null) return;
  if (action.kind === 'add' || action.kind === 'project') {
    if (index === 'unread') throw todoChangeError('internal');
    const match = index?.resolve(after.place.project, after.place.client, after.place.scope);
    if (match?.how === 'restricted') throw todoChangeError('bad-request');
  }
  // Open to anyone is always allowed: whoever takes it is checked when it is passed to them.
  if (!check || after.assignee === null) return;
  let answer: AssignAnswer;
  try {
    answer = await check(after.place, after.assignee);
  } catch {
    throw todoChangeError('internal');
  }
  if (!answer.ok) throw new TodoChangeError('not-allowed', outsideProjectNote(answer.name));
}

/**
 * One change, run by the brain's `todo` skill script. Refuses `not-allowed` unless `changes` is
 * 'on' (and, for anything personal, `canUsePersonal`), `bad-request` for values outside the
 * Workbench's rules (and personal changes without `expect`), `not-found` for an id that is
 * not listed for this person in that scope (theirs or open; THE task rule leaves out a hidden project's
 * task that isn't theirs), `changed` when `expect` is not the listed version, and the assign block, all
 * before anything runs.
 */
export async function changeTodo(
  root: string,
  action: TodoAction | TodoTickAction,
  identity: Identity,
  runner: TodoSkillRunner,
  deps: TodoChangeDeps = {},
): Promise<TodoChangeResult> {
  const { list, files, index } = await buildTodoList(root, identity, {
    history: deps.history,
    capabilities: () => runner.capabilities(),
    projects: deps.projects,
  });
  if (list.changes !== 'on') throw todoChangeError('not-allowed');
  if (typeof action !== 'object' || action === null) throw todoChangeError('bad-request');
  if ((action.kind === 'attach' || action.kind === 'detach') && !list.canAttach)
    throw todoChangeError('not-allowed');
  if (usesProjectFields(action) && !list.canProject) throw todoChangeError('not-allowed');
  if (action.kind === 'update' && !list.canUpdate) throw todoChangeError('not-allowed');
  if ((action.kind === 'link' || action.kind === 'unlink') && !list.canLink)
    throw todoChangeError('not-allowed');
  if (!validAction(action, list.canAddOpen)) throw todoChangeError('bad-request');
  const updateText =
    action.kind === 'update'
      ? action.text
      : action.kind === 'assignee' || action.kind === 'tick'
        ? action.note
        : undefined;
  if (holdsCodeBlock(updateText)) throw new TodoChangeError('bad-request', TODO_UPDATES_MESSAGES.codeBlock);
  // `note` and `back` are for a script that writes the log (updates-v1); an older one would ignore them.
  if ((action.kind === 'assignee' || action.kind === 'tick') && action.note !== undefined && !list.canUpdate)
    throw todoChangeError('bad-request');
  if (action.kind === 'assignee' && action.back !== undefined && !list.canUpdate)
    throw todoChangeError('bad-request');
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
  // A new file has no `## Updates` or `## Handover history` section to keep, so a typed heading would be
  // lost or double up.
  if (action.kind === 'add' && list.canUpdate && action.details !== undefined) {
    const typed = splitTodoSections(action.details);
    if (typed.updates !== '')
      throw new TodoChangeError('bad-request', TODO_UPDATES_MESSAGES.headingInDetails);
    if (typed.handover !== '')
      throw new TodoChangeError('bad-request', TODO_UPDATES_MESSAGES.handoverInDetails);
  }
  const personal = action.kind === 'move' || action.scope === 'personal';
  if (personal && !list.canUsePersonal) throw todoChangeError('not-allowed');
  if (personal) {
    // A personal to-do belongs to its person alone: no passing it on, and an add is always theirs.
    if (action.kind === 'assignee') throw todoChangeError('bad-request');
    if (action.kind === 'add' && action.assignee !== identity.slug) throw todoChangeError('bad-request');
    if ('id' in action && action.expect === undefined) throw todoChangeError('bad-request');
  }
  let onDisk: TodoItem | null = null;
  if ('id' in action) {
    const scope: TodoScope = action.scope ?? 'tds';
    const listed = [...list.mine, ...list.open].find((t) => t.id === action.id && t.scope === scope);
    if (!listed) {
      // Decision 8: the asker may add an update to a task they passed on while it waits, and nothing else.
      if (action.kind !== 'update' || scope !== 'tds') throw todoChangeError('not-found');
      const asked = await askedWaiting(deps.asked, identity, action.id);
      // THE task rule: a hidden project's task (or any project one while the index can't be read) stays refused.
      if (
        !asked ||
        asked.projectMatch?.how === 'restricted' ||
        (index === 'unread' && asked.project !== null)
      )
        throw todoChangeError('not-found');
      if (action.expect !== undefined && asked.version !== action.expect) throw todoChangeError('changed');
      await runner.run(action, { name: identity.name, slug: identity.slug });
      return {};
    }
    // The task as its file says: a served task in a hidden project has its label masked.
    onDisk = files.get(listed.key) ?? listed;
    if (action.expect !== undefined && listed.version !== action.expect) throw todoChangeError('changed');
    if (action.kind === 'assignee') {
      // A hand back goes to the one person `handBackTarget` names, as the button does.
      if (action.back === true) {
        const target = action.assignee === null ? null : handBackTarget(listed, identity.slug, list.team);
        if (target === null || target.slug !== action.assignee) throw todoChangeError('bad-request');
      }
      // The script refuses a note on a pass-on to the person who already has it: nothing was passed on.
      if (action.note !== undefined && action.assignee === listed.assignee)
        throw todoChangeError('bad-request');
    }
    if (action.kind === 'edit' && list.canUpdate && action.details !== undefined) {
      // Without a section on disk a typed heading would be lost (review round 1: `## Handover history` too).
      const typed = splitTodoSections(action.details);
      const filed = splitTodoSections(onDisk.details);
      // A section sent back exactly as filed goes on to the script, which keeps its own. One that differs is
      // text the person typed (the script would refuse it without words they can act on).
      if (typed.updates !== '' && typed.updates.trim() !== filed.updates.trim())
        throw new TodoChangeError('bad-request', TODO_UPDATES_MESSAGES.headingInDetails);
      if (typed.handover !== '' && typed.handover.trim() !== filed.handover.trim())
        throw new TodoChangeError('bad-request', TODO_UPDATES_MESSAGES.handoverInDetails);
    }
    if (action.kind === 'attach') await checkAttach(root, listed, action.path, index);
    // An older script (no canProject) moves the bytes as they are, so a private project's name would
    // reach todo/: refuse while the to-do is in one (decision 8; overseer sign-off, should 2).
    if (action.kind === 'move' && action.to === 'tds' && !list.canProject && inPersonalProject(onDisk)) {
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
  await assignBlock(action, onDisk, index, deps.assignCheck);
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

/** The app's own words for the 0.7 refusals (UK English). */
export const TODO_UPDATES_MESSAGES = {
  headingInDetails:
    'The details can\'t have their own "Updates" heading, because the updates are listed under it. Rename that heading and try again.',
  handoverInDetails:
    'The details can\'t have their own "Handover history" heading, because the task\'s handovers are listed under it. Rename that heading and try again.',
  codeBlock: "An update can't hold a code block.",
} as const;

/** This person's waiting Asked task with that id, or null (also when the list can't be read). */
async function askedWaiting(
  asked: TodoChangeDeps['asked'],
  identity: Identity,
  id: string,
): Promise<AskedTodo | null> {
  if (!asked) return null;
  try {
    return (await asked(identity)).waiting.find((t) => t.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this person may add updates to tasks: changes are on and the script lists `updates-v1`. For the
 * Asked list's `canUpdate` (decision 8). A probe that fails answers false.
 */
export async function canUpdateTodos(
  root: string,
  identity: Identity,
  capabilities: () => Promise<readonly string[]>,
): Promise<boolean> {
  try {
    if ((await changeAccess(root, identity)).changes !== 'on') return false;
    return (await capabilities()).includes(TODO_UPDATES_CAPABILITY);
  } catch {
    return false;
  }
}

/** Said when `add` worked and `attach` didn't: the file is in the library at `path`, just not linked. */
export function savedNotLinkedMessage(path: string): string {
  return `The file was saved to the library at ${path}, but it couldn't be linked to this task. Add it from the library instead.`;
}

/**
 * Refuses `bad-request` unless `path` is a real, listable file and there is room on the to-do for it.
 * Restricted projects: a hidden project's file (in its folder, or a call note naming it) gets the very
 * answer a missing file gets, so a guessed path never confirms that a hidden file exists. With an
 * unreadable index every project folder's file, and every call note naming a project, is refused (decision 4).
 */
async function checkAttach(root: string, listed: TodoItem, path: string, index: TaskIndex): Promise<void> {
  const linked = listed.attachments.some((a) => a.path === path);
  if (!linked && listed.attachments.length >= TODO_ATTACHMENTS_MAX)
    throw new TodoChangeError('bad-request', TODO_FILES_MESSAGES.full);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    throw todoChangeError('internal');
  }
  if (
    hiddenPathOf(index)(path) ||
    !(await isListableFile(root, realRoot, path)) ||
    (await isHiddenCallNote(root, index, path))
  )
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
  /** The projects index, for THE task rule: a hidden project's task that isn't theirs is not found. */
  projects?: () => Promise<ProjectsIndex>;
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
    projects: deps.projects,
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

export async function completeTodo(
  root: string,
  id: string,
  by: Identity,
  at: Date,
  deps: Pick<TodoListDeps, 'projects'> = {},
): Promise<void> {
  if (typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('That is not a task the app can tick off.');
  const index = await readTaskIndex(deps.projects);
  const live = await readFolder(root, 'tds', '', [], null, usableIndex(index));
  const item = live.find((t) => t.id === id);
  // THE task rule: a hidden project's task that isn't theirs is answered as one that isn't there.
  if (!item || taskRule(index, item, item.assignee !== null && item.assignee === by.slug) === 'hide')
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
