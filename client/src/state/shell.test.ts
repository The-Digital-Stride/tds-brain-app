import { describe, expect, it } from 'vitest';
import type { ShellState } from '../shell/contract.ts';
import {
  DEFAULT_SHELL,
  dockModes,
  fitToWidth,
  giveWay,
  layoutOf,
  loadShell,
  saveShell,
  shellReducer,
  toggleRail,
} from './shell.ts';

const base: ShellState = { ...DEFAULT_SHELL };

describe('shellReducer', () => {
  it('opening a drawer closes the other one', () => {
    const chats = shellReducer(base, { type: 'toggle-drawer', drawer: 'chats' });
    expect(chats.drawer).toBe('chats');
    const todos = shellReducer(chats, { type: 'toggle-drawer', drawer: 'todos' });
    expect(todos.drawer).toBe('todos');
    expect(shellReducer(todos, { type: 'open-drawer', drawer: 'skills' }).drawer).toBe('skills');
  });

  it('toggling the open drawer closes it; open-drawer never does', () => {
    const open = shellReducer(base, { type: 'toggle-drawer', drawer: 'skills' });
    expect(shellReducer(open, { type: 'toggle-drawer', drawer: 'skills' }).drawer).toBeNull();
    expect(shellReducer(open, { type: 'open-drawer', drawer: 'skills' }).drawer).toBe('skills');
    expect(shellReducer(open, { type: 'close-drawer' }).drawer).toBeNull();
  });

  it('handles the rail, panel, palette and single keys', () => {
    expect(shellReducer(base, { type: 'toggle-rail' }).railWide).toBe(!base.railWide);
    expect(shellReducer(base, { type: 'toggle-panel' }).panelOpen).toBe(!base.panelOpen);
    expect(shellReducer(base, { type: 'set-panel', open: true }).panelOpen).toBe(true);
    expect(shellReducer(base, { type: 'set-panel-tab', tab: 'details' }).panelTab).toBe('details');
    expect(shellReducer(base, { type: 'set-palette', open: true }).paletteOpen).toBe(true);
    expect(shellReducer(base, { type: 'set-single-keys', on: false }).singleKeys).toBe(false);
  });

  it('show-chat-file opens the panel on the files tab with the file chosen', () => {
    const shown = shellReducer(base, { type: 'show-chat-file', chat: 'c1', key: 'a.md' });
    expect(shown).toMatchObject({
      panelOpen: true,
      panelTab: 'files',
      panelFile: { chat: 'c1', key: 'a.md' },
    });
    const list = shellReducer(shown, { type: 'show-chat-file', chat: 'c1', key: null });
    expect(list).toMatchObject({ panelOpen: true, panelTab: 'files', panelFile: null });
  });

  it('changing tab clears the chosen file', () => {
    const shown = shellReducer(base, { type: 'show-chat-file', chat: 'c1', key: 'a.md' });
    expect(shellReducer(shown, { type: 'set-panel-tab', tab: 'steps' }).panelFile).toBeNull();
    expect(shellReducer(shown, { type: 'set-panel-tab', tab: 'files' }).panelFile).toBeNull();
  });
});

describe('loadShell', () => {
  it('falls back to the default for null, bad JSON and non-objects', () => {
    expect(loadShell(null)).toEqual(DEFAULT_SHELL);
    expect(loadShell('{not json')).toEqual(DEFAULT_SHELL);
    expect(loadShell('42')).toEqual(DEFAULT_SHELL);
    expect(loadShell('null')).toEqual(DEFAULT_SHELL);
    expect(loadShell('[]')).toEqual(DEFAULT_SHELL);
  });

  it('keeps good fields and replaces wrong types one by one', () => {
    const raw = JSON.stringify({
      railWide: 'yes',
      drawer: 'todos',
      panelOpen: true,
      panelTab: 'files',
      singleKeys: 0,
    });
    expect(loadShell(raw)).toEqual({
      ...DEFAULT_SHELL,
      drawer: 'todos',
      panelOpen: true,
      panelTab: 'files',
    });
    expect(loadShell(JSON.stringify({ drawer: 'history' })).drawer).toBeNull();
    expect(loadShell(JSON.stringify({ railWide: !DEFAULT_SHELL.railWide })).railWide).toBe(
      !DEFAULT_SHELL.railWide,
    );
  });

  it('never restores a chosen file', () => {
    const raw = JSON.stringify({ panelTab: 'files', panelFile: { chat: 'c', key: 'k' } });
    expect(loadShell(raw).panelFile).toBeNull();
  });

  it('never restores an open palette', () => {
    expect(loadShell(JSON.stringify({ paletteOpen: true })).paletteOpen).toBe(false);
  });
});

