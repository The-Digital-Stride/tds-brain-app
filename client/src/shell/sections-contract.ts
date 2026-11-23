/**
 * Contract for sections: a rail item that opens a left drawer listing tools, each of which opens on
 * the main sheet. Plan: docs/plans/2026-11-16-workbench-ad-manager.md, decisions 1 to 6 and 17.
 * Types only; no behaviour lives here.
 */
import type { AdsSummary } from '../../../shared/ads-contract.ts';
import type { AppSlot, IconName } from './contract.ts';

/**
 * What a tool's `visible` and `badge` read: a snapshot of the store, like `SearchSource` gets. Pure functions of
 * it, so the rail, drawer, palette and Home agree and tests need no hooks. Grows as tools need more.
 */
export interface ToolSnapshot {
  /** null until loaded (or when the server has no ads routes): every ads tool counts as not visible. */
  ads: AdsSummary | null;
}

/** A tool in a section. Everything an app has (Sheet, BarActions, Panel, search), plus the drawer row. */
export interface ToolSlot extends AppSlot {
  /** One line under the title in the drawer, e.g. "Proposals, the ads board and monthly reports". UK English. */
  summary: string;
  /** A shorter name for the tool's tab under the sheet bar, e.g. "Manager". Falls back to `title`. */
  tabLabel?: string;
  /** Optional group name. The drawer shows group folds when its tools use at least one group. */
  group?: string;
  /** Whether this person may see the tool now. False while unknown, so the rail never flashes an item. */
  visible: (snap: ToolSnapshot) => boolean;
  /** A count for the drawer row and the rail item (summed per section), or 0 for none. */
  badge?: (snap: ToolSnapshot) => number;
  /**
   * A short line shown as text on the drawer row, not a waiting count, or null for none. Never summed
   * into the rail or a folded group's count.
   */
  rowNote?: (snap: ToolSnapshot) => string | null;
}

export interface SectionSlot {
  /** Lowercase, no spaces (SECTION_ID_PATTERN). */
  id: string;
  /** Rail label and dock heading, e.g. "Workbench". */
  title: string;
  icon: IconName;
  /** Single-key shortcut, lowercase, e.g. 'w'. Must not clash with `client/src/state/keys.ts`. */
  key?: string;
  /** Spoken name for the rail item when the badge is above 0, e.g. (n) => `Workbench, ${n} waiting`. */
  railName?: (badge: number) => string;
  tools: ToolSlot[];
}

/**
 * Drawer: `DrawerName` gains ONE fixed member, `'section'`, so every `Record<DrawerName, …>` stays exhaustive.
 * Which section shows lives in `ShellState.section: string | null` (like `helpPage`), set by these actions:
 */
export type SectionShellAction =
  | { type: 'open-section'; section: string }
  /** Opens it, or closes it when that same section is open. */
  | { type: 'toggle-section'; section: string };
/** Never saved: a section drawer isn't restored on reload, since visibility loads after the shell. */
export interface SectionShellState {
  section: string | null;
}

/** The sheet view for a tool. Joins `View` in `store.tsx`. An unknown section or tool, or one not visible, shows Home. */
export type ToolView = `tool:${string}/${string}`;

/** `client/src/shell/sections.ts` exports these. */
export interface SectionsModule {
  SECTIONS: SectionSlot[];
  /** The section and tool for a view, or null. */
  toolFor: (view: string) => { section: SectionSlot; tool: ToolSlot } | null;
  toolView: (sectionId: string, toolId: string) => ToolView;
  /** Visible tools of a section for this snapshot, in order. */
  visibleTools: (section: SectionSlot, snap: ToolSnapshot) => ToolSlot[];
}

/** Added to the store (`client/src/store.tsx`). Builder A owns these; Builder C uses them. */
export interface StoreToolAdditions {
  /**
   * Opens a tool on the sheet, closes the open drawer (as opening an app does), and records it as the section's
   * last tool (`AppPrefs.lastTool`). `arg` is handed to the tool (Ad Manager: the account key) via `toolArg`.
   */
  openTool: (sectionId: string, toolId: string, arg?: string) => void;
  /** The argument the last `openTool` passed, read once by the tool and then cleared. */
  toolArg: string | null;
  clearToolArg: () => void;
  /**
   * Starts a NEW chat with `prompt` as its first message, for `client`, calling `api.startSession` directly (as
   * `openPast` does), never `send` (which posts into the active chat). `open: true` shows it; `open: false` leaves
   * the person where they are; `in: 'drawer'` shows it in the right-hand drawer over the tool instead of the chat
   * screen. Resolves to the new session id, or null with `actionError` set.
   */
  startChat: (
    prompt: string,
    client: string | null,
    opts: { open: boolean; in?: 'sheet' | 'drawer' },
  ) => Promise<string | null>;
  /** Shows a live chat on the chat screen, or with `in: 'drawer'` in the right-hand drawer over the tool. */
  openChat: (sessionId: string, opts?: { in?: 'sheet' | 'drawer' }) => void;
  /** Loaded at boot and on the `ads-changed` event; null until then or when unavailable. */
  ads: AdsSummary | null;
  /** Re-fetches `ads` (Refresh, and after a change action). */
  reloadAds: () => Promise<void>;
}

/** `SearchActions` (search-sources) gains `openTool` with the same signature as above. */
export type SearchToolAction = Pick<StoreToolAdditions, 'openTool'>;
