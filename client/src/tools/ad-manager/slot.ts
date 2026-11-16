/**
 * STUB written by the lead so Builder A can wire sections before Builder C lands the real slot.
 * Builder C replaces this file (same export name and type). Plan 2026-11-16-workbench-ad-manager.
 */
import type { ToolSlot } from '../../shell/sections-contract.ts';

const Empty = () => null;

export const adManagerTool: ToolSlot = {
  id: 'ad-manager',
  title: 'Ad Manager',
  icon: 'chart' as ToolSlot['icon'],
  summary: 'Proposals, the ads board and monthly reports',
  Sheet: Empty,
  search: null,
  visible: (snap) => snap.ads?.visible === true,
  badge: (snap) => snap.ads?.waiting ?? 0,
};
