/**
 * Projects R2 phase 2 (plan docs/plans/2026-11-23-projects-r2-updates-log.md, decisions 5, 2 and 8): reads a
 * project's `updates/` log and gates adding and removing entries. The app never writes a brain file: `update`
 * and `update-remove` are the `tdsapp-projects` script's. Reads the project's own folder, plus, read-only and
 * marked, entries left in the folders of its `moved_from` keys and any card-less folder still at its key.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_ID_PATTERN,
  CHAT_TITLE_MAX,
  PROJECTS_CHAT_SUMMARY_CAPABILITY,
} from '../../shared/chat-summary-contract.ts';
import type { Identity } from '../../shared/contract.ts';
import {
  GMAIL_THREAD_ID_PATTERN,
  gmailThreadUrl,
  PROJECTS_EMAIL_CAPABILITY,
} from '../../shared/project-email-contract.ts';
import {
  PROJECTS_UPDATES_CAPABILITY,
  type ProjectUpdateAction,
  type ProjectUpdateItem,
  type ProjectUpdateRemoveAction,
  type ProjectUpdatesResponse,
  UPDATE_FILE_PATTERN,
  UPDATE_SUMMARY_MAX,
  UPDATES_DIR,
  UPDATES_PAGE,
} from '../../shared/project-updates-contract.ts';
import { archiveFolderFor, parseProjectKey } from '../../shared/projects.ts';
import {
  INTERNAL_CLIENT,
  PROJECT_CARD_FILE,
  type ProjectCard,
  type ProjectKey,
  ProjectsError,
} from '../../shared/projects-contract.ts';
import { isSlugOf, memberEmailOfSlug } from './email-drafts.ts';
import { asString, type FrontmatterValue, parseFrontmatter } from './frontmatter.ts';
import { hasConflict, type ProjectsIndex } from './projects.ts';
import type { ProjectsSkillRunner } from './projects-skill.ts';
import { readTeam } from './todos.ts';
import { memberSlug } from './util.ts';

export interface ProjectUpdatesOptions {
  index: () => Promise<ProjectsIndex>;
  skill: ProjectsSkillRunner;
  /** Whether the brain's `tdsapp-projects` skill allows this person (its `roles:`). Missing: everyone. */
  mayChange?: (identity: Identity) => Promise<boolean>;
  /**
   * Whether this Mac holds the chat with that session id (live, or in Claude Code's session list), so a
   * `chat` entry can say "Open chat". Missing: no entry is openable.
   */
  holdsChat?: (chatId: string) => boolean | Promise<boolean>;
}

/** One of this person's `chat` entries for a chat, as `chatEntries` answers it. */
export interface ChatEntryRef {
  path: string;
  at: string;
  summary: string;
}

export interface ProjectUpdatesService {
  read(key: ProjectKey, before: string | null, identity: Identity): Promise<ProjectUpdatesResponse>;
  /**
   * Runs `update` or `update-remove` through the script after the app's own checks. Answers what the script
   * added to its reply: `file` for an update. Throws ProjectsError.
   */
  change(
    action: ProjectUpdateAction | ProjectUpdateRemoveAction,
    identity: Identity,
  ): Promise<{ file?: string }>;
  /**
   * Every `chat` entry of that chat on the project (the whole log, not one page, old folders included) that
   * this person wrote, newest first. Empty for an unknown project.
   */
  chatEntries(key: ProjectKey, chatId: string, identity: Identity): Promise<ChatEntryRef[]>;
}

/** An entry file bigger than this is counted unreadable. */
const ENTRY_MAX_BYTES = 64 * 1024;
const MANUAL_KINDS: readonly string[] = ['note', 'call'];
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const VERSION = /^[0-9a-f]{64}$/;

const COULD_NOT_FIND = "That project couldn't be found. It may have been moved.";
const NOT_ALLOWED = "Changing projects isn't available to you in the app yet.";
const NEEDS_SKILLS = "Update the brain's skills to add project updates.";
const BAD = "That update couldn't be saved. Check the details and try again.";

