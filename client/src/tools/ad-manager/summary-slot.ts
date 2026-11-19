import { lazy } from 'react';
import type { ToolSlot } from '../../shell/sections-contract.ts';
import { ADS_GROUP } from './ads-tools-contract.ts';
import { summarySearch } from './summary-search.ts';

/** Ads Account Summary: the deep-dive tables on their own page (plan 2026-11-19-ads-workbench-sections, decision 8). No count. */
const ui = () => import('./ui.ts');

export const adsSummaryTool: ToolSlot = {
  id: 'ads-account-summary',
  title: 'Ads Account Summary',
  icon: 'chart',
  summary: 'Top campaigns, search terms, wasted spend, keywords, products and Quality Score',
  group: ADS_GROUP,
  Sheet: lazy(() => ui().then((m) => ({ default: m.SummarySheet }))),
  BarActions: lazy(() => ui().then((m) => ({ default: m.AdManagerBar }))),
  search: summarySearch,
  visible: (snap) => snap.ads?.visible === true,
};
