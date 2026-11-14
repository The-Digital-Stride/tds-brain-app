import type { SessionState } from '../../../shared/contract.ts';

/** `/clear` on its own, in any case, means "start afresh". It is handled here and never sent to Claude. */
export function isClearCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/clear';
}

/** Closing a chat that is starting, working or waiting asks first; an idle one closes at once. */
export function needsCloseConfirm(state: SessionState): boolean {
  return state === 'starting' || state === 'working' || state === 'waiting';
}

/** `helpersWorking` names the helpers that closing would also stop (an older page passes none). */
export function closeConfirmText(state: SessionState, helpersWorking = 0): string {
  if (helpersWorking > 0 && needsCloseConfirm(state)) {
    const helpers = `${helpersWorking} ${helpersWorking === 1 ? 'helper' : 'helpers'}`;
    const lead = state === 'waiting' ? 'Claude is waiting for your answer and' : 'Claude and';
    // "Claude and 1 helper are", but "… and 1 helper is" when Claude is waiting.
    const verb = state === 'waiting' && helpersWorking === 1 ? 'is' : 'are';
    return `${lead} ${helpers} ${verb} still working. Closing stops them all. Close anyway?`;
  }
  if (state === 'waiting') return 'Claude is waiting for your answer. Close anyway?';
  if (needsCloseConfirm(state)) return 'Claude is still working. Close anyway?';
  return 'Close this chat?';
}
