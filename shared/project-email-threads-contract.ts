/**
 * Project email threads (plan docs/plans/2026-11-25-project-email-threads.md, with the overseer's pre-review
 * outcomes). Adds to shared/project-email-contract.ts; nothing there changes meaning. The script
 * (`tdsapp-projects` 0.8.0), the server and the Projects app build against this file. Every new field is
 * optional, so an older script, an older app and an older /gm rule keep working (plan, "Backward
 * compatibility").
 */
import type { ProjectKey } from './projects-contract.ts';

// ─── Capability ──────────────────────────────────────────────────────────────────────────────────
/** The script answers `capabilities` with this once it has `email-check`, `thread` and `threadCodes` (0.8.0). */
export const PROJECTS_EMAIL_THREADS_CAPABILITY = 'projects-email-threads-v1';

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────
/** Messages of one thread sent to the script, newest first. A longer thread sends its newest 30. */
export const EMAIL_THREAD_MESSAGES_MAX = 30;
/** Codes Claude reports from earlier messages. */
export const EMAIL_THREAD_CODES_MAX = 10;
/**
 * Two inboxes can stamp one message a second or two apart (the connector's `date` equalled Gmail's
 * `internalDate` in the 2026-11-25 probe; the pair most likely to differ is the sender's Sent copy and a
 * teammate's received copy). A message sent within this many seconds of a minute boundary also matches the
 * neighbouring minute's key. A miss makes a repeat, never a loss.
 */
export const EMAIL_KEY_SLOP_SECONDS = 5;

// ─── The code line (decisions 8 and 9) ───────────────────────────────────────────────────────────
/** The last line of an email started from a project. Ian chose the wording (2026-11-25). */
export const emailCodeLine = (ref: string): string => `Ref: [${ref}]`;

/**
 * "Write an email" (decision 8): Gmail's own compose window, the message text ending with the code line.
 * The Projects app opens it in a small window beside the project (2026-11-25: Gmail can't be shown inside
 * another page), and in a new tab when the click asks for one. `ownerEmail` is this Mac's identity email (the
 * same `authuser` rule as `gmailThreadUrl`); null leaves Gmail on its default account. `ref` must already be
 * a valid project code. `to` is one address in the strict shape of `BusinessContact.email` (the picker on the
 * project's Overview); left out, Gmail's "To" is empty. Probed 2026-11-25: `view=cm&fs=1&body=` fills the
 * text; an account with a Gmail signature was not available to test.
 */
export const gmailComposeUrl = (ownerEmail: string | null, ref: string, to?: string): string =>
  `https://mail.google.com/mail/?${ownerEmail ? `authuser=${encodeURIComponent(ownerEmail)}&` : ''}view=cm&fs=1${to ? `&to=${encodeURIComponent(to)}` : ''}&body=${encodeURIComponent(`\n\n${emailCodeLine(ref)}`)}`;

// ─── Script input ────────────────────────────────────────────────────────────────────────────────
/** One message of a thread as the connector lists it. `subject` only when it differs from the draft's. */
export interface EmailThreadMessage {
  /** The sender's address. Used for the key only; never stored. */
  from: string;
  /** ISO time, the connector's `date`. */
  sentAt: string;
  subject?: string;
}

/**
 * Added to `EmailDraftInput` (both optional).
 * `thread`: every message of the thread as this inbox has it, newest first, the drafted email included, at
 * most EMAIL_THREAD_MESSAGES_MAX. Refused (`bad-request`) when over the limit, when an address or time is
 * bad, or when none of its messages has the drafted email's own key (overseer S4: the list and the email
 * must be the same conversation). The over-size refusal says "send fewer thread messages". Also refused: a
 * message dated more than five minutes after this Mac's clock (security review: an email not yet sent can't
 * be claimed ahead of time).
 * With `thread`, the draft's `email_key` is always the derived `x:` key, even when `messageId` is given
 * (correctness review: every inbox can derive it); the Message-ID then joins `thread_message_ids`.
 * `threadCodes`: project codes Claude saw in earlier messages' own text (never a signature), at most
 * EMAIL_THREAD_CODES_MAX; the script keeps only valid code shapes.
 */
export interface EmailDraftThreadInput {
  thread?: EmailThreadMessage[];
  threadCodes?: string[];
}

/**
 * stdin `{"action":"email-check", ...EmailCheckInput}`: read-only, writes nothing, needs no drafts folder.
 * Refused like `email-draft` for an inbox that isn't this Mac's identity (`not-allowed`) or bad fields
 * (`bad-request`).
 */
export interface EmailCheckInput {
  inboxAddress: string;
  /** This inbox's Gmail thread id. */
  threadId: string;
  /** The newest message's subject. */
  subject: string;
  thread: EmailThreadMessage[];
}

/**
 * The reply. Claude summarises only the messages in `fresh` (named by index and by sent time, so a miscount
 * shows; overseer S4); when `fresh` is empty it makes no draft.
 */
