/**
 * Projects R2 phase 4 (plan docs/plans/2026-11-23-projects-r2-meetings.md): meetings on the project home.
 *
 * Reads `briefing/meetings-cache.json` (written by /gm on this Mac, never by the app), read only and defensively,
 * and ONLY when git says the file is ignored (overseer blocker 1): otherwise the answer is cache 'none', so a
 * synced cache can never show one person's calendar to another. Matches each meeting to a project
 * (meeting-match.ts), keeps ENDED matches in the app's own history (store/meeting-history.ts) and answers the
 * project's last meeting (cache + history) and next meeting (cache only, so a cancelled one never lingers).
 * Emails are used in memory for matching only: nothing returned or stored holds one.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ClientInfo } from '../../shared/contract.ts';
import {
  type CachedMeeting,
  type KeptMeeting,
  MEETING_PEOPLE_SHOWN,
  MEETINGS_CACHE_PATH,
  MEETINGS_STALE_MS,
  type MeetingView,
  type ProjectMeetingsResponse,
} from '../../shared/project-meetings-contract.ts';
import { type ProjectKey, ProjectsError } from '../../shared/projects-contract.ts';
import type { MeetingHistoryStore } from '../store/meeting-history.ts';
import { findCallNote, type NoteCard } from './call-notes.ts';
import { readClientAliases } from './client-aliases.ts';
import { readMembers } from './identity.ts';
import { gitIgnored } from './library.ts';
import { domainOf, type MatchContext, matchMeeting, meetingEndMs, websiteDomain } from './meeting-match.ts';
import type { ProjectsIndex } from './projects.ts';
import { readText } from './util.ts';

const NOT_FOUND = "That project couldn't be found. It may have been moved.";
const CACHE_MAX_BYTES = 5 * 1024 * 1024;
const CACHE_MAX_MEETINGS = 2000;
const KEEP_PEOPLE = 20;

export interface ProjectMeetingsDeps {
  root: string;
  index: () => Promise<ProjectsIndex>;
  clients: () => Promise<ClientInfo[]>;
  store: MeetingHistoryStore;
  /** This person's email (from git), left out of the attendees and counted as agency. Null: unknown. */
  selfEmail: () => Promise<string | null>;
  /** Which of the paths git ignores; null when git can't say. Default: `git check-ignore` in the brain. */
  ignored?: (rels: string[]) => Promise<Set<string> | null>;
  /** The filed call note for a meeting. Default: findCallNote in the brain. */
  notes?: (card: NoteCard, start: string) => Promise<{ id: string; path: string } | null>;
  now?: () => Date;
}

export interface ProjectMeetingsService {
  read(key: ProjectKey): Promise<ProjectMeetingsResponse>;
  /** Re-reads the cache into the history. Never throws. */
  merge(): Promise<void>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const validTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** The cache's meetings, each checked; bad entries are dropped. Null when the file isn't a cache at all. */
function parseCache(text: string): { generated: string; meetings: CachedMeeting[] } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!validTime(r.generated) || !Array.isArray(r.meetings)) return null;
  const meetings: CachedMeeting[] = [];
  for (const m of r.meetings.slice(0, CACHE_MAX_MEETINGS)) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    const e = m as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id === '' || !validTime(e.start)) continue;
    const attendees: CachedMeeting['attendees'] = [];
    if (Array.isArray(e.attendees)) {
      for (const a of e.attendees) {
        if (!a || typeof a !== 'object') continue;
        const x = a as Record<string, unknown>;
        attendees.push({ name: str(x.name), email: str(x.email) });
      }
    }
    meetings.push({
      id: e.id,
      title: str(e.title) ?? '',
      start: e.start,
      end: validTime(e.end) ? e.end : null,
      allDay: e.allDay === true,
      location: null, // never used, never kept
      attendees,
    });
  }
  return { generated: r.generated, meetings };
}

