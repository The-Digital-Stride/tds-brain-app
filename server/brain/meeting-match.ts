/**
 * Projects R2 phase 4 (plan docs/plans/2026-11-23-projects-r2-meetings.md, decisions 3 and 4): which client and
 * which project a calendar meeting belongs to. Pure functions, no I/O. Emails are used here, in memory only, to
 * compare domains; nothing returned holds one. It never guesses: a tie is "none".
 */

import type { ProjectMatch } from '../../shared/project-meetings-contract.ts';
import { INTERNAL_CLIENT, type ProjectKey, type ProjectStatus } from '../../shared/projects-contract.ts';

export interface MatchClient {
  slug: string;
  name: string;
  aliases: string[];
  /** The client's website domain, lower case, no `www.`; null when the profile has none. */
  domain: string | null;
}

export interface MatchProject {
  key: ProjectKey;
  /** Null for personal projects. */
  client: string | null;
  title: string;
  status: ProjectStatus;
  archived: boolean;
}

export interface MatchContext {
  clients: MatchClient[];
  projects: MatchProject[];
  /** Domains never used to pick a client: the agency's own (team emails, the person's git email). */
  ignoreDomains: string[];
  /** This person's own addresses, left out of the attendees. */
  selfEmails: string[];
}

export interface MatchMeeting {
  title: string;
  allDay: boolean;
  attendees: { name: string | null; email: string | null }[];
}

/** Public mail providers: an attendee on one says nothing about a client (decision 3a). */
export const PUBLIC_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'btinternet.com',
];

/** A meeting with no end is taken to last this long. */
export const DEFAULT_MEETING_MS = 60 * 60 * 1000;

/** When the meeting ends, in ms; the start plus an hour when the end is missing or not a time. */
export function meetingEndMs(start: string, end: string | null): number {
  const e = end === null ? Number.NaN : Date.parse(end);
  if (!Number.isNaN(e)) return e;
  return Date.parse(start) + DEFAULT_MEETING_MS;
}

/** The lower-case domain of an email address, or null. */
export function domainOf(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const d = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d) ? d : null;
}

function hostOf(url: string): string | null {
  const m = /^(?:https?:\/\/)?([^\s/?#:]+)/i.exec(url.trim());
  if (!m) return null;
  const host = (m[1] as string).toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host) ? host : null;
}

/**
 * A client's website domain from its `profile.md`: the `**Website:** https://…` line, else a `website:`
 * frontmatter line. Lower case, `www.` stripped; null when neither is there or it isn't a web address.
 */
export function websiteDomain(profile: string): string | null {
  const bold = /^\s*\*\*Website:\*\*[ \t]*(\S+)/im.exec(profile);
  if (bold) return hostOf((bold[1] as string).replace(/^[<(]|[>)]$/g, ''));
  const fm = /^website:[ \t]*["']?([^\s"']+)/im.exec(profile);
  return fm ? hostOf(fm[1] as string) : null;
}

/** True when `domain` is `site` or a subdomain of it. */
function underDomain(domain: string, site: string): boolean {
  return domain === site || domain.endsWith(`.${site}`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words of a title, lower case. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** How many words of `name` appear in `title` as a whole-word phrase, or 0. Short names only as written. */
function nameWords(title: string, name: string): number {
  const t = name.trim();
  const n = wordsOf(t).length;
  if (n === 0) return 0;
  const letters = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const body = t.split(/\s+/).map(escapeRe).join('\\s+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, letters <= 3 ? 'u' : 'iu');
  return re.test(title) ? n : 0;
}

function attendeeDomains(m: MatchMeeting, ctx: MatchContext): string[] {
  const own = new Set(ctx.selfEmails.map((e) => e.toLowerCase()));
  const skip = new Set([...ctx.ignoreDomains.map((d) => d.toLowerCase()), ...PUBLIC_MAIL_DOMAINS]);
  const out: string[] = [];
  for (const a of m.attendees) {
    const email = typeof a.email === 'string' ? a.email.trim().toLowerCase() : '';
    if (!email || own.has(email)) continue;
    const d = domainOf(email);
    if (d && !skip.has(d)) out.push(d);
  }
  return out;
}

/** The one client this meeting is with (decision 3), or null. */
export function matchClient(m: MatchMeeting, ctx: MatchContext): string | null {
  const domains = attendeeDomains(m, ctx);
  if (domains.length > 0) {
    const hits = ctx.clients.filter(
      (c) => c.domain && domains.some((d) => underDomain(d, c.domain as string)),
    );
    if (hits.length === 1) return (hits[0] as MatchClient).slug;
  }
  let best = 0;
  let winners: string[] = [];
  for (const c of ctx.clients) {
    const score = Math.max(0, ...[c.name, ...c.aliases].map((n) => nameWords(m.title, n)));
    if (score === 0 || score < best) continue;
    if (score > best) winners = [];
    best = score;
    winners.push(c.slug);
  }
  return winners.length === 1 ? (winners[0] as string) : null;
}

const open = (p: MatchProject) => p.status !== 'done' && !p.archived;

/**
 * Words that say nothing about WHICH project: common in both project and meeting titles ("The new website",
 * "Weekly call"). They never score, so a project can't match a meeting on "the" or "call" alone.
 */
const COMMON_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'our',
  'new',
  'from',
  'into',
  'call',
  'calls',
  'meeting',
  'meet',
  'sync',
  'catch',
  'weekly',
  'monthly',
  'daily',
  'chat',
  'check',
  'project',
]);

/** The project of a meeting already matched to `clientSlug` (null: no client), or null (decision 4). */
export function matchProject(
  m: MatchMeeting,
  clientSlug: string | null,
  ctx: MatchContext,
): { key: ProjectKey; match: ProjectMatch } | null {
  const client = clientSlug === null ? null : (ctx.clients.find((c) => c.slug === clientSlug) ?? null);
  const internal = clientSlug === null || clientSlug === INTERNAL_CLIENT || client === null;
  const pool = ctx.projects.filter(
    (p) =>
      open(p) && (internal ? p.client === null || p.client === INTERNAL_CLIENT : p.client === clientSlug),
  );
  const titleWords = new Set(wordsOf(m.title));
  const clientWords = new Set(client && !internal ? wordsOf(client.name) : []);
  let best = 0;
  let winners: MatchProject[] = [];
  for (const p of pool) {
    const own = new Set(
      wordsOf(p.title).filter((w) => [...w].length >= 3 && !clientWords.has(w) && !COMMON_WORDS.has(w)),
    );
    let score = 0;
    for (const w of own) if (titleWords.has(w)) score++;
    if (score === 0 || score < best) continue;
    if (score > best) winners = [];
    best = score;
    winners.push(p);
  }
  if (winners.length === 1) return { key: (winners[0] as MatchProject).key, match: 'title' };
  if (winners.length > 1) return null;
  if (!internal && pool.length === 1) return { key: (pool[0] as MatchProject).key, match: 'only' };
  return null;
}

/** The project a calendar meeting belongs to, or null. All-day events are skipped. */
export function matchMeeting(
  m: MatchMeeting,
  ctx: MatchContext,
): { key: ProjectKey; match: ProjectMatch } | null {
  if (m.allDay) return null;
  return matchProject(m, matchClient(m, ctx), ctx);
}