export interface EmailCheckReply {
  ok: true;
  action: 'email-check';
  /** Indexes into `thread` of messages some project already holds. */
  covered: number[];
  /** The messages no project holds: index into `thread` and that message's `sentAt` as given. */
  fresh: { index: number; sentAt: string }[];
  /** The one project holding the covered ones; null when none, or when they sit in more than one project. */
  project: ProjectKey | null;
}

// ─── The draft file (added, all optional) ────────────────────────────────────────────────────────
/**
 * Added to `EmailDraftFile`; `v` stays 1 and `parseDraft` treats a missing field as empty.
 * Keys are `x:` hashes as `EmailKey` (never an address).
 */
export interface EmailDraftThreadFields {
  /** The exact-minute key of every thread message, newest first, the draft's own `email_key` left out. */
  thread_keys?: string[];
  /**
   * Exact key → its neighbour-minute key, for the drafted email (`email_key`) and each thread message sent
   * within EMAIL_KEY_SLOP_SECONDS of a minute boundary (a message has at most one). Matching only: message
   * `k` is held when `k` or `near_keys[k]` is held. A near key equal to another listed message's own key is
   * never written (correctness review): that would be a different message, a quick follow-up from the same
   * sender, and taking it for a copy would lose it.
   */
  near_keys?: Record<string, string>;
  /** Valid codes from quoted lines of the newest text and from `threadCodes`, minus those in subject or body. */
  codes_thread?: string[];
  /**
   * The drafted email's Message-ID (`<...>`), only when one was given with a `thread` (its `email_key` is then
   * the derived key). The email is also held when an entry holds this (second review, 2026-11-25).
   */
  message_id?: string;
  /** How many of the thread's distinct keys (the drafted email included) no project held when the draft was made (at least 1). */
  fresh_at_draft?: number;
}

// ─── The entry on disk (added; overseer B1) ──────────────────────────────────────────────────────
/**
 * An `email` entry gains two optional frontmatter keys, both written by the script at approval:
 *
 * - `email_thread_keys:` a YAML list of exact-minute keys: the draft's `thread_keys` that NO entry holds at
 *   that moment, i.e. the other messages this entry's summary covers. Left out when empty.
 * - `email_thread_link:` one key that some entry already holds (the newest such key among the draft's
 *   `thread_keys`, matched exactly or by near key and written as the held entry has it). It joins this
 *   entry to the conversation and claims nothing. Left out when the thread is new to every project.
 *
 * HELD (de-duplication, `exists`, `email-check`): a message is held when its key, or for the side asking a
 * near key, equals any entry's `email_key` or is in any entry's `email_thread_keys`. `email_thread_link` is
 * never read for this, so removing an entry frees exactly the messages it summarised.
 *
 * JOIN (one row per conversation): two entries of one project are one conversation when they share any of
 * `email_key`, `email_thread_keys` or `email_thread_link`, or have the same `email_inbox_owner` and
 * `email_thread_id`. Transitive.
 *
 * One scan per run (overseer S1): the script builds the map of held keys once per command, never per key.
 */

// ─── Routing (added to shared/project-email-contract.ts by the lead) ─────────────────────────────
// `EmailRouteWhy` gains 'thread-code': after 'body-code', before 'domain'. The code is in an earlier
// message or in quoted text. The app's words: "A project code earlier in this thread."
// `EmailRoute` gains `overruled?: string`: set when the route is 'thread' or 'message' and a code in the
// newest message's subject or text names a different live project (the sheet says so).

// ─── What the app shows ──────────────────────────────────────────────────────────────────────────
/**
 * `EmailDraftItem.thread` (added by the lead to shared/project-email-contract.ts). Absent for a draft made
 * without a thread list. A draft whose own email is held is not listed at all (hidden, never deleted:
 * overseer S2; it shows again if that entry is removed, and expires at DRAFT_MAX_AGE_DAYS as before).
 */
export interface EmailDraftThread {
  /** Messages in the thread as this inbox has it. */
  total: number;
  /**
   * How many no project holds now (at least 1). The sheet says above Save how much of the thread the summary
   * covers ("all 3 messages" or "2 of the 4 messages"); nothing for a thread of one email.
   */
  fresh: number;
  /** A project already holds earlier messages of this thread: where, who saved the latest part, and when. */
  partOf?: { key: ProjectKey; byName: string | null; at: string };
  /** Fewer messages are new now than when the draft was made: the summary may repeat a teammate's. */
  overlap?: boolean;
}

/**
 * `ProjectUpdateItem.emailThread?: string` (added by the lead to shared/project-updates-contract.ts): the
 * same value on every `email` entry of one conversation in this project (the file name of its earliest
 * entry); absent on an entry that stands alone.
 *
 * Order and paging (overseer S3): before paging, the server places all parts of a conversation together at
 * the position of its newest-saved part, ordered inside by `email_sent_at`, newest first. A conversation is
 * never split across pages.
 *
 * The row (overseer ruling c): one Gmail line for the row (the viewer's own thread when they saved a part,
 * else "In <name>'s inbox"); each part keeps its saver, date, Client can see this mark and Remove. Never a
 * row-level client mark.
 */
