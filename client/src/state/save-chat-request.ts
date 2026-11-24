import type { SaveChatRequest } from '../../../shared/chat-summary-contract.ts';

/**
 * A request to open the "Save to project" form for one chat on a project's Updates tab, made by the chat
 * header's Save to project (plan 2026-11-24-chat-summary-updates, decision 8). Like `projectPageRequest`: the
 * Projects app reads it when it mounts or through `subscribe`, and clears it with `takeSaveChatRequest` once
 * it has acted. null means no request.
 */
let pending: SaveChatRequest | null = null;
const listeners = new Set<() => void>();

export const saveChatRequest = {
  get: (): SaveChatRequest | null => pending,
  /** Asks for the form; null withdraws the request. */
  set(req: SaveChatRequest | null): void {
    if (req === pending) return;
    pending = req;
    for (const l of [...listeners]) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Returns the pending request and clears it, only when it is for `key`; null otherwise (and it stays). */
export function takeSaveChatRequest(key: string): SaveChatRequest | null {
  const req = pending;
  if (!req || req.key !== key) return null;
  saveChatRequest.set(null);
  return req;
}
