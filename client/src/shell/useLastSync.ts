import { useEffect, useState } from 'react';
import { SYNC_POLL_MS } from '../../../shared/contract.ts';
import { api } from '../api.ts';

/** How often the clock is checked, so a sync goes stale on time between polls. */
const TICK_MS = 15_000;

/**
 * When the brain last synced, asked of the server every SYNC_POLL_MS, plus a clock that ticks so
 * callers can tell when it goes stale. `lastSync` is undefined until the first answer and null when
 * no good sync was seen. If the server can't be reached, the last answer is kept, so it still goes
 * stale. Used by the rail's stamp and the Settings health panel.
 */
export function useLastSync(): { lastSync: string | null | undefined; now: number } {
  const [lastSync, setLastSync] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stopped = false;
    const load = () => {
      api.sync().then(
        (s) => {
          if (stopped) return;
          setLastSync(s.lastSync);
          setNow(Date.now());
        },
        () => {
          // Keep the last time we had; the clock tick turns it stale if this goes on.
        },
      );
    };
    load();
    const poll = setInterval(load, SYNC_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    // A tab in the background may have had its timers slowed: catch up as soon as it is seen.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { lastSync, now };
}
