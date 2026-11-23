import { useEffect, useRef } from 'react';
import { useStore } from '../../store.tsx';
import { adStore, loadBoard, selectAccount } from './store.ts';

/**
 * Loads the Ads board at start-up, so ⌘K search finds Command Centre tasks and Account Summary tables before any Ads
 * tool opens (`command-search.ts`, `summary-search.ts` read `adStore`). Mounted once in the shell. What is left of the
 * old `useAdsDue` after the "N due" note was removed (2026-11-23: the tasks are optional checks, so nothing is due).
 * - At start-up, when Ads is available, it picks the account the tools would (the one used last, else the first with
 *   proposals waiting) and loads its board. An Ads tool opened later keeps that account and reloads its board.
 *   With nothing saved and nothing waiting, nothing loads until a tool opens.
 * - When the Ads summary changes (the `ads-changed` event: a decision, a teammate's run), it reloads that board, so
 *   search stays right with no tool open.
 */
export function useAdsPreload(): void {
  const { ads, boot } = useStore();
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
}
