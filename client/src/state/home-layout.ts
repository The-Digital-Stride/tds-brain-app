import { type HomeItemId, type HomeShortcut, homeShortcutKey } from '../../../shared/contract.ts';
import { HOME_ITEMS, type HomeItemDef } from '../shell/home-items.ts';

/** Whether a Home item shows: not hidden by the person, and its own condition (if it has one) holds. */
export function isShown(id: HomeItemId, hidden: readonly string[] | undefined, condition = true): boolean {
  return condition && !(hidden ?? []).includes(id);
}

export type ResolvedShortcut =
  | { state: 'ready'; key: string; label: string; run: () => void }
  | { state: 'waiting'; key: string }
  | { state: 'gone'; key: string; label: string };

export interface ShortcutSources {
  skills: readonly { name: string; title: string }[];
  /** null while the tool list is still loading. */
  tools: readonly { section: string; tool: string; title: string }[] | null;
  /** A tool's fixed title, for a shortcut that is still loading or gone. Falls back to the raw id when absent. */
  toolTitle?: (section: string, tool: string) => string | undefined;
  actions: {
    startSkill: (name: string) => void;
    openTool: (section: string, tool: string) => void;
  };
}

export function resolveShortcut(s: HomeShortcut, src: ShortcutSources): ResolvedShortcut {
  const key = homeShortcutKey(s);
  if (s.kind === 'skill') {
    const hit = src.skills.find((k) => k.name === s.name);
    if (!hit) return { state: 'gone', key, label: s.name };
    return { state: 'ready', key, label: hit.title, run: () => src.actions.startSkill(s.name) };
  }
  if (src.tools === null) return { state: 'waiting', key };
  const hit = src.tools.find((t) => t.section === s.section && t.tool === s.tool);
  if (!hit) return { state: 'gone', key, label: src.toolTitle?.(s.section, s.tool) ?? s.tool };
  return { state: 'ready', key, label: hit.title, run: () => src.actions.openTool(s.section, s.tool) };
}

/**
 * What "Add a shortcut" offers: every ready target not already added, minus the `gm` skill (Start my day has its
 * own place). `pins` is an extra argument (not in the contract's signature) so a pinned skill can say so.
 */
export function shortcutChoices(
  current: readonly HomeShortcut[],
  src: ShortcutSources,
  pins: readonly string[] = [],
): { group: 'Skills' | 'Tools'; shortcut: HomeShortcut; label: string; meta?: string }[] {
  const have = new Set(current.map(homeShortcutKey));
  const skills = src.skills
    .filter((k) => k.name !== 'gm')
    .map((k) => ({ shortcut: { kind: 'skill', name: k.name } as HomeShortcut, label: k.title, name: k.name }))
    .filter((c) => !have.has(homeShortcutKey(c.shortcut)))
    .map((c) => ({
      group: 'Skills' as const,
      shortcut: c.shortcut,
      label: c.label,
      ...(pins.includes(c.name) ? { meta: 'Also in Pinned skills' } : {}),
    }));
  const tools = (src.tools ?? [])
    .map((t) => ({
      shortcut: { kind: 'tool', section: t.section, tool: t.tool } as HomeShortcut,
      label: t.title,
    }))
    .filter((c) => !have.has(homeShortcutKey(c.shortcut)))
    .map((c) => ({ group: 'Tools' as const, ...c }));
  return [...skills, ...tools];
}

/** The switch rows a person can ever see: no Start my day without the gm skill, no Ads approvals without Ads access. */
export function panelItems(ctx: { hasGm: boolean; hasAds: boolean }): readonly HomeItemDef[] {
  return HOME_ITEMS.filter(
    (i) => !(i.id === 'start-my-day' && !ctx.hasGm) && !(i.id === 'ads' && !ctx.hasAds),
  );
}
