// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type AppPrefs, DEFAULT_PREFS } from '../../../shared/contract.ts';
import { prefStamp, usePrefList } from './pref-list.ts';

/** A save the test settles by hand. */
function deferred() {
  let resolve!: (p: AppPrefs) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<AppPrefs>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePrefList keepBoot', () => {
  it('a stale bootstrap landing mid-save never becomes the saved list a failure falls back to', async () => {
    const saves: ReturnType<typeof deferred>[] = [];
    const save = vi.fn(() => {
      const d = deferred();
      saves.push(d);
      return d.promise;
    });
    const shown: string[][] = [];
    const { result } = renderHook(() =>
      usePrefList({
        field: 'homeHidden',
        current: [],
        save,
        show: (_f, list) => shown.push([...list]),
        onError: () => {},
      }),
    );

    // 1. A bootstrap begins (it reads the list as [] on the server).
    const begun = prefStamp();
    // 2. Hide Pinned files; the server confirms it.
    let first!: Promise<void>;
    act(() => {
      first = result.current.set((l) => [...l, 'files']);
    });
    await act(async () => {
      saves[0]?.resolve({ ...DEFAULT_PREFS, homeHidden: ['files'] });
      await first;
    });
    // 3. Hide Meetings; that save is still waiting.
    let second!: Promise<void>;
    act(() => {
      second = result.current.set((l) => [...l, 'meetings']);
    });
    // 4. The old bootstrap lands with the list it read before both changes.
    const kept = result.current.keepBoot({ ...DEFAULT_PREFS, homeHidden: [] }, begun);
    expect(kept.homeHidden).toEqual(['files', 'meetings']);
    // 5. The Meetings save fails: the list falls back to what the server confirmed, not the bootstrap's stale [].
    await act(async () => {
      saves[1]?.reject(new Error('offline'));
      await second;
    });
    expect(shown.at(-1)).toEqual(['files']);
  });
});
