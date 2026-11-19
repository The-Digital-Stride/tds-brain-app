import { lazy } from 'react';
import type { ToolSlot } from '../../shell/sections-contract.ts';
import { ADS_GROUP } from './ads-tools-contract.ts';
import { adManagerSearch } from './search.ts';

/**
 * Ads Manager, the Ads group's first tool (plans 2026-11-16-workbench-ad-manager and 2026-11-19-ads-workbench-sections).
 * It keeps the id `ad-manager`, so saved views and search results keep opening. Its code loads only when first
 * opened, together with the other two Ads tools (`ui.ts`); its search source sits outside that chunk (`search.ts`),
 * so the palette never loads the screens.
 */
const ui = () => import('./ui.ts');

export const adManagerTool: ToolSlot = {
  id: 'ad-manager',
  title: 'Ads Manager',
  icon: 'inbox',
  summary: 'Proposals waiting for a decision, recent decisions and the monthly close',
  group: ADS_GROUP,
  Sheet: lazy(() => ui().then((m) => ({ default: m.AdManagerSheet }))),
  BarActions: lazy(() => ui().then((m) => ({ default: m.AdManagerBar }))),
  Panel: lazy(() => ui().then((m) => ({ default: m.ProposalPanel }))),
  panelLabel: 'Proposal',
  search: adManagerSearch,
  visible: (snap) => snap.ads?.visible === true,
  badge: (snap) => snap.ads?.waiting ?? 0,
};
