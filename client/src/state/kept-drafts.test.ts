// @vitest-environment jsdom
// Unsent chats saved for later (the drawer's "Save for later"): the pure rules, then the store over localStorage.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEPT_DRAFTS_MAX,
  type KeptDraft,
  keptDraftKey,
  keptDrafts,
  keptDraftsKey,
  parseKept,
  sameAsKept,
  useJustKept,
  withKept,
  withoutKept,
} from './kept-drafts.ts';

const chat = (text: string, savedAt = '2026-11-26T10:00:00.000Z'): KeptDraft => ({
  text,
  picks: { project: 'acme/site', client: 'acme' },
  savedAt,
});

describe('keptDraftKey', () => {
  it("is the task for a task's chat, whatever its project", () => {
    expect(keptDraftKey({ todoId: 'a.md', project: 'acme/site' })).toBe('todo:a.md');
  });
  it("is the project for a project's chat, with the opener's own slot when it has one", () => {
    expect(keptDraftKey({ todoId: null, project: 'acme/site' })).toBe('project:acme/site');
    expect(keptDraftKey({ todoId: null, project: 'acme/site', slot: 'checklist' })).toBe(
      'project:acme/site#checklist',
    );
  });
  it('is null for a chat with neither: there is no button to come back by', () => {
    expect(keptDraftKey({ todoId: null })).toBeNull();
    expect(keptDraftKey({ todoId: null, project: null })).toBeNull();
  });
});

describe('parseKept', () => {
  it('reads what was written', () => {
    const all = { 'project:acme/site': chat('Hello') };
    expect(parseKept(JSON.stringify(all))).toEqual(all);
  });
  it('gives nothing for missing, broken or foreign data, and leaves out bad entries', () => {
    expect(parseKept(null)).toEqual({});
    expect(parseKept('{oops')).toEqual({});
    expect(parseKept('[1,2]')).toEqual({});
    expect(
      parseKept(
        JSON.stringify({
          good: chat('Kept'),
          empty: chat('   '),
          noText: { picks: null, savedAt: 'x' },
          badPicks: { text: 'Hi', picks: { project: 1 }, savedAt: 'x' },
        }),
      ),
    ).toEqual({ good: chat('Kept'), badPicks: { text: 'Hi', picks: null, savedAt: 'x' } });
  });
});

describe('withKept and withoutKept', () => {
  it('adds a chat, and saving again under the same key replaces it', () => {
    const one = withKept({}, 'k', chat('First'));
    expect(withKept(one, 'k', chat('Second'))).toEqual({ k: chat('Second') });
  });
  it('never mutates what it was given', () => {
    const one = { k: chat('First') };
    withKept(one, 'j', chat('Other'));
    withoutKept(one, 'k');
    expect(one).toEqual({ k: chat('First') });
  });
  it(`keeps the ${KEPT_DRAFTS_MAX} most recently saved, dropping the oldest`, () => {
    let all: Record<string, KeptDraft> = {};
    for (let i = 0; i < KEPT_DRAFTS_MAX + 2; i++)
      all = withKept(all, `k${i}`, chat(`Text ${i}`, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()));
    expect(Object.keys(all)).toHaveLength(KEPT_DRAFTS_MAX);
    expect(all.k0).toBeUndefined();
    expect(all.k1).toBeUndefined();
    expect(all[`k${KEPT_DRAFTS_MAX + 1}`]?.text).toBe(`Text ${KEPT_DRAFTS_MAX + 1}`);
  });
  it('removes one, and removing an unknown key changes nothing', () => {
    const all = { k: chat('First'), j: chat('Other') };
    expect(withoutKept(all, 'k')).toEqual({ j: chat('Other') });
    expect(withoutKept(all, 'zzz')).toBe(all);
  });
});

