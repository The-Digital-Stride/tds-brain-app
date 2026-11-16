import { useEffect, useRef } from 'react';

/**
 * Gives focus back to the button that opened an inline `Confirm`. Buttons that open one carry
 * `data-am-opener="<key>"`; pass the open key (or null while shut). When it goes back to null the same button is
 * found again (it was unmounted while the question showed) and focused, else the fallback is.
 */
export function useRestoreFocus(openKey: string | null, fallback?: () => HTMLElement | null) {
  const prev = useRef<string | null>(null);
  const fb = useRef(fallback);
  fb.current = fallback;
  useEffect(() => {
    const was = prev.current;
    prev.current = openKey;
    if (was === null || openKey !== null) return;
    const opener = document.querySelector<HTMLElement>(`[data-am-opener="${was}"]`);
    (opener ?? fb.current?.() ?? null)?.focus();
  }, [openKey]);
}
