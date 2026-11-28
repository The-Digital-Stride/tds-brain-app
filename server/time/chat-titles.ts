/**
 * My day (plan decision 32): a chat's own title, shown to the person as a hint beside an entry. Pure.
 *
 * View only: the hint is joined into `DayEntryView.titleHint` when the day is shown. It is never stored in
 * the draft or anywhere under `<dataDir>/time/`, never logged and never sent to Toolbox, unless the person
 * uses it as the description (then it is an ordinary description edit).
 *
 * Only a real title counts: the custom or AI title. The Claude Agent SDK's `listSessions` puts the AI title in
 * `customTitle` (custom, then AI), and builds `summary` as customTitle, aiTitle, lastPrompt, summary,
 * firstPrompt: with no title, `summary` is the person's own prompt text. So `summary` and `firstPrompt` are
 * never read, and a chat with no custom or AI title gives no hint. Prompt text is never shown.
 */

/** What a chat's title hint is made from: `listSessions`' `customTitle` (server/engine/session-manager.ts `PastInfo`). */
export interface ChatTitleSource {
  customTitle?: string | undefined;
}

/** Chats Cortex still lists, by sdkSessionId (= the transcript's file name). */
export type ChatTitles = ReadonlyMap<string, ChatTitleSource>;

export const TITLE_HINT_CHARS = 80;

// C0 and C1 controls, and the bidi embedding, override and isolate marks (they could reorder what's shown).
function isControl(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Every control character as a space, then one line with single spaces. */
function oneLine(text: string): string {
  let out = '';
  for (const ch of text) out += isControl(ch.codePointAt(0) ?? 0) ? ' ' : ch;
  return out.replace(/\s+/g, ' ').trim();
}

/** One line, controls stripped, at most TITLE_HINT_CHARS characters with an ellipsis when cut. */
export function cleanTitle(text: string): string {
  const flat = oneLine(text);
  const chars = Array.from(flat);
  if (chars.length <= TITLE_HINT_CHARS) return flat;
  return `${chars
    .slice(0, TITLE_HINT_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

/** The hint for a chat: its custom or AI title, or null when it has none. */
export function titleHint(source: ChatTitleSource | undefined): string | null {
  return source?.customTitle ? cleanTitle(source.customTitle) || null : null;
}

/**
 * Whether a project's title hints are offered with no one-click use (decision 32.4). Fails closed: no card
 * (or no projects index to find it in) counts as restricted.
 */
export function cardRestricted(card: { visibility?: string | undefined } | null | undefined): boolean {
  return card ? card.visibility === 'restricted' : true;
}
