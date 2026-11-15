/**
 * What's new notes: short plain-words notes in /help/whats-new/<version>.md, one per release that changes what people
 * see (plan docs/plans/2026-11-15-cortex-help-phase-3.md, decision 5). Frontmatter: `version`, `title`, `pages` (help ids).
 * The Home card shows the newest note that is not newer than the app and that the person has not closed.
 */
import { VERSION_PATTERN } from '../../../shared/contract.ts';
import type { HelpTopic } from './contract.ts';
import { splitFrontmatter } from './frontmatter.ts';

/** A note's body may hold this many words (same reading rules as help pages otherwise). */
export const WHATS_NEW_MAX_WORDS = 120;
/** The help topic that lists every note, newest first. */
export const WHATS_NEW_ID = 'whats-new';

export interface WhatsNewNote {
  /** e.g. "0.40.0" */
  version: string;
  title: string;
  /** Help page ids the card links to. */
  pages: readonly string[];
  /** Markdown after the frontmatter. */
  body: string;
}

export type NoteResult = { ok: true; note: WhatsNewNote } | { ok: false; errors: string[] };

/** Splits "0.40.0" into numbers; null when it isn't a version. */
export function versionParts(v: string): [number, number, number] | null {
  if (!VERSION_PATTERN.test(v)) return null;
  const [a, b, c] = v.split('.').map(Number);
  return [a as number, b as number, c as number];
}

/** Compares as numbers, so 0.40.0 is newer than 0.9.0. Unparseable versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] as number) - (y[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

/** Parses one file's text. `fileName` is e.g. "0.40.0.md". Pure. */
export function parseNote(fileName: string, raw: string): NoteResult {
  const split = splitFrontmatter(raw);
  if (!split)
    return { ok: false, errors: [`${fileName}: the file has no frontmatter block between --- lines.`] };
  const { data, body } = split;
  const errors: string[] = [];
  const version = typeof data.version === 'string' ? data.version : '';
  if (!versionParts(version)) errors.push(`${fileName}: "version" must look like 0.40.0.`);
  else if (`${version}.md` !== fileName)
    errors.push(`${fileName}: "version" (${version}) must match the file name.`);
  const title = typeof data.title === 'string' ? data.title : '';
  if (!title) errors.push(`${fileName}: "title" is missing.`);
  const pages = Array.isArray(data.pages) ? data.pages : null;
  if (!pages) errors.push(`${fileName}: "pages" must be a list like [welcome, dock-app].`);
  if (body.trim() === '') errors.push(`${fileName}: the note has no words.`);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, note: { version, title, pages: pages ?? [], body: body.trim() } };
}

/** Parses raw files (keyed by path), newest first. A bad file is left out and warned about, never thrown. */
export function loadNotes(files: Record<string, string>): WhatsNewNote[] {
  const notes: WhatsNewNote[] = [];
  for (const [path, raw] of Object.entries(files)) {
    const r = parseNote(path.split('/').pop() ?? path, raw);
    if (r.ok) notes.push(r.note);
    else console.warn(`What's new note left out. ${r.errors.join(' ')}`);
  }
  return notes.sort((a, b) => compareVersions(b.version, a.version));
}

// Vite root is `client`, so the repo's help folder is three levels up from here.
const files = import.meta.glob('../../../help/whats-new/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every bundled note, newest first. */
export const whatsNewNotes: readonly WhatsNewNote[] = loadNotes(files);

/**
 * The note to show: the newest whose version is not newer than the app and is newer than the one last closed.
 * `notes` may be in any order. Null when there is nothing to show.
 */
export function pickNote(
  notes: readonly WhatsNewNote[],
  appVersion: string,
  whatsNewSeen: string | null | undefined,
): WhatsNewNote | null {
  let best: WhatsNewNote | null = null;
  for (const n of notes) {
    if (compareVersions(n.version, appVersion) > 0) continue;
    if (whatsNewSeen && compareVersions(n.version, whatsNewSeen) <= 0) continue;
    if (!best || compareVersions(n.version, best.version) > 0) best = n;
  }
  return best;
}

/** The first paragraph of a note's body, as plain text (bold and links flattened). */
export function firstParagraph(body: string): string {
  const para = body.split(/\n\s*\n/)[0] ?? '';
  return para
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether the card may show at all. A brand-new person (no earlier chats, `whatsNewSeen` never saved) never sees
 * notes from before they started, so the card shows only if they have at least one earlier chat, or have closed
 * a note before. `chatCount` is null while the chat lists load.
 */
export function mayShowNotes(chatCount: number | null, whatsNewSeen: string | null | undefined): boolean {
  if (whatsNewSeen) return true;
  return chatCount !== null && chatCount > 0;
}

/** The "What's new" help topic: every note, newest first, each with links to the pages it names. */
export function whatsNewTopic(
  notes: readonly WhatsNewNote[],
  titleOf: (id: string) => string | undefined,
  today: string,
): HelpTopic | null {
  const newest = notes[0];
  if (!newest) return null;
  const body = notes
    .map((n) => {
      const links = n.pages
        .map((id) => {
          const t = titleOf(id);
          return t ? `[${t}](help:${id})` : null;
        })
        .filter((l): l is string => l !== null);
      const more = links.length > 0 ? `\n\nRead more: ${links.join(', ')}.` : '';
      return `### ${n.title} (${n.version})\n\n${n.body}${more}`;
    })
    .join('\n\n');
  return {
    id: WHATS_NEW_ID,
    title: "What's new",
    area: 'help',
    order: 90,
    summary: 'What changed in each update, newest first.',
    benefit: 'You can see what an update changed without reading a list of fixes.',
    roles: 'all',
    related: [],
    since: newest.version,
    reviewed: today,
    body,
  };
}
