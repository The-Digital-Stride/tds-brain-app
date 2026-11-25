/**
 * Projects R2 phase 5 (plan docs/plans/2026-11-24-projects-r2-email-entries.md, decisions 2, 3, 5 and 6): the
 * email drafts waiting for their inbox owner's OK. A draft is a gitignored file the `tdsapp-projects` script
 * wrote on this Mac (`briefing/email-drafts/<id>.json`, never an email's text). This reads them (only when git
 * says the folder is ignored, only this person's, not older than DRAFT_MAX_AGE_DAYS), routes each to a project
 * (email-route.ts) and, on the owner's Save, runs the script's `update` with the token from the draft's key
 * file outside the brain (`emailKeysDir`, overseer ruling after the security review). A draft with no key is never
 * listed.
 * The app never writes a brain file: approve and dismiss are the script's. Nothing returned holds an address,
 * the sender's domain or the approve token.
 */
import { promises as fs } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { ClientInfo, Identity } from '../../shared/contract.ts';
import {
  DRAFT_MAX_AGE_DAYS,
  EMAIL_DRAFT_FILE_PATTERN,
  EMAIL_DRAFT_MAX_BYTES,
  EMAIL_DRAFTS_DIR,
  EMAIL_NAME_MAX,
  EMAIL_PEOPLE_MAX,
  EMAIL_SUBJECT_MAX,
  type EmailDraftApproveRequest,
  type EmailDraftFile,
  type EmailDraftItem,
  type EmailDraftsResponse,
  type EmailPerson,
  emailKeysDir,
  PROJECTS_EMAIL_CAPABILITY,
  type ProjectEmailEntryInput,
} from '../../shared/project-email-contract.ts';
import type { EmailDraftThread } from '../../shared/project-email-threads-contract.ts';
import { UPDATE_SUMMARY_MAX, UPDATES_DIR } from '../../shared/project-updates-contract.ts';
import { parseProjectKey } from '../../shared/projects.ts';
import {
  PROJECTS_SCRIPT_TIMEOUT_MS,
  type ProjectCard,
  type ProjectKey,
  ProjectsError,
} from '../../shared/projects-contract.ts';
import { readClientAliases } from './client-aliases.ts';
import { type EmailRouteContext, routeEmail } from './email-route.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { readMembers } from './identity.ts';
import { gitIgnored } from './library.ts';
import { domainOf, type MatchContext, matchClient, websiteDomain } from './meeting-match.ts';
import type { ProjectsIndex } from './projects.ts';
import { findProjectsScript, PROJECTS_SCRIPT_MAX_OUTPUT_BYTES } from './projects-skill.ts';
import { createQueue, parseReply, runScript, type ScriptOptions, withDefaults } from './skill-runner.ts';
import { readTeam } from './todos.ts';
import { memberSlug, readText } from './util.ts';

export interface EmailDraftsDeps {
  index: () => Promise<ProjectsIndex>;
  clients: () => Promise<ClientInfo[]>;
  /** Who is using this Mac. */
  identity: () => Promise<Identity>;
  /** The script's capabilities. */
  capabilities: () => Promise<string[]>;
  /** Whether the brain's `tdsapp-projects` skill allows this person. Missing: everyone. */
  mayChange?: (identity: Identity) => Promise<boolean>;
  /** Which of the paths git ignores; null when git can't say. Default: `git check-ignore` in the brain. */
  ignored?: (rels: string[]) => Promise<Set<string> | null>;
  /** Called after the script saved or cleared a draft, so project caches are dropped. */
  onChanged?: () => void;
  script?: ScriptOptions;
  /** The projects runner's queue, so a draft's save never runs beside another project change. */
  queue?: ReturnType<typeof createQueue>;
  /** Test only: the approve keys folder. Default: this Mac account's own, as the script finds it. */
  keysDir?: string;
  now?: () => Date;
}

export type EmailApproveAnswer =
  | { ok: true; key: ProjectKey; file: string }
  | { ok: false; code: 'exists'; key: ProjectKey; byName: string };

