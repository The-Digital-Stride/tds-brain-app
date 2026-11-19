import { lazy } from 'react';
import type { ToolSlot } from '../../shell/sections-contract.ts';
import { ADS_GROUP } from './ads-tools-contract.ts';
import { commandSearch } from './command-search.ts';

/**
 * Ads Command Centre: running the account, with the original brain board's layout (plan
 * 2026-11-19-ads-workbench-sections, decisions 3 and 6). The rail count stays "proposals waiting", so `badge` is 0:
 * the due tasks show as text on the drawer row (`rowNote`) instead. Rate calls opens in its side panel (decision 6a).
 */
const ui = () => import('./ui.ts');

export const adsCommandTool: ToolSlot = {
  id: 'ads-command-centre',
  title: 'Ads Command Centre',
  icon: 'play',
  summary:
    'Your Google Ads operating rhythm: account data, the daily standup and every task from daily to quarterly',
  group: ADS_GROUP,
  Sheet: lazy(() => ui().then((m) => ({ default: m.CommandSheet }))),
  BarActions: lazy(() => ui().then((m) => ({ default: m.AdManagerBar }))),
  Panel: lazy(() => ui().then((m) => ({ default: m.RateCalls }))),
  panelLabel: 'Rate calls',
  search: commandSearch,
  visible: (snap) => snap.ads?.visible === true,
  badge: () => 0,
  rowNote: (snap) => (snap.adsDue && snap.adsDue > 0 ? `${snap.adsDue} due` : null),
};
