/**
 * What a key press means to the shell. Pure; the one global listener lives in ShellProvider.
 * Contract: client/src/shell/contract.ts (`KeyAction`).
 */
import type { DrawerName, KeyAction } from '../shell/contract.ts';

const LETTER_DRAWERS: Record<string, DrawerName> = { t: 'todos', c: 'chats', s: 'skills' };

export const keyAction: KeyAction = (e, { typing, state, panelFloating = false }) => {
  const key = e.key.toLowerCase();

  // The file viewer sits over everything and the desk behind it is inert: only Esc, to close it.
  if (state.viewer) return e.key === 'Escape' ? { type: 'close-viewer' } : null;

  // Cmd+K or Ctrl+K: works everywhere, even in a text field.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 'k') {
    return { type: 'set-palette', open: !state.paletteOpen };
  }

  // Esc: one thing per press.
  if (e.key === 'Escape') {
    if (state.paletteOpen) return { type: 'set-palette', open: false };
    if (panelFloating) return { type: 'set-panel', open: false };
    if (state.drawer) return { type: 'close-drawer' };
    return null;
  }

  // "/" opens the global search from anywhere (not while typing, so it can still be typed). Before the Shift
  // check: on some keyboards (German, French, Nordic) "/" is typed with Shift.
  if (key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return !typing && !state.paletteOpen && state.singleKeys ? { type: 'set-palette', open: true } : null;
  }

  // Single keys: no modifier, not typing, palette shut, and switched on.
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (typing || state.paletteOpen || !state.singleKeys) return null;
  if (key === '[') return { type: 'toggle-rail' };
  const drawer = LETTER_DRAWERS[key];
  return drawer ? { type: 'toggle-drawer', drawer } : null;
};