describe('saveShell', () => {
  it('saves everything except paletteOpen, and loads back the same', () => {
    const state: ShellState = {
      railWide: true,
      drawer: 'chats',
      panelOpen: true,
      panelTab: 'details',
      panelFile: { chat: 'c', key: 'k' },
      paletteOpen: true,
      singleKeys: false,
    };
    const saved = JSON.parse(saveShell(state)) as Record<string, unknown>;
    expect(saved).not.toHaveProperty('paletteOpen');
    expect(saved).not.toHaveProperty('panelFile');
    expect(saved).toEqual({
      railWide: true,
      drawer: 'chats',
      panelOpen: true,
      panelTab: 'details',
      singleKeys: false,
    });
    expect(loadShell(saveShell(state))).toEqual({ ...state, panelFile: null, paletteOpen: false });
  });
});

describe('dockModes', () => {
  const narrowRail = { ...base, railWide: false };
  const wideRail = { ...base, railWide: true };

  it('the drawer overlays under 900px with the rail as icons', () => {
    expect(dockModes(899, narrowRail).drawerOverlays).toBe(true);
    expect(dockModes(900, narrowRail).drawerOverlays).toBe(false);
    expect(dockModes(901, narrowRail).drawerOverlays).toBe(false);
  });

  it('the drawer overlays under 1060px with the rail showing names', () => {
    expect(dockModes(1059, wideRail).drawerOverlays).toBe(true);
    expect(dockModes(1060, wideRail).drawerOverlays).toBe(false);
    expect(dockModes(1061, wideRail).drawerOverlays).toBe(false);
  });

  it('the panel overlays under 1100px with no drawer open', () => {
    expect(dockModes(1099, narrowRail).panelOverlays).toBe(true);
    expect(dockModes(1100, narrowRail).panelOverlays).toBe(false);
    expect(dockModes(1101, narrowRail).panelOverlays).toBe(false);
  });

  it('the panel overlays under 1400px while a drawer is open', () => {
    const withDrawer = { ...narrowRail, drawer: 'todos' as const };
    expect(dockModes(1399, withDrawer).panelOverlays).toBe(true);
    expect(dockModes(1400, withDrawer).panelOverlays).toBe(false);
    expect(dockModes(1401, withDrawer).panelOverlays).toBe(false);
  });
});

describe('giveWay: the docks give way when both cannot push (most recent wins)', () => {
  const panelOpen = { ...base, railWide: false, panelOpen: true };
  const drawerOpen = { ...base, railWide: false, drawer: 'todos' as const };

  it('opening a drawer closes the panel when the panel would then float', () => {
    const open = { type: 'toggle-drawer', drawer: 'chats' } as const;
    expect(giveWay(panelOpen, open, 1399)).toMatchObject({ drawer: 'chats', panelOpen: false });
    expect(giveWay(panelOpen, open, 1400)).toMatchObject({ drawer: 'chats', panelOpen: true });
    expect(giveWay(panelOpen, { type: 'open-drawer', drawer: 'skills' }, 1280)).toMatchObject({
      drawer: 'skills',
      panelOpen: false,
    });
  });

  it('closing a drawer leaves the panel alone', () => {
    const both = { ...drawerOpen, panelOpen: true };
    expect(giveWay(both, { type: 'close-drawer' }, 1000)).toMatchObject({ drawer: null, panelOpen: true });
  });

  it('opening the panel closes the drawer when the panel could push without it', () => {
    expect(giveWay(drawerOpen, { type: 'toggle-panel' }, 1100)).toMatchObject({
      drawer: null,
      panelOpen: true,
    });
    expect(giveWay(drawerOpen, { type: 'set-panel', open: true }, 1399)).toMatchObject({
      drawer: null,
      panelOpen: true,
    });
    expect(giveWay(drawerOpen, { type: 'toggle-panel' }, 1400)).toMatchObject({
      drawer: 'todos',
      panelOpen: true,
    });
  });

  it('under 1100px the panel floats over the drawer instead', () => {
    expect(giveWay(drawerOpen, { type: 'toggle-panel' }, 1099)).toMatchObject({
      drawer: 'todos',
      panelOpen: true,
    });
  });

  it('other actions pass straight through the reducer', () => {
    expect(giveWay(panelOpen, { type: 'toggle-rail' }, 1000)).toEqual(
      shellReducer(panelOpen, { type: 'toggle-rail' }),
    );
  });
});

