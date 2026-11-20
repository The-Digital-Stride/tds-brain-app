/**
 * Settings tabs (plan docs/plans/2026-11-20-settings-tabs.md): which tabs exist, which show for whom, and the
 * help page each opens. Pure, so it is tested on its own; `SettingsView` and the shell build on it.
 */

/** A Settings tab. `general` is the default and the fallback for an unknown or hidden tab. */
export type SettingsTab = 'general' | 'claude' | 'skill-levels' | 'health' | 'about';

export interface SettingsTabInfo {
  id: SettingsTab;
  /** The tab's words, also the hidden part of the sheet-bar title (": Claude"). UK English. */
  label: string;
  /** The help page the Help drawer opens while this tab shows. */
  help: string;
}

/** In order. */
export const SETTINGS_TABS: readonly SettingsTabInfo[] = [
  { id: 'general', label: 'General', help: 'settings' },
  { id: 'claude', label: 'Claude', help: 'levels' },
  { id: 'skill-levels', label: 'Skill levels', help: 'skill-levels' },
  { id: 'health', label: 'Health', help: 'health' },
  { id: 'about', label: 'About', help: 'settings' },
];

/** What decides which tabs show. */
export interface SettingsTabContext {
  /** True when the boot (or an override) has skill levels; without them the Skill levels tab hides, as the section did. */
  hasSkillLevels: boolean;
}

/** The tabs this person sees, in order. */
export function visibleSettingsTabs(ctx: SettingsTabContext): SettingsTabInfo[] {
  return SETTINGS_TABS.filter((t) => t.id !== 'skill-levels' || ctx.hasSkillLevels);
}

/** `tab` if it is visible, else `general`. */
export function settingsTabOrDefault(
  tab: SettingsTab | string | null | undefined,
  ctx: SettingsTabContext,
): SettingsTab {
  const hit = visibleSettingsTabs(ctx).find((t) => t.id === tab);
  return hit ? hit.id : 'general';
}

/** One tab in a `SheetTabs` row. Shared by the tool tabs and the Settings tabs. */
export interface SheetTabItem {
  id: string;
  label: string;
  /** A neutral `.count` pill ("waiting"). */
  count?: number;
  /** Small text after the label when there is no count. */
  note?: string | null;
  /** A status dot after the label (`.health-dot[data-state]`), for a problem that must show from any tab. */
  dot?: 'problem' | null;
  /** The spoken name when it differs from `label` ("Health, 1 thing needs attention"). */
  spoken?: string;
}

export interface SheetTabsProps {
  /** The nav's accessible name: "Ads tools", "Settings sections". */
  label: string;
  items: SheetTabItem[];
  current: string;
  /** Called only for a tab that is not current. */
  onChoose: (id: string) => void;
  /** Extra class on the nav (the tool tabs keep `tool-tabs`). */
  className?: string;
}

/** The tab that holds the control a focus request names (`requestSettingsFocus(id)`); unknown ids stay on General. */
export function settingsTabForFocus(id: string): SettingsTab {
  return id === 'set-model' || id === 'set-effort' ? 'claude' : 'general';
}
