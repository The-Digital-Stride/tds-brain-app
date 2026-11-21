/**
 * Pure helpers for the projects system (plan docs/plans/2026-11-20-projects-system.md, decisions 3, 5, 7).
 * Browser-safe: no node imports. The brain skill script `tdsapp-projects.cjs` mirrors the key and
 * `## Linked files` rules; their tests run the same cases.
 */
import {
  PROJECT_KEY_PATTERN,
  PROJECT_KEY_SEGMENT_MAX,
  PROJECT_SLUG_MAX,
  PROJECT_SLUG_PATTERN,
  type ProjectCard,
  type ProjectKey,
  type TodoProjectMatch,
} from './projects-contract.ts';

/** A folder name that can be a project slug (PROJECT_SLUG_PATTERN, at most PROJECT_SLUG_MAX). */
export function isProjectSlug(value: string): boolean {
  return value.length <= PROJECT_SLUG_MAX && PROJECT_SLUG_PATTERN.test(value);
}

/** The two halves of a well-formed ProjectKey, or null (pattern and segment cap). */
export function parseProjectKey(value: string): { client: string | 'personal'; slug: string } | null {
  if (typeof value !== 'string' || !PROJECT_KEY_PATTERN.test(value)) return null;
  const at = value.indexOf('/');
  const client = value.slice(0, at);
  const slug = value.slice(at + 1);
  if (client.length > PROJECT_KEY_SEGMENT_MAX || slug.length > PROJECT_KEY_SEGMENT_MAX) return null;
  return { client, slug };
}

type Eligible = Pick<ProjectCard, 'key' | 'slug' | 'client' | 'space' | 'movedFrom'>;

/**
 * The project an old key now names (move plan decision 5): the card whose `movedFrom` lists it, the
 * lowest sorted key when two do (overseer S6). Null when none, and null when `projects` itself holds
 * the key: a live folder at a key (card or not) always wins over an alias. That matters most for a
 * `personal/` key: a moved card syncs to teammates, where `personal/` is their own private folder.
 */
export function movedKey(
  key: ProjectKey,
  projects: Pick<Eligible, 'key' | 'movedFrom'>[],
): ProjectKey | null {
  if (projects.some((p) => p.key === key)) return null;
  let best: ProjectKey | null = null;
  for (const p of projects) {
    if (p.movedFrom?.includes(key) && (best === null || p.key < best)) best = p.key;
  }
  return best;
}

/** The folder a movable project's key names: `personal/projects/<slug>` or `clients/<client>/projects/<slug>`. */
function liveFolderOf(key: ProjectKey): string | null {
  const parsed = parseProjectKey(key);
  if (!parsed) return null;
  return parsed.client === 'personal'
    ? `personal/projects/${parsed.slug}`
    : `clients/${parsed.client}/projects/${parsed.slug}`;
}

/**
 * A brain path inside a moved project's old folder, mapped to the folder it is in now (overseer S8),
 * so links written before the move still find the file. Any other path, or one under an old key a live
 * project now holds, comes back as it is.
 */
export function movedFolderPath(
  path: string,
  projects: Pick<ProjectCard, 'key' | 'folder' | 'movedFrom'>[],
): string {
  if (!projects.some((p) => p.movedFrom && p.movedFrom.length > 0)) return path;
  const live = new Set(projects.map((p) => p.key));
  let best: { key: ProjectKey; path: string } | null = null;
  for (const p of projects) {
    for (const old of p.movedFrom ?? []) {
      const folder = liveFolderOf(old);
      if (folder === null || live.has(old) || !path.startsWith(`${folder}/`)) continue;
      if (best === null || p.key < best.key)
        best = { key: p.key, path: p.folder + path.slice(folder.length) };
    }
  }
  return best ? best.path : path;
}

/**
 * How a to-do's `project:` value reads (contract TodoProjectMatch, overseer S3). A TDS to-do only ever
 * resolves against shared projects, so it reads the same on every Mac; a `personal/` key on one is
 * `missing` (overseer B2). A personal to-do may resolve against either.
 * Move plan: a key (or `<to-do client>/<label>` for a bare slug) no live project holds resolves
 * through the cards' `movedFrom` (movedKey). A TDS to-do never takes a `personal/` alias, and never
 * lands on a personal project through one.
 */
