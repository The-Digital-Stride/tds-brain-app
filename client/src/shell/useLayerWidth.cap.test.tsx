// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The hook reads the saved width from the shell and the window width from the desk: both stand-ins here.
const shell = { state: { chatDrawerWidth: null as number | null, viewerWidth: null }, dispatch: vi.fn() };
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => shell,
  useDesk: () => ({ width: 1440 }),
}));

const { maxBesideContent, useLayerWidth } = await import('./useLayerWidth.ts');

describe('useLayerWidth with a session cap (Save to project beside Projects)', () => {
  const sheet = 1370;
  const cap = maxBesideContent(sheet);
  beforeEach(() => {
    shell.state.chatDrawerWidth = null;
    shell.dispatch.mockReset();
  });

  it('the handle can go no wider than the cap, and a drag or End past it saves the cap, not more', () => {
    const { result } = renderHook(() => useLayerWidth('chat', sheet, cap));
    expect(result.current.max).toBe(cap);
    act(() => result.current.commit(sheet - 24));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-chat-drawer-width', width: cap });
  });

  it('shows a saved width wider than the cap at the cap, inline, without saving anything', () => {
    shell.state.chatDrawerWidth = 1000;
    const { result } = renderHook(() => useLayerWidth('chat', sheet, cap));
    expect(result.current.width).toBe(cap);
    expect(result.current.style).toEqual({ width: cap });
    expect(shell.dispatch).not.toHaveBeenCalled();
  });

  it('caps the default width too when the cap is narrower than it', () => {
    const narrow = 980; // cap = 380 (the narrowest), under the 520 default
    const { result } = renderHook(() => useLayerWidth('chat', narrow, maxBesideContent(narrow)));
    expect(result.current.width).toBe(380);
    expect(result.current.style).toEqual({ width: 380 });
  });

  it('without a cap (a tool), behaves as before: the saved width, the full limits', () => {
    shell.state.chatDrawerWidth = 1000;
    const { result } = renderHook(() => useLayerWidth('chat', sheet));
    expect(result.current.width).toBe(1000);
    // The sheet's width less the 12px the drawer keeps on its left.
    expect(result.current.max).toBe(sheet - 12);
    act(() => result.current.commit(1300));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-chat-drawer-width', width: 1300 });
  });
});
