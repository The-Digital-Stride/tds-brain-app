/**
 * What a key press means to the shell. Pure; the one global listener lives in ShellProvider.
 * Contract: client/src/shell/contract.ts (`KeyAction`).
 */
import type { DrawerName, KeyAction } from '../shell/contract.ts';

const LETTER_DRAWERS: Record<string, DrawerName> = { t: 'todos', c: 'chats', s: 'skills' };

export const keyAction: KeyAction = (
  e,
  {
    typing,
    state,
    panelFloating = false,
    helpVisible = false,
    skillsHidden = false,
    sectionKeys,
    chatDrawer = false,
    chatDraft = false,
  },
) => {
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
    // The to-do panel is the topmost layer: it closes first (the shell asks first when it holds unsaved changes).
    if (state.todoPanel) return { type: 'close-todo' };
    if (panelFloating) return { type: 'set-panel', open: false };
    // The chat drawer over a tool; a message being typed in it is never thrown away by Esc.
    if (chatDrawer) return chatDraft ? null : { type: 'close-chat-drawer' };
    // Closing Help puts back the drawer it replaced; closing any other drawer just closes it.
    if (state.drawer) return state.drawer === 'help' ? { type: 'close-help' } : { type: 'close-drawer' };
    return null;
  }

  // "/" opens the global search from anywhere (not while typing, so it can still be typed). Before the Shift
  // check: on some keyboards (German, French, Nordic) "/" is typed with Shift.
  if (key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return !typing && !state.paletteOpen && state.singleKeys ? { type: 'set-palette', open: true } : null;
  }

  // "?" opens Help (Shift+/ on most keyboards), so it too comes before the Shift check below.
  if (key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return helpVisible && !typing && !state.paletteOpen && state.singleKeys
      ? { type: 'open-drawer', drawer: 'help' }
      : null;
  }

  // Single keys: no modifier, not typing, palette shut, and switched on.
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (typing || state.paletteOpen || !state.singleKeys) return null;
  if (key === '[') return { type: 'toggle-rail' };
  // With the to-do panel open, P and N walk through the to-dos (the rail's own key stays `[`).
  if (state.todoPanel?.key != null && (key === 'p' || key === 'n')) {
    return { type: 'todo-step', dir: key === 'p' ? -1 : 1 };
  }
  if (key === 'h') return helpVisible ? { type: 'toggle-drawer', drawer: 'help' } : null;
  const section = sectionKeys?.[key];
  if (section) return { type: 'toggle-section', section };
  const drawer = LETTER_DRAWERS[key];
  if (drawer === 'skills' && skillsHidden) return null;
  return drawer ? { type: 'toggle-drawer', drawer } : null;
};
