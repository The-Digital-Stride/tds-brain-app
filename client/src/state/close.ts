import type { SessionState } from '../../../shared/contract.ts';

/** `/clear` on its own, in any case, means "start afresh". It is handled here and never sent to Claude. */
export function isClearCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/clear';
}

/** Closing a chat that is starting, working or waiting asks first; an idle one closes at once. */
export function needsCloseConfirm(state: SessionState): boolean {
  return state === 'starting' || state === 'working' || state === 'waiting';
}

export function closeConfirmText(state: SessionState): string {
  if (state === 'waiting') return 'Claude is waiting for your answer. Close anyway?';
  if (needsCloseConfirm(state)) return 'Claude is still working. Close anyway?';
  return 'Close this chat?';
}
