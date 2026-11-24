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

/**
 * The chat whose "Save to project" form is open on a project's Updates tab (its SDK session id), or null. Set by
 * the project page while the form shows and cleared when it closes; the chat drawer's header hides its own Save to
 * project for that chat, so the button isn't offered beside the form it already opened.
 */
let savingChatId: string | null = null;
const savingListeners = new Set<() => void>();

export const savingChat = {
  get: (): string | null => savingChatId,
  set(chat: string | null): void {
    if (chat === savingChatId) return;
    savingChatId = chat;
    for (const l of [...savingListeners]) l();
  },
  subscribe(listener: () => void): () => void {
    savingListeners.add(listener);
    return () => {
      savingListeners.delete(listener);
    };
  },
};
