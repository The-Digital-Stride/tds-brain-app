/**
 * Projects R2 phase 3 (plan docs/plans/2026-11-23-projects-r2-activity.md): "Since you last looked" and
 * "Coming up" for a project's Overview. Everything is worked out on read from readers that already exist (the
 * projects index, the To-dos tab's read, the Files tab's read, the updates log); the only thing kept is this
 * person's snapshot per project in the app's data folder (server/store/project-seen.ts). Never writes the brain.
 *
 * `read` also remembers, in memory, the snapshot of exactly what it saw under a random token. `seen` commits that
 * snapshot only for a matching, live token, so something that synced in while the page was open stays unseen.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Identity } from '../../shared/contract.ts';
import {
  ACTIVITY_MAX,
  ACTIVITY_TOKEN_TTL_MS,
  type ActivityItem,
  COMING_UP_DAYS,
  type ComingUpItem,
  PROJECT_SEEN_LIST_MAX,
  type ProjectActivityResponse,
  type ProjectSeen,
} from '../../shared/project-activity-contract.ts';
import { type ProjectUpdatesResponse, UPDATES_PAGE } from '../../shared/project-updates-contract.ts';
import {
  type ProjectCard,
  type ProjectFilesResponse,
  type ProjectKey,
  ProjectsError,
  type ProjectTodosResponse,
} from '../../shared/projects-contract.ts';
import type { ProjectSeenStore } from '../store/project-seen.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import type { ProjectsIndex } from './projects.ts';
import { SAFE_ID } from './todos.ts';

/** What a finished to-do's file says (`todo/done/<id>`), or null when there is no such file. */
export interface DoneInfo {
  title: string | null;
  /** Team slug from `completed_by`. */
  by: string | null;
  /** ISO time from `completed_at`. */
  at: string | null;
}