interface Parsed {
  item: Omit<ProjectUpdateItem, 'byName' | 'canRemove'>;
  time: number;
  name: string;
  /** `email_thread_keys` and `email_thread_link` (project-email-threads-contract.ts): they only join entries into a conversation. */
  threadKeys: string[];
  threadLink?: string;
}
interface Listing {
  entries: Parsed[];
  unreadable: number;
}

/**
 * The folders a key's project may sit in (the live and archive folder beside it, the old
 * `projects/` ones for The Digital Stride). Personal keys never have old folders from teammates.
 */
function foldersOfKey(key: ProjectKey): string[] {
  const parsed = parseProjectKey(key);
  if (!parsed || parsed.client === 'personal') return [];
  const live = [`clients/${parsed.client}/projects/${parsed.slug}`];
  if (parsed.client === INTERNAL_CLIENT) live.push(`projects/${parsed.slug}`);
  return live.flatMap((f) => [f, archiveFolderFor(f)].filter((x): x is string => x !== null));
}

async function lstat(path: string) {
  try {
    return await fs.lstat(path);
  } catch {
    return null;
  }
}

const text = (v: FrontmatterValue | undefined): string | undefined => {
  const s = asString(v).trim();
  return s === '' ? undefined : s;
};

/** One entry file, or null when it can't be read as an entry. */
function parseEntry(path: string, name: string, bytes: Buffer, old: boolean): Parsed | null {
  const src = bytes.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (lines[0] !== '---' || !lines.slice(1).includes('---') || hasConflict(src)) return null;
  const { data, body } = parseFrontmatter(src);
  const kind = text(data.kind);
  const by = text(data.by);
  const at = text(data.at);
  if (text(data.v) !== '1' || !kind || !by || !at || !/^\d{4}-\d{2}-\d{2}T/.test(at)) return null;
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return null;
  const people = data.email_people;
  const item = {
    v: 1 as const,
    kind,
    by,
    at,
    clientSafe: text(data.client_safe) === 'true',
    summary: body.trim(),
    ...(text(data.change) !== undefined ? { change: text(data.change) } : {}),
    ...(text(data.from) !== undefined ? { from: text(data.from) } : {}),
    ...(text(data.to) !== undefined ? { to: text(data.to) } : {}),
    ...(text(data.email_subject) !== undefined ? { emailSubject: text(data.email_subject) } : {}),
    ...(text(data.email_from) !== undefined ? { emailFrom: text(data.email_from) } : {}),
    ...(people !== undefined
      ? { emailPeople: (Array.isArray(people) ? people : [people]).filter((p) => p !== '') }
      : {}),
    ...(text(data.email_sent_at) !== undefined ? { emailSentAt: text(data.email_sent_at) } : {}),
    ...(text(data.email_thread_id) !== undefined ? { emailThreadId: text(data.email_thread_id) } : {}),
    ...(text(data.email_key) !== undefined ? { emailKey: text(data.email_key) } : {}),
    ...(text(data.email_message_id) !== undefined ? { emailMessageId: text(data.email_message_id) } : {}),
    ...(text(data.email_inbox_owner) !== undefined ? { emailInboxOwner: text(data.email_inbox_owner) } : {}),
    ...(kind === 'chat' && CHAT_ID_PATTERN.test(text(data.chat) ?? '') ? { chatId: text(data.chat) } : {}),
    ...(kind === 'chat' && text(data.chat_title) !== undefined ? { chatTitle: text(data.chat_title) } : {}),
    path,
    version: sha256(bytes),
    ...(old ? { fromOldFolder: true as const } : {}),
  };
  const listed = data.email_thread_keys;
  const threadKeys = (Array.isArray(listed) ? listed : listed === undefined ? [] : [listed]).filter(
    (k) => k !== '',
  );
  return {
    item,
    time,
    name,
    threadKeys,
    ...(text(data.email_thread_link) ? { threadLink: text(data.email_thread_link) } : {}),
  };
}

