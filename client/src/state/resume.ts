const KEY = 'tds-brain-open-chat';

/** Returns the remembered chat id only if that chat is still open. */
export function chooseInitialChat(saved: string | null, liveIds: string[]): string | null {
  return saved !== null && liveIds.includes(saved) ? saved : null;
}

export function readSavedChat(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveChat(id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, id);
  } catch {
    // Storage can be blocked; the app works without it.
  }
}
