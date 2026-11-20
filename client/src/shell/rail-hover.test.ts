import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHELL, shellReducer } from '../state/shell.ts';
import { createRailHover, HOVER_CLOSE_MS, HOVER_OPEN_MS } from './rail-hover.ts';

function make() {
  const changes: boolean[] = [];
  const hover = createRailHover({ onChange: (v) => changes.push(v) });
  return { hover, changes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('rail hover expand', () => {
  it('uses 200 ms to open and 150 ms to close', () => {
    expect(HOVER_OPEN_MS).toBe(200);
    expect(HOVER_CLOSE_MS).toBe(150);
  });

  it('opens after 200 ms, not before', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(199);
    expect(hover.isExpanded()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hover.isExpanded()).toBe(true);
  });

  it('does nothing when the pointer only passes across', () => {
    const { hover, changes } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(100);
    hover.pointerLeave();
    vi.advanceTimersByTime(1000);
    expect(hover.isExpanded()).toBe(false);
    expect(changes).toEqual([]);
  });

  it('stays open while pointed at, even past the close delay', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    hover.pointerLeave();
    vi.advanceTimersByTime(100);
    hover.pointerEnter('mouse'); // a wobble back in
    vi.advanceTimersByTime(5000);
    expect(hover.isExpanded()).toBe(true);
  });

  it('closes 150 ms after the pointer leaves', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    hover.pointerLeave();
    vi.advanceTimersByTime(149);
    expect(hover.isExpanded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hover.isExpanded()).toBe(false);
  });

  it('opens at once when keyboard focus moves in, and closes when focus leaves', () => {
    const { hover } = make();
    hover.focusIn();
    expect(hover.isExpanded()).toBe(true);
    hover.focusOut();
    expect(hover.isExpanded()).toBe(false);
  });

  it('Escape closes it, and it stays shut until the pointer leaves and returns', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    hover.escape();
    expect(hover.isExpanded()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(hover.isExpanded()).toBe(false);
    hover.pointerLeave();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    expect(hover.isExpanded()).toBe(true);
  });

  it('closes at once when an item is chosen, and stays shut until the pointer returns', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    hover.choose();
    expect(hover.isExpanded()).toBe(false);
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(1000);
    expect(hover.isExpanded()).toBe(false);
  });

  it('collapse shuts it without dismissing, so the next rest still opens it (a pop-up came and went)', () => {
    const { hover } = make();
    hover.collapse();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(hover.isExpanded()).toBe(true);
    hover.collapse();
    expect(hover.isExpanded()).toBe(false);
  });

  it('collapse cancels a pending open', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    hover.collapse();
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(hover.isExpanded()).toBe(false);
  });

  it('opens for a mouse or a pen, never for touch', () => {
    for (const type of ['mouse', 'pen']) {
      const { hover } = make();
      hover.pointerEnter(type);
      vi.advanceTimersByTime(200);
      expect(hover.isExpanded()).toBe(true);
    }
    const { hover, changes } = make();
    hover.pointerEnter('touch');
    vi.advanceTimersByTime(1000);
    expect(hover.isExpanded()).toBe(false);
    expect(changes).toEqual([]);
  });

  it('says how it opened, so Escape knows whether to stop there', () => {
    const { hover } = make();
    expect(hover.openedBy()).toBeNull();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    expect(hover.openedBy()).toBe('pointer');
    hover.focusIn();
    expect(hover.openedBy()).toBe('focus');
    hover.focusOut();
    expect(hover.openedBy()).toBeNull();
  });

  it('reports each change once', () => {
    const { hover, changes } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    hover.focusIn();
    hover.pointerLeave();
    vi.advanceTimersByTime(150);
    hover.focusOut();
    expect(changes).toEqual([true, false]);
  });

  it('dispose cancels pending timers', () => {
    const { hover, changes } = make();
    hover.pointerEnter('mouse');
    hover.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
  });

  it('leaves the saved preference alone: it has no way to reach the shell state', () => {
    const { hover } = make();
    hover.pointerEnter('mouse');
    vi.advanceTimersByTime(200);
    const after = shellReducer({ ...DEFAULT_SHELL, railWide: false }, { type: 'close-drawer' });
    expect(after.railWide).toBe(false);
    expect(hover.isExpanded()).toBe(true);
  });
});