/** Reads `todo/done/<id>`: its title, who finished it and when. Null when the id isn't a plain to-do name or the file is absent. */
export async function readDoneInfo(root: string, id: string): Promise<DoneInfo | null> {
  if (!SAFE_ID.test(id)) return null;
  let text: string;
  try {
    text = await fs.readFile(join(root, 'todo', 'done', id), 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(text);
  const h1 = /^#\s+(.+?)\s*$/m.exec(body);
  const at = asString(data.completed_at).trim();
  return {
    title: asString(data.title).trim() || h1?.[1] || null,
    by: asString(data.completed_by).trim() || null,
    at: at !== '' && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null,
  };
}

export interface ProjectActivityDeps {
  index: () => Promise<ProjectsIndex>;
  /** The To-dos tab's read (it applies the own-personal rule). */
  todos: (key: ProjectKey, identity: Identity) => Promise<ProjectTodosResponse>;
  /** The Files tab's read, both kinds. */
  files: (card: ProjectCard, identity: Identity) => Promise<ProjectFilesResponse>;
  /** The updates log, newest first (the first page is enough: only entries after `since` are used). */
  updates: (key: ProjectKey, identity: Identity) => Promise<ProjectUpdatesResponse>;
  /** `todo/done/<id>` for a TDS to-do id; null when it isn't there. */
  done: (id: string) => Promise<DoneInfo | null>;
  /** Team slug → display name. */
  roster: () => Promise<Map<string, string>>;
  store: ProjectSeenStore;
  now?: () => Date;
  /** A new token. Default: 16 random bytes in hex. */
  token?: () => string;
}

export interface ProjectActivityService {
  read(key: ProjectKey, identity: Identity): Promise<ProjectActivityResponse>;
  /** Commits the snapshot a read holds for this token; any other token (or key) does nothing. */
  seen(key: ProjectKey, token: string, identity: Identity): Promise<void>;
}

const DAY_MS = 86_400_000;
const KIND_ORDER: ActivityItem['kind'][] = [
  'update',
  'status',
  'todo-added',
  'todo-closed',
  'file-added',
  'link-added',
];
const NOT_FOUND = "That project couldn't be found. It may have been moved.";

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const newest = (list: string[]) =>
  list.length > PROJECT_SEEN_LIST_MAX ? list.slice(-PROJECT_SEEN_LIST_MAX) : list;

/** Today as YYYY-MM-DD in the Mac's own time, matching how due dates are written. */
function dayOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The wording for an update row: who and what kind only, never the summary or an email subject. */
function updateText(kind: string, change: string | undefined, name: string): string {
  if (kind === 'note') return `${name} added a note`;
  if (kind === 'call') return `${name} added a call`;
  if (kind === 'status' || kind === 'owner') {
    if (change === 'health') return 'Health changed';
    if (change === 'owner' || kind === 'owner') return 'Account Owner changed';
    return 'Status changed';
  }
  return `${name} added an update`;
}

export function createProjectActivity(deps: ProjectActivityDeps): ProjectActivityService {
  const now = deps.now ?? (() => new Date());
  const newToken = deps.token ?? (() => randomBytes(16).toString('hex'));
  /** Per person and project: the snapshot the last read would save. */
  const held = new Map<string, { token: string; snapshot: ProjectSeen; expires: number }>();
  const holdKey = (identity: Identity, key: string) => `${identity.slug}\u0000${key}`;

  const sweep = () => {
    const t = now().getTime();
    for (const [k, v] of held) if (v.expires <= t) held.delete(k);
  };

  const read: ProjectActivityService['read'] = async (key, identity) => {
    sweep();
    const card = (await deps.index()).byKey(key);
    if (!card) throw new ProjectsError('not-found', NOT_FOUND);
    const stored = await deps.store.get(key);
    // A different folder now (a move) counts as a first visit.
    const before = stored && stored.folder === card.folder ? stored : null;
    if (card.archived) {
      held.delete(holdKey(identity, key));
      return { since: before?.at ?? null, token: null, items: [], more: 0, comingUp: [] };
    }

    const [todoRead, fileRead, updateRead, roster] = await Promise.all([
      deps.todos(key, identity),
      deps.files(card, identity),
      deps.updates(key, identity),
      deps.roster().catch(() => new Map<string, string>()),
    ]);
    const nameOf = (slug: string | null | undefined) => (slug ? (roster.get(slug) ?? null) : null);

    // ── the project as it is now ──
    const prefix = `${card.folder}/`;
    const fileMap = new Map<string, string>(); // snapshot path (relative when inside the folder) → brain path
    for (const item of fileRead.items) {
      const rel = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path;
      if (!fileMap.has(rel)) fileMap.set(rel, item.path);
    }
    const nowFiles = [...fileMap.keys()];
    const nowLinks = [...new Set(card.links)];
    const nowTodos = todoRead.todos.map((t) => t.key);
    const titles: Record<string, string> = {};
    for (const t of todoRead.todos) titles[t.key] = t.title;

    const keptTodos = newest(nowTodos);
    const snapshot: ProjectSeen = {
      at: now().toISOString(),
      folder: card.folder,
      todos: keptTodos,
      links: newest(nowLinks),
      files: newest(nowFiles),
      updates: updateRead.updates.map((u) => u.path),
    };
    const todoTitles: Record<string, string> = {};
    for (const k of keptTodos) if (titles[k] !== undefined) todoTitles[k] = titles[k];
    if (Object.keys(todoTitles).length > 0) snapshot.todoTitles = todoTitles;
    if (
      nowTodos.length > PROJECT_SEEN_LIST_MAX ||
      nowLinks.length > PROJECT_SEEN_LIST_MAX ||
      nowFiles.length > PROJECT_SEEN_LIST_MAX
    )
      snapshot.cut = true;

    const token = newToken();
    held.set(holdKey(identity, key), { token, snapshot, expires: now().getTime() + ACTIVITY_TOKEN_TTL_MS });

    // ── what changed ──
    const found: ActivityItem[] = [];
    if (before) {
      const sinceMs = Date.parse(before.at);
      const cutList = (list: string[]) => before.cut === true && list.length >= PROJECT_SEEN_LIST_MAX;

      // New = not in the snapshot's list (so an entry that synced in late still shows); older snapshots without
      // the list fall back to "written after the last look".
      const seenUpdates = before.updates ? new Set(before.updates) : null;
      // A full page seen: an entry older than the oldest one seen was paged out then, not new (it slid back in
      // because a newer entry was removed).
      let pagedOutBefore = Number.NEGATIVE_INFINITY;
      if (seenUpdates && seenUpdates.size >= UPDATES_PAGE) {
        const seenAts = updateRead.updates
          .filter((u) => seenUpdates.has(u.path))
          .map((u) => Date.parse(u.at))
          .filter((t) => !Number.isNaN(t));
        if (seenAts.length > 0) pagedOutBefore = Math.min(...seenAts);
      }
      for (const u of updateRead.updates) {
        const at = Date.parse(u.at);
        if (Number.isNaN(at)) continue;
        if (seenUpdates ? seenUpdates.has(u.path) || at < pagedOutBefore : at <= sinceMs) continue;
        if (u.by === identity.slug || (card.space === 'personal' && u.by === 'me')) continue;
        const name = nameOf(u.by) ?? (u.byName && u.byName !== u.by ? u.byName : null);
        const auto = u.kind === 'status' || u.kind === 'owner';
        found.push({
          kind: auto ? 'status' : 'update',
          text: updateText(u.kind, u.change, name ?? 'Someone'),
          at: u.at,
          byName: name,
          target: { kind: 'updates' },
        });
      }

      const seenTodos = new Set(before.todos);
      if (!cutList(before.todos)) {
        for (const t of todoRead.todos)
          if (!seenTodos.has(t.key))
            found.push({
              kind: 'todo-added',
              text: `To-do added: ${t.title}`,
              at: null,
              byName: null,
              target: { kind: 'todo', key: t.key },
            });
      }
      const open = new Set(nowTodos);
      // Personal to-dos here are always this person's own, so a gone one is their own change: never listed.
      const gone = before.todos.filter((k) => !open.has(k) && !k.startsWith('personal/'));
      const closed = await Promise.all(
        gone.map(async (k): Promise<ActivityItem | null> => {
          const info = await deps.done(k).catch(() => null);
          const title = before.todoTitles?.[k] ?? info?.title ?? null;
          if (!title) return null; // no blank rows
          if (info) {
            if (info.by !== null && info.by === identity.slug) return null; // their own tick
            return {
              kind: 'todo-closed',
              text: `To-do done: ${title}`,
              at: info.at,
              byName: nameOf(info.by),
              target: { kind: 'todo', key: k },
            };
          }
          return {
            kind: 'todo-closed',
            text: `No longer in this project: ${title}`,
            at: null,
            byName: null,
            target: { kind: 'todo', key: k },
          };
        }),
      );
      for (const c of closed) if (c) found.push(c);

      const seenFiles = new Set(before.files);
      // The Files read also lists linked files kept outside the folder: those are links, not new files.
      const linkSet = new Set(nowLinks);
      const isOutsideLink = (path: string) => !path.startsWith(prefix) && linkSet.has(path);
      if (!cutList(before.files)) {
        for (const [rel, path] of fileMap)
          if (!seenFiles.has(rel) && !isOutsideLink(path))
            found.push({
              kind: 'file-added',
              text: `New file: ${baseName(path)}`,
              at: null,
              byName: null,
              target: { kind: 'file', path },
            });
      }
      const seenLinks = new Set(before.links);
      const filePaths = new Set(fileMap.values());
      if (!cutList(before.links)) {
        // A path linked AND inside the folder shows once, as a file.
        for (const path of nowLinks)
          if (!seenLinks.has(path) && !(filePaths.has(path) && path.startsWith(prefix)))
            found.push({
              kind: 'link-added',
              text: `Linked file: ${baseName(path)}`,
              at: null,
              byName: null,
              target: { kind: 'file', path },
            });
      }
    }

    // Newest first where `at` is known; the rest after, in kind order.
    const withAt = found
      .filter((i) => i.at !== null)
      .sort((a, b) => Date.parse(b.at as string) - Date.parse(a.at as string));
    const without = found
      .filter((i) => i.at === null)
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const all = [...withAt, ...without];

    // ── coming up ──
    const today = dayOf(now());
    const limit = dayOf(new Date(now().getTime() + COMING_UP_DAYS * DAY_MS));
    const coming: ComingUpItem[] = [];
    for (const t of todoRead.todos)
      if (t.due !== null && t.due <= limit)
        coming.push({
          kind: 'todo-due',
          text: t.title,
          date: t.due,
          overdue: t.due < today,
          target: { kind: 'todo', key: t.key },
        });
    if (card.end && card.end <= limit && card.status !== 'done')
      coming.push({
        kind: 'project-end',
        text: 'Project end date',
        date: card.end,
        overdue: card.end < today,
        target: null,
      });
    coming.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date));

    return {
      since: before?.at ?? null,
      token,
      items: all.slice(0, ACTIVITY_MAX),
      more: Math.max(0, all.length - ACTIVITY_MAX),
      comingUp: coming,
    };
  };

  const seen: ProjectActivityService['seen'] = async (key, token, identity) => {
    sweep();
    const k = holdKey(identity, key);
    const h = held.get(k);
    if (!h || h.token !== token) return;
    held.delete(k);
    await deps.store.set(key, h.snapshot);
  };

  return { read, seen };
}
