/**
 * Contract for sections: a rail item that opens a left drawer listing tools, each of which opens on
 * the main sheet. Plan: docs/plans/2026-11-16-workbench-ad-manager.md, decisions 1 to 6.
 * Types only; no behaviour lives here.
 */
import type { AppSlot, IconName } from './contract.ts';

/** A tool in a section. Everything an app has (Sheet, BarActions, Panel, search), plus the drawer row. */
export interface ToolSlot extends AppSlot {
  /** One line under the title in the drawer, e.g. "Proposals, the ads board and monthly reports". UK English. */
  summary: string;
  /** Optional group name. The drawer shows group folds only when its tools use two or more groups. */
  group?: string;
  /**
   * Whether this person may see the tool now. A hook, so it can follow server data (Ad Manager: the
   * bridge's capabilities). While unknown (loading), return false: the rail never flashes an item.
   */
  useVisible: () => boolean;
  /** A count for the drawer row and the rail item (summed per section), or 0 for none. */
  useBadge?: () => number;
}

export interface SectionSlot {
  /** Lowercase, no spaces. The drawer is `section:<id>`. */
  id: string;
  /** Rail label and dock heading, e.g. "Workbench". */
  title: string;
  icon: IconName;
  /** Single-key shortcut, lowercase, e.g. 'w'. Must not clash with the shell's keys. */
  key?: string;
  /** Spoken name for the rail item when the badge is above 0, e.g. (n) => `Workbench, ${n} waiting`. */
  railName?: (badge: number) => string;
  tools: ToolSlot[];
}

/** The drawer for a section. Joins `DrawerName` in `contract.ts`: `'chats' | 'todos' | 'skills' | 'help' | SectionDrawerName`. */
export type SectionDrawerName = `section:${string}`;

/** The sheet view for a tool. Joins `View` in `store.tsx`. An unknown section or tool shows Home. */
export type ToolView = `tool:${string}/${string}`;

/** `client/src/shell/sections.ts` exports these. */
export interface SectionsModule {
  SECTIONS: SectionSlot[];
  /** The section and tool for a view, or null. */
  toolFor: (view: string) => { section: SectionSlot; tool: ToolSlot } | null;
  toolView: (sectionId: string, toolId: string) => ToolView;
}

/**
 * Added to the store (`client/src/store.tsx`): opens a tool on the sheet and records it as the
 * section's last tool (`AppPrefs.lastTool`). `account` is passed through to tools that take one
 * (Ad Manager: the ads account to show), via `toolArg`.
 */
export interface StoreToolAdditions {
  openTool: (sectionId: string, toolId: string, arg?: string) => void;
  /** The argument the last `openTool` passed, read once by the tool and then cleared. */
  toolArg: string | null;
  clearToolArg: () => void;
}
