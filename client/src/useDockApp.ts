import { useCallback, useSyncExternalStore } from 'react';
import { getInstallState, promptInstall, subscribeInstallPrompt } from './installPrompt.ts';

export type DockState = 'installed' | 'added' | 'dismissed' | 'can-install' | 'manual';

const isStandalone = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;

/** Where the Dock app stands: running as it, just added, turned down, installable in one click, or by hand. */
export function useDockApp(): { state: DockState; install: () => Promise<void> } {
  const s = useSyncExternalStore(subscribeInstallPrompt, getInstallState);
  const install = useCallback(() => promptInstall(), []);
  let state: DockState = 'manual';
  if (isStandalone()) state = 'installed';
  else if (s.result === 'added') state = 'added';
  else if (s.result === 'dismissed') state = 'dismissed';
  else if (s.canPrompt) state = 'can-install';
  return { state, install };
}