export function createProjectMeetings(deps: ProjectMeetingsDeps): ProjectMeetingsService {
  const now = deps.now ?? (() => new Date());
  const ignored = deps.ignored ?? ((rels: string[]) => gitIgnored(deps.root, rels));
  const notes = deps.notes ?? ((card: NoteCard, start: string) => findCallNote(deps.root, card, start));

  /** The cache, or null when there is none, git doesn't ignore it, or it can't be read. */
  async function readCache(): Promise<{ generated: string; meetings: CachedMeeting[] } | null> {
    const abs = join(deps.root, ...MEETINGS_CACHE_PATH.split('/'));
    let text: string;
    try {
      const st = await fs.lstat(abs);
      if (!st.isFile() || st.size > CACHE_MAX_BYTES) return null;
      text = await fs.readFile(abs, 'utf8');
    } catch {
      return null;
    }
    const answer = await ignored([MEETINGS_CACHE_PATH]).catch(() => null);
    if (!answer?.has(MEETINGS_CACHE_PATH)) return null;
    return parseCache(text);
  }

  async function context(index: ProjectsIndex, self: string | null): Promise<MatchContext> {
    const clients = await deps.clients().catch(() => [] as ClientInfo[]);
    const withAliases = await readClientAliases(deps.root, clients).catch(() => []);
    const aliasesOf = new Map(withAliases.map((c) => [c.slug, c.aliases]));
    const matchClients = await Promise.all(
      clients.map(async (c) => {
        const profile = await readText(join(deps.root, 'clients', c.slug, 'profile.md')).catch(() => null);
        return {
          slug: c.slug,
          name: c.name,
          aliases: aliasesOf.get(c.slug) ?? c.aliases ?? [],
          domain: profile ? websiteDomain(profile) : null,
        };
      }),
    );
    const agency = new Set<string>();
    for (const m of await readMembers(deps.root)) {
      const d = domainOf(typeof m.email === 'string' ? m.email : null);
      if (d) agency.add(d);
    }
    const mine = domainOf(self);
    if (mine) agency.add(mine);
    return {
      clients: matchClients,
      projects: index.cards.map((c) => ({
        key: c.key,
        client: c.client,
        title: c.title,
        status: c.status,
        archived: c.archived,
      })),
      ignoreDomains: [...agency],
      selfEmails: self ? [self] : [],
    };
  }

  /** Names of the other people (never emails), and how many there were. */
  function people(m: CachedMeeting, self: string | null): { people: string[]; others: number } {
    const me = self?.toLowerCase() ?? null;
    const names: string[] = [];
    let others = 0;
    for (const a of m.attendees) {
      const email = a.email?.trim().toLowerCase() ?? '';
      if (me && email === me) continue;
      const name = a.name?.trim() ?? '';
      if (!email && !name) continue;
      others++;
      if (name && !name.includes('@') && !names.includes(name) && names.length < KEEP_PEOPLE)
        names.push(name);
    }
    return { people: names, others };
  }

  interface Loaded {
    cache: { generated: string; meetings: CachedMeeting[] };
    self: string | null;
    matched: { meeting: CachedMeeting; kept: KeptMeeting }[];
  }

  async function load(getIndex: () => Promise<ProjectsIndex>): Promise<Loaded | null> {
    const cache = await readCache();
    if (!cache) return null;
    const index = await getIndex();
    const self = await deps.selfEmail().catch(() => null);
    const ctx = await context(index, self);
    const matched: Loaded['matched'] = [];
    for (const meeting of cache.meetings) {
      const hit = matchMeeting(meeting, ctx);
      if (!hit) continue;
      const who = people(meeting, self);
      matched.push({
        meeting,
        kept: {
          id: meeting.id,
          key: hit.key,
          match: hit.match,
          title: meeting.title,
          start: meeting.start,
          end: meeting.end,
          people: who.people,
          others: who.others,
        },
      });
    }
    return { cache, self, matched };
  }

  const ended = (m: { start: string; end: string | null }) => meetingEndMs(m.start, m.end) <= now().getTime();

  const view = (m: KeptMeeting, filed: MeetingView['notes']): MeetingView => ({
    id: m.id,
    title: m.title,
    start: m.start,
    end: m.end,
    people: m.people.slice(0, MEETING_PEOPLE_SHOWN),
    others: m.others,
    match: m.match,
    notes: filed,
  });

  return {
    async merge() {
      try {
        const loaded = await load(deps.index);
        if (loaded) await deps.store.merge(loaded.matched.map((x) => x.kept).filter(ended), now());
      } catch {
        // a failed merge never breaks the page; the next one tries again
      }
    },

    async read(key) {
      const index = await deps.index();
      const card = index.byKey(key);
      if (!card) throw new ProjectsError('not-found', NOT_FOUND);
      let loaded: Loaded | null = null;
      try {
        loaded = await load(async () => index);
      } catch {
        loaded = null;
      }
      if (!loaded) return { cache: 'none', checked: null, last: null, next: null };
      const age = now().getTime() - Date.parse(loaded.cache.generated);
      const base = {
        cache: age > MEETINGS_STALE_MS ? ('stale' as const) : ('fresh' as const),
        checked: loaded.cache.generated,
      };
      // Keep what has ended, for the "Last meeting" of later days.
      await deps.store.merge(loaded.matched.map((x) => x.kept).filter(ended), now()).catch(() => {});
      if (card.archived) return { ...base, last: null, next: null };

      const mine = loaded.matched.filter((x) => x.kept.key === key).map((x) => x.kept);
      const past = new Map<string, KeptMeeting>();
      for (const m of (await deps.store.all().catch(() => [])).filter((h) => h.key === key))
        past.set(`${m.id}\u0000${m.start}`, m);
      for (const m of mine.filter(ended)) past.set(`${m.id}\u0000${m.start}`, m);
      const last = [...past.values()].sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0] ?? null;
      const next =
        mine.filter((m) => !ended(m)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null;
      return {
        ...base,
        last: last ? view(last, await notes(card, last.start).catch(() => null)) : null,
        next: next ? view(next, null) : null,
      };
    },
  };
}
