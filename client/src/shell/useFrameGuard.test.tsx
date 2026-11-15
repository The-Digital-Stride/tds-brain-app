// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFrameGuard } from './useFrameGuard.ts';

describe('useFrameGuard', () => {
  it('lets the first load through and stops the second for the same frame', () => {
    const { result } = renderHook(({ id }) => useFrameGuard(id), { initialProps: { id: 'a' } });
    expect(result.current.stopped).toBe(false);
    act(() => result.current.onLoad());
    expect(result.current.stopped).toBe(false);
    act(() => result.current.onLoad());
    expect(result.current.stopped).toBe(true);
  });

  it('counts afresh for a new frame id', () => {
    const { result, rerender } = renderHook(({ id }) => useFrameGuard(id), { initialProps: { id: 'a' } });
    act(() => result.current.onLoad());
    act(() => result.current.onLoad());
    expect(result.current.stopped).toBe(true);
    rerender({ id: 'b' });
    expect(result.current.stopped).toBe(false);
    act(() => result.current.onLoad());
    expect(result.current.stopped).toBe(false);
  });
});
