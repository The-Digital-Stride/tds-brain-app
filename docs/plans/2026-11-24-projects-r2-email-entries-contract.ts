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
export const EMAIL_DISMISSED_FILE = 'briefing/email-drafts/dismissed.json';
export const DISMISSED_DAYS = 90;

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────
export const EMAIL_SUBJECT_MAX = 300;
/** One "Name <address>" string. */
export const EMAIL_PERSON_MAX = 320;
/** to + cc together; bcc is never accepted (a `bcc` key anywhere is refused). */
export const EMAIL_PEOPLE_MAX = 30;
/** Message-IDs of the thread's messages kept for matching across inboxes (decision 2). */
export const EMAIL_THREAD_IDS_MAX = 50;
/** The newest message's own text, read for codes then dropped. */
export const EMAIL_NEWEST_TEXT_MAX = 50_000;
/** A draft file larger than this is skipped as unreadable. */
export const EMAIL_DRAFT_MAX_BYTES = 64 * 1024;
/** /gm writes at most this many drafts a run (brain rule, decision 8). */
export const GM_EMAIL_DRAFTS_PER_RUN = 8;

// ─── Script input: `email-draft` (decision 1) ────────────────────────────────────────────────────
/**
 * stdin `{"action":"email-draft", ...EmailDraftInput}`. Answers `{ok:true, action:'email-draft', id}`.
 * Refused: drafts folder not git-ignored or a link (`not-allowed`); no identity for this Mac (`not-allowed`);
 * Message-ID dismissed (`dismissed`) or already in any project's `email` entry (`exists`, with `file`);
 * a draft with the same Message-ID already waiting is replaced, not duplicated; bad or over-long fields,
 * a `bcc` key (`bad-request`); `requested` not a live project with a card (`not-found`).
 */
export interface EmailDraftInput {
  /** This inbox's Gmail thread id. */
  threadId: string;
  /** RFC 822 Message-ID of the message being summarised, with angle brackets. */
  messageId: string;
  /** Message-IDs of the thread's other messages (newest first), at most EMAIL_THREAD_IDS_MAX. */
  threadMessageIds?: string[];
  subject: string;
  /** "Name <address>" as shown. */
  from: string;
  /** to and cc as shown, never bcc. */
  people: string[];
  /** ISO time the message was sent. */
  sentAt: string;
  /** Claude's summary, at most UPDATE_SUMMARY_MAX; never the email text. */
  summary: string;
  /** The newest message's own text, read for codes (quoted `>` lines and everything after a `-- ` line skipped), then dropped. */
  newestText: string;
  /** Set when the person asked "link this thread to <project>". */
  requested?: ProjectKey;
}

/** The draft file on disk (snake_case). Never holds the email text. */
export interface EmailDraftFile {
  v: 1;
  id: string;
  /** Team slug from this Mac's identity at draft time. */
  inbox_owner: string;
  created_at: string;
  thread_id: string;
  message_id: string;
  thread_message_ids: string[];
  subject: string;
  from: string;
  /** Lower-case domain of `from`'s address. */
  from_domain: string;
  people: string[];
  sent_at: string;
  summary: string;
  /** Distinct valid project codes found (shared code rules), upper case. */
  codes_subject: string[];
  codes_body: string[];
  requested: string | null;
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
  summary: string;
  subject: string;
  from: string;
  people: string[];
  clientSafe: boolean;
}

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

/** `POST ROUTES.projectEmailDrafts` body: dismiss one draft. Answers `{ok:true}`. */
export interface EmailDraftDismissRequest {
  action: 'dismiss';
  id: string;
}

// ROUTES additions (shared/contract.ts): projectEmailDrafts: '/api/projects/email-drafts' (GET list, POST dismiss).
// ProjectUpdateItem already carries emailSubject, emailFrom, emailPeople, emailSentAt, emailThreadId,
// emailMessageId and emailInboxOwner; the server adds `isInboxOwner: boolean` for "Open in Gmail".