/**
 * Within one project, entries with the same `email_key` (or an old file's `email_message_id`) collapse to the
 * earliest by `at`, ties to the smaller file name (phase 5, overseer 5): two people approving one email show once.
 */
function collapseEmails(entries: Parsed[]): Parsed[] {
  const first = new Map<string, Parsed>();
  for (const e of entries) {
    const k = e.item.kind === 'email' ? (e.item.emailKey ?? e.item.emailMessageId) : undefined;
    if (!k) continue;
    const cur = first.get(k);
    if (!cur || e.time < cur.time || (e.time === cur.time && e.name < cur.name)) first.set(k, e);
  }
  return entries.filter((e) => {
    const k = e.item.kind === 'email' ? (e.item.emailKey ?? e.item.emailMessageId) : undefined;
    return !k || first.get(k) === e;
  });
}

/**
 * One conversation, one `emailThread` (project-email-threads-contract.ts, JOIN): within one project, email
 * entries that share any of `email_key`, `email_thread_keys`, `email_thread_link`, or the same inbox owner and
 * Gmail thread id, transitively, get the file name of the earliest entry as `emailThread`. An entry alone gets
 * none. Runs after `collapseEmails`.
 */
function joinConversations(entries: Parsed[]): Parsed[] {
  const emails = entries.filter((e) => e.item.kind === 'email');
  const parent = new Map<Parsed, Parsed>();
  const find = (e: Parsed): Parsed => {
    let root = e;
    while (parent.get(root) !== root) root = parent.get(root) as Parsed;
    parent.set(e, root);
    return root;
  };
  const owner = new Map<string, Parsed>();
  for (const e of emails) parent.set(e, e);
  for (const e of emails) {
    const tokens = [e.item.emailKey, ...e.threadKeys, e.threadLink]
      .filter((k): k is string => !!k)
      .map((k) => `k:${k}`);
    if (e.item.emailInboxOwner && e.item.emailThreadId)
      tokens.push(`t:${e.item.emailInboxOwner}\0${e.item.emailThreadId}`);
    for (const t of tokens) {
      const seen = owner.get(t);
      if (!seen) owner.set(t, e);
      else parent.set(find(e), find(seen));
    }
  }
  const groups = new Map<Parsed, Parsed[]>();
  for (const e of emails) {
    const r = find(e);
    groups.set(r, [...(groups.get(r) ?? []), e]);
  }
  const thread = new Map<Parsed, string>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const earliest = members.reduce((a, b) =>
      b.time < a.time || (b.time === a.time && b.name < a.name) ? b : a,
    );
    for (const m of members) thread.set(m, earliest.name);
  }
  return entries.map((e) => {
    const t = thread.get(e);
    return t ? { ...e, item: { ...e.item, emailThread: t } } : e;
  });
}

/**
 * Before paging, all parts of a conversation sit together at the position of its newest-saved part, ordered
 * inside by `email_sent_at`, newest first (overseer S3). `entries` arrives sorted newest-saved first.
 */
function groupConversations(entries: Parsed[]): Parsed[] {
  const parts = new Map<string, Parsed[]>();
  for (const e of entries) {
    const t = e.item.emailThread;
    if (t) parts.set(t, [...(parts.get(t) ?? []), e]);
  }
  const sentAt = (e: Parsed) => {
    const t = Date.parse(e.item.emailSentAt ?? '');
    return Number.isFinite(t) ? t : e.time;
  };
  const out: Parsed[] = [];
  const placed = new Set<string>();
  for (const e of entries) {
    const t = e.item.emailThread;
    if (!t) {
      out.push(e);
      continue;
    }
    if (placed.has(t)) continue;
    placed.add(t);
    out.push(
      ...(parts.get(t) as Parsed[]).sort(
        (a, b) =>
          sentAt(b) - sentAt(a) || b.time - a.time || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0),
      ),
    );
  }
  return out;
}