export function resolveTodoProject(
  value: string | null,
  todoClient: string | null,
  scope: 'tds' | 'personal',
  projects: Eligible[],
  clients: string[],
): TodoProjectMatch {
  const label = typeof value === 'string' ? value.trim() : '';
  if (label === '') return { how: 'none' };
  const eligible = scope === 'tds' ? projects.filter((p) => p.space !== 'personal') : projects;
  const parsed = parseProjectKey(label);
  if (parsed) {
    if (scope === 'tds' && parsed.client === 'personal') return { how: 'missing', key: label };
    if (eligible.some((p) => p.key === label)) return { how: 'key', key: label };
    const moved = movedKey(label, eligible);
    return moved !== null ? { how: 'key', key: moved } : { how: 'missing', key: label };
  }
  if (label.includes('/')) return { how: 'loose', label };
  if (clients.includes(label)) return { how: 'client', client: label };
  const client = typeof todoClient === 'string' && todoClient.trim() !== '' ? todoClient.trim() : null;
  const bySlug = eligible.filter((p) => p.slug === label);
  if (client !== null) {
    const within = bySlug.find((p) => p.client === client);
    if (within) return { how: 'legacy', key: within.key };
    const old = `${client}/${label}`;
    const moved =
      parseProjectKey(old) && !(scope === 'tds' && client === 'personal') ? movedKey(old, eligible) : null;
    return moved !== null ? { how: 'legacy', key: moved } : { how: 'loose', label };
  }
  if (bySlug.length === 1) return { how: 'legacy', key: (bySlug[0] as Eligible).key };
  return { how: 'loose', label };
}

/** The key a match points at ('key' and 'legacy'), else null. */
export function matchedKey(m: TodoProjectMatch | undefined): ProjectKey | null {
  if (!m) return null;
  return m.how === 'key' || m.how === 'legacy' ? m.key : null;
}

/** "Client · Title" ("Personal · Title" for a personal project). */
export function projectLabel(card: Pick<ProjectCard, 'title' | 'client'>, clientName?: string): string {
  if (card.client === null) return `Personal · ${card.title}`;
  return `${clientName ?? card.client} · ${card.title}`;
}

/** A folder name tidied into a title: "client-portal" → "Client portal". */
export function folderTitle(slug: string): string {
  const words = slug.split('-').filter((w) => w !== '');
  const text = words.join(' ');
  return text === '' ? slug : text.charAt(0).toUpperCase() + text.slice(1);
}

// ─── `## Linked files` (decision 7): the to-do attachments line format, under its own heading ────────

/** The section starts at a level-2 heading that says exactly "Linked files" (any case)... */
const LINKED_HEADING = /^##[ \t]+linked[ \t]+files[ \t]*$/i;
/** ...and ends at the next level-1 or level-2 heading. */
const NEXT_HEADING = /^#{1,2}[ \t]/;
/** `- [name](path)` or `- [name](<path>)`, as shared/todo-files.ts (no "only on" note on a card). */
const ITEM = /^[ \t]*[-*][ \t]+\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s()<>]+))\)[ \t]*$/;
/** A card may link files under these brain folders. `personal/` only from a personal project (decision 8). */
export const LINKED_FILE_ROOTS = ['clients/', 'templates/', 'personal/', 'projects/'] as const;

/**
 * A link target as a brain path, or null: every leading `../` dropped, then it must start with one of
 * LINKED_FILE_ROOTS and have no empty, `.` or `..` segment, backslash, colon or `%`.
 */
export function resolveLinkedFilePath(target: string): string | null {
  let rest = String(target).trim();
  while (rest.startsWith('../')) rest = rest.slice(3);
  if (!LINKED_FILE_ROOTS.some((r) => rest.startsWith(r))) return null;
  if (/[\\:%\0]/.test(rest)) return null;
  if (rest.split('/').some((p) => p === '' || p === '.' || p === '..')) return null;
  return rest;
}

function linesOutsideFences(lines: string[]): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] as string).match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence !== null) {
      if (m && (m[1] as string)[0] === fence[0] && (m[1] as string).length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1] as string;
      continue;
    }
    out.push(i);
  }
  return out;
}

function sectionRange(lines: string[]): [number, number] | null {
  const outside = linesOutsideFences(lines);
  const at = outside.findIndex((i) => LINKED_HEADING.test(lines[i] as string));
  if (at === -1) return null;
  const start = outside[at] as number;
  for (let k = at + 1; k < outside.length; k++) {
    const i = outside[k] as number;
    if (NEXT_HEADING.test(lines[i] as string)) return [start, i];
  }
  return [start, lines.length];
}

/** Brain paths linked in a card body's first `## Linked files` section, in written order, each once. */
export function parseLinkedFiles(body: string): string[] {
  const lines = String(body ?? '').split(/\r?\n/);
  const range = sectionRange(lines);
  if (!range) return [];
  const out: string[] = [];
  for (let i = range[0] + 1; i < range[1]; i++) {
    const m = ITEM.exec(lines[i] as string);
    if (!m) continue;
    const path = resolveLinkedFilePath((m[2] ?? m[3]) as string);
    if (path !== null && !out.includes(path)) out.push(path);
  }
  return out;
}

/** The card body without its first `## Linked files` section (`brief`, trimmed) and the section's source. */
export function splitLinkedFiles(body: string): { brief: string; section: string } {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const range = sectionRange(lines);
  if (!range) return { brief: text.trim(), section: '' };
  const before = lines.slice(0, range[0]).join('\n').trimEnd();
  const after = lines.slice(range[1]).join('\n').trimStart();
  const section = lines.slice(range[0], range[1]).join('\n').trimEnd();
  return {
    brief: [before, after]
      .filter((s) => s !== '')
      .join('\n\n')
      .trim(),
    section,
  };
}
