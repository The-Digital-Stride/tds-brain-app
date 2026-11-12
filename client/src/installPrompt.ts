// Chrome's install offer arrives once, early. Keep it here so Settings can use it later.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Chrome has offered the install and it can still be shown. */
  canPrompt: boolean;
  /** What happened since: added (the app installed) or dismissed (the person said no). */
  result: 'added' | 'dismissed' | null;
}

let deferred: InstallPromptEvent | null = null;
let state: InstallState = { canPrompt: false, result: null };
const listeners = new Set<() => void>();
const set = (next: Partial<InstallState>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ canPrompt: false, result: 'added' });
  });
}

export function subscribeInstallPrompt(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getInstallState = (): InstallState => state;

export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  set({ canPrompt: false });
  await e.prompt();
  const choice = await e.userChoice;
  if (choice.outcome === 'dismissed') set({ result: 'dismissed' });
}
