/**
 * The daily clean-up of deleted library files (plan 2026-11-15-delete-library-files, decision 3):
 * once at start-up, then every 24 hours, in the app's own process. It never overlaps itself, never
 * keeps the process alive and never throws. Not started in setup mode.
 */
export const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

export interface PurgeTimerOptions {
  /** The brain's `purgeDeletedFiles`; undefined means there is nothing to run (and nothing starts). */
  purge: (() => Promise<number>) | undefined;
  /** False in setup mode: no brain, so nothing runs. */
  enabled: boolean;
  log: (line: string) => void;
  intervalMs?: number;
}

export interface PurgeTimer {
  /** Runs one purge now unless one is still running. Resolves when it has finished. */
  tick(): Promise<void>;
  stop(): void;
}

export function startPurgeTimer(options: PurgeTimerOptions): PurgeTimer {
  const { purge, enabled, log } = options;
  if (!enabled || !purge) return { tick: async () => {}, stop: () => {} };
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const erased = await purge();
      if (erased > 0)
        log(`Erased ${erased} deleted library file${erased === 1 ? '' : 's'} held for 30 days.`);
    } catch {
      log('Could not tidy the deleted library files.');
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? PURGE_EVERY_MS);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