export interface EmailDraftsService {
  list(key: ProjectKey | null): Promise<EmailDraftsResponse>;
  approve(req: EmailDraftApproveRequest): Promise<EmailApproveAnswer>;
  dismiss(id: string): Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ID = /^[a-z0-9]{12}$/;
const PROBE = `${EMAIL_DRAFTS_DIR}/aaaaaaaaaaaa.json`;
const ENTRY_MAX_BYTES = 64 * 1024;
const NEWLINE = /[\r\n]/;

const NOT_ALLOWED = "Saving emails to projects isn't available to you in the app yet.";
const NEEDS_SKILLS = "Update the brain's skills to save emails to projects.";
const NO_KEY = "This email can't be saved from here. Ask Claude to suggest it again.";
const NO_DRAFT = "That email isn't waiting any more. It may already have been saved or cleared.";
const BAD = "That email couldn't be saved. Check the details and try again.";
const INTERNAL = 'The change could not be made. Try again.';

// ─── Identity ────────────────────────────────────────────────────────────────────────────────────

/**
 * True when `slug` (a draft's `inbox_owner` or an entry's `email_inbox_owner`, which the script writes as
 * memberSlug(name)) is this person. The to-do roster uses another slug form, so both are known.
 */
export function isSlugOf(identity: Identity, slug: string | null | undefined): boolean {
  if (!slug) return false;
  return slug === identity.slug || slug === memberSlug(identity.name);
}

/** The roles.json email of the team member whose script slug is `slug`, or null. */
export async function memberEmailOfSlug(root: string, slug: string): Promise<string | null> {
  for (const m of await readMembers(root)) {
    if (typeof m.name === 'string' && typeof m.email === 'string' && memberSlug(m.name) === slug)
      return m.email;
  }
  return null;
}

// ─── Reading a draft file ────────────────────────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === 'string';
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isStrMap = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isStr);
const isPerson = (v: unknown): v is EmailPerson =>
  !!v &&
  typeof v === 'object' &&
  isStr((v as EmailPerson).address) &&
  ((v as EmailPerson).name === null || isStr((v as EmailPerson).name));

/** The draft file as the contract has it, or null when it isn't one. */
export function parseDraft(text: string, id: string): EmailDraftFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (
    d.v !== 1 ||
    d.id !== id ||
    !isStr(d.inbox_owner) ||
    d.inbox_owner === '' ||
    !isStr(d.created_at) ||
    Number.isNaN(Date.parse(d.created_at)) ||
    !isStr(d.thread_id) ||
    !isStr(d.email_key) ||
    d.email_key === '' ||
    !strList(d.thread_message_ids) ||
    !isStr(d.subject) ||
    !isPerson(d.from) ||
    !isStr(d.from_domain) ||
    !Array.isArray(d.people) ||
    !d.people.every(isPerson) ||
    !isStr(d.sent_at) ||
    !isStr(d.summary) ||
    !strList(d.codes_subject) ||
    !strList(d.codes_body) ||
    !(d.requested === null || isStr(d.requested)) ||
    // The thread fields are optional (older drafts have none); when present they must be the right shape.
    (d.thread_keys !== undefined && !strList(d.thread_keys)) ||
    (d.codes_thread !== undefined && !strList(d.codes_thread)) ||
    (d.near_keys !== undefined && !isStrMap(d.near_keys)) ||
    (d.message_id !== undefined && !isStr(d.message_id)) ||
    (d.fresh_at_draft !== undefined &&
      !(Number.isInteger(d.fresh_at_draft) && (d.fresh_at_draft as number) > 0))
  )
    return null;
  return d as unknown as EmailDraftFile;
}

/** What the app shows for a person: the name, else the part of the address before the @. Never an address. */
function shown(p: EmailPerson): string {
  const name = (p.name ?? '').trim();
  if (name !== '' && !name.includes('@')) return name;
  const local = p.address.split('@')[0]?.trim() ?? '';
  return local === '' ? 'Unknown' : local;
}

// ─── Emails already in projects ──────────────────────────────────────────────────────────────────

/** Who saved the newest entry holding a message key, and when. */
interface HeldBy {
  key: ProjectKey;
  by: string;
  at: string;
  time: number;
}
interface Linked {
  threads: Map<string, ProjectKey>;
  /** HELD keys: every entry's `email_key`, old `email_message_id` and `email_thread_keys` (never `email_thread_link`). */
  messages: Map<string, ProjectKey>;
  held: Map<string, HeldBy>;
}

