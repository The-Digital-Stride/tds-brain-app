/**
 * Reads the projects (plan docs/plans/2026-11-20-projects-system.md, decisions 1, 4, 4b, 8, 10, 13 and
 * 26): walks every projects location, reads each card, counts open to-dos, works out the team from
 * to-dos, and runs the tidy-up. Moving a project (docs/plans/2026-11-21-project-move.md) runs the
 * script's `move`, then re-points this Mac's open to-dos; old keys keep resolving through `movedFrom`. Writes nothing in the brain: changes go through the `tdsapp-projects`
 * script (projects-skill.ts) and to-do lines through `tdsapp-todo` (todo-skill.ts). The only file it
 * writes is `tidy-skips.json` in the app's own data folder.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type ClientInfo,
  type DoneTodoList,
  type Identity,
  TodoChangeError,
  type TodoList,
} from '../../shared/contract.ts';
import { PROJECTS_REFS_CAPABILITY, type RefIndex } from '../../shared/project-refs-contract.ts';
import {
  archivedFolderPath,
  archiveFolderFor,
  folderTitle,
  isProjectSlug,
  liveFolderFor,
  matchedKey,
  movedFolderPath,
  movedKey,
  parseLinkedFiles,
  parseProjectKey,
  resolveTodoProject,
  splitLinkedFiles,
} from '../../shared/projects.ts';
import {
  type CardState,
  INTERNAL_CLIENT,
  type Light,
  PROJECT_CARD_FILE,
  PROJECT_CHECKLIST_ITEM_MAX,
  PROJECT_CHECKLIST_MAX,
  PROJECT_MOVED_FROM_MAX,
  PROJECT_TITLE_MAX,
  PROJECTS_ARCHIVE_CAPABILITY,
  PROJECTS_CAPABILITY,
  PROJECTS_MOVE_CAPABILITY,
  type ProjectAction,
  type ProjectCard,
  type ProjectDoneRow,
  type ProjectKey,
  type ProjectKind,
  type ProjectList,
  type ProjectMoveCheckResponse,
  type ProjectMoveRequest,
  type ProjectMoveResult,
  type ProjectRemoveCheckResponse,
  type ProjectRemoveRequest,
  type ProjectRemoveResult,
  type ProjectRemoveTodo,
  type ProjectSpace,
  type ProjectStatus,
  ProjectsError,
  type ProjectTodoRow,
  type ProjectTodosResponse,
  TEAM_FROM_TODOS_DAYS,
  type TeamFromTodo,
  type TidyApply,
  type TidyList,
  type TidySuggestion,
  TODO_PROJECT_CAPABILITY,
  type TodoProjectMatch,
} from '../../shared/projects-contract.ts';
import { asString, type FrontmatterValue, parseFrontmatter } from './frontmatter.ts';
import { buildRefIndex, cleanRef } from './project-refs.ts';
import type { ProjectsSkillRunner } from './projects-skill.ts';
import { buildTidyRows, checkSuggestion, type TidyContext, type TidyTodo, tidyTarget } from './tidy.ts';
import { defaultGitRunner } from './todo-history.ts';
import type { TodoSkillRunner } from './todo-skill.ts';
import { memberSlug } from './util.ts';

export interface ProjectsIndex {
  /** Every project, personal ones only this Mac's. `openTodos` and `teamFromTodos` are filled by `list`. */
  cards: ProjectCard[];
  byKey(key: ProjectKey): ProjectCard | null;
  /** The projects a file belongs to: by folder prefix, or listed in a card's `## Linked files`. */
  keysForPath(brainRel: string): ProjectKey[];
  resolve(value: string | null, client: string | null, scope: 'tds' | 'personal'): TodoProjectMatch;
  /** Project codes (R2 phase 4b): every card, live and archived; personal and duplicate refs resolve to nothing. */
  refs?: RefIndex;
}

export interface ProjectsService {
  /** Cached like the library: 30 s stale without a watcher; `changed()` drops it. */
  index(): Promise<ProjectsIndex>;
  list(identity: Identity): Promise<ProjectList>;
  change(action: ProjectAction, identity: Identity): Promise<ProjectList>;
  /**
   * Move plan: `check: true` answers what the move would do; otherwise moves the folder, then re-points
   * this Mac's open to-dos (TDS ones and this person's personal ones) unless `todos` is false. Throws
   * ProjectsError.
   */
  move(
    req: ProjectMoveRequest,
    identity: Identity,
    opts?: { todos?: boolean },
  ): Promise<ProjectMoveCheckResponse | ProjectMoveResult>;
  /**
   * Archive plan: archive, unarchive or delete a project's folder. `check: true` answers what it would
   * touch plus the open to-dos linked to it. Otherwise the script changes the folder first, then each
   * listed to-do choice is applied (`opts.todos` false: a choice other than keep is refused up front).
   * Whether this person may is the script's answer alone. Throws ProjectsError.
   */
  remove(
    req: ProjectRemoveRequest,
    identity: Identity,
    opts?: { todos?: boolean },
  ): Promise<ProjectRemoveCheckResponse | ProjectRemoveResult>;
  tidy(identity: Identity): Promise<TidyList>;
  applyTidy(apply: TidyApply, identity: Identity): Promise<TidyList>;
  /** Every open to-do in the project (UX B2): all TDS ones, whoever has them, and this person's own personal ones. */
  projectTodos(key: ProjectKey, identity: Identity): Promise<ProjectTodosResponse>;
  /** Drops the caches (the watcher, and after a write). */
  changed(brainRel?: string): void;
}

export interface ProjectsOptions {
  skill: ProjectsSkillRunner;
  todoSkill: TodoSkillRunner;
  clients: () => Promise<ClientInfo[]>;
  /** The app's own data folder, for `tidy-skips.json`. Null: skips are kept in memory only. */
  dataDir: string | null;
  now?: () => Date;
  /** Runs read-only git (lastChanged, which personal folders git tracks). Injectable for tests. */
  git?: (args: string[], cwd: string) => Promise<string>;
  /**
   * Whether the brain's `tdsapp-projects` skill allows this person (its `roles:`). Feeds
   * `ProjectList.canChange` and refuses `change`. Missing: everyone (tests and older wiring).
   */
  mayChange?: (identity: Identity) => Promise<boolean>;
  /**
   * This person's to-do list, for `projectTodos`' `mine` (in `mine` or `open`). Missing: worked out
   * here by the same rule (theirs, an open TDS one, or their own personal one).
   */
  todoList?: (identity: Identity) => Promise<Pick<TodoList, 'mine' | 'open'>>;
  /**
   * This person's finished to-dos (the same reader as the Done tab), for `projectTodos`' `done` rows.
   * Missing or failing: no `done` (older behaviour).
   */
  doneTodos?: (identity: Identity) => Promise<DoneTodoList>;
  /** After a move, archive, unarchive or delete: the old and new folders (brain-relative), so the library drops both from its caches. */
  onMoved?: (from: string, to: string) => void;
}

