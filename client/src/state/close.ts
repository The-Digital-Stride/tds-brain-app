import type { SessionState } from '../../../shared/contract.ts';

/** `/clear` on its own, in any case, means "start afresh". It is handled here and never sent to Claude. */
export function isClearCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/clear';
}

/** Ending a chat that is starting, working or waiting asks first; an idle one ends at once. */
export function needsCloseConfirm(state: SessionState): boolean {
  return state === 'starting' || state === 'working' || state === 'waiting';
}

/**
 * The question in the End chat confirm. `helpersWorking` names the helpers that ending would also stop (an
 * older page passes none). "End", not "Close": ending a chat stops its session (design-system.md, Words).
 */
export function closeConfirmText(state: SessionState, helpersWorking = 0): string {
  if (helpersWorking > 0 && needsCloseConfirm(state)) {
    const helpers = `${helpersWorking} ${helpersWorking === 1 ? 'helper' : 'helpers'}`;
    const lead = state === 'waiting' ? 'Claude is waiting for your answer and' : 'Claude and';
    // "Claude and 1 helper are", but "… and 1 helper is" when Claude is waiting.
    const verb = state === 'waiting' && helpersWorking === 1 ? 'is' : 'are';
    return `End this chat? ${lead} ${helpers} ${verb} still working. Ending stops them all.`;
  }
  if (state === 'waiting') return 'End this chat? Claude is waiting for your answer.';
  if (needsCloseConfirm(state)) return 'End this chat? Claude is still working on a reply.';
  return 'End this chat?';
}
