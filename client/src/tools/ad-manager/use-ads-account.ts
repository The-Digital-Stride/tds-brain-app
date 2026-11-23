import { useEffect } from 'react';
import { useStore } from '../../store.tsx';
import { loadApprovals, loadBoard, selectAccount, useAd, waitingFor } from './store.ts';

/**
 * The account every Ads sheet shows (plan 2026-11-19-ads-workbench-sections, decision 3), moved out of
 * `AdManagerSheet`: the caller's account (`toolArg`), else the one used last, else the first with something waiting;
 * then that account's board. Also loads the account list and approvals (on arrival, on the `ads-changed` summary
 * and on Refresh), since a tool opened directly has nothing else to load them.
 */
export function useAdsAccount(): { account: string | null; loading: boolean } {
  const { ads, boot, toolArg, clearToolArg, updatePrefs } = useStore();
  const s = useAd();

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ads` and `refresh` are the triggers
  useEffect(() => {
    if (s.account) void loadBoard(s.account);
  }, [s.account, ads, s.refresh]);

  return { account: s.account, loading: s.loading || (s.account !== null && s.boardFor !== s.account) };
}
