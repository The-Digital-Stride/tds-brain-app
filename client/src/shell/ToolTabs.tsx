import { useStore, useToolSnapshot } from '../store.tsx';
import { SheetTabs } from './SheetTabs.tsx';
import { visibleTools } from './sections.ts';
import type { SectionSlot, ToolSlot } from './sections-contract.ts';
import type { SheetTabItem } from './settings-tabs.ts';

/** The tools shown as tabs for `tool`: the visible tools of its group. Fewer than two means no tabs. */
export function tabGroupFor(tool: ToolSlot, tools: ToolSlot[]): ToolSlot[] {
  if (!tool.group) return [];
  const inGroup = tools.filter((t) => t.group === tool.group);
  return inGroup.length >= 2 ? inGroup : [];
}

/**
 * The tool tabs under the sheet bar (plan 2026-11-20-rail-hover-tool-tabs, decision 2): the visible tools of the open
 * tool's group, as plain buttons that open that tool. Not `Seg` (a radio group); it reuses the `.seg` look. The shell
 * renders it, so focus stays on the pressed tab. The row scrolls sideways when the sheet is narrow.
 */
export function ToolTabs({ section, tool }: { section: SectionSlot; tool: ToolSlot }) {
  const { openTool } = useStore();
  const snap = useToolSnapshot();
  const tabs = tabGroupFor(tool, visibleTools(section, snap));
  if (tabs.length < 2) return null;
  const items: SheetTabItem[] = tabs.map((t) => {
    const label = t.tabLabel ?? t.title;
    const count = t.badge?.(snap) ?? 0;
    return { id: t.id, label, count, note: count > 0 ? null : (t.rowNote?.(snap) ?? null) };
  });
  return (
    <SheetTabs
      className="tool-tabs seg"
      label={`${tool.group} tools`}
      items={items}
      current={tool.id}
      onChoose={(id) => openTool(section.id, id)}
    />
  );
}
