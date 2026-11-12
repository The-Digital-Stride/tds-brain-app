import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLastSync } from './useLastSync.ts';
import { syncWords } from './words.ts';

/**
 * The foot of the rail: when the brain last synced with GitHub, in red once it is over five minutes
 * old. Asks the server every SYNC_POLL_MS. If the server can't be reached it keeps the last time it
 * had, so the stamp still turns red. Shows nothing until the first answer.
 */
export function SyncStamp({ wide }: { wide: boolean }) {
  // undefined: not heard yet. null: no good sync seen (never synced, or failing since the app started).
  const { lastSync, now } = useLastSync();
  // Said once to screen readers when it goes stale or recovers; never on every poll.
  const [announce, setAnnounce] = useState('');
  const wasStale = useRef<boolean | null>(null);

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