describe('fitToWidth: after a resize, if both are open and one must float, the panel closes', () => {
  const both = { ...base, railWide: false, drawer: 'todos' as const, panelOpen: true };
  it('closes the panel below 1400px and keeps both at 1400px', () => {
    expect(fitToWidth(both, 1399).panelOpen).toBe(false);
    expect(fitToWidth(both, 1399).drawer).toBe('todos');
    expect(fitToWidth(both, 1400)).toBe(both);
  });
  it('leaves a lone dock alone', () => {
    const panel = { ...both, drawer: null };
    expect(fitToWidth(panel, 800)).toBe(panel);
  });
});

describe('layoutOf: the rail is held to icons while the panel shows', () => {
  const wide = { ...base, railWide: true };
  const live = { liveOnSheet: true, railOverride: false };

  it('the panel showing on a live chat holds the rail to icons, without changing railWide', () => {
    const state = { ...wide, panelOpen: true };
    const l = layoutOf(state, 1500, live);
    expect(l.panelShowing).toBe(true);
    expect(l.railHeld).toBe(true);
    expect(l.railShowsNames).toBe(false);
    expect(JSON.parse(saveShell(state)).railWide).toBe(true);
  });

  it('names come back when the panel closes, or when the person overrides the hold', () => {
    expect(layoutOf(wide, 1500, live).railShowsNames).toBe(true);
    const l = layoutOf({ ...wide, panelOpen: true }, 1500, { liveOnSheet: true, railOverride: true });
    expect(l.railHeld).toBe(false);
    expect(l.railShowsNames).toBe(true);
  });

  it('no live chat on the sheet: the panel is not showing and nothing is held', () => {
    const l = layoutOf({ ...wide, panelOpen: true }, 1500, { liveOnSheet: false, railOverride: false });
    expect(l.panelShowing).toBe(false);
    expect(l.railShowsNames).toBe(true);
  });

  it('a left drawer never holds the rail', () => {
    expect(layoutOf({ ...wide, drawer: 'todos' }, 1500, live).railShowsNames).toBe(true);
  });

  it('dock modes use the rail as it shows', () => {
    // Names showing: a drawer floats under 1060px. Held to icons by the panel: only under 900px.
    expect(layoutOf({ ...wide, drawer: 'todos' }, 1000, live).modes.drawerOverlays).toBe(true);
    const held = layoutOf({ ...wide, drawer: 'todos', panelOpen: true }, 1000, live);
    expect(held.modes.drawerOverlays).toBe(false);
    expect(held.panelShowing).toBe(true);
  });

  it('a panel behind a floating drawer is not showing and does not hold the rail', () => {
    const l = layoutOf({ ...wide, drawer: 'todos', panelOpen: true }, 800, live);
    expect(l.drawerModal).toBe(true);
    expect(l.panelShowing).toBe(false);
    expect(l.railHeld).toBe(false);
  });
});

describe('toggleRail: the rail toggle while the panel shows', () => {
  const live = { liveOnSheet: true };
  const icons = { ...base, railWide: false, panelOpen: true };

  function press(state: ShellState, railOverride: boolean, width: number) {
    const showing = layoutOf(state, width, { ...live, railOverride }).panelShowing;
    const next = toggleRail(state, width, { panelShowing: showing, railOverride });
    const after = { ...state, railWide: next.railWide };
    return { after, override: next.railOverride, layout: layoutOf(after, width, { ...live, ...next }) };
  }

  it('with icons as the saved choice, the first press shows the names; the second hides them', () => {
    const first = press(icons, false, 1240);
    expect(first.layout.railShowsNames).toBe(true);
    const second = press(first.after, first.override, 1240);
    expect(second.layout.railShowsNames).toBe(false);
    expect(second.after.railWide).toBe(true);
    expect(second.override).toBe(false);
  });

  it('with names as the saved choice, the press overrides the hold without changing railWide', () => {
    const held = { ...icons, railWide: true };
    expect(layoutOf(held, 1240, { ...live, railOverride: false }).railShowsNames).toBe(false);
    const first = press(held, false, 1240);
    expect(first.layout.railShowsNames).toBe(true);
    expect(first.after.railWide).toBe(true);
  });

  it('a panel showing with icons chosen is not a hold', () => {
    expect(layoutOf(icons, 1240, { ...live, railOverride: false }).railHeld).toBe(false);
  });

  it('under 900px names never show; with no panel the toggle just flips railWide', () => {
    expect(press(icons, false, 899).layout.railShowsNames).toBe(false);
    const noPanel = { ...icons, panelOpen: false };
    expect(toggleRail(noPanel, 1240, { panelShowing: false, railOverride: false })).toEqual({
      railWide: true,
      railOverride: false,
    });
  });
});
