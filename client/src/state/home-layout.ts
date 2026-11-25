import {
  type HomeItemId,
  type HomeShortcut,
  type HomeShortcutDrawer,
  type HomeShortcutPlace,
  homeShortcutKey,
} from '../../../shared/contract.ts';
import { HOME_ITEMS, type HomeItemDef } from '../shell/home-items.ts';

/** Whether a Home item shows: not hidden by the person, and its own condition (if it has one) holds. */
export function isShown(id: HomeItemId, hidden: readonly string[] | undefined, condition = true): boolean {
  return condition && !(hidden ?? []).includes(id);
}

export type ResolvedShortcut =
  | { state: 'ready'; key: string; label: string; run: () => void }
  | { state: 'waiting'; key: string }
  | { state: 'gone'; key: string; label: string };

/** What a shortcut can point at. No skills: Cortex never offers a skill as a shortcut (Ian, 2026-11-25). */
export interface ShortcutSources {
  /** null while the tool list is still loading. */
  tools: readonly { section: string; tool: string; title: string }[] | null;
  /** A tool's fixed title, for a shortcut that is still loading or gone. Falls back to the raw id when absent. */
  toolTitle?: (section: string, tool: string) => string | undefined;
  /** The places (rail apps) a shortcut can open, in rail order. */
  places: readonly { id: HomeShortcutPlace; title: string }[];
  /** The drawers a shortcut can open, by their rail names ("Tasks", "Chats"). */
  drawers: readonly { id: HomeShortcutDrawer; title: string }[];
  actions: {
    openTool: (section: string, tool: string) => void;
    openPlace: (id: HomeShortcutPlace) => void;
    openDrawer: (id: HomeShortcutDrawer) => void;
  };
}

export function resolveShortcut(s: HomeShortcut, src: ShortcutSources): ResolvedShortcut {
  // A retired kind (a v0.85-0.87 skill shortcut) never reaches here, as the server drops it; if one did, it is gone
  // rather than a crash, so Home hides it and the panel can remove it.
  if (!(['tool', 'place', 'drawer'] as const).some((k) => k === s.kind)) {
    const kind = String((s as { kind?: unknown }).kind);
    return { state: 'gone', key: kind, label: 'Old shortcut' };
  }
  const key = homeShortcutKey(s);
  switch (s.kind) {
    case 'tool': {
      if (src.tools === null) return { state: 'waiting', key };
      const hit = src.tools.find((t) => t.section === s.section && t.tool === s.tool);
      if (!hit) return { state: 'gone', key, label: src.toolTitle?.(s.section, s.tool) ?? s.tool };
      return { state: 'ready', key, label: hit.title, run: () => src.actions.openTool(s.section, s.tool) };
    }
    case 'place': {
      const hit = src.places.find((p) => p.id === s.place);
      if (!hit) return { state: 'gone', key, label: s.place };
      return { state: 'ready', key, label: hit.title, run: () => src.actions.openPlace(s.place) };
    }
    case 'drawer': {
      const hit = src.drawers.find((d) => d.id === s.drawer);
      if (!hit) return { state: 'gone', key, label: s.drawer };
      return { state: 'ready', key, label: hit.title, run: () => src.actions.openDrawer(s.drawer) };
    }
  }
}

export type ShortcutGroup = 'Places' | 'Drawers' | 'Tools';
/** The add list's groups, in the order they show: the short fixed lists first. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Places', 'Drawers', 'Tools'];
export interface ShortcutChoice {
  group: ShortcutGroup;
  shortcut: HomeShortcut;
  label: string;
}

/** What "Add a shortcut" offers: every ready place, drawer and tool not already added. */
export function shortcutChoices(current: readonly HomeShortcut[], src: ShortcutSources): ShortcutChoice[] {
  const have = new Set(current.map(homeShortcutKey));
  const tools = (src.tools ?? [])
    .map((t) => ({
      shortcut: { kind: 'tool', section: t.section, tool: t.tool } as HomeShortcut,
      label: t.title,
    }))
    .filter((c) => !have.has(homeShortcutKey(c.shortcut)))
    .map((c) => ({ group: 'Tools' as const, ...c }));
  const places = src.places
    .map((p) => ({
      group: 'Places' as const,
      shortcut: { kind: 'place', place: p.id } as HomeShortcut,
      label: p.title,
    }))
    .filter((c) => !have.has(homeShortcutKey(c.shortcut)));
  const drawers = src.drawers
    .map((d) => ({
      group: 'Drawers' as const,
      shortcut: { kind: 'drawer', drawer: d.id } as HomeShortcut,
      label: d.title,
    }))
    .filter((c) => !have.has(homeShortcutKey(c.shortcut)));
  return [...places, ...drawers, ...tools];
}

/**
 * The switch rows a person can ever see: no Start my day without the gm skill, no Ads approvals without Ads access,
 * no Pinned skills for anyone but owners and scouts (`skillsMenuVisible`).
 */
export function panelItems(ctx: {
  hasGm: boolean;
  hasAds: boolean;
  hasSkills: boolean;
}): readonly HomeItemDef[] {
  return HOME_ITEMS.filter(
    (i) =>
      !(i.id === 'start-my-day' && !ctx.hasGm) &&
      !(i.id === 'ads' && !ctx.hasAds) &&
      !(i.id === 'skills' && !ctx.hasSkills),
  );
}
