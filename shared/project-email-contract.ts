/**
 * Projects R2 phase 5 (plan docs/plans/2026-11-24-projects-r2-email-entries.md): email entries, only with the
 * inbox owner's approval. Copied to shared/project-email-contract.ts. The script (`tdsapp-projects` 0.6.0),
 * the server and the Projects app build against this file. The app never writes brain files itself.
 */
import type { ProjectKey } from './projects-contract.ts';

// ─── Capability ──────────────────────────────────────────────────────────────────────────────────
/** The script answers `capabilities` with this once it has `email-draft`, `email-draft-remove` and email `update` (0.6.0). */
export const PROJECTS_EMAIL_CAPABILITY = 'projects-email-v1';

// ─── Where drafts live (decision 1) ──────────────────────────────────────────────────────────────
/** Brain-relative. Must be git-ignored (`git check-ignore`), else every read and write is refused. */
export const EMAIL_DRAFTS_DIR = 'briefing/email-drafts';
/** One file per draft: `<id>.json`, id = 12 characters of [a-z0-9]. */
export const EMAIL_DRAFT_FILE_PATTERN = /^[a-z0-9]{12}\.json$/;
/** Message-IDs the owner said "Not for a project" to, with the date; entries older than DISMISSED_DAYS dropped on write. */
/** Per inbox owner (overseer 6): `briefing/email-drafts/dismissed-<slug>.json`, `{ "<email_key>": "<YYYY-MM-DD>" }`. */
export const emailDismissedFile = (slug: string): string => `briefing/email-drafts/dismissed-${slug}.json`;
export const DISMISSED_DAYS = 90;
/** Drafts older than this (any owner) are deleted by the script on every email-draft / email-draft-remove, and hidden by the server (overseer 6). */
export const DRAFT_MAX_AGE_DAYS = 30;
/** Folder 0700, files 0600 (overseer 6). */
export const EMAIL_DRAFTS_DIR_MODE = 0o700;
export const EMAIL_DRAFT_FILE_MODE = 0o600;

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────
export const EMAIL_SUBJECT_MAX = 300;
/** One "Name <address>" string. */
export const EMAIL_PERSON_MAX = 320;
/** to + cc together; bcc is never accepted (a `bcc` key anywhere is refused). */
export const EMAIL_PEOPLE_MAX = 30;
/** Message-IDs of the thread's messages, draft only (overseer c). */
export const EMAIL_THREAD_IDS_MAX = 20;
/** The newest message's own text, read for codes then dropped. Small so the whole call fits Cortex's 20,000-character command limit (overseer 4; test it). */
export const EMAIL_NEWEST_TEXT_MAX = 4_000;
/** Gmail thread ids as the connector gives them (hex). */
export const GMAIL_THREAD_ID_PATTERN = /^[0-9a-f]{8,32}$/i;
/** RFC 822 Message-ID: at most this long, no whitespace or control characters (overseer 9). */
export const MESSAGE_ID_MAX = 300;
/** A display name stored in an entry. */
export const EMAIL_NAME_MAX = 120;
/** A draft file larger than this is skipped as unreadable. */
export const EMAIL_DRAFT_MAX_BYTES = 64 * 1024;
/** /gm writes at most this many drafts a run (brain rule, decision 8). */
export const GM_EMAIL_DRAFTS_PER_RUN = 8;

// ─── Script input: `email-draft` (decision 1) ────────────────────────────────────────────────────
/**
 * stdin `{"action":"email-draft", ...EmailDraftInput}`. Answers `{ok:true, action:'email-draft', id}`.
 * Answers never include approve_token. Refused: drafts folder not git-ignored or a link (`not-allowed`); no identity for this Mac (`not-allowed`);
 * email_key dismissed by this owner (`dismissed`) or already in any project's `email` entry (`exists`, with `file`);
 * inboxAddress not this identity's email (`not-allowed`); a draft with the same email_key already waiting is replaced, not duplicated; bad or over-long fields,
 * a `bcc` key (`bad-request`); `requested` not a live project with a card (`not-found`).
 */
