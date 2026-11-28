/**
 * The daily Performance refresh (plan decision 6), after `server/purge-timer.ts`: a first check shortly after
 * start-up, then hourly. A check only refreshes when today's hasn't run and the current person may see the page.
 * Never overlaps itself, never keeps the process alive, never throws. Not started in setup or demo mode.
 */
import {
  PERFORMANCE_CHECK_EVERY_MS,
  PERFORMANCE_FIRST_CHECK_AFTER_MS,
} from '../../shared/performance-contract.ts';
import type { PerformanceService } from './refresh.ts';

export interface PerformanceTimerOptions {
  service: PerformanceService | undefined;
  /** False in setup mode and demo mode: nothing starts. */
  enabled: boolean;
  /** Re-checked every tick: is the current person an owner or scout? */
  canRun: () => Promise<boolean>;
  log: (line: string) => void;
  firstCheckAfterMs?: number;
  everyMs?: number;
}

export interface PerformanceTimer {
  /** One check now unless one is still running. Resolves when it has finished. */
  tick(): Promise<void>;
  stop(): void;
}

export function startPerformanceTimer(options: PerformanceTimerOptions): PerformanceTimer {
  const { service, enabled, canRun, log } = options;
  if (!enabled || !service) return { tick: async () => {}, stop: () => {} };
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      if (!(await canRun())) return;
      if (!(await service.dueToday())) return;
      await service.refreshNow();
    } catch {
      log('Could not check the Performance figures.');
    } finally {
      running = false;
    }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), options.everyMs ?? PERFORMANCE_CHECK_EVERY_MS);
    interval.unref();
  }, options.firstCheckAfterMs ?? PERFORMANCE_FIRST_CHECK_AFTER_MS);
  first.unref();
  return {
    tick,
    stop: () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}
