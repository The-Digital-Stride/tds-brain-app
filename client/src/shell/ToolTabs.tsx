import { useStore, useToolSnapshot } from '../store.tsx';
import { visibleTools } from './sections.ts';
import type { SectionSlot, ToolSlot } from './sections-contract.ts';

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
  return (
    <nav className="tool-tabs seg" aria-label={`${tool.group} tools`}>
      {tabs.map((t) => {
        const label = t.tabLabel ?? t.title;
        const count = t.badge?.(snap) ?? 0;
        const note = count > 0 ? null : (t.rowNote?.(snap) ?? null);
        const spoken = count > 0 ? `${label}, ${count} waiting` : note ? `${label}, ${note}` : undefined;
        const current = t.id === tool.id;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={current ? 'page' : undefined}
            aria-label={spoken}
            onClick={() => {
              if (!current) openTool(section.id, t.id);
            }}
          >
            {label}
            {count > 0 ? <span className="count">{count}</span> : null}
            {note ? <span className="tool-tab-note">{note}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
