/**
 * Emails Claude drafts in a project chat, opened in the small Gmail window
 * (plan docs/plans/2026-11-25-chat-email-to-gmail.md).
 *
 * CONTRACT FILE: types, limits and signatures. Bodies live in `shared/chat-email-draft.ts`.
 *
 * In a project chat Claude writes an email it drafts as a fenced block whose info word is `email`:
 *
 *     ```email
 *     To: jo@acme.co.uk
 *     Cc: Kim Example <kim@acme.co.uk>
 *     Subject: Boiler quote
 *
 *     Hi Jo,
 *     …
 *     Ref: [ACM4K7]
 *     ```
 *
 * The chat shows that block as a card with "Open in Gmail", which opens Gmail's own compose window with the
 * fields filled in. Nothing is written to anyone's Gmail account: the person sends it, or closes the window.
 * An older app shows the block as an ordinary code block, and so does a terminal.
 */

/** The info word of the fenced block, lower case. Matched without regard to case. */
export const CHAT_EMAIL_LANG = 'email';

/** At most this many addresses over To, Cc and Bcc together; the rest are left out (`over` counts them). */
export const CHAT_EMAIL_RECIPIENTS_MAX = 20;
/** A subject longer than this is cut. */
export const CHAT_EMAIL_SUBJECT_MAX = 250;
/**
 * The longest compose link Gmail is given. Probed 2026-11-25 with made-up text, signed out: Google caps the
 * path and query at 8,192 characters (8,200 in all answered, 8,215 refused with a 400), and its sign-in
 * redirect took a 7,981 link. An email whose link would be longer opens with its recipients and subject
 * only (`chatEmailLink().fits === false`), and the card says to copy the text in.
 */
export const GMAIL_COMPOSE_URL_MAX = 7500;

/** An email Claude wrote in a chat. (Not an `EmailDraftInput`: that is a received email waiting to be filed.) */
export interface ChatEmail {
  /** Addresses only, in the order written, each in the strict shape of `BusinessContact.email`, no repeats. */
  to: string[];
  cc: string[];
  bcc: string[];
  /** One line, trimmed, control and text-direction characters removed; '' when the block has none. */
  subject: string;
  /** The message text exactly as written after the header lines: plain text, line ends as `\n`, trimmed of
   *  blank lines at both ends. Never rendered as markdown. */
  body: string;
  /** How many header entries were left out because they are not an address. A repeat is dropped silently. */
  dropped: number;
  /** How many good addresses were left out because the email already had CHAT_EMAIL_RECIPIENTS_MAX. */
  over: number;
}

/**
 * Reads the inside of an `email` block (the text between the fences).
 * - Header lines come first, one per line: `To:`, `Cc:`, `Bcc:`, `Subject:` (any case; each at most once,
 *   a repeat of To/Cc/Bcc adds to the list, a second Subject is ignored). They end at the first blank line
 *   or the first line that is not one of those headers; everything after is the body. A block with no
 *   header lines is all body.
 * - Addresses are split on commas and semicolons. `Name <a@b.co>` gives `a@b.co` (the name is never kept or
 *   shown); a bare address is taken as written. Anything else is dropped and counted. An address is never
 *   invented or repaired. The same address twice, in any of the three lists and any case, is kept once.
 * - Never throws. Cost is linear in the text.
 * Body in `shared/chat-email-draft.ts`: `parseChatEmail`.
 */
export type ParseChatEmail = (block: string) => ChatEmail;

export interface ChatEmailLink {
  /** Always starts `https://mail.google.com/mail/?` and is at most GMAIL_COMPOSE_URL_MAX long. */
  url: string;
  /** False when the body was left out of the link because it would be too long. */
  fits: boolean;
}

/**
 * Gmail's compose link for a draft: `view=cm&fs=1`, then `to`, `cc`, `bcc` (comma-joined), `su`, `body`,
 * each only when non-empty and every value through `encodeURIComponent`. `ownerEmail` is this Mac's
 * identity email (`authuser`, the same rule as `gmailComposeUrl`); null leaves Gmail on its default
 * account. When the whole link would pass GMAIL_COMPOSE_URL_MAX the body is left out and `fits` is false;
 * when it still would (a huge subject or list), the subject is left out too. Never throws (a broken
 * character pair in the text is replaced before encoding).
 * Body in `shared/chat-email-draft.ts`: `chatEmailLink`.
 */
export type ChatEmailLinkFor = (ownerEmail: string | null, email: ChatEmail) => ChatEmailLink;

/** One piece of a reply: markdown text, or an email block (top level only). */
export type ReplyPiece =
  | { kind: 'text'; text: string }
  | {
      kind: 'email';
      email: ChatEmail;
      /** False while the reply is still arriving and the block's closing fence has not come yet. */
      closed: boolean;
    };

/**
 * Splits a reply into pieces, in order (client only: it uses the markdown lexer, `client/src/email-draft.ts`).
 * Only a fenced block at the top level of the reply counts: one inside a list, a quote or a longer fence
 * stays ordinary markdown. A reply with no such block gives one text piece equal to the whole reply, so
 * replies without emails render exactly as before (and the markdown lexer is not run at all unless the text
 * has a line that could open such a block). Only Claude's own replies are split: a helper's report and brain
 * files shown as markdown never get a card.
 */
export type SplitReply = (text: string) => ReplyPiece[];