async function scanEmailEntries(root: string, cards: ProjectCard[]): Promise<Linked> {
  const out: Linked = { threads: new Map(), messages: new Map(), held: new Map() };
  await Promise.all(
    cards.map(async (card) => {
      const dir = join(root, ...card.folder.split('/'), UPDATES_DIR);
      let names: string[];
      try {
        const st = await fs.lstat(dir);
        if (!st.isDirectory()) return;
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (!name.endsWith('.md') || name.startsWith('.')) continue;
        try {
          const abs = join(dir, name);
          const st = await fs.lstat(abs);
          if (!st.isFile() || st.size > ENTRY_MAX_BYTES) continue;
          const { data } = parseFrontmatter((await fs.readFile(abs, 'utf8')).replace(/\r\n?/g, '\n'));
          if (data.kind !== 'email') continue;
          const owner = typeof data.email_inbox_owner === 'string' ? data.email_inbox_owner : '';
          const thread = typeof data.email_thread_id === 'string' ? data.email_thread_id : '';
          if (owner && thread) out.threads.set(`${owner}\0${thread}`, card.key);
          const by = typeof data.by === 'string' ? data.by : '';
          const at = typeof data.at === 'string' ? data.at : '';
          const time = Date.parse(at);
          const listed = Array.isArray(data.email_thread_keys)
            ? data.email_thread_keys
            : typeof data.email_thread_keys === 'string'
              ? [data.email_thread_keys]
              : [];
          for (const k of [data.email_key, data.email_message_id, ...listed]) {
            if (typeof k !== 'string' || k === '') continue;
            out.messages.set(k, card.key);
            const cur = out.held.get(k);
            const t = Number.isFinite(time) ? time : 0;
            if (!cur || t > cur.time) out.held.set(k, { key: card.key, by, at, time: t });
          }
        } catch {
          // an unreadable entry says nothing
        }
      }
    }),
  );
  return out;
}

// ─── The service ─────────────────────────────────────────────────────────────────────────────────