/** Who sent or received it, as the connector's `addressDisplayNames` give it. No newlines. */
export interface EmailPerson {
  name: string | null;
  address: string;
}

export interface EmailDraftInput {
  /** This inbox's Gmail thread id (GMAIL_THREAD_ID_PATTERN). */
  threadId: string;
  /** The Gmail address of the inbox being read (the connector's `authuser`). Refused unless it equals this identity's email in `.team-config/roles.json`, case-insensitive (overseer 7). */
  inboxAddress: string;
  /**
   * RFC 822 Message-ID, with angle brackets, when Claude has it (the connector shows it only in RAW format,
   * so usually absent; probed 2026-11-24). Without it the script derives the key (see `email_key`).
   */
  messageId?: string;
  /** Message-IDs of the thread's other messages (newest first), at most EMAIL_THREAD_IDS_MAX. Draft only. */
  threadMessageIds?: string[];
  /** No newlines. */
  subject: string;
  from: EmailPerson;
  /** to and cc, never bcc. */
  people: EmailPerson[];
  /** ISO time the message was sent. */
  sentAt: string;
  /** Claude's summary, at most UPDATE_SUMMARY_MAX; never the email text. */
  summary: string;
  /** The newest message's own text, read for codes (quoted `>` lines and everything after a `-- ` line skipped), then dropped. */
  newestText: string;
  /** Set when the person asked "link this thread to <project>". */
  requested?: ProjectKey;
}

/**
 * The key that makes one email one entry, across inboxes (decision 4, overseer blocker 2): the Message-ID when
 * given, else `x:` + hex SHA-256 of `<from address lower-case>\n<sentAt to the minute, UTC, YYYY-MM-DDTHH:mm>\n<subject
 * lower-case, whitespace collapsed, leading Re:/Fwd:/Fw: removed repeatedly>`. Computed by the script only.
 */
export type EmailKey = string;

/** The draft file on disk (snake_case). Never holds the email text. Mode 0600. */
export interface EmailDraftFile {
  v: 1;
  id: string;
  /** Team slug from this Mac's identity at draft time. */
  inbox_owner: string;
  created_at: string;
  thread_id: string;
  email_key: EmailKey;
  /** Message-IDs from the input (draft only, never in an entry). */
  thread_message_ids: string[];
  subject: string;
  /** Addresses stay in the draft only (overseer 3). */
  from: EmailPerson;
  /** Lower-case domain of `from.address`. */
  from_domain: string;
  people: EmailPerson[];
  sent_at: string;
  summary: string;
  /** Distinct valid project codes found (shared code rules), upper case. */
  codes_subject: string[];
  codes_body: string[];
  requested: string | null;
  /**
   * 32 hex characters from crypto random (overseer blocker 1). Never returned by any script reply, never sent to
   * the app's client. The server reads it from the file when the owner clicks Save and passes it to `update`.
   */
  approve_token: string;
}

/** stdin `{"action":"email-draft-remove", id, dismiss}`. `dismiss: true` records the Message-ID (decision 5). Only the draft's inbox owner. Answers `{ok:true, action:'email-draft-remove', id}`. */
export interface EmailDraftRemoveInput {
  id: string;
  dismiss: boolean;
}

// ─── Approval: `update` with kind email (decision 3), through POST ROUTES.projectsChange ─────────
/**
 * `{kind:'update', key, entry: ProjectEmailEntryInput}`. The script reads the draft, refuses unless its
 * `inbox_owner` is this Mac's identity (`not-allowed`), takes thread id, Message-ID, sent time and inbox owner
 * from the draft, the rest from here, writes the entry (frontmatter as R1's `ProjectUpdate`), then deletes the
 * draft. `exists` (with `file` and `key` of the entry) when any project already holds that Message-ID; the
 * draft is then deleted too. Answers `{ok:true, action:'update', key, version, file}`.
 */
