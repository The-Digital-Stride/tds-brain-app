/**
 * My day (plan decision 32): a chat's own title, shown to the person as a hint beside an entry. Pure.
 *
 * View only: the hint is joined into `DayEntryView.titleHint` when the day is shown. It is never stored in
 * the draft or anywhere under `<dataDir>/time/`, never logged and never sent to Toolbox, unless the person
 * uses it as the description (then it is an ordinary description edit).
 *
 * Only a real title counts: a custom title, or Claude Code's summary when it isn't just the first prompt
 * (equal to it, or either one a prefix of the other). A chat titled by its first prompt gives no hint.
 */

/** What Claude Code's `listSessions` knows about a chat's title (server/engine/session-manager.ts `PastInfo`). */
export interface ChatTitleSource {
  customTitle?: string | undefined;
  summary?: string | undefined;
  firstPrompt?: string | undefined;
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

/** For comparing a summary with the first prompt: one line, no controls, no trailing ellipsis, lower case. */
function comparable(text: string): string {
  return oneLine(text)
    .replace(/(…|\.\.\.)$/, '')
    .trimEnd()
    .toLowerCase();
}

/** The hint for a chat, or null when it has no real title. */
export function titleHint(source: ChatTitleSource | undefined): string | null {
  if (!source) return null;
  const custom = source.customTitle ? cleanTitle(source.customTitle) : '';
  if (custom) return custom;
  const summary = source.summary ? comparable(source.summary) : '';
  // Without the first prompt there is no telling a summary from it, so no hint.
  const prompt = source.firstPrompt ? comparable(source.firstPrompt) : '';
  if (!summary || !prompt) return null;
  if (summary.startsWith(prompt) || prompt.startsWith(summary)) return null;
  return cleanTitle(source.summary ?? '') || null;
}