/** How long a read is reused when no watcher says the brain changed. */
export const PROJECTS_STALE_MS = 30_000;
export const TIDY_SKIPS_FILE = 'tidy-skips.json';
const GIT_PARALLEL = 4;
const LABEL_MAX = 200;
const DAY_MS = 86_400_000;

const KINDS: readonly ProjectKind[] = ['one-off', 'ongoing'];
const STATUSES: readonly ProjectStatus[] = ['planned', 'active', 'on-hold', 'done'];
const LIGHTS: readonly Light[] = ['green', 'amber', 'red'];
const RULES_FILES = new Set(['claude.md', 'readme.md', 'agents.md']);

/**
 * A git merge conflict: a `<<<<<<<` line, then a `=======` line, then a `>>>>>>>` line, as the
 * `tdsapp-projects` script reads it. One marker alone is not one, so a brief with a `=======`
 * divider stays readable and editable.
 */
export function hasConflict(src: string): boolean {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^<{7}(?: |$)/.test(l));
  if (start === -1) return false;
  const mid = lines.findIndex((l, i) => i > start && /^={7}[ \t]*$/.test(l));
  return mid !== -1 && lines.some((l, i) => i > mid && /^>{7}(?: |$)/.test(l));
}

// ─── Small readers ──────────────────────────────────────────────────────────────────────────────────

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function lstat(path: string) {
  try {
    return await fs.lstat(path);
  } catch {
    return null;
  }
}

/** Real sub-folders (no links), by name. */
async function folders(path: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** As the script's LEFTOVER_FILES_MAX: a bigger card-less folder is never a leftover. */
const LEFTOVER_FILES_MAX = 200;

/**
 * The files in a card-less folder, folder-relative, as the script's `looseFiles`; null when there are
 * too many or anything isn't a plain file or folder (then it is never a leftover).
 */
async function looseFiles(abs: string): Promise<string[] | null> {
  const files: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const sub = stack.pop() as string;
    let names: string[];
    try {
      names = await fs.readdir(sub === '' ? abs : join(abs, ...sub.split('/')));
    } catch {
      return null;
    }
    for (const name of names) {
      const rel = sub === '' ? name : `${sub}/${name}`;
      const st = await lstat(join(abs, ...rel.split('/')));
      if (!st || st.isSymbolicLink()) return null;
      if (st.isDirectory()) stack.push(rel);
      else if (st.isFile()) files.push(rel);
      else return null;
      if (files.length + stack.length > LEFTOVER_FILES_MAX) return null;
    }
  }
  return files;
}

/**
 * As the script's `onlyIgnored`: a card-less shared folder (live or archive) holding at least one
 * file, every one of which git ignores. False when git can't tell or the brain isn't a repository.
 */
async function onlyIgnored(
  root: string,
  git: NonNullable<ProjectsOptions['git']>,
  c: Pick<ProjectCard, 'space' | 'folder'>,
): Promise<boolean> {
  if (c.space === 'personal') return false;
  const files = await looseFiles(join(root, ...c.folder.split('/')));
  if (!files || files.length === 0) return false;
  const rels = files.map((f) => `${c.folder}/${f}`);
  try {
    const ignored = new Set((await git(['check-ignore', '-z', '--', ...rels], root)).split('\0'));
    return rels.every((r) => ignored.has(r));
  } catch {
    // git check-ignore exits 1 when nothing is ignored; any failure means "not a leftover".
    return false;
  }
}

function text(v: FrontmatterValue | undefined): string | null {
  const s = asString(v).trim();
  return s === '' ? null : s;
}

function list(v: FrontmatterValue | undefined): string[] {
  if (v === undefined) return [];
  const items = Array.isArray(v) ? v : v.split(',');
  return items.map((x) => x.trim()).filter((x) => x !== '');
}

