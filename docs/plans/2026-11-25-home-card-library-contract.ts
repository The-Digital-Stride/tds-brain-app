/**
 * Contract for plan 2026-11-25-home-card-library. Every builder builds against these names.
 * Part 1 goes into `shared/contract.ts` as written. Parts 2-4 are client-side signatures.
 */

// ---------------------------------------------------------------------------
// Part 1: shared/contract.ts (Builder A)
// ---------------------------------------------------------------------------

/** Every Home item a person can hide, in the default order. The client ignores ids it doesn't know. */
export const HOME_ITEM_IDS = [
  'start-my-day',
  'whats-new',
  'meetings',
  'ads',
  'todos',
  'projects',
  'chats',
  'files',
  'skills',
] as const;
export type HomeItemId = (typeof HOME_ITEM_IDS)[number];

/** The server checks hidden ids by pattern only, so an id from a newer app survives an older server's clean. */
export const HOME_ITEM_ID_PATTERN = /^[a-z0-9-]{1,40}$/; // same as SECTION_ID_PATTERN
export const HOME_HIDDEN_MAX = 40;
export const HOME_SHORTCUTS_MAX = 6;
/** Moved from the private `SKILL_NAME` in server/http/routes.ts:393 so client and server share it. */
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][\w.:-]{0,127}$/;

// Decision 8 (owner): skills and tools only in v1. A newer app may add kinds; an older server drops unknown kinds on clean.
export type HomeShortcut =
  | { kind: 'skill'; name: string } // name matches SKILL_NAME_PATTERN
  | { kind: 'tool'; section: string; tool: string }; // both match SECTION_ID_PATTERN

/** Same shortcut twice = same key. Used for de-duplication on both sides. */
export declare function homeShortcutKey(s: HomeShortcut): string; // e.g. 'skill:gm', 'tool:workbench/ads'

// Added to `interface AppPrefs` (optional: older servers send none, which reads as []):
export interface AppPrefsHomeFields {
  /** Home items this person hid (plan 2026-11-25-home-card-library). Ids match HOME_ITEM_ID_PATTERN, at most HOME_HIDDEN_MAX, no repeats. */
  homeHidden?: string[];
  /** Shortcut buttons this person added, in their order, at most HOME_SHORTCUTS_MAX, no repeats by homeShortcutKey. Start my day is NOT stored here. */
  homeShortcuts?: HomeShortcut[];
}
// DEFAULT_PREFS gains: homeHidden: [], homeShortcuts: []. This server always sends both.
//
// Server clean (app-store.ts sanitise, on read and write): drop entries that fail their pattern or kind, drop repeats
// (first wins), keep the first N. Never throws.
// Server validate (routes.ts validatePrefsPatch): any bad entry, unknown kind or over the cap → 400 with
//   'The hidden Home items were not understood.' / 'The Home shortcuts were not understood.'

// ---------------------------------------------------------------------------
// Part 2: client registry and pure logic (Builder C)
// ---------------------------------------------------------------------------

export interface HomeItemDef {
  id: HomeItemId;
  /** Shown in the panel and in status lines, e.g. 'Pinned files'. UK English; "tasks", never "to-dos". */
  title: string;
  kind: 'card' | 'button';
  /** Panel hint for items that show only sometimes, e.g. Ads approvals, Recent projects, Start my day. */
  hint?: string;
}
/** client/src/shell/home-items.ts */
export declare const HOME_ITEMS: readonly HomeItemDef[];

/** client/src/state/home-layout.ts */
export declare function isShown(id: HomeItemId, hidden: readonly string[] | undefined, condition?: boolean): boolean;

export type ResolvedShortcut =
  | { state: 'ready'; key: string; label: string; run: () => void }
  | { state: 'waiting'; key: string } // target list not loaded yet (e.g. ads tools): render nothing, say nothing
  | { state: 'gone'; key: string; label: string }; // panel says "No longer in your Brain"; Home hides it

