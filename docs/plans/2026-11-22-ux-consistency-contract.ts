/**
 * Contract for the UX consistency programme (docs/plans/2026-11-22-ux-consistency.md).
 * Builders build against these shapes. Not compiled into the app; the real modules copy these types.
 */
import type { ReactNode } from 'react';

// ── Release 1: CSS attribute API ─────────────────────────────────────────────────────────────────────

/** `.btn` and `.icon-btn`: no attribute = 32px; "small" = 28px. Nothing else. (`data-size="28"` is retired.) */
export type ButtonSize = 'small';

// ── Release 2: shell/UndoLine.tsx ────────────────────────────────────────────────────────────────────

/** How long a held delete/tick waits before it is sent. One value for to-dos, files and chats. */
export const UNDO_MS = 10_000;

export interface UndoLineProps {
  /** What happened, shown and announced: "“Weekly report” deleted." */
  text: string;
  /** Accessible name for the button: "Undo deleting “Weekly report”". Visible text is always "Undo". */
  undoLabel: string;
  onUndo: () => void;
  /** Called when pointer or focus arrives (either one); the clock stops. */
  onPause: () => void;
  /** Called only when both pointer and focus have left; the clock carries on with the time remaining. */
  onResume: () => void;
  /** Move focus to the Undo button on mount: ONLY after a keyboard press. After a pointer press focus goes to
   *  the neighbouring row, so the clock is not paused by focus and the hold sends on time. */
  focusOnMount?: boolean;
  /** While the request is in flight after the time ran out: shows "Sending…", no button. */
  sending?: boolean;
  /** `row`: an `li` in place of the removed drawer row. `strip`: a `div` at the top of the sheet when no row is
   *  in view (viewer, grid, details pane). UndoLine does NOT announce; hosts keep an always-mounted status. */
  as: 'row' | 'strip';
}

/** Store side: a held chat delete, mirroring HeldTodo / held files. Nothing is sent until `expiresAt`. */
export interface HeldChatDelete {
  sdkSessionId: string;
  title: string;
  phase: 'waiting' | 'sending';
}
/* Resume restarts the full UNDO_MS (file precedent). One held-queue helper serves to-dos, files and chats.
   Past sessions are served minus held ids everywhere (drawer, Home, search); openPast ignores a held id;
   api.deletePastChat uses keepalive; page close sends pending deletes at once. */

export interface ChatDeleteStore {
  heldChats: HeldChatDelete[];
  /** Starts the hold; the row is replaced by its UndoLine. Replaces the inline confirm. */
  holdDeletePastChat: (sdkSessionId: string, title: string) => void;
  undoDeletePastChat: (sdkSessionId: string) => void;
  pauseChatDelete: (sdkSessionId: string) => void;
  resumeChatDelete: (sdkSessionId: string) => void;
}

// ── Release 2: icons ─────────────────────────────────────────────────────────────────────────────────

/** New `Icon` name for ending a chat session (X stays "close a surface / remove a chip"). */
export type NewIconName = 'end';

// ── Release 3: shared pieces ─────────────────────────────────────────────────────────────────────────

/** shell/Confirm.tsx, promoted from tools/ad-manager/Confirm.tsx (same behaviour: safe option focused, Esc = safe). */
export interface ConfirmProps {
  /** Names the fieldset for screen readers. */
  label: string;
  /** The question, naming the consequence. Linked to the action with aria-describedby. */
  text: ReactNode;
  /** The specific verb: "Delete project", "Discard changes". */
  action: string;
  /** "Keep editing", "Keep chat" when protecting work; "Cancel" for a constructive step. */
  safe?: string;
  variant: 'primary' | 'danger';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** shell/ShowMore.tsx: "Show all N {noun}" / "Show fewer", aria-expanded, quiet small. */
export interface ShowMoreProps {
  expanded: boolean;
  /** Total count, shown as "Show N more {noun}" or "Show all N" per `wording`. */
  count: number;
  noun: { one: string; many: string };
  wording: 'more' | 'all';
  onToggle: () => void;
}

/** shell/StateNote.tsx: one empty / loading / error line (generalises LibraryNotice). */
export interface StateNoteProps {
  kind: 'empty' | 'loading' | 'error';
  /** Loading defaults to "Loading…". */
  children?: ReactNode;
  /** Error only: renders a standard "Try again" button. */
  onRetry?: () => void;
}

/** CSS-only patterns (patterns.css): */
export type NoticeLevel = 'info' | 'warn' | 'error' | 'ok';
export type NoticeShape = 'box' | 'strip';
export type DotState = 'ok' | 'warn' | 'bad' | 'idle' | 'working' | 'asking';
