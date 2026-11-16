import { lazy } from 'react';
import type { ToolSlot } from '../../shell/sections-contract.ts';
import { adManagerSearch } from './search.ts';

/**
 * Ad Manager, the Workbench section's first tool (plan 2026-11-16-workbench-ad-manager). Its code loads only when
 * first opened; its search source sits outside that chunk (`search.ts`), so the palette never loads the screens.
 */
const ui = () => import('./ui.ts');

export const adManagerTool: ToolSlot = {
  id: 'ad-manager',
  title: 'Ad Manager',
  icon: 'chart' as ToolSlot['icon'],
  summary: 'Proposals, the ads board and monthly reports',
  Sheet: lazy(() => ui().then((m) => ({ default: m.AdManagerSheet }))),
  BarActions: lazy(() => ui().then((m) => ({ default: m.AdManagerBar }))),
  Panel: lazy(() => ui().then((m) => ({ default: m.ProposalPanel }))),
  panelLabel: 'Proposal',
  search: adManagerSearch,
  visible: (snap) => snap.ads?.visible === true,
  badge: (snap) => snap.ads?.waiting ?? 0,
};
