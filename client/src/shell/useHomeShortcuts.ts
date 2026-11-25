import { useMemo } from 'react';
import { HOME_SHORTCUT_DRAWERS, HOME_SHORTCUT_PLACES } from '../../../shared/contract.ts';
import type { ShortcutSources } from '../state/home-layout.ts';
import { useStore, useToolSnapshot } from '../store.tsx';
import { APPS } from './apps.ts';
import { DRAWER_LABELS } from './Rail.tsx';
import { useShell } from './ShellProvider.tsx';
import { SECTIONS, toolFor, toolView, visibleTools } from './sections.ts';

/** The places and drawers a shortcut can open, in rail order, each named as the rail names it. */
const PLACES = HOME_SHORTCUT_PLACES.flatMap((id) => {
  const app = APPS.find((a) => a.id === id);
  return app ? [{ id, title: app.title }] : [];
});
const DRAWERS = HOME_SHORTCUT_DRAWERS.map((id) => ({ id, title: DRAWER_LABELS[id] }));

/**
 * What a shortcut can point at, for Home and the Customise Home panel: this Brain's skills and the tools this
 * person may see. `tools` stays null while the ads list has loaded nothing yet, so a tool shortcut waits instead of
 * looking gone. A skill shortcut opens the skill ready; it never runs it.
 */
export function useHomeShortcuts(): { sources: ShortcutSources; hasGm: boolean; hasAds: boolean } {
  const { boot, startSkill, openTool, openView } = useStore();
  const { dispatch } = useShell();
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
      places: PLACES,
      drawers: DRAWERS,
      actions: {
        startSkill: (name) => {
          const skill = list.find((s) => s.name === name);
          if (skill) startSkill(skill);
        },
        openTool: (section, tool) => openTool(section, tool),
        openPlace: (id) => openView(`app:${id}`),
        openDrawer: (id) => dispatch({ type: 'open-drawer', drawer: id }),
      },
    };
  }, [skills, snap, startSkill, openTool, openView, dispatch]);
  return {
    sources,
    hasGm: (skills ?? []).some((s) => s.name === 'gm'),
    hasAds: snap.ads?.visible === true,
  };
}
