import { useEffect } from 'react';
import { useStore } from '../../store.tsx';
import { dueCount } from './logic.ts';
import { loadApprovals, loadBoard, selectAccount, useAd, waitingFor } from './store.ts';
import { runKey, useTaskRuns } from './task-runs.ts';
import { readStandup } from './types.ts';

/**
 * The account every Ads sheet shows (plan 2026-11-19-ads-workbench-sections, decision 3), moved out of
 * `AdManagerSheet`: the caller's account (`toolArg`), else the one used last, else the first with something waiting;
 * then that account's board. Also loads the account list and approvals (on arrival, on the `ads-changed` summary
 * and on Refresh), since a tool opened directly has nothing else to load them. When a board loads it tells the main
 * store how many tasks are due, for the drawer's "N due" note (null while there is no board).
 */
export function useAdsAccount(): { account: string | null; loading: boolean } {
  const { ads, boot, toolArg, clearToolArg, updatePrefs, setAdsDue } = useStore();
  const s = useAd();
  const runs = useTaskRuns();

  // Load on arrival, on the ads summary changing (the `ads-changed` event) and on Refresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ads` and `refresh` are the triggers
  useEffect(() => {
    void loadApprovals();
  }, [ads, s.refresh]);

  // The account: from the caller (Home, search, another Ads tool), else the one used last, else the first waiting.
  const keys = s.accounts?.map((a) => a.key);
  const savedAccount = boot?.prefs.adsAccount ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list or the caller's choice arrives
  useEffect(() => {
    if (!s.accounts || !keys) return;
    if (toolArg) {
      clearToolArg();
      if (keys.includes(toolArg)) {
        selectAccount(toolArg);
        void updatePrefs({ adsAccount: toolArg });
        return;
      }
    }
    if (s.account && keys.includes(s.account)) return;
    const first =
      (savedAccount && keys.includes(savedAccount) ? savedAccount : null) ??
      s.accounts.find((a) => waitingFor(ads, a) > 0)?.key ??
      s.accounts[0]?.key;
    if (first) selectAccount(first);
  }, [s.accounts, toolArg]);

  // A new account has no due count until its board arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setAdsDue` is stable
  useEffect(() => {
    setAdsDue(null);
  }, [s.account]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ads` and `refresh` are the triggers
  useEffect(() => {
    if (s.account) void loadBoard(s.account);
  }, [s.account, ads, s.refresh]);

  // The due count follows the board, and a run started here (this browser's record) counts at once.
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
          ? { sharedAt: standup.lastRun?.at, localAt: runs[runKey(board.key, 'standup:daily')]?.at }
          : null,
      ),
    );
  }, [board, runs]);

  return { account: s.account, loading: s.loading || (s.account !== null && s.boardFor !== s.account) };
}