export interface ShortcutSources {
  skills: readonly { name: string; title: string }[];
  /** null while the tool list is still loading. */
  tools: readonly { section: string; tool: string; title: string }[] | null;
  actions: {
    startSkill: (name: string) => void;
    openTool: (section: string, tool: string) => void;
  };
}
export declare function resolveShortcut(s: HomeShortcut, src: ShortcutSources): ResolvedShortcut;
/** What the "Add a shortcut" list offers: every ready target not already added, minus the `gm` skill. Grouped. */
export declare function shortcutChoices(
  current: readonly HomeShortcut[],
  src: ShortcutSources,
): { group: 'Skills' | 'Tools'; shortcut: HomeShortcut; label: string; meta?: string }[];

// ---------------------------------------------------------------------------
// Part 3: store (Builder B), exposed on the app context
// ---------------------------------------------------------------------------

export interface HomeLayoutStore {
  /** Always an array once booted; undefined means an older server: hide "Customise Home" entirely. */
  homeHidden: readonly string[] | undefined;
  homeShortcuts: readonly HomeShortcut[] | undefined;
  /** Optimistic: Home changes at once, the save follows; the newest choice wins a quick double toggle. */
  setHomeItemShown: (id: HomeItemId, shown: boolean) => void;
  addHomeShortcut: (s: HomeShortcut) => void; // ignored when full or a repeat
  removeHomeShortcut: (key: string) => void;
  /** "Show everything again" (decision 14): homeHidden [] only. Shortcuts and card order are left alone. */
  showAllHomeItems: () => void;
}

// ---------------------------------------------------------------------------
// Part 4: shell (Builder D)
// ---------------------------------------------------------------------------

export interface HomeCustomiseShell {
  /** Separate from `panelOpen` and never saved, so the panel can't get stuck open on Home. */
  homeCustomiseOpen: boolean;
  openCustomiseHome: () => void;
  closeCustomiseHome: () => void; // focus returns to the "Customise Home" button (Dock.tsx already does this)
}

// ---------------------------------------------------------------------------
// Part 5: hand-over points between Builders B, C and D (added at build start)
// ---------------------------------------------------------------------------

// Builder C, client/src/state/home-layout.ts (pure):
/** The switch rows a person can ever see, in HOME_ITEMS order: no 'start-my-day' without the gm skill, no 'ads' without Ads access. */
export declare function panelItems(ctx: { hasGm: boolean; hasAds: boolean }): readonly HomeItemDef[];

// Builder C, client/src/shell/useHomeShortcuts.ts (hook; used by Home and by the panel):
/**
 * Builds ShortcutSources from useStore() (boot.skills, startSkill, openTool) and useToolSnapshot() (tools; null while the
 * ads tool list hasn't loaded: `ads === null`), and also returns `hasGm` and `hasAds` (`ads?.visible === true`, as
 * client/src/tools/ad-manager/slot.ts:26).
 */
export declare function useHomeShortcuts(): { sources: ShortcutSources; hasGm: boolean; hasAds: boolean };

// Builder B: Part 3 is added to the `Store` returned by useStore() (client/src/store.tsx:504);
// Part 4 is added to the `ShellApi` returned by useShell() (client/src/shell/ShellProvider.tsx:74).
// B mounts D's panel in the right Dock (client/src/App.tsx:236-251) when the view is Home and homeCustomiseOpen,
// with label 'Customise Home'. On the Home view, the SheetBar panel toggle drives homeCustomiseOpen (aria-pressed
// follows it), never panelOpen.

// Builder C: Home passes `panel="Customise Home"` to its SheetBar only when `homeHidden !== undefined` (decision 6);
// the tray foot's "Show hidden cards" calls openCustomiseHome().

// Builder D, client/src/shell/CustomiseHome.tsx:
/** The panel body (no props). Reads Part 3 from useStore(), Part 4 from useShell(), useHomeShortcuts() and panelItems(). */
export declare function CustomiseHome(): JSX.Element;