export interface ProjectEmailEntryInput {
  kind: 'email';
  draft: string;
  /** The draft's approve_token: injected by the server from the file, never from the client. Missing or wrong → `not-allowed`. */
  token: string;
  summary: string;
  subject: string;
  /** Display names only (overseer 3): name, else the address when there is no name. No newlines, at most EMAIL_NAME_MAX. */
  from: string;
  people: string[];
  clientSafe: boolean;
}

/**
 * The entry on disk (R1 `ProjectUpdate` layout): `kind: email`, `email_subject`, `email_from` (a name),
 * `email_people` (names), `email_sent_at`, `email_thread_id` (hex), `email_key`, `email_inbox_owner`. Never an
 * address, never `email_message_id` (superseded by `email_key`). The server reads `email_key` (and, for old
 * files, `email_message_id`) for de-duplication.
 *
 * Removal (overseer d): `update-remove` allows an `email` entry for its `email_inbox_owner`, the brain's Owner or
 * a scout. Removing never re-opens or dismisses a draft.
 *
 * Reading (overseer 5): within one project, entries with the same `email_key` collapse to the earliest by `at`.
 */

// ─── Reading drafts (server → app, decisions 2 and 6) ────────────────────────────────────────────
export type EmailRouteWhy =
  | 'requested'
  | 'thread' // a thread this inbox owner already linked
  | 'message' // one of the thread's Message-IDs is already in a project
  | 'subject-code'
  | 'body-code'
  | 'domain'
  | 'codes-disagree' // two or more different codes: no pre-selection
  | 'domain-several' // the client has more than one live project
  | 'none';

export interface EmailRoute {
  /** Pre-selected project, or null ("Choose a project"). Never archived or done. */
  key: ProjectKey | null;
  why: EmailRouteWhy;
  /** For 'codes-disagree': the codes found. */
  codes?: string[];
}

/** One draft as the app shows it. Only drafts whose inbox_owner is this Mac's identity are listed. */
export interface EmailDraftItem {
  id: string;
  subject: string;
  from: string;
  people: string[];
  sentAt: string;
  summary: string;
  route: EmailRoute;
}

/** `GET ROUTES.projectEmailDrafts[?key=<ProjectKey>]` → this. With `key`, only drafts routed to that project. */
export interface EmailDraftsResponse {
  drafts: EmailDraftItem[];
  /** Draft files that couldn't be read: counted, never shown. */
  unreadable: number;
  /** The script has PROJECTS_EMAIL_CAPABILITY and the folder is git-ignored. */
  canApprove: boolean;
}

/** `POST ROUTES.projectEmailDrafts` body: dismiss one draft (runs `email-draft-remove` with dismiss). Answers `{ok:true}`. */
export interface EmailDraftDismissRequest {
  action: 'dismiss';
  id: string;
}

/** `POST ROUTES.projectEmailDrafts` body: approve one draft. The server reads the draft (owner check), injects the token and runs `update`. Answers the `update` reply, or `{ok:false, code:'exists', key, byName}`. */
export interface EmailDraftApproveRequest {
  action: 'approve';
  id: string;
  key: ProjectKey;
  summary: string;
  subject: string;
  from: string;
  people: string[];
  clientSafe: boolean;
}

/**
 * "Open in Gmail" (overseer f; format seen in the connector's viewUrl, 2026-11-24):
 * `https://mail.google.com/mail/?authuser=<owner's roles.json email, URI-encoded>#all/thread-f:<thread id as a decimal>`
 * (hex → BigInt → decimal). Built by the server only when this Mac's identity is the entry's inbox owner.
 */
export const gmailThreadUrl = (ownerEmail: string, threadIdHex: string): string =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(ownerEmail)}#all/thread-f:${BigInt(`0x${threadIdHex}`).toString(10)}`;

// ROUTES additions (shared/contract.ts): projectEmailDrafts: '/api/projects/email-drafts' (GET list; POST approve or dismiss).
// ProjectUpdateItem gains `emailKey?: string` and `gmailUrl?: string` (only for the inbox owner) and keeps the
// email fields R1 reserved; `emailMessageId` is read from old files only.
