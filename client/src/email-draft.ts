/**
 * Finds the emails Claude drafted in a reply (contract: `shared/chat-email-draft-contract.ts`).
 * The markdown lexer does the finding, so "top level" and "fenced" mean what they mean when the reply is
 * drawn: a block inside a list, a quote or a longer fence is never an email.
 */
import { Marked, type Token, type Tokens } from 'marked';
import { parseChatEmail } from '../../shared/chat-email-draft.ts';
import { CHAT_EMAIL_LANG, type ReplyPiece } from '../../shared/chat-email-draft-contract.ts';

// A line that could open an email block. Most replies have none, and then the lexer is never run.
const MAY_OPEN = /(?:^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*email[ \t]*(?:\r?\n|\r|$)/i;
const OPENING = /^ {0,3}(`{3,}|~{3,})/;
const lexer = new Marked();

/** True when the block's own closing fence has arrived: the same mark as the opening, at least as long. */
function isClosed(raw: string): boolean {
  const opening = OPENING.exec(raw);
  if (!opening) return false;
  const fence = opening[1] ?? '';
  const lines = raw.trimEnd().split('\n');
  if (lines.length < 2) return false;
  const last = (lines.at(-1) ?? '').trim();
  return last.length >= fence.length && last === (fence[0] ?? '').repeat(last.length);
}

const isEmail = (t: Token): t is Tokens.Code =>
  t.type === 'code' &&
  t.codeBlockStyle !== 'indented' &&
  typeof t.lang === 'string' &&
  t.lang.trim().toLowerCase() === CHAT_EMAIL_LANG;

export function splitReply(text: string): ReplyPiece[] {
  const whole: ReplyPiece[] = [{ kind: 'text', text }];
  if (!MAY_OPEN.test(text)) return whole;
  const tokens = lexer.lexer(text, { gfm: true });
  if (!tokens.some(isEmail)) return whole;
  const pieces: ReplyPiece[] = [];
  let run = '';
  const flush = () => {
    if (run.trim() !== '') pieces.push({ kind: 'text', text: run });
    run = '';
  };
  for (const t of tokens) {
    if (!isEmail(t)) {
      run += t.raw;
      continue;
    }
    flush();
    pieces.push({ kind: 'email', email: parseChatEmail(t.text), closed: isClosed(t.raw) });
  }
  flush();
  return pieces;
}

/** Whether a reply holds an email: such a reply is never folded away with the steps. */
export const holdsEmail = (text: string): boolean => splitReply(text).some((p) => p.kind === 'email');