export function createEmailDrafts(root: string, deps: EmailDraftsDeps): EmailDraftsService {
  const now = deps.now ?? (() => new Date());
  const ignored = deps.ignored ?? ((rels: string[]) => gitIgnored(root, rels));
  const options = withDefaults(
    deps.script ?? {},
    PROJECTS_SCRIPT_TIMEOUT_MS,
    PROJECTS_SCRIPT_MAX_OUTPUT_BYTES,
  );
  const queue = deps.queue ?? createQueue();
  const dir = join(root, ...EMAIL_DRAFTS_DIR.split('/'));

  const folderIgnored = async (): Promise<boolean> => {
    try {
      const st = await fs.lstat(dir);
      if (!st.isDirectory()) return false;
    } catch {
      return false;
    }
    const answer = await ignored([PROBE]).catch(() => null);
    return answer?.has(PROBE) === true;
  };

  const canApprove = async (): Promise<boolean> =>
    (await deps.capabilities().catch(() => [] as string[])).includes(PROJECTS_EMAIL_CAPABILITY) &&
    (await folderIgnored());

  const keysDir = deps.keysDir ?? emailKeysDir(userInfo().homedir);
  /** The approve token from `<id>.key` outside the brain, or null. Read only here, never sent anywhere but the script. */
  const readKey = async (id: string): Promise<string | null> => {
    if (!ID.test(id)) return null;
    try {
      const abs = join(keysDir, `${id}.key`);
      const st = await fs.lstat(abs);
      if (!st.isFile() || st.size > 4096) return null;
      const k = JSON.parse(await fs.readFile(abs, 'utf8')) as { token?: unknown };
      return typeof k.token === 'string' && /^[0-9a-f]{32}$/.test(k.token) ? k.token : null;
    } catch {
      return null;
    }
  };

  /** One draft file for this person, or null (missing, unreadable, not theirs). */
  const readOwn = async (id: string, who: Identity): Promise<EmailDraftFile | null> => {
    if (!ID.test(id) || !(await folderIgnored())) return null;
    try {
      const abs = join(dir, `${id}.json`);
      const st = await fs.lstat(abs);
      if (!st.isFile() || st.size > EMAIL_DRAFT_MAX_BYTES) return null;
      const d = parseDraft(await fs.readFile(abs, 'utf8'), id);
      return d && isSlugOf(who, d.inbox_owner) ? d : null;
    } catch {
      return null;
    }
  };

  const isLive = (c: ProjectCard | null | undefined): boolean =>
    !!c && !c.archived && c.status !== 'done' && c.card === 'ok';

  /** The domain → client rule of the meetings matcher (profile `Website`), in memory only. */
  const domainRouter = async (index: ProjectsIndex, who: Identity) => {
    const clients = await deps.clients().catch(() => [] as ClientInfo[]);
    const withAliases = await readClientAliases(root, clients).catch(() => []);
    const aliasesOf = new Map(withAliases.map((c) => [c.slug, c.aliases]));
    const matchClients = await Promise.all(
      clients.map(async (c) => {
        const profile = await readText(join(root, 'clients', c.slug, 'profile.md')).catch(() => null);
        return {
          slug: c.slug,
          name: c.name,
          aliases: aliasesOf.get(c.slug) ?? c.aliases ?? [],
          domain: profile ? websiteDomain(profile) : null,
        };
      }),
    );
    const agency = new Set<string>();
    for (const m of await readMembers(root)) {
      const d = domainOf(typeof m.email === 'string' ? m.email : null);
      if (d) agency.add(d);
    }
    const mine = domainOf(who.email);
    if (mine) agency.add(mine);
    const mctx: MatchContext = {
      clients: matchClients,
      projects: [],
      ignoreDomains: [...agency],
      selfEmails: who.email ? [who.email] : [],
    };
    return (domain: string): ProjectKey[] | null => {
      // A made-up address on the sender's domain: the matcher compares domains only (the title is empty).
      const client = matchClient(
        { title: '', allDay: false, attendees: [{ name: null, email: `x@${domain}` }] },
        mctx,
      );
      if (client === null) return null;
      return index.cards.filter((c) => c.client === client && isLive(c)).map((c) => c.key);
    };
  };

  const list: EmailDraftsService['list'] = async (keyFilter) => {
    const who = await deps.identity();
    const approve = await canApprove();
    if (!(await folderIgnored())) return { drafts: [], unreadable: 0, canApprove: false };
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return { drafts: [], unreadable: 0, canApprove: approve };
    }
    let unreadable = 0;
    const mine: EmailDraftFile[] = [];
    const cutoff = now().getTime() - DRAFT_MAX_AGE_DAYS * DAY_MS;
    for (const name of names.sort().filter((n) => EMAIL_DRAFT_FILE_PATTERN.test(n))) {
      const id = name.slice(0, -'.json'.length);
      try {
        const abs = join(dir, name);
        const st = await fs.lstat(abs);
        if (!st.isFile() || st.size > EMAIL_DRAFT_MAX_BYTES) {
          unreadable++;
          continue;
        }
        const d = parseDraft(await fs.readFile(abs, 'utf8'), id);
        if (!d) {
          unreadable++;
          continue;
        }
        if (!isSlugOf(who, d.inbox_owner)) continue;
        if (Date.parse(d.created_at) < cutoff) continue;
        // A draft with no key (hand-made, or its key lost) can never be saved: counted, never shown.
        if (!(await readKey(id))) {
          unreadable++;
          continue;
        }
        mine.push(d);
      } catch {
        unreadable++;
      }
    }
    if (mine.length === 0) return { drafts: [], unreadable, canApprove: approve };

    const index = await deps.index();
    const linked = await scanEmailEntries(root, index.cards);
    const byKey = new Map(index.cards.map((c) => [c.key, c]));
    const toDomain = await domainRouter(index, who).catch(() => (): ProjectKey[] | null => null);
    const ctx: EmailRouteContext = {
      isLive: (k) => isLive(byKey.get(k)),
      linkedThread: (owner, thread) => linked.threads.get(`${owner}\0${thread}`) ?? null,
      linkedMessage: (id) => linked.messages.get(id) ?? null,
      resolveCode: (code) => index.refs?.resolve(code) ?? null,
      liveProjectsOfDomain: toDomain,
    };
    const isHeld = (k: string, near: Record<string, string>) =>
      linked.held.has(k) || (near[k] !== undefined && linked.held.has(near[k]));
    let roster: Map<string, string> | null = null;
    const nameOf = async (by: string): Promise<string | null> => {
      if (by === '') return null;
      if (!roster) {
        roster = new Map();
        for (const m of await readTeam(root).catch(() => [])) {
          roster.set(m.slug, m.name);
          const alt = memberSlug(m.name);
          if (alt && !roster.has(alt)) roster.set(alt, m.name);
        }
      }
      return roster.get(by) ?? by;
    };
    const drafts: EmailDraftItem[] = [];
    for (const d of mine) {
      const near = d.near_keys ?? {};
      // A teammate saved this very email first: hidden, never deleted (it returns if that entry is removed).
      // The same when an entry holds it under its Message-ID (a save made without a thread list).
      if (isHeld(d.email_key, near) || (d.message_id !== undefined && linked.held.has(d.message_id)))
        continue;
      const route = routeEmail(
        {
          requested: d.requested,
          inboxOwner: d.inbox_owner,
          threadId: d.thread_id,
          emailKey: d.email_key,
          threadMessageIds: d.thread_message_ids,
          codesSubject: d.codes_subject,
          codesBody: d.codes_body,
          threadKeys: d.thread_keys ?? [],
          nearKeys: near,
          codesThread: d.codes_thread ?? [],
          fromDomain: d.from_domain.toLowerCase(),
        },
        ctx,
      );
      if (keyFilter !== null && route.key !== keyFilter) continue;
      let thread: EmailDraftThread | undefined;
      if (
        d.thread_keys !== undefined ||
        d.near_keys !== undefined ||
        d.codes_thread !== undefined ||
        d.fresh_at_draft !== undefined
      ) {
        const keys = d.thread_keys ?? [];
        const covered = keys.filter((k) => isHeld(k, near));
        const fresh = Math.max(1, keys.length + 1 - covered.length);
        let latest: HeldBy | null = null;
        for (const k of covered) {
          const h = linked.held.get(k) ?? linked.held.get(near[k] ?? '');
          if (h && (!latest || h.time > latest.time)) latest = h;
        }
        thread = {
          total: keys.length + 1,
          fresh,
          ...(latest ? { partOf: { key: latest.key, byName: await nameOf(latest.by), at: latest.at } } : {}),
          ...(d.fresh_at_draft !== undefined && fresh < d.fresh_at_draft ? { overlap: true } : {}),
        };
      }
      drafts.push({
        id: d.id,
        subject: d.subject,
        from: shown(d.from),
        people: d.people.map(shown),
        sentAt: d.sent_at,
        summary: d.summary,
        route,
        ...(thread ? { thread } : {}),
      });
    }
    drafts.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
    return { drafts, unreadable, canApprove: approve };
  };

  /** Runs one script command; the raw reply so `exists` can be told apart. */
  const run = async (command: string, input: object) => {
    const script = await findProjectsScript(root);
    if (!script) throw new ProjectsError('internal', INTERNAL);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      throw new ProjectsError('internal', INTERNAL);
    }
    const outcome = await queue(() => runScript(script, realRoot, command, JSON.stringify(input), options));
    const reply = outcome.failed ? null : parseReply(outcome.stdout);
    if (reply === null) throw new ProjectsError('internal', INTERNAL);
    return { code: outcome.code, reply };
  };

  const refusal = (reply: Record<string, unknown>): ProjectsError => {
    switch (reply.error) {
      case 'bad-request':
        return new ProjectsError('bad-request', BAD);
      case 'not-found':
        return new ProjectsError('not-found', NO_DRAFT);
      case 'not-allowed':
        return new ProjectsError('not-allowed', NOT_ALLOWED);
      default:
        return new ProjectsError('internal', INTERNAL);
    }
  };

  const checkText = (v: string, max: number) => v.trim() !== '' && v.length <= max && !NEWLINE.test(v);

  const approve: EmailDraftsService['approve'] = async (req) => {
    const who = await deps.identity();
    if (deps.mayChange && !(await deps.mayChange(who).catch(() => false)))
      throw new ProjectsError('not-allowed', NOT_ALLOWED);
    const summary = typeof req.summary === 'string' ? req.summary.trim() : '';
    if (
      !ID.test(req.id) ||
      summary === '' ||
      summary.length > UPDATE_SUMMARY_MAX ||
      typeof req.subject !== 'string' ||
      // An email can have no subject (correctness review).
      req.subject.length > EMAIL_SUBJECT_MAX ||
      NEWLINE.test(req.subject) ||
      typeof req.from !== 'string' ||
      !checkText(req.from, EMAIL_NAME_MAX) ||
      !Array.isArray(req.people) ||
      req.people.length > EMAIL_PEOPLE_MAX ||
      !req.people.every((p) => typeof p === 'string' && checkText(p, EMAIL_NAME_MAX)) ||
      typeof req.clientSafe !== 'boolean' ||
      !parseProjectKey(req.key)
    )
      throw new ProjectsError('bad-request', BAD);
    if (!(await deps.capabilities().catch(() => [] as string[])).includes(PROJECTS_EMAIL_CAPABILITY))
      throw new ProjectsError('not-allowed', NEEDS_SKILLS);
    if (!(await folderIgnored())) throw new ProjectsError('not-allowed', NOT_ALLOWED);
    const index = await deps.index();
    const card = index.byKey(req.key);
    if (!card)
      throw new ProjectsError('not-found', "That project couldn't be found. It may have been moved.");
    if (card.archived) throw new ProjectsError('not-allowed', 'Archived projects are read only.');
    if (card.card !== 'ok')
      throw new ProjectsError(
        'not-allowed',
        "This project has no readable card yet, so it can't take emails.",
      );
    // The draft is read here, on the owner's click: the token never reaches the browser or the request.
    const draft = await readOwn(req.id, who);
    if (!draft) throw new ProjectsError('not-found', NO_DRAFT);
    const token = await readKey(draft.id);
    if (!token) throw new ProjectsError('not-allowed', NO_KEY);
    const entry: ProjectEmailEntryInput = {
      kind: 'email',
      draft: draft.id,
      token,
      summary,
      subject: req.subject,
      from: req.from,
      people: [...req.people],
      clientSafe: req.clientSafe,
    };
    try {
      const { code, reply } = await run('update', { kind: 'update', key: card.key, entry });
      if (code === 0 && reply.ok === true) {
        const file = reply.file;
        if (typeof file !== 'string' || file.length > 1024 || file.split('/').includes('..'))
          throw new ProjectsError('internal', INTERNAL);
        return { ok: true, key: card.key, file };
      }
      if (reply.ok === false && reply.error === 'exists') return await existsAnswer(reply, index, card.key);
      throw refusal(reply);
    } finally {
      deps.onChanged?.();
    }
  };

  /** "Already in <project>, added by <name>": found from the entry the script named. */
  const existsAnswer = async (
    reply: Record<string, unknown>,
    index: ProjectsIndex,
    fallback: ProjectKey,
  ): Promise<EmailApproveAnswer> => {
    const file = typeof reply.file === 'string' ? reply.file : '';
    const found = index.cards.find((c) => file.startsWith(`${c.folder}/${UPDATES_DIR}/`));
    const replyKey = typeof reply.key === 'string' && parseProjectKey(reply.key) ? reply.key : null;
    let byName = 'someone';
    if (found && /^[A-Za-z0-9._-]+\.md$/.test(file.slice(found.folder.length + UPDATES_DIR.length + 2))) {
      try {
        const text = await fs.readFile(join(root, ...file.split('/')), 'utf8');
        const raw = parseFrontmatter(text.replace(/\r\n?/g, '\n')).data.by;
        const by = typeof raw === 'string' ? raw : '';
        if (by) {
          const roster = new Map<string, string>();
          for (const m of await readTeam(root).catch(() => [])) {
            roster.set(m.slug, m.name);
            const alt = memberSlug(m.name);
            if (alt && !roster.has(alt)) roster.set(alt, m.name);
          }
          byName = roster.get(by) ?? by;
        }
      } catch {
        // keep "someone"
      }
    }
    return { ok: false, code: 'exists', key: found?.key ?? replyKey ?? fallback, byName };
  };

  const dismiss: EmailDraftsService['dismiss'] = async (id) => {
    const who = await deps.identity();
    if (deps.mayChange && !(await deps.mayChange(who).catch(() => false)))
      throw new ProjectsError('not-allowed', NOT_ALLOWED);
    if (!ID.test(id)) throw new ProjectsError('bad-request', BAD);
    if (!(await deps.capabilities().catch(() => [] as string[])).includes(PROJECTS_EMAIL_CAPABILITY))
      throw new ProjectsError('not-allowed', NEEDS_SKILLS);
    if (!(await readOwn(id, who))) throw new ProjectsError('not-found', NO_DRAFT);
    const { code, reply } = await run('email-draft-remove', {
      kind: 'email-draft-remove',
      id,
      dismiss: true,
    });
    if (code === 0 && reply.ok === true) return;
    throw refusal(reply);
  };

  return { list, approve, dismiss };
}
