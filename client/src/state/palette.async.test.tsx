// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit, SearchResults, SearchSource } from '../shell/contract.ts';
import { ASYNC_DEBOUNCE_MS, ASYNC_RETRIES, ASYNC_RETRY_MS, useAsyncSearch } from './palette.ts';

const hit = (id: string): SearchHit => ({ id, label: id, hint: null, icon: 'doc', run: () => {} });
const results = (ids: string[], partial = false): SearchResults => ({
  hits: ids.map(hit),
  total: ids.length,
  partial,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => act(async () => {});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useAsyncSearch', () => {
  it('waits for the debounce before asking, and not at all for one character', async () => {
    const searchAsync = vi.fn(async () => results(['d1']));
    const sources: SearchSource[] = [{ id: 'docs', title: 'Docs', searchAsync }];
    const { rerender } = renderHook(({ q }) => useAsyncSearch(sources, q), { initialProps: { q: 'a' } });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(searchAsync).not.toHaveBeenCalled();
    rerender({ q: 'ab' });
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS - 1));
    expect(searchAsync).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(searchAsync).toHaveBeenCalledTimes(1);
    expect(searchAsync).toHaveBeenCalledWith('ab', expect.any(AbortSignal));
  });

  it('asks once for a burst of typing, and aborts what the next keystroke makes stale', async () => {
    const signals: AbortSignal[] = [];
    const searchAsync = vi.fn(async (_q: string, signal: AbortSignal) => {
      signals.push(signal);
      return results(['d1']);
    });
    const sources: SearchSource[] = [{ id: 'docs', title: 'Docs', searchAsync }];
    const { rerender } = renderHook(({ q }) => useAsyncSearch(sources, q), { initialProps: { q: 'ab' } });
    await act(async () => vi.advanceTimersByTime(100));
    rerender({ q: 'abc' });
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS));
    expect(searchAsync).toHaveBeenCalledTimes(1);
    expect(searchAsync.mock.calls[0]?.[0]).toBe('abc');
    rerender({ q: 'abcd' });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('drops an answer that arrives after the query changed', async () => {
    const first = deferred<SearchResults>();
    const searchAsync = vi
      .fn<(q: string, s: AbortSignal) => Promise<SearchResults>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(results(['new']));
    const sources: SearchSource[] = [{ id: 'docs', title: 'Docs', searchAsync }];
    const { result, rerender } = renderHook(({ q }) => useAsyncSearch(sources, q), {
      initialProps: { q: 'ab' },
    });
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS));
    rerender({ q: 'abc' });
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS));
    await settle();
    expect(result.current.docs?.query).toBe('abc');
    // The slow first answer finally lands: it must not replace the newer one.
    await act(async () => first.resolve(results(['old'])));
    expect(result.current.docs?.query).toBe('abc');
    expect(result.current.docs?.results?.hits.map((h) => h.id)).toEqual(['new']);
  });

  it('asks a partial answer again every second, up to five more times, then stops', async () => {
    const searchAsync = vi.fn(async () => results(['d1'], true));
    const sources: SearchSource[] = [{ id: 'docs', title: 'Docs', searchAsync }];
    const { result } = renderHook(() => useAsyncSearch(sources, 'ab'));
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS));
    await settle();
    expect(searchAsync).toHaveBeenCalledTimes(1);
    expect(result.current.docs?.looking).toBe(true);
    for (let i = 1; i <= ASYNC_RETRIES; i++) {
      await act(async () => vi.advanceTimersByTime(ASYNC_RETRY_MS));
      expect(searchAsync).toHaveBeenCalledTimes(1 + i);
    }
    expect(result.current.docs?.looking).toBe(false);
    await act(async () => vi.advanceTimersByTime(ASYNC_RETRY_MS * 3));
    expect(searchAsync).toHaveBeenCalledTimes(1 + ASYNC_RETRIES);
  });

  it('stops retrying once the answer is complete, and when the query changes', async () => {
    const searchAsync = vi
      .fn<(q: string, s: AbortSignal) => Promise<SearchResults>>()
      .mockResolvedValueOnce(results([], true))
      .mockResolvedValue(results(['d1'], false));
    const sources: SearchSource[] = [{ id: 'docs', title: 'Docs', searchAsync }];
    const { result } = renderHook(() => useAsyncSearch(sources, 'ab'));
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS));
    await act(async () => vi.advanceTimersByTime(ASYNC_RETRY_MS));
    expect(searchAsync).toHaveBeenCalledTimes(2);
    expect(result.current.docs).toMatchObject({ looking: false });
    await act(async () => vi.advanceTimersByTime(ASYNC_RETRY_MS * 3));
    expect(searchAsync).toHaveBeenCalledTimes(2);
  });

  it('treats a failed search as no answer, and leaves other sources alone', async () => {
    const sources: SearchSource[] = [
      { id: 'bad', title: 'Bad', searchAsync: async () => Promise.reject(new Error('down')) },
      { id: 'good', title: 'Good', searchAsync: async () => results(['g1']) },
    ];
    const { result } = renderHook(() => useAsyncSearch(sources, 'ab'));
    await act(async () => vi.advanceTimersByTime(ASYNC_DEBOUNCE_MS));
    await settle();
    expect(result.current.bad).toEqual({ query: 'ab', results: null, looking: false });
    expect(result.current.good?.results?.hits).toHaveLength(1);
  });
});
