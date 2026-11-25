import { useMemo } from 'react';
import type { ShortcutSources } from '../state/home-layout.ts';
import { useStore, useToolSnapshot } from '../store.tsx';
import { SECTIONS, toolFor, toolView, visibleTools } from './sections.ts';

/**
 * What a shortcut can point at, for Home and the Customise Home panel: this Brain's skills and the tools this
 * person may see. `tools` stays null while the ads list has loaded nothing yet, so a tool shortcut waits instead of
 * looking gone. A skill shortcut opens the skill ready; it never runs it.
 */
export function useHomeShortcuts(): { sources: ShortcutSources; hasGm: boolean; hasAds: boolean } {
  const { boot, startSkill, openTool } = useStore();
  const snap = useToolSnapshot();
  const skills = boot?.skills;
  const sources = useMemo<ShortcutSources>(() => {
    const list = skills ?? [];
    return {
      skills: list.map((s) => ({ name: s.name, title: s.title })),
      tools:
        snap.ads === null
          ? null
          : SECTIONS.flatMap((section) =>
              visibleTools(section, snap).map((tool) => ({
                section: section.id,
                tool: tool.id,
                title: toolFor(toolView(section.id, tool.id))?.tool.title ?? tool.title,
              })),
            ),
      toolTitle: (section, tool) => toolFor(toolView(section, tool))?.tool.title,
      actions: {
        startSkill: (name) => {
          const skill = list.find((s) => s.name === name);
          if (skill) startSkill(skill);
        },
        openTool: (section, tool) => openTool(section, tool),
      },
    };
  }, [skills, snap, startSkill, openTool]);
  return {
    sources,
    hasGm: (skills ?? []).some((s) => s.name === 'gm'),
    hasAds: snap.ads?.visible === true,
  };
}