async function readFolder(root: string, folder: string, old: boolean): Promise<Listing> {
  const dir = join(root, ...folder.split('/'), UPDATES_DIR);
  const st = await lstat(dir);
  if (!st?.isDirectory()) return { entries: [], unreadable: 0 };
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { entries: [], unreadable: 0 };
  }
  const out: Listing = { entries: [], unreadable: 0 };
  await Promise.all(
    names
      .filter((n) => n.endsWith('.md') && !n.startsWith('.'))
      .map(async (name) => {
        const abs = join(dir, name);
        const fst = await lstat(abs);
        if (!fst?.isFile() || fst.size > ENTRY_MAX_BYTES) {
          out.unreadable++;
          return;
        }
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(abs);
        } catch {
          out.unreadable++;
          return;
        }
        const parsed = parseEntry(`${folder}/${UPDATES_DIR}/${name}`, name, bytes, old);
        if (parsed) out.entries.push(parsed);
        else out.unreadable++;
      }),
  );
  return out;
}

export function createProjectUpdates(root: string, opts: ProjectUpdatesOptions): ProjectUpdatesService {
  const mayChange = (identity: Identity) =>
    opts.mayChange ? opts.mayChange(identity).catch(() => false) : Promise.resolve(true);
  /** Per project, valid while every folder's `updates/` has the same modified time (cheap, no watcher needed). */
  const cache = new Map<string, { stamp: string; value: Listing }>();

  /** The folders to read for a card: its own, then old folders that hold no card of their own. */
  const oldFolders = async (card: ProjectCard, index: ProjectsIndex): Promise<string[]> => {
    if (card.space === 'personal') return [];
    const keys = [card.key, ...(card.movedFrom ?? [])].filter(
      (k) => k === card.key || !index.cards.some((c) => c.key === k),
    );
    const found: string[] = [];
    for (const k of keys) {
      for (const folder of foldersOfKey(k)) {
        if (folder === card.folder || found.includes(folder)) continue;
        if (index.cards.some((c) => c.folder === folder)) continue;
        // A folder with any project.md is a project, not a leftover (the script refuses card-less ones only).
        if (await lstat(join(root, ...folder.split('/'), PROJECT_CARD_FILE))) continue;
        found.push(folder);
      }
    }
    return found;
  };

  const listing = async (card: ProjectCard, index: ProjectsIndex): Promise<Listing> => {
    const folders = [{ folder: card.folder, old: false }];
    for (const f of await oldFolders(card, index)) folders.push({ folder: f, old: true });
    // The folder's own stats change on add and remove; each file's size and time catch an entry edited in place.
    const stamps = await Promise.all(
      folders.map(async (f) => {
        const dir = join(root, ...f.folder.split('/'), UPDATES_DIR);
        const st = await lstat(dir);
        if (!st?.isDirectory()) return `${f.folder}:${st ? 'other' : 'none'}`;
        const names = (await fs.readdir(dir).catch(() => [] as string[]))
          .filter((n) => n.endsWith('.md'))
          .sort();
        const files = await Promise.all(
          names.map(async (n) => {
            const fst = await lstat(join(dir, n));
            return fst ? `${n}=${fst.size}@${fst.mtimeMs}` : `${n}=gone`;
          }),
        );
        return `${f.folder}:${st.ino}:${st.mtimeMs}:${files.join(',')}`;
      }),
    );
    const stamp = stamps.join('|');
    const hit = cache.get(card.key);
    if (hit && hit.stamp === stamp) return hit.value;
    const parts = await Promise.all(folders.map((f) => readFolder(root, f.folder, f.old)));
    const entries = joinConversations(collapseEmails(parts.flatMap((p) => p.entries)));
    entries.sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    entries.splice(0, entries.length, ...groupConversations(entries));
    const value = { entries, unreadable: parts.reduce((n, p) => n + p.unreadable, 0) };
    cache.set(card.key, { stamp, value });
    return value;
  };

  const capable = async () =>
    (await opts.skill.capabilities().catch(() => [] as string[])).includes(PROJECTS_UPDATES_CAPABILITY);

  const chatCapable = async () =>
    (await opts.skill.capabilities().catch(() => [] as string[])).includes(PROJECTS_CHAT_SUMMARY_CAPABILITY);

  const emailCapable = async () =>
    (await opts.skill.capabilities().catch(() => [] as string[])).includes(PROJECTS_EMAIL_CAPABILITY);

  const read: ProjectUpdatesService['read'] = async (key, before, identity) => {
    const index = await opts.index();
    const card = index.byKey(key);
    if (!card) throw new ProjectsError('not-found', COULD_NOT_FIND);
    const [all, allowed, hasCap, hasEmailCap, hasChatCap] = await Promise.all([
      listing(card, index),
      mayChange(identity),
      capable(),
      emailCapable(),
      chatCapable(),
    ]);
    let start = 0;
    if (before !== null) {
      const at = all.entries.findIndex((e) => e.item.path === before);
      if (at === -1) throw new ProjectsError('bad-request', BAD);
      start = at + 1;
    }
    // The script writes `by` as memberSlug(name); the to-do roster uses another slug form. Know both.
    const roster = new Map<string, string>();
    for (const m of await readTeam(root).catch(() => [])) {
      roster.set(m.slug, m.name);
      const alt = memberSlug(m.name);
      if (alt && !roster.has(alt)) roster.set(alt, m.name);
    }
    // The script refuses both changes without a live, readable card.
    const live = !card.archived && card.card === 'ok';
    // A conversation is never split across pages: a page may run over its size to finish one.
    let end = Math.min(start + UPDATES_PAGE, all.entries.length);
    const tail = all.entries[end - 1]?.item.emailThread;
    while (tail && end < all.entries.length && all.entries[end]?.item.emailThread === tail) end++;
    const page = all.entries.slice(start, end);
    // "Open in Gmail" only for the inbox owner: their roles.json email is the Gmail account to open.
    const gmail = new Map<string, string | null>();
    for (const { item } of page) {
      const owner = item.emailInboxOwner;
      if (item.kind !== 'email' || !owner || gmail.has(owner) || !isSlugOf(identity, owner)) continue;
      gmail.set(owner, (await memberEmailOfSlug(root, owner).catch(() => null)) ?? identity.email);
    }
    // "Open chat" only for a chat this Mac holds; one look-up per chat id.
    const held = new Map<string, boolean>();
    for (const { item } of page) {
      const id = item.chatId;
      if (item.kind !== 'chat' || !id || held.has(id)) continue;
      held.set(
        id,
        await Promise.resolve()
          .then(() => opts.holdsChat?.(id) ?? false)
          .catch(() => false),
      );
    }
    const updates: ProjectUpdateItem[] = page.map(({ item }) => {
      const isEmail = item.kind === 'email';
      const author = item.by === identity.slug || (card.space === 'personal' && item.by === 'me');
      // An email entry: its inbox owner (not just whoever saved it), the Owner or a scout (contract, overseer d).
      const mayRemove = isEmail
        ? isSlugOf(identity, item.emailInboxOwner) || identity.role === 'owner' || identity.role === 'scout'
        : author || identity.role === 'owner' || identity.role === 'scout';
      const ownerEmail = item.emailInboxOwner ? gmail.get(item.emailInboxOwner) : null;
      let gmailUrl: string | undefined;
      if (isEmail && ownerEmail && item.emailThreadId && GMAIL_THREAD_ID_PATTERN.test(item.emailThreadId)) {
        try {
          gmailUrl = gmailThreadUrl(ownerEmail, item.emailThreadId);
        } catch {
          gmailUrl = undefined;
        }
      }
      return {
        ...item,
        ...(gmailUrl ? { gmailUrl } : {}),
        ...(item.kind === 'chat' && item.chatId && held.get(item.chatId)
          ? { chatOpenable: true as const }
          : {}),
        byName: roster.get(item.by) ?? item.by,
        canRemove:
          hasCap &&
          allowed &&
          live &&
          !item.fromOldFolder &&
          (isEmail
            ? hasEmailCap
            : MANUAL_KINDS.includes(item.kind) || (item.kind === 'chat' && hasChatCap)) &&
          UPDATE_FILE_PATTERN.test(item.path.slice(item.path.lastIndexOf('/') + 1)) &&
          mayRemove,
      };
    });
    return {
      updates,
      more: end < all.entries.length,
      unreadable: all.unreadable,
      canAdd: hasCap && allowed && live,
    };
  };

  const change: ProjectUpdatesService['change'] = async (action, identity) => {
    const bad = () => new ProjectsError('bad-request', BAD);
    const index = await opts.index();
    const card = index.byKey(action.key);
    if (!card) throw new ProjectsError('not-found', COULD_NOT_FIND);
    if (action.kind === 'update') {
      const e = action.entry;
      const summary = typeof e?.summary === 'string' ? e.summary.trim() : '';
      if (e?.kind === 'chat') {
        // Shape only; the route checks ownership and the body's layout. Needs the script's chat capability.
        const title = typeof e.title === 'string' ? e.title.trim() : '';
        if (
          typeof e.chat !== 'string' ||
          !CHAT_ID_PATTERN.test(e.chat) ||
          title === '' ||
          title.length > CHAT_TITLE_MAX ||
          /[\r\n]/.test(e.title) ||
          typeof e.clientSafe !== 'boolean' ||
          summary === '' ||
          summary.length > UPDATE_SUMMARY_MAX
        )
          throw bad();
        if (!(await chatCapable())) throw new ProjectsError('not-allowed', NEEDS_SKILLS);
      } else if (
        !e ||
        !MANUAL_KINDS.includes(e.kind) ||
        typeof e.clientSafe !== 'boolean' ||
        summary === '' ||
        summary.length > UPDATE_SUMMARY_MAX
      )
        throw bad();
    } else {
      const prefix = `${card.folder}/${UPDATES_DIR}/`;
      const name = typeof action.file === 'string' ? action.file.slice(prefix.length) : '';
      if (
        typeof action.file !== 'string' ||
        !action.file.startsWith(prefix) ||
        name === '' ||
        name.includes('/') ||
        !UPDATE_FILE_PATTERN.test(name) ||
        typeof action.expect !== 'string' ||
        !VERSION.test(action.expect)
      )
        throw bad();
    }
    if (!(await mayChange(identity))) throw new ProjectsError('not-allowed', NOT_ALLOWED);
    if (!(await capable())) throw new ProjectsError('not-allowed', NEEDS_SKILLS);
    if (card.archived) throw new ProjectsError('not-allowed', 'Archived projects are read only.');
    if (card.card !== 'ok')
      throw new ProjectsError(
        'not-allowed',
        "This project has no readable card yet, so its updates can't be changed.",
      );
    const result = await opts.skill.run(action);
    return result.file !== undefined ? { file: result.file } : {};
  };

  const chatEntries: ProjectUpdatesService['chatEntries'] = async (key, chatId, identity) => {
    const index = await opts.index();
    const card = index.byKey(key);
    if (!card) return [];
    const all = await listing(card, index);
    return all.entries
      .filter(
        (e) =>
          e.item.kind === 'chat' &&
          e.item.chatId === chatId &&
          (e.item.by === identity.slug || (card.space === 'personal' && e.item.by === 'me')),
      )
      .map((e) => ({ path: e.item.path, at: e.item.at, summary: e.item.summary }));
  };

  return { read, change, chatEntries };
}
