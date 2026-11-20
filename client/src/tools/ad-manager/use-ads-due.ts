import { useEffect, useRef } from 'react';
import { useStore } from '../../store.tsx';
import { dueCount } from './logic.ts';
import { adStore, loadBoard, selectAccount, useAd } from './store.ts';
import { runKey, useTaskRuns } from './task-runs.ts';
import { readStandup } from './types.ts';

/**
 * The Workbench drawer's "N due" note on Ads Command Centre (plan 2026-11-20-ads-release-3, decision 1). Mounted once
 * in the shell, so the note is there before any Ads tool opens:
 * - At start-up, when Ads is available, it picks the account the tools would (the one used last, else the first with
 *   proposals waiting) and loads its board. An Ads tool opened later keeps that account and reloads its board, as it
 *   always has. With nothing saved and nothing waiting, there is no note until a tool opens.
 * - When the Ads summary changes (the `ads-changed` event: a decision, a teammate's run), it reloads that board, so
 *   the note stays right with no tool open.
 * - Whenever the shown account's board arrives, or a run is recorded here, it counts the due and overdue tasks.
 * - A new account has no count until its board arrives (null hides the note).
 * This is the only place that sets `adsDue`; `useAdsAccount` no longer does.
 */
export function useAdsDue(): void {
  const { ads, boot, setAdsDue } = useStore();
  const s = useAd();
  const runs = useTaskRuns();
  const visible = ads?.visible === true;
  const saved = boot?.prefs.adsAccount ?? null;
  const firstWaiting = ads?.clients.find((c) => c.waiting > 0)?.slug ?? null;
  const start = saved ?? firstWaiting;

  useEffect(() => {
    if (!visible || !start || adStore.get().account) return;
    selectAccount(start);
    void loadBoard(start);
  }, [visible, start]);

  // A later change to the Ads summary: reload the shown account's board (skipping the first summary, loaded above).
  const seenAds = useRef(ads);
  useEffect(() => {
    if (seenAds.current === ads) return;
    const first = seenAds.current === null || seenAds.current === undefined;
    seenAds.current = ads;
    const account = adStore.get().account;
    if (!first && visible && account) void loadBoard(account);
  }, [ads, visible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `setAdsDue` is stable
  useEffect(() => {
    setAdsDue(null);
  }, [s.account]);

  const board = s.boardFor === s.account ? s.board : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setAdsDue` is stable
  useEffect(() => {
    if (!board || !Array.isArray(board.cards)) return;
    const standup = readStandup(board);
    setAdsDue(
      dueCount(
        board.cards,
        new Date(),
        (c) => runs[runKey(board.key, c.id)]?.at,
        // The Daily standup card shows a daily badge once it is set up, so it counts too.
        standup.hasStandup && standup.prompt
          ? {
              // A verdict on file with no run record (run outside the app) still counts as the last run.
              sharedAt: standup.lastRun?.at ?? standup.verdict?.date,
              localAt: runs[runKey(board.key, 'standup:daily')]?.at,
            }
          : null,
      ),
    );
  }, [board, runs]);
}
