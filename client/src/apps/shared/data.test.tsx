// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoaded } from './data.ts';

vi.mock('../../store.tsx', () => ({ useStore: () => ({ libraryVersion: 0, boot: null }) }));
vi.mock('../../api.ts', () => ({ api: {} }));

afterEach(cleanup);

describe('useLoaded', () => {
  it('goes from loading to ready', async () => {
    const load = vi.fn().mockResolvedValue('answer');
    const { result } = renderHook(() => useLoaded('k', 0, load));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe('answer');
  });

  it('fails with the message, and retry loads again from loading', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Not reachable.')).mockResolvedValue('ok');
    const { result } = renderHook(() => useLoaded('k', 0, load));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.message).toBe('Not reachable.');
    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('a new version fetches again without going back to loading, and a failed refresh keeps the old answer', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce('one')
      .mockResolvedValueOnce('two')
      .mockRejectedValueOnce(new Error('x'));
    const { result, rerender } = renderHook(({ v }) => useLoaded('k', v, load), { initialProps: { v: 0 } });
    await waitFor(() => expect(result.current.data).toBe('one'));
    rerender({ v: 1 });
    expect(result.current.status).toBe('ready');
    await waitFor(() => expect(result.current.data).toBe('two'));
    rerender({ v: 2 });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(result.current.data).toBe('two');
  });

  it('a new key starts again from loading, so another library’s files never show', async () => {
    const load = vi.fn().mockImplementation(async () => 'x');
    const { result, rerender } = renderHook(({ k }) => useLoaded(k, 0, load), {
      initialProps: { k: 'a' as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ k: 'b' });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('loads nothing for a null key', () => {
    const load = vi.fn();
    const { result } = renderHook(() => useLoaded(null, 0, load));
    expect(result.current.status).toBe('loading');
    expect(load).not.toHaveBeenCalled();
  });
});