describe('sameAsKept', () => {
  const saved = chat('Half a thought');
  it('is true for the same words and picks (spaces at the ends aside)', () => {
    expect(sameAsKept(saved, '  Half a thought ', { project: 'acme/site', client: 'acme' })).toBe(true);
  });
  it('is true while the pickers have not been touched', () => {
    expect(sameAsKept(saved, 'Half a thought', null)).toBe(true);
  });
  it('is false once the words or either pick change', () => {
    expect(sameAsKept(saved, 'Half a thought more', null)).toBe(false);
    expect(sameAsKept(saved, 'Half a thought', { project: '', client: 'acme' })).toBe(false);
    expect(sameAsKept(saved, 'Half a thought', { project: 'acme/site', client: '@none' })).toBe(false);
  });
  it('is false with nothing saved', () => {
    expect(sameAsKept(null, 'Half a thought', null)).toBe(false);
  });
});

describe('the store over localStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    keptDrafts.use('sam');
    keptDrafts.reload();
  });
  afterEach(() => window.localStorage.clear());

  it('saves, reads back and drops, telling listeners each time', () => {
    let calls = 0;
    const stop = keptDrafts.subscribe(() => {
      calls += 1;
    });
    keptDrafts.save('project:acme/site', { text: ' Hello ', picks: null });
    expect(keptDrafts.get('project:acme/site')).toMatchObject({ text: 'Hello', picks: null });
    expect(JSON.parse(window.localStorage.getItem(keptDraftsKey('sam')) ?? '{}')).toHaveProperty([
      'project:acme/site',
    ]);
    keptDrafts.drop('project:acme/site');
    expect(keptDrafts.get('project:acme/site')).toBeNull();
    expect(calls).toBe(2);
    stop();
  });
  it('saving nothing but spaces drops the saved chat instead', () => {
    keptDrafts.save('k', { text: 'Hello', picks: null });
    keptDrafts.save('k', { text: '   ', picks: null });
    expect(keptDrafts.get('k')).toBeNull();
  });
  it('dropping a key that is not saved tells nobody', () => {
    let calls = 0;
    const stop = keptDrafts.subscribe(() => {
      calls += 1;
    });
    keptDrafts.drop('nope');
    expect(calls).toBe(0);
    stop();
  });
  it('survives a reload of the page (read again from localStorage)', () => {
    keptDrafts.save('k', { text: 'Still here', picks: { project: '', client: '@auto' } });
    keptDrafts.reload();
    expect(keptDrafts.get('k')).toMatchObject({
      text: 'Still here',
      picks: { project: '', client: '@auto' },
    });
  });
  it('each person sharing the browser has their own', () => {
    keptDrafts.save('k', { text: "Sam's words", picks: null });
    keptDrafts.use('alex');
    expect(keptDrafts.get('k')).toBeNull();
    keptDrafts.save('k', { text: "Alex's words", picks: null });
    keptDrafts.use('sam');
    expect(keptDrafts.get('k')?.text).toBe("Sam's words");
  });
  it('counts saves (for the spoken confirmation), not drops', () => {
    const before = keptDrafts.saves();
    keptDrafts.save('k', { text: 'Hello', picks: null });
    keptDrafts.drop('k');
    keptDrafts.save('k', { text: '  ', picks: null });
    expect(keptDrafts.saves()).toBe(before + 1);
  });
  describe('with another tab open', () => {
    /** What another tab would do: write its own copy straight to storage. */
    const otherTab = (all: Record<string, { text: string }>) => {
      const full = Object.fromEntries(
        Object.entries(all).map(([k, v]) => [k, { ...v, picks: null, savedAt: '2026-11-26T10:00:00.000Z' }]),
      );
      window.localStorage.setItem(keptDraftsKey('sam'), JSON.stringify(full));
    };
    const stored = () =>
      Object.keys(JSON.parse(window.localStorage.getItem(keptDraftsKey('sam')) ?? '{}')).sort();

    it('a save here keeps what the other tab saved', () => {
      expect(keptDrafts.get('project:a')).toBeNull();
      otherTab({ 'project:b': { text: 'From the other tab' } });
      keptDrafts.save('project:a', { text: 'From this tab', picks: null });
      expect(stored()).toEqual(['project:a', 'project:b']);
      expect(keptDrafts.get('project:b')?.text).toBe('From the other tab');
    });
    it('a drop here keeps what the other tab saved, and tells the buttons about it', () => {
      keptDrafts.save('project:a', { text: 'From this tab', picks: null });
      const heard = vi.fn();
      const off = keptDrafts.subscribe(heard);
      otherTab({ 'project:a': { text: 'From this tab' }, 'project:b': { text: 'From the other tab' } });
      // Dropping one that isn't there changes nothing of ours, but the other tab's message is new here.
      keptDrafts.drop('project:zzz');
      expect(heard).toHaveBeenCalledTimes(1);
      keptDrafts.drop('project:a');
      expect(stored()).toEqual(['project:b']);
      off();
    });
    it("the other tab's changes arrive on their own (the storage event)", () => {
      const heard = vi.fn();
      const off = keptDrafts.subscribe(heard);
      expect(keptDrafts.get('project:b')).toBeNull();
      otherTab({ 'project:b': { text: 'From the other tab' } });
      window.dispatchEvent(new StorageEvent('storage', { key: keptDraftsKey('sam') }));
      expect(heard).toHaveBeenCalledTimes(1);
      expect(keptDrafts.get('project:b')?.text).toBe('From the other tab');
      // Someone else's key, or the same text again, is no news.
      window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
      window.dispatchEvent(new StorageEvent('storage', { key: keptDraftsKey('sam') }));
      expect(heard).toHaveBeenCalledTimes(1);
      off();
      window.dispatchEvent(new StorageEvent('storage', { key: keptDraftsKey('sam') }));
    });
    it('a kept message is the same object between changes (a steady snapshot for React)', () => {
      keptDrafts.save('project:a', { text: 'Hello', picks: null });
      const first = keptDrafts.get('project:a');
      keptDrafts.drop('project:zzz');
      expect(keptDrafts.get('project:a')).toBe(first);
    });
  });

  it('carries on in memory when localStorage refuses', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('full');
    };
    try {
      keptDrafts.save('k', { text: 'Kept in memory', picks: null });
      expect(keptDrafts.get('k')?.text).toBe('Kept in memory');
    } finally {
      Storage.prototype.setItem = real;
    }
  });
  it('a write that failed is not the end of storage: the next change that gets through catches it up', () => {
    keptDrafts.save('y', { text: 'Already kept', picks: null });
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('full');
    };
    try {
      keptDrafts.save('x', { text: 'Kept in memory', picks: null });
    } finally {
      Storage.prototype.setItem = real;
    }
    // Storage is behind memory here, so it is not read over it, even when another tab has written since.
    const other = JSON.parse(window.localStorage.getItem(keptDraftsKey('sam')) ?? '{}');
    window.localStorage.setItem(keptDraftsKey('sam'), JSON.stringify({ ...other, z: other.y }));
    expect(keptDrafts.get('x')?.text).toBe('Kept in memory');
    // "y" is sent: the drop reaches storage, and takes "x" with it.
    keptDrafts.drop('y');
    expect(Object.keys(JSON.parse(window.localStorage.getItem(keptDraftsKey('sam')) ?? '{}'))).toEqual(['x']);
    keptDrafts.reload();
    expect(keptDrafts.get('y')).toBeNull();
    expect(keptDrafts.get('x')?.text).toBe('Kept in memory');
  });
});

describe('the spoken confirmation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    keptDrafts.use('sam');
    keptDrafts.reload();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('is on for a few seconds after a save, and not after a drop', () => {
    const { result } = renderHook(() => useJustKept(4000));
    expect(result.current).toBe(false);
    act(() => keptDrafts.save('k', { text: 'Hello', picks: null }));
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
    act(() => keptDrafts.drop('k'));
    expect(result.current).toBe(false);
  });
});
