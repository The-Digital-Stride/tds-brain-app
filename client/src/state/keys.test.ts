import { describe, expect, it } from 'vitest';
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

describe('keyAction: the to-dos search key', () => {
  it('leaves "/" to the to-dos drawer, which focuses its own search', () => {
    expect(keyAction(key('/'), ctx({ drawer: 'todos' }))).toBeNull();
  });
});
