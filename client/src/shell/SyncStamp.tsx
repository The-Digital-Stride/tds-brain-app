import { type ReactNode, useEffect, useRef, useState } from 'react';
import { SYNC_POLL_MS } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { syncWords } from './words.ts';

/** How often the stamp checks the clock, so it turns red on time between polls. */
const TICK_MS = 15_000;

/**
 * The foot of the rail: when the brain last synced with GitHub, in red once it is over five minutes
 * old. Asks the server every SYNC_POLL_MS. If the server can't be reached it keeps the last time it
 * had, so the stamp still turns red. Shows nothing until the first answer.
 */
export function SyncStamp({ wide }: { wide: boolean }) {
  // undefined: not heard yet. null: no good sync seen (never synced, or failing since the app started).
  const [lastSync, setLastSync] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  // Said once to screen readers when it goes stale or recovers; never on every poll.
  const [announce, setAnnounce] = useState('');
  const wasStale = useRef<boolean | null>(null);

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
          // Keep the last time we had; the clock tick turns it red if this goes on.
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

  const w = lastSync === undefined ? null : syncWords(lastSync, now);
  const stale = w?.stale ?? null;
  const spoken = w?.spoken ?? '';
  useEffect(() => {
    if (stale === null) return;
    if (wasStale.current === false && stale) setAnnounce(spoken);
    if (wasStale.current === true && !stale) setAnnounce('The brain is syncing again.');
    wasStale.current = stale;
  }, [stale, spoken]);

  // The status region is always there, so a change to it is announced.
  const status = (
    <span className="visually-hidden" role="status">
      {announce}
    </span>
  );
  if (!w) return status;
  // Wide: one line, and if it must wrap, the time and date stay together. Icons only: time over date.
  let shown: ReactNode = w.time ? (
    <span>
      {w.lead}{' '}
      <span className="rail-sync-when">
        {w.time}, {w.date}
      </span>
    </span>
  ) : (
    w.line
  );
  if (!wide) {
    shown = w.time ? (
      <>
        <span>{w.time}</span>
        <span>{w.date}</span>
      </>
    ) : (
      'No sync'
    );
  }

  return (
    <p className="rail-sync" data-stale={w.stale} data-wide={wide} data-tip={wide ? undefined : w.line}>
      <span className="rail-sync-shown" aria-hidden="true">
        {/* Green while syncing as normal, red once it is over five minutes. Always beside words. */}
        <span className="dot rail-sync-dot" />
        {shown}
      </span>
      <span className="visually-hidden">{w.spoken}</span>
      {status}
    </p>
  );
}