function oneOf<T extends string>(v: FrontmatterValue | undefined, allowed: readonly T[]): T | null {
  const s = text(v);
  return s !== null && (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

function date(v: FrontmatterValue | undefined): string | null {
  const s = text(v);
  return s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** The first `# ` heading of a folder's README.md, outside code fences, or null. */
async function readmeTitle(folderAbs: string): Promise<string | null> {
  let src: string;
  try {
    src = await fs.readFile(join(folderAbs, 'README.md'), 'utf8');
  } catch {
    return null;
  }
  let fence: string | null = null;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence !== null) {
      if (f && (f[1] as string)[0] === fence[0] && (f[1] as string).length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1] as string;
      continue;
    }
    const m = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (m) {
      const title = (m[1] as string).replace(/\s+/g, ' ').trim().slice(0, PROJECT_TITLE_MAX).trim();
      return title === '' ? null : title;
    }
  }
  return null;
}

// ─── The walk ─────────────────────────────────────────────────────────────────────────────────────

interface Location {
  key: ProjectKey;
  space: ProjectSpace;
  slug: string;
  client: string | null;
  folder: string;
  archived: boolean;
}

interface Walk {
  cards: ProjectCard[];
  duplicates: string[];
  /** Move plan B1: card-less folders whose key a live card's movedFrom lists. Not in `cards`. */
  leftovers: string[];
  skippedFolders: number;
  clients: string[];
}

interface Roles {
  byEmail: Map<string, string>;
}

async function readRoles(root: string): Promise<Roles> {
  const byEmail = new Map<string, string>();
  try {
    const members: unknown = JSON.parse(
      await fs.readFile(join(root, '.team-config', 'roles.json'), 'utf8'),
    ).members;
    if (Array.isArray(members)) {
      for (const m of members) {
        if (m && typeof m.email === 'string' && typeof m.name === 'string' && memberSlug(m.name))
          byEmail.set(m.email.toLowerCase(), memberSlug(m.name));
      }
    }
  } catch {
    /* no roles: git names are shown as they are */
  }
  return { byEmail };
}

async function readCard(root: string, loc: Location): Promise<ProjectCard> {
  const folderAbs = join(root, ...loc.folder.split('/'));
  const fallbackTitle = async () => (await readmeTitle(folderAbs)) ?? folderTitle(loc.slug);
  const st = await lstat(join(folderAbs, PROJECT_CARD_FILE));
  let state: CardState = 'none';
  let data: Record<string, FrontmatterValue> = {};
  let body = '';
  let version = '';
  if (st) {
    state = 'unreadable';
    if (st.isFile()) {
      try {
        const bytes = await fs.readFile(join(folderAbs, PROJECT_CARD_FILE));
        const src = bytes.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
        const lines = src.split('\n');
        const hasBlock = lines[0] === '---' && lines.slice(1).includes('---');
        if (hasBlock && !hasConflict(src)) {
          const fm = parseFrontmatter(src);
          state = 'ok';
          data = fm.data;
          body = fm.body;
          version = sha256(bytes);
        }
      } catch {
        /* unreadable */
      }
    }
  }
  const checklist = (await lstat(join(folderAbs, 'todo.md')))?.isFile() ? `${loc.folder}/todo.md` : null;
  const checklistOpen = checklist === null ? null : await readChecklistOpen(join(folderAbs, 'todo.md'));
  const links = parseLinkedFiles(body).filter((p) => loc.space === 'personal' || !p.startsWith('personal/'));
  // Move plan decision 4: the keys it had before, well-formed, never its own, the newest MAX.
  const movedFrom = [
    ...new Set(list(data.moved_from).filter((k) => parseProjectKey(k) !== null && k !== loc.key)),
  ].slice(-PROJECT_MOVED_FROM_MAX);
  const budget = Number(text(data.budget_hours) ?? Number.NaN);
  const billable = text(data.billable);
  return {
    key: loc.key,
    space: loc.space,
    slug: loc.slug,
    client: loc.client,
    folder: loc.folder,
    card: state,
    archived: loc.archived,
    title: text(data.title) ?? (await fallbackTitle()),
    kind: oneOf(data.kind, KINDS),
    status: loc.archived ? 'done' : (oneOf(data.status, STATUSES) ?? 'active'),
    health: oneOf(data.health, LIGHTS),
    comms: oneOf(data.comms, LIGHTS),
    owner: text(data.owner),
    team: list(data.team),
    service: list(data.service),
    start: date(data.start),
    end: date(data.end),
    budgetHours: Number.isFinite(budget) && budget >= 0 ? budget : null,
    billable: billable === 'true' ? true : billable === 'false' ? false : null,
    stages: list(data.stages),
    mondayId: text(data.monday_id),
    ref: cleanRef(text(data.ref)),
    created: text(data.created),
    createdBy: text(data.created_by),
    lastChanged: null,
    brief: splitLinkedFiles(body).brief,
    links,
    version,
    openTodos: 0,
    teamFromTodos: [],
    checklist,
    ...(checklistOpen !== null ? { checklistOpen } : {}),
    ...(movedFrom.length > 0 ? { movedFrom } : {}),
  };
}

/** A checklist bigger than this is left unread: its items aren't shown. */
const CHECKLIST_READ_MAX = 256 * 1024;

/**
 * Brain compat decision 10: the unticked items under a legacy `todo.md`'s `## Active` heading, read the
 * way the Workbench reads them (`tools/members/command-centre/lib/todo-parser.cjs`). Unreadable → [].
 */
async function readChecklistOpen(path: string): Promise<string[]> {
  try {
    if (((await lstat(path))?.size ?? 0) > CHECKLIST_READ_MAX) return [];
    const lines = (await fs.readFile(path, 'utf8')).split(/\r?\n/);
    const items: string[] = [];
    let inActive = false;
    for (const line of lines) {
      if (/^##\s+Active\s*$/i.test(line)) {
        inActive = true;
        continue;
      }
      if (inActive && /^#{1,2}\s+/.test(line)) break;
      if (!inActive) continue;
      const m = /^\s*-\s*\[\s\]\s*(.+?)\s*$/.exec(line);
      if (!m?.[1]) continue;
      items.push(m[1].slice(0, PROJECT_CHECKLIST_ITEM_MAX));
      if (items.length >= PROJECT_CHECKLIST_MAX) break;
    }
    return items;
  } catch {
    return [];
  }
}

async function walk(root: string, git: NonNullable<ProjectsOptions['git']>): Promise<Walk> {
  const locations: Location[] = [];
  let skippedFolders = 0;
  // Project folders under `base`, keyed under `client` ('personal' for personal ones).
  const projectsIn = async (base: string, client: string | null, space: ProjectSpace, archived: boolean) => {
    for (const name of await folders(join(root, ...base.split('/')))) {
      if (name.startsWith('.')) continue;
      if (!isProjectSlug(name)) {
        skippedFolders++;
        continue;
      }
      locations.push({
        key: `${client ?? 'personal'}/${name}`,
        space,
        slug: name,
        client,
        folder: `${base}/${name}`,
        archived,
      });
    }
  };
  const clientDirs = (await folders(join(root, 'clients'))).filter(
    (c) => !c.startsWith('_') && !c.startsWith('.'),
  );
  const live = clientDirs.filter(isProjectSlug);
  // The Digital Stride's own folder first: INTERNAL_PRECEDENCE.
  const ordered = [
    ...live.filter((c) => c === INTERNAL_CLIENT),
    ...live.filter((c) => c !== INTERNAL_CLIENT),
  ];
  for (const c of ordered) await projectsIn(`clients/${c}/projects`, c, 'client', false);
  await projectsIn('projects', INTERNAL_CLIENT, 'legacy', false);
  // Archive plan decision 1: archives come after every live folder, each location explicit about
  // `archived` and `space` (never worked out from its name).
  if (live.includes(INTERNAL_CLIENT))
    await projectsIn(`clients/${INTERNAL_CLIENT}/projects-archive`, INTERNAL_CLIENT, 'client', true);
  await projectsIn('projects-archive', INTERNAL_CLIENT, 'legacy', true);
  for (const c of ordered.filter((c) => c !== INTERNAL_CLIENT))
    await projectsIn(`clients/${c}/projects-archive`, c, 'client', true);
  const archivedClients = (await folders(join(root, 'clients', '_archive'))).filter(isProjectSlug);
  for (const c of archivedClients) await projectsIn(`clients/_archive/${c}/projects`, c, 'client', true);

  // Personal: only real folders, and never anything git tracks (that came from someone else's Mac).
  const personalBases = ['personal/projects', 'personal/projects-archive'] as const;
  const personalLinked = await Promise.all(
    ['personal', ...personalBases].map(async (rel) =>
      (await lstat(join(root, ...rel.split('/'))))?.isSymbolicLink(),
    ),
  );
  if (!personalLinked.some(Boolean)) {
    let tracked = new Set<string>();
    try {
      const out = await git(['ls-files', '-z', '--', ...personalBases], root);
      tracked = new Set(out.split('\0').filter(Boolean));
    } catch {
      /* not a git repository: nothing is tracked */
    }
    for (const base of personalBases) {
      const before = locations.length;
      await projectsIn(base, null, 'personal', base.endsWith('-archive'));
      for (let i = locations.length - 1; i >= before; i--) {
        const slug = (locations[i] as Location).slug;
        if ([...tracked].some((p) => p.startsWith(`${base}/${slug}/`))) locations.splice(i, 1);
      }
    }
  }

  const all = await Promise.all(locations.map((loc) => readCard(root, loc)));
  // Archive plan decision 2 (leftovers). These rules copy the script's `foldersOf` and `locate`
  // (brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs), which is the source of truth, so the
  // list and the script always read the same folder for a key:
  // - A key's folders are taken in reader precedence (the walk order above, per key).
  // - A folder is a leftover when it has no `project.md` at all AND either
  //   (a) it is a live folder and some archive folder for the key has a plain-file `project.md`, or
  //   (b) it is not personal and holds at least one file, every one of them git-ignored, with no
  //       link or special file and at most LEFTOVER_FILES_MAX entries (git unable to tell: not a leftover).
  //   Rule (b) applies to archive folders too.
  // - The key reads the first folder that is not a leftover, else the first leftover. Other leftovers
  //   go in `leftovers`; other non-leftover folders go in `duplicates`. A leftover is never a project.
  const groups = new Map<ProjectKey, ProjectCard[]>();
  for (const c of all) {
    const group = groups.get(c.key);
    if (group) group.push(c);
    else groups.set(c.key, [c]);
  }
  const isLeftover = new Map<ProjectCard, boolean>();
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const plain = await Promise.all(
        group.map(async (c) =>
          c.archived && c.card !== 'none'
            ? Boolean((await lstat(join(root, ...c.folder.split('/'), PROJECT_CARD_FILE)))?.isFile())
            : false,
        ),
      );
      const cardedArchive = plain.some(Boolean);
      await Promise.all(
        group.map(async (c) => {
          const flag =
            c.card === 'none' && ((!c.archived && cardedArchive) || (await onlyIgnored(root, git, c)));
          isLeftover.set(c, flag);
        }),
      );
    }),
  );
  const picks = new Map<ProjectKey, ProjectCard>();
  for (const [key, group] of groups) {
    picks.set(key, group.find((c) => !isLeftover.get(c)) ?? (group[0] as ProjectCard));
  }
  const strays: string[] = [];
  const duplicates: string[] = [];
  const read: ProjectCard[] = [];
  for (const c of all) {
    if (isLeftover.get(c)) strays.push(c.folder);
    else if (picks.get(c.key) === c) read.push(c);
    else duplicates.push(c.folder);
  }
  // B1: git deletes only tracked files, so a moved project's old folder can linger on a teammate's Mac
  // with no card. The alias wins: the folder is a leftover, not a project. Never a `personal/` one:
  // a moved card syncs to teammates, where `personal/` is THEIR private folder, which always wins
  // over the alias (card or not). The alias then applies only on a Mac with no such folder.
  const aliases = new Set(read.flatMap((c) => c.movedFrom ?? []));
  const leftovers = [
    ...strays,
    ...read
      .filter((c) => c.card === 'none' && c.space !== 'personal' && aliases.has(c.key))
      .map((c) => c.folder),
  ].filter((f, i, a) => a.indexOf(f) === i);
  const cards = read.filter((c) => !leftovers.includes(c.folder));
  // S8: links written before a move into a moved project's old folder follow it.
  if (aliases.size > 0) {
    for (const c of cards) c.links = [...new Set(c.links.map((p) => movedFolderPath(p, cards)))];
  }
  // Archive plan S5: links into an archived project's old live folder follow it into the archive.
  if (cards.some((c) => c.archived)) {
    for (const c of cards) c.links = [...new Set(c.links.map((p) => archivedFolderPath(p, cards)))];
  }

  const roles = await readRoles(root);
  const shared = cards.filter((c) => c.space !== 'personal');
  for (let i = 0; i < shared.length; i += GIT_PARALLEL) {
    await Promise.all(
      shared.slice(i, i + GIT_PARALLEL).map(async (c) => {
        try {
          const out = (await git(['log', '-1', '--format=%an%x00%ae%x00%aI', '--', c.folder], root)).trim();
          const [name, email, at] = out.split('\0');
          if (!at) return;
          const by = roles.byEmail.get((email ?? '').toLowerCase()) ?? (name ?? '').trim();
          if (by) c.lastChanged = { by, at: at.trim() };
        } catch {
          /* outside git or unknown */
        }
      }),
    );
  }
  return { cards, duplicates, leftovers, skippedFolders, clients: [...clientDirs, ...archivedClients] };
}

