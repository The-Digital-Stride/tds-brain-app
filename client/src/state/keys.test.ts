import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../../../shared/contract.ts';
import type { KeyLike, ShellState } from '../shell/contract.ts';
import { keyAction } from './keys.ts';
import { DEFAULT_SHELL } from './shell.ts';

const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const state = (patch: Partial<ShellState> = {}): ShellState => ({ ...DEFAULT_SHELL, ...patch });
const ctx = (patch: Partial<ShellState> = {}, typing = false) => ({ typing, state: state(patch) });

describe('keyAction: the file viewer', () => {
  const viewer = { item: { id: 'a' } as LibraryItem };

  it('Esc closes the viewer first, whatever else is open behind it', () => {
    expect(keyAction(key('Escape'), ctx({ viewer, drawer: 'todos' }))).toEqual({ type: 'close-viewer' });
    expect(
      keyAction(key('Escape'), {
        typing: false,
        state: state({ viewer, panelOpen: true }),
        panelFloating: true,
      }),
    ).toEqual({ type: 'close-viewer' });
    expect(keyAction(key('Escape'), ctx({ viewer }, true))).toEqual({ type: 'close-viewer' });
  });

  it('no other key reaches the desk behind it', () => {
    for (const k of ['[', 't', 'c', 's', '/']) expect(keyAction(key(k), ctx({ viewer }))).toBeNull();
    expect(keyAction(key('k', { metaKey: true }), ctx({ viewer }))).toBeNull();
    expect(keyAction(key('k', { ctrlKey: true }), ctx({ viewer }, true))).toBeNull();
  });
});

describe('keyAction: the palette', () => {
  it('Cmd+K and Ctrl+K open the palette, even while typing', () => {
    expect(keyAction(key('k', { metaKey: true }), ctx())).toEqual({ type: 'set-palette', open: true });
    expect(keyAction(key('k', { ctrlKey: true }), ctx({}, true))).toEqual({
      type: 'set-palette',
      open: true,
    });
    expect(keyAction(key('K', { metaKey: true }), ctx({}, true))).toEqual({
      type: 'set-palette',
      open: true,
    });
  });

  it('Cmd+K and Ctrl+K shut it again', () => {
    expect(keyAction(key('k', { metaKey: true }), ctx({ paletteOpen: true }))).toEqual({
      type: 'set-palette',
      open: false,
    });
    expect(keyAction(key('k', { ctrlKey: true }), ctx({ paletteOpen: true }, true))).toEqual({
      type: 'set-palette',
      open: false,
    });
  });

  it('a plain k does nothing to the palette', () => {
    expect(keyAction(key('k'), ctx())).toBeNull();
  });
});

describe('keyAction: Esc does one thing per press', () => {
  it('shuts the palette first, leaving the drawer open', () => {
    expect(keyAction(key('Escape'), ctx({ paletteOpen: true, drawer: 'todos' }))).toEqual({
      type: 'set-palette',
      open: false,
    });
  });

  it('then closes the drawer, even while typing in it', () => {
    expect(keyAction(key('Escape'), ctx({ drawer: 'todos' }))).toEqual({ type: 'close-drawer' });
    expect(keyAction(key('Escape'), ctx({ drawer: 'skills' }, true))).toEqual({ type: 'close-drawer' });
  });

  it('else does nothing', () => {
    expect(keyAction(key('Escape'), ctx())).toBeNull();
  });
});

describe('keyAction: single keys', () => {
  it('[, t, c and s move the rail and drawers', () => {
    expect(keyAction(key('['), ctx())).toEqual({ type: 'toggle-rail' });
    expect(keyAction(key('t'), ctx())).toEqual({ type: 'toggle-drawer', drawer: 'todos' });
    expect(keyAction(key('c'), ctx())).toEqual({ type: 'toggle-drawer', drawer: 'chats' });
    expect(keyAction(key('s'), ctx())).toEqual({ type: 'toggle-drawer', drawer: 'skills' });
  });

  it('caps lock still counts as the same letter', () => {
    expect(keyAction(key('T'), ctx())).toEqual({ type: 'toggle-drawer', drawer: 'todos' });
  });

  it('are ignored while typing', () => {
    for (const k of ['[', 't', 'c', 's']) expect(keyAction(key(k), ctx({}, true))).toBeNull();
  });

  it('are ignored with any modifier', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(keyAction(key('t', { [mod]: true }), ctx())).toBeNull();
      expect(keyAction(key('[', { [mod]: true }), ctx())).toBeNull();
    }
  });

  it('are ignored while the palette is open', () => {
    for (const k of ['[', 't', 'c', 's']) expect(keyAction(key(k), ctx({ paletteOpen: true }))).toBeNull();
  });

  it('are ignored when switched off', () => {
    for (const k of ['[', 't', 'c', 's']) expect(keyAction(key(k), ctx({ singleKeys: false }))).toBeNull();
  });

  it('other keys are left alone', () => {
    expect(keyAction(key('x'), ctx())).toBeNull();
    expect(keyAction(key('Enter'), ctx())).toBeNull();
  });
});

describe('keyAction: Esc and a floating panel', () => {
  const esc = key('Escape');
  it('closes a floating panel after the palette, before a pushing drawer', () => {
    const s = state({ drawer: 'todos', panelOpen: true });
    expect(keyAction(esc, { typing: false, state: s, panelFloating: true })).toEqual({
      type: 'set-panel',
      open: false,
    });
    expect(
      keyAction(esc, { typing: false, state: { ...s, paletteOpen: true }, panelFloating: true }),
    ).toEqual({ type: 'set-palette', open: false });
  });

  it('leaves a pushing panel open', () => {
    expect(
      keyAction(esc, { typing: false, state: state({ panelOpen: true }), panelFloating: false }),
    ).toBeNull();
    expect(keyAction(esc, ctx({ panelOpen: true }))).toBeNull();
  });
});

describe('keyAction: "/" opens the global search', () => {
  it('opens the palette from anywhere, with or without a drawer open', () => {
    const open = { type: 'set-palette', open: true };
    expect(keyAction(key('/'), ctx())).toEqual(open);
    expect(keyAction(key('/'), ctx({ drawer: 'todos' }))).toEqual(open);
    expect(keyAction(key('/'), ctx({ drawer: 'chats' }))).toEqual(open);
  });

  it('is left alone while typing, so it can be typed', () => {
    expect(keyAction(key('/'), ctx({}, true))).toBeNull();
  });

  it('works with Shift, where "/" is typed with it (German, French, Nordic keyboards)', () => {
    expect(keyAction(key('/', { shiftKey: true }), ctx())).toEqual({ type: 'set-palette', open: true });
    expect(keyAction(key('/', { shiftKey: true }), ctx({}, true))).toBeNull();
    expect(keyAction(key('/', { shiftKey: true }), ctx({ singleKeys: false }))).toBeNull();
  });

  it('is ignored with Cmd, Ctrl or Alt, while the palette is open, and when single keys are off', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      expect(keyAction(key('/', { [mod]: true }), ctx())).toBeNull();
    }
    expect(keyAction(key('/'), ctx({ paletteOpen: true }))).toBeNull();
    expect(keyAction(key('/'), ctx({ singleKeys: false }))).toBeNull();
  });
});
