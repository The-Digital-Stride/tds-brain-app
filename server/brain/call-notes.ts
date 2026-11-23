/**
 * Projects R2 phase 4 (decision 6 and 8): has this meeting's call note been filed? Read only. Looks at files whose
 * name starts with the meeting's local date (a day either side), reads just the frontmatter, and applies the rule
 * in MeetingView.notes (shared/project-meetings-contract.ts). Old notes without `project:` still count when their
 * `meeting_start` is close to the meeting's start.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { MEETING_NOTE_MATCH_MS } from '../../shared/project-meetings-contract.ts';
import { LEGACY_PROJECTS_SCOPE, type ProjectCard } from '../../shared/projects-contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { idFor } from './library.ts';

const HEAD_BYTES = 4096;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NoteCard = Pick<ProjectCard, 'client' | 'slug' | 'folder' | 'space'>;

/** `YYYY-MM-DD` in this machine's time zone. */
function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The library scope a brain-relative path is listed under, or null (e.g. an archive folder nothing lists). */
export function libraryScopeFor(rel: string): string | null {
  const parts = rel.split('/');
  if (parts[0] === 'clients' && parts[1] && !parts[1].startsWith('_') && !parts[1].startsWith('.'))
    return `client:${parts[1]}`;
  if (parts[0] === 'personal') return 'personal';
  if (parts[0] === 'projects') return LEGACY_PROJECTS_SCOPE;
  return null;
}

async function head(abs: string): Promise<string | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(abs, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * The filed note for a meeting that started at `start` (ISO), with its library id and brain-relative path, or
 * null. `meeting_start` within MEETING_NOTE_MATCH_MS matches with or without a `project:` tag; otherwise a note
 * with no `meeting_start` matches when its `date` is the meeting's local date and its `project:` is this project
 * (or it sits in the project's own folder).
 */
export async function findCallNote(
  root: string,
  card: NoteCard,
  start: string,
): Promise<{ id: string; path: string } | null> {
  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) return null;
  const day = localDate(startMs);
  const days = new Set([localDate(startMs - DAY_MS), day, localDate(startMs + DAY_MS)]);
  const dirs: { rel: string; inProject: boolean }[] = [];
  if (card.client) dirs.push({ rel: `clients/${card.client}/call-notes`, inProject: false });
  dirs.push({ rel: card.folder, inProject: true }, { rel: `${card.folder}/call-notes`, inProject: true });

  let best: { id: string; path: string; diff: number } | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      const entries = await fs.readdir(join(root, ...dir.rel.split('/')), { withFileTypes: true });
      names = entries
        .filter((e) => e.isFile() && e.name.endsWith('.md') && days.has(e.name.slice(0, 10)))
        .map((e) => e.name)
        .sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const rel = `${dir.rel}/${name}`;
      const text = await head(join(root, ...rel.split('/')));
      if (text === null) continue;
      const { data } = parseFrontmatter(text);
      const at = Date.parse(asString(data.meeting_start).trim());
      let diff: number | null = null;
      if (!Number.isNaN(at)) {
        if (Math.abs(at - startMs) <= MEETING_NOTE_MATCH_MS) diff = Math.abs(at - startMs);
      } else if (asString(data.meeting_start).trim() === '') {
        const date = asString(data.date).trim().slice(0, 10);
        const project = asString(data.project).trim();
        if (date === day && (dir.inProject || project === card.slug)) diff = MEETING_NOTE_MATCH_MS;
      }
      if (diff === null) continue;
      const scope = libraryScopeFor(rel);
      if (scope === null) continue;
      if (!best || diff < best.diff) best = { id: idFor(scope, rel), path: rel, diff };
    }
  }
  return best ? { id: best.id, path: best.path } : null;
}