// ─── To-dos ───────────────────────────────────────────────────────────────────────────────────────

interface TodoRec {
  id: string;
  scope: 'tds' | 'personal';
  done: boolean;
  title: string;
  client: string | null;
  assignee: string | null;
  project: string | null;
  stage: string | null;
  /** YYYY-MM-DD from `due`, else null. */
  due: string | null;
  /** The latest of created / assigned_at (and the done date), YYYY-MM-DD, or ''. */
  lastActive: string;
  /** completed_at, else completed (YYYY-MM-DD); null when neither (decision 26). */
  doneDate: string | null;
  version: string;
}

const day = (v: FrontmatterValue | undefined) => {
  const s = text(v);
  return s !== null && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

async function readTodoDir(
  root: string,
  rel: string,
  scope: 'tds' | 'personal',
  done: boolean,
): Promise<TodoRec[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(join(root, ...rel.split('/')), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TodoRec[] = [];
  for (const e of entries) {
    if (
      !e.isFile() ||
      !e.name.endsWith('.md') ||
      e.name.startsWith('.') ||
      RULES_FILES.has(e.name.toLowerCase())
    )
      continue;
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(join(root, ...rel.split('/'), e.name));
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(bytes.toString('utf8'));
    const h1 = /^#\s+(.+?)\s*$/m.exec(body);
    const doneDate = done ? (day(data.completed_at) ?? day(data.completed)) : null;
    const fileDate = /^(\d{4})(\d{2})(\d{2})-/.exec(e.name);
    const dates = [day(data.created), day(data.assigned_at), doneDate].filter((d): d is string => d !== null);
    if (dates.length === 0 && fileDate) dates.push(`${fileDate[1]}-${fileDate[2]}-${fileDate[3]}`);
    out.push({
      id: e.name,
      scope,
      done,
      title: text(data.title) ?? (h1 ? (h1[1] as string) : e.name.replace(/\.md$/, '')),
      client: text(data.client),
      assignee: text(data.assignee),
      project: text(data.project),
      stage: text(data.stage),
      due: date(data.due),
      lastActive: dates.sort().at(-1) ?? '',
      doneDate,
      version: sha256(bytes),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function readTodos(root: string): Promise<TodoRec[]> {
  const [open, done, personal] = await Promise.all([
    readTodoDir(root, 'todo', 'tds', false),
    readTodoDir(root, 'todo/done', 'tds', true),
    readTodoDir(root, 'personal/todo', 'personal', false),
  ]);
  return [...open, ...done, ...personal];
}

/** This person's own personal to-do (personal/todo/ is this Mac's; one for nobody counts as theirs). */
const ownPersonal = (t: TodoRec, identity: Identity) => !t.assignee || t.assignee === identity.slug;

// ─── The service ────────────────────────────────────────────────────────────────────────────────────

function makeIndex(w: Walk, clients: string[], refs: RefIndex): ProjectsIndex {
  const byKey = new Map(w.cards.map((c) => [c.key, c]));
  return {
    cards: w.cards,
    // A live project at the key, else the one it moved to (move plan decision 5).
    byKey: (key) => {
      const live = byKey.get(key);
      if (live) return live;
      const moved = movedKey(key, w.cards);
      return moved === null ? null : (byKey.get(moved) ?? null);
    },
    keysForPath: (rel) =>
      w.cards.filter((c) => rel.startsWith(`${c.folder}/`) || c.links.includes(rel)).map((c) => c.key),
    resolve: (value, client, scope) => resolveTodoProject(value, client, scope, w.cards, clients),
    refs,
  };
}

export function createProjects(root: string, opts: ProjectsOptions): ProjectsService {
  const now = opts.now ?? (() => new Date());
  const git = opts.git ?? ((args: string[], cwd: string) => defaultGitRunner(args, cwd));
  let indexCache: {
    at: number;
    value: Promise<{ index: ProjectsIndex; walk: Walk; clients: string[] }>;
  } | null = null;
  let todoCache: { at: number; value: Promise<TodoRec[]> } | null = null;
  let memorySkips: string[] = [];

  const fresh = (at: number) => now().getTime() - at < PROJECTS_STALE_MS;
  const mayChange = (identity: Identity) =>
    opts.mayChange ? opts.mayChange(identity).catch(() => false) : Promise.resolve(true);

  const load = () => {
    if (indexCache && fresh(indexCache.at)) return indexCache.value;
    const value = (async () => {
      const [walked, infos] = await Promise.all([
        walk(root, git),
        opts.clients().catch(() => [] as ClientInfo[]),
      ]);
      const clients = [...new Set([...infos.map((c) => c.slug), ...walked.clients])];
      const refResult = buildRefIndex(
        walked.cards.map((c) => ({ key: c.key, space: c.space, client: c.client, ref: c.ref ?? null })),
        new Map(infos.map((c) => [c.slug, c.code ?? null] as const)),
      );
      const w: Walk = {
        ...walked,
        cards: walked.cards.map((c) => {
          const info = refResult.byKey.get(c.key);
          return info
            ? {
                ...c,
                ref: info.ref,
                refState: info.refState,
                ...(info.refDuplicateOf ? { refDuplicateOf: info.refDuplicateOf } : {}),
              }
            : c;
        }),
      };
      return { index: makeIndex(w, clients, refResult.index), walk: w, clients };
    })();
    indexCache = { at: now().getTime(), value };
    value.catch(() => {
      if (indexCache?.value === value) indexCache = null;
    });
    return value;
  };

  const todos = () => {
    if (todoCache && fresh(todoCache.at)) return todoCache.value;
    const value = readTodos(root);
    todoCache = { at: now().getTime(), value };
    value.catch(() => {
      if (todoCache?.value === value) todoCache = null;
    });
    return value;
  };

  const changed = () => {
    indexCache = null;
    todoCache = null;
  };

  // ── tidy-skips.json, in the app's data folder (never the brain) ──
  const skipsPath = opts.dataDir ? join(opts.dataDir, TIDY_SKIPS_FILE) : null;
  const readSkips = async (): Promise<string[]> => {
    if (!skipsPath) return memorySkips;
    try {
      const labels: unknown = JSON.parse(await fs.readFile(skipsPath, 'utf8')).labels;
      return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string') : [];
    } catch {
      return [];
    }
  };
  const writeSkips = async (labels: string[]) => {
    const sorted = [...new Set(labels)].sort();
    if (!skipsPath || !opts.dataDir) {
      memorySkips = sorted;
      return;
    }
    await fs.mkdir(opts.dataDir, { recursive: true });
    const tmp = `${skipsPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ v: 1, labels: sorted }, null, 2)}\n`);
    await fs.rename(tmp, skipsPath);
  };

  const tidyContext = (loaded: { walk: Walk; clients: string[] }): TidyContext => ({
    projects: loaded.walk.cards,
    clients: loaded.clients,
  });

  const tidyTodos = (all: TodoRec[], identity: Identity): TidyTodo[] =>
    all
      .filter((t) => !t.done && (t.scope === 'tds' || ownPersonal(t, identity)))
      .map((t) => ({
        id: t.id,
        scope: t.scope,
        title: t.title,
        client: t.client,
        assignee: t.assignee,
        version: t.version,
        project: t.project,
        stage: t.stage,
      }));

  const rowsFor = async (identity: Identity) => {
    const loaded = await load();
    const ctx = tidyContext(loaded);
    const pool = tidyTodos(await todos(), identity);
    return { rows: buildTidyRows(pool, ctx), pool, ctx };
  };

  const tidy = async (identity: Identity): Promise<TidyList> => {
    const [{ rows }, skipped] = await Promise.all([rowsFor(identity), readSkips()]);
    return { rows: rows.filter((r) => !skipped.includes(r.label)), skipped: [...skipped].sort() };
  };

  const list = async (identity: Identity): Promise<ProjectList> => {
    const loaded = await load();
    const { index, walk: w } = loaded;
    const all = await todos();
    const cutoff = new Date(now().getTime() - TEAM_FROM_TODOS_DAYS * DAY_MS).toISOString().slice(0, 10);
    const open = new Map<ProjectKey, number>();
    const team = new Map<ProjectKey, Map<string, TeamFromTodo>>();
    for (const t of all) {
      if (t.scope === 'personal' && !ownPersonal(t, identity)) continue;
      const key = matchedKey(index.resolve(t.project, t.client, t.scope));
      if (key === null) continue;
      if (!t.done) open.set(key, (open.get(key) ?? 0) + 1);
      // Decision 26: TDS to-dos only, open or done within the window by their own done date.
      if (t.scope !== 'tds' || !t.assignee) continue;
      if (t.done && (t.doneDate === null || t.doneDate < cutoff)) continue;
      const people = team.get(key) ?? new Map<string, TeamFromTodo>();
      const entry = people.get(t.assignee) ?? { person: t.assignee, openTodos: 0, lastActive: '' };
      if (!t.done) entry.openTodos += 1;
      if (t.lastActive > entry.lastActive) entry.lastActive = t.lastActive;
      people.set(t.assignee, entry);
      team.set(key, people);
    }
    const projects = w.cards.map((c) => {
      const named = new Set([...(c.owner ? [c.owner] : []), ...c.team]);
      const fromTodos =
        c.space === 'personal'
          ? []
          : [...(team.get(c.key)?.values() ?? [])]
              .filter((p) => !named.has(p.person))
              .sort(
                (a, b) =>
                  b.openTodos - a.openTodos ||
                  b.lastActive.localeCompare(a.lastActive) ||
                  a.person.localeCompare(b.person),
              );
      return { ...c, openTodos: open.get(c.key) ?? 0, teamFromTodos: fromTodos };
    });
    const [features, todoFeatures, allowed, tidied] = await Promise.all([
      opts.skill.capabilities().catch(() => [] as string[]),
      opts.todoSkill.capabilities().catch(() => [] as readonly string[]),
      mayChange(identity),
      tidy(identity),
    ]);
    const canChange = features.includes(PROJECTS_CAPABILITY) && allowed;
    const canRef = canChange && features.includes(PROJECTS_REFS_CAPABILITY);
    return {
      projects,
      canChange,
      // Move plan S2: moving re-points to-dos, so it needs the to-do script's `project` action too.
      canMove:
        canChange &&
        features.includes(PROJECTS_MOVE_CAPABILITY) &&
        todoFeatures.includes(TODO_PROJECT_CAPABILITY),
      // Archive plan decision 11: the script's own capability, and the same roles check as any change.
      canArchive: canChange && features.includes(PROJECTS_ARCHIVE_CAPABILITY),
      // Project codes (R2 phase 4b): the script's own capability; "all" is the brain's Owner only.
      canRef,
      canRefAll: canRef && identity.role === 'owner',
      looseLabels: tidied.rows.length,
      duplicates: w.duplicates,
      leftovers: w.leftovers,
      skippedFolders: w.skippedFolders,
    };
  };

  const change = async (action: ProjectAction, identity: Identity): Promise<ProjectList> => {
    const bad = () =>
      new ProjectsError('bad-request', "That change couldn't be saved. Check the details and try again.");
    if (!action || typeof action !== 'object') throw bad();
    if (!['create', 'card', 'edit', 'link', 'unlink', 'ref'].includes(action.kind)) throw bad();
    if (!(await mayChange(identity))) {
      throw new ProjectsError('not-allowed', "Changing projects isn't available to you in the app yet.");
    }
    const caps = await opts.skill.capabilities().catch(() => [] as string[]);
    if (!caps.includes(PROJECTS_CAPABILITY)) {
      throw new ProjectsError('not-allowed', "Update the brain's skills to change projects.");
    }
    if (action.kind === 'ref') {
      if (!caps.includes(PROJECTS_REFS_CAPABILITY)) {
        throw new ProjectsError('not-allowed', "Update the brain's skills to give projects codes.");
      }
      // Decision 5: a backfill of every card is the brain Owner's alone (the script checks too).
      if (action.all === true && identity.role !== 'owner') {
        throw new ProjectsError('not-allowed', 'Only the brain Owner can give every project a code at once.');
      }
    }
    if ('key' in action && action.key !== undefined) {
      const card = (await load()).index.byKey(action.key);
      if (card?.archived) throw new ProjectsError('not-allowed', 'Archived projects are read only.');
      if (
        card &&
        action.kind === 'link' &&
        card.space !== 'personal' &&
        action.path.startsWith('personal/')
      ) {
        throw new ProjectsError(
          'not-allowed',
          "A shared project can't link a personal file: it would show the team something private.",
        );
      }
    }
    try {
      await opts.skill.run(action);
    } finally {
      changed();
    }
    return list(identity);
  };

  const move = async (
    req: ProjectMoveRequest,
    identity: Identity,
    moveOpts: { todos?: boolean } = {},
  ): Promise<ProjectMoveCheckResponse | ProjectMoveResult> => {
    const bad = () =>
      new ProjectsError('bad-request', "That move couldn't be made. Check the details and try again.");
    if (!req || typeof req !== 'object' || typeof req.expect !== 'string') throw bad();
    if (
      req.filesExpect !== undefined &&
      (typeof req.filesExpect !== 'string' || !/^[0-9a-f]{64}$/.test(req.filesExpect))
    )
      throw bad();
    const from = parseProjectKey(req.key);
    if (!from || typeof req.client !== 'string' || req.client === 'personal' || !isProjectSlug(req.client))
      throw bad();
    if (!(await mayChange(identity))) {
      throw new ProjectsError('not-allowed', "Changing projects isn't available to you in the app yet.");
    }
    const [features, todoFeatures] = await Promise.all([
      opts.skill.capabilities().catch(() => [] as string[]),
      opts.todoSkill.capabilities().catch(() => [] as readonly string[]),
    ]);
    if (!features.includes(PROJECTS_MOVE_CAPABILITY) || !todoFeatures.includes(TODO_PROJECT_CAPABILITY)) {
      throw new ProjectsError('not-allowed', "Update the brain's skills to move projects.");
    }
    // The to-dos to re-point are chosen from a fresh read, before the move.
    if (req.check !== true) changed();
    const { index } = await load();
    const card = index.cards.find((c) => c.key === req.key) ?? null;
    if (card?.archived) throw new ProjectsError('not-allowed', 'Archived projects are read only.');
    const newKey = `${req.client}/${from.slug}`;
    // The script refuses any folder there; an old key another project still answers to counts too.
    const there = index.byKey(newKey);
    if (there && there.key !== req.key) {
      throw new ProjectsError(
        'exists',
        `There's already a project called ${from.slug} for that client, or one that was moved from there.`,
      );
    }
    const pool =
      card && moveOpts.todos !== false
        ? (await todos()).filter(
            (t) =>
              !t.done &&
              (t.scope === 'tds' || ownPersonal(t, identity)) &&
              matchedKey(index.resolve(t.project, t.client, t.scope)) === card.key,
          )
        : [];
    const base = {
      kind: 'move',
      key: req.key,
      client: req.client,
      expect: req.expect,
      // Security review: the check's file fingerprint, so a file saved meanwhile can't move unlisted.
      ...(req.filesExpect !== undefined ? { filesExpect: req.filesExpect } : {}),
    } as const;
    if (req.check === true) {
      const r = await opts.skill.run({ ...base, check: true });
      if (!r.check) throw new ProjectsError('internal', "The move couldn't be checked. Try again.");
      return { check: r.check, todos: pool.length };
    }
    let result: { key: ProjectKey; version: string };
    try {
      const ran = await opts.skill.run({
        ...base,
        ...(req.dropPersonal === true ? { dropPersonal: true } : {}),
      });
      if (ran.key === undefined)
        throw new ProjectsError('internal', 'The move could not be made. Try again.');
      result = { key: ran.key, version: ran.version };
    } finally {
      changed();
    }
    const oldFolder =
      card?.folder ??
      (from.client === 'personal'
        ? `personal/projects/${from.slug}`
        : `clients/${from.client}/projects/${from.slug}`);
    opts.onMoved?.(oldFolder, `clients/${req.client}/projects/${from.slug}`);
    // Decision 7: the to-dos follow, keeping their stage. A failure leaves one on the old key, which
    // still resolves through movedFrom, so none is fatal.
    let todosMoved = 0;
    for (const t of pool) {
      try {
        await opts.todoSkill.run({
          kind: 'project',
          id: t.id,
          scope: t.scope,
          client: req.client,
          project: result.key,
          stage: t.stage,
          expect: t.version,
        });
        todosMoved++;
      } catch {
        /* counted in todosLeft */
      }
    }
    if (pool.length > 0) changed();
    return { list: await list(identity), key: result.key, todosMoved, todosLeft: pool.length - todosMoved };
  };

  const remove = async (
    req: ProjectRemoveRequest,
    identity: Identity,
    removeOpts: { todos?: boolean } = {},
  ): Promise<ProjectRemoveCheckResponse | ProjectRemoveResult> => {
    const bad = () =>
      new ProjectsError('bad-request', "That change couldn't be made. Check the details and try again.");
    if (!req || typeof req !== 'object') throw bad();
    const kind = req.action;
    if (kind !== 'archive' && kind !== 'unarchive' && kind !== 'delete') throw bad();
    if (!parseProjectKey(req.key)) throw bad();
    for (const v of [req.expect, req.filesExpect]) {
      if (v !== undefined && (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))) throw bad();
    }
    if (req.check !== undefined && req.check !== true) throw bad();
    const choices = req.todos ?? [];
    if (!Array.isArray(choices) || (req.check === true && choices.length > 0)) throw bad();
    const allowedDo: readonly string[] =
      kind === 'archive' ? ['done', 'keep'] : kind === 'delete' ? ['delete', 'unlink'] : [];
    const seenChoice = new Set<string>();
    for (const c of choices) {
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || c.id === '') throw bad();
      if (c.scope !== 'tds' && c.scope !== 'personal') throw bad();
      if (typeof c.version !== 'string' || !/^[0-9a-f]{64}$/.test(c.version)) throw bad();
      if (!allowedDo.includes(c.do) || seenChoice.has(`${c.scope}:${c.id}`)) throw bad();
      seenChoice.add(`${c.scope}:${c.id}`);
    }
    if (!(await mayChange(identity))) {
      throw new ProjectsError('not-allowed', "Changing projects isn't available to you in the app yet.");
    }
    const [features, todoFeatures] = await Promise.all([
      opts.skill.capabilities().catch(() => [] as string[]),
      opts.todoSkill.capabilities().catch(() => [] as readonly string[]),
    ]);
    if (!features.includes(PROJECTS_ARCHIVE_CAPABILITY)) {
      throw new ProjectsError('not-allowed', "Update the brain's skills to archive or delete projects.");
    }
    const acting = choices.filter((c) => c.do !== 'keep');
    if (acting.length > 0 && removeOpts.todos === false) {
      throw new ProjectsError(
        'not-allowed',
        'Changing tasks is switched off, so they can only be kept. Turn on changes to the shared brain in Settings first.',
      );
    }
    if (acting.some((c) => c.do === 'unlink') && !todoFeatures.includes(TODO_PROJECT_CAPABILITY)) {
      throw new ProjectsError('not-allowed', "Update the brain's skills to unlink tasks.");
    }
    // The to-dos are chosen from a fresh read, before the folder changes.
    if (req.check !== true) changed();
    const { index } = await load();
    const card = index.cards.find((c) => c.key === req.key) ?? null;
    const linked = (done: boolean) =>
      card && kind !== 'unarchive'
        ? todos().then((all) =>
            all.filter(
              (t) =>
                t.done === done &&
                (t.scope === 'tds' || ownPersonal(t, identity)) &&
                matchedKey(index.resolve(t.project, t.client, t.scope)) === card.key,
            ),
          )
        : Promise.resolve([] as TodoRec[]);
    const pool = await linked(false);
    const base = {
      kind,
      key: req.key,
      ...(req.expect !== undefined ? { expect: req.expect } : {}),
      ...(req.filesExpect !== undefined ? { filesExpect: req.filesExpect } : {}),
    } as const;
    if (req.check === true) {
      const r = await opts.skill.run({ ...base, check: true });
      if (!r.removeCheck) throw new ProjectsError('internal', "That couldn't be checked. Try again.");
      const rows: ProjectRemoveTodo[] = pool.map((t) => ({
        id: t.id,
        title: t.title,
        scope: t.scope,
        assignee: t.assignee,
        version: t.version,
      }));
      return { check: r.removeCheck, todos: rows, doneTodos: (await linked(true)).length };
    }
    // Correctness review: a to-do that is no longer an open linked one (a teammate ticked or
    // unlinked it since the check) is dropped, never a reason to refuse: counted neither way.
    const byId = new Map(pool.map((t) => [`${t.scope}:${t.id}`, t]));
    const applying = acting.filter((c) => byId.has(`${c.scope}:${c.id}`));
    let leftBehind: string | undefined;
    try {
      leftBehind = (await opts.skill.run(base)).leftBehind;
    } finally {
      changed();
    }
    if (card) {
      const other =
        kind === 'delete'
          ? card.folder
          : kind === 'archive'
            ? archiveFolderFor(card.folder)
            : liveFolderFor(card.folder);
      opts.onMoved?.(card.folder, other ?? card.folder);
    }
    // Folder first, then each to-do through tdsapp-todo. A failure is named, never fatal.
    const by = { name: identity.name, slug: identity.slug };
    let todosChanged = 0;
    const todosFailed: string[] = [];
    for (const c of applying) {
      const t = byId.get(`${c.scope}:${c.id}`) as TodoRec;
      try {
        await opts.todoSkill.run(
          c.do === 'done'
            ? { kind: 'tick', id: t.id, scope: t.scope, expect: c.version }
            : c.do === 'delete'
              ? { kind: 'delete', id: t.id, scope: t.scope, expect: c.version }
              : {
                  kind: 'project',
                  id: t.id,
                  scope: t.scope,
                  client: t.client,
                  project: null,
                  stage: null,
                  expect: c.version,
                },
          by,
        );
        todosChanged++;
      } catch {
        todosFailed.push(t.id);
      }
    }
    if (applying.length > 0) changed();
    return {
      list: await list(identity),
      key: req.key,
      todosChanged,
      todosFailed,
      ...(kind === 'delete' && leftBehind !== undefined ? { leftBehind } : {}),
    };
  };

  const applyTidy = async (apply: TidyApply, identity: Identity): Promise<TidyList> => {
    const bad = () =>
      new ProjectsError('bad-request', "That change to the old label couldn't be made. Try again.");
    if (!apply || typeof apply !== 'object' || typeof apply.label !== 'string') throw bad();
    const label = apply.label.trim();
    if (label === '' || label.length > LABEL_MAX) throw bad();
    if (apply.do === 'skip' || apply.do === 'unskip') {
      const skips = await readSkips();
      await writeSkips(apply.do === 'skip' ? [...skips, label] : skips.filter((l) => l !== label));
      return tidy(identity);
    }
    if (apply.do !== 'approve' || !apply.suggestion || typeof apply.suggestion !== 'object') throw bad();
    const { rows, pool, ctx } = await rowsFor(identity);
    const row = rows.find((r) => r.label === label);
    if (!row) return tidy(identity);
    const s: TidySuggestion = checkSuggestion(row.todos, apply.suggestion, ctx);
    if (s.do === 'skip') {
      await writeSkips([...(await readSkips()), label]);
      return tidy(identity);
    }
    if (s.do === 'new-project') {
      // Making a project is a projects change: the same roles check as `change` (fix-round review).
      if (!(await mayChange(identity))) {
        throw new ProjectsError('not-allowed', "Changing projects isn't available to you in the app yet.");
      }
      const title = /[A-Z ]/.test(label) && label.length <= PROJECT_TITLE_MAX ? label : folderTitle(s.slug);
      try {
        await opts.skill.run(
          s.client === null
            ? { kind: 'create', space: 'personal', slug: s.slug, fields: { title } }
            : { kind: 'create', space: 'client', client: s.client, slug: s.slug, fields: { title } },
        );
      } catch (err) {
        // Made meanwhile (another Mac, a sync): link to it instead.
        if (!(err instanceof ProjectsError && err.code === 'exists')) throw err;
      }
      changed();
    }
    // The row's to-dos and its conflicts: a changed suggestion may take in a to-do the offered one left out.
    // Each by its own scope, and only while it still carries this label, so a personal to-do that shares
    // a file name with a TDS one is never touched (review fix, release 1).
    const ids = new Set([
      ...row.todos.map((t) => `${t.scope}:${t.id}`),
      ...row.conflicts.map((c) => `${c.scope}:${c.id}`),
    ]);
    for (const t of pool) {
      if (!ids.has(`${t.scope}:${t.id}`) || (t.project ?? '').trim() !== row.label) continue;
      const target = tidyTarget(t, s);
      if (target === null) continue;
      try {
        await opts.todoSkill.run({ kind: 'project', id: t.id, scope: t.scope, ...target, expect: t.version });
      } catch (err) {
        // The row is re-read below, so a to-do that changed meanwhile simply stays in it.
        if (!(err instanceof TodoChangeError)) throw err;
      }
    }
    changed();
    return tidy(identity);
  };

  const projectTodos = async (key: ProjectKey, identity: Identity): Promise<ProjectTodosResponse> => {
    const { index } = await load();
    const card = index.byKey(key);
    if (!card)
      throw new ProjectsError('not-found', "That project couldn't be found. It may have been moved.");
    const [all, listed] = await Promise.all([
      todos(),
      opts.todoList ? opts.todoList(identity).catch(() => null) : Promise.resolve(null),
    ]);
    const keyOf = (t: TodoRec) => (t.scope === 'personal' ? `personal/${t.id}` : t.id);
    const theirs = listed ? new Set([...listed.mine, ...listed.open].map((t) => t.key)) : null;
    const isMine = (t: TodoRec) =>
      theirs
        ? theirs.has(keyOf(t))
        : t.scope === 'personal' || t.assignee === null || t.assignee === identity.slug;
    // The same to-dos `list` counts as openTodos: open, TDS or this person's own personal ones.
    const rows: ProjectTodoRow[] = all
      .filter((t) => !t.done && (t.scope === 'tds' || ownPersonal(t, identity)))
      .filter((t) => matchedKey(index.resolve(t.project, t.client, t.scope)) === card.key)
      .map((t) => ({
        key: keyOf(t),
        id: t.id,
        scope: t.scope,
        title: t.title,
        assignee: t.assignee,
        due: t.due,
        stage: t.stage,
        mine: isMine(t),
      }))
      .sort(
        (a, b) =>
          (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
          a.title.localeCompare(b.title) ||
          a.key.localeCompare(b.key),
      );
    const response: ProjectTodosResponse = { todos: rows, count: rows.length };
    if (opts.doneTodos) {
      try {
        const doneRows: ProjectDoneRow[] = (await opts.doneTodos(identity)).items
          .filter(
            (t) => matchedKey(t.projectMatch ?? index.resolve(t.project, t.client, t.scope)) === card.key,
          )
          .map((t) => ({
            key: t.key,
            id: t.id,
            scope: t.scope,
            title: t.title,
            assignee: t.assignee,
            stage: t.stage,
            doneDate: t.done && /^\d{4}-\d{2}-\d{2}/.test(t.done.at) ? t.done.at.slice(0, 10) : null,
            doneBy: t.done?.name ?? null,
          }));
        response.done = doneRows;
        response.doneCount = doneRows.length;
      } catch {
        // No Done section: the open to-dos still answer.
      }
    }
    return response;
  };

  return {
    index: async () => (await load()).index,
    list,
    change,
    move,
    remove,
    tidy,
    applyTidy,
    projectTodos,
    changed: () => changed(),
  };
}
