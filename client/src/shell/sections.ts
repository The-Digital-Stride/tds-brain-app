import { adsCommandTool } from '../tools/ad-manager/command-slot.ts';
import { adManagerTool } from '../tools/ad-manager/slot.ts';
import { adsSummaryTool } from '../tools/ad-manager/summary-slot.ts';
import type { SectionSlot, SectionsModule, ToolSlot, ToolSnapshot, ToolView } from './sections-contract.ts';

/**
 * Sections on the rail: each opens a left drawer listing its tools, and a tool opens on the main sheet as the view
 * `tool:<sectionId>/<toolId>`. Adding a section (Processes, later) is one entry here. Plan
 * 2026-11-16-workbench-ad-manager, decisions 1 to 6.
 */
export const SECTIONS: SectionSlot[] = [
  {
    id: 'workbench',
    title: 'Workbench',
    icon: 'workbench',
    key: 'w',
    railName: (n) => `Workbench, ${n} waiting`,
    tools: [adManagerTool, adsCommandTool, adsSummaryTool],
  },
];

export const toolView: SectionsModule['toolView'] = (sectionId, toolId): ToolView =>
  `tool:${sectionId}/${toolId}`;

/** The section and tool a view names, or null (not a tool view, or an unknown section or tool). Visibility is not checked. */
export const toolFor: SectionsModule['toolFor'] = (view) => {
  if (typeof view !== 'string' || !view.startsWith('tool:')) return null;
  const [sectionId, toolId, ...rest] = view.slice('tool:'.length).split('/');
  if (!sectionId || !toolId || rest.length > 0) return null;
  const section = SECTIONS.find((s) => s.id === sectionId);
  const tool = section?.tools.find((t) => t.id === toolId);
  return section && tool ? { section, tool } : null;
};

/** The tools of a section this person may see now, in order. */
export const visibleTools: SectionsModule['visibleTools'] = (section, snap) =>
  section.tools.filter((t) => t.visible(snap));

/** The tool a view shows, but only while it is visible: an unknown or hidden tool shows Home instead. */
export function visibleToolFor(
  view: string,
  snap: ToolSnapshot,
): { section: SectionSlot; tool: ToolSlot } | null {
  const hit = toolFor(view);
  return hit?.tool.visible(snap) ? hit : null;
}

/** Sections with at least one visible tool: what the rail lists. */
export function visibleSections(snap: ToolSnapshot): SectionSlot[] {
  return SECTIONS.filter((s) => visibleTools(s, snap).length > 0);
}

/** A section's count for the rail: the sum of its visible tools' badges. */
export function sectionBadge(section: SectionSlot, snap: ToolSnapshot): number {
  return visibleTools(section, snap).reduce((n, t) => n + (t.badge?.(snap) ?? 0), 0);
}

/** Key to section id for the sections visible now: what `keyAction` reads. */
export function sectionKeys(snap: ToolSnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of visibleSections(snap)) if (s.key) out[s.key] = s.id;
  return out;
}
