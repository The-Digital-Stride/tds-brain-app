import { describe, expect, it } from 'vitest';
import type { AskedTodo, TodoActor, TodoHandover, TodoItem } from './contract.ts';
import {
  type ChangeSubject,
  entryKey,
  fitLooked,
  isLookedMark,
  lookedMark,
  othersEntries,
  pruneLooked,
  TODO_CHANGED_DAYS,
  TODO_LOOKED_KEEP_DAYS,
  TODO_LOOKED_KEY_LENGTH,
  TODO_LOOKED_KEYS_MAX,
  TODO_LOOKED_MAX,
  type TodoLooked,
  todoChange,
} from './todo-changes.ts';
import type { TodoUpdate } from './todo-updates-contract.ts';

const ME = { slug: 'sam-example', name: 'Sam Example' };
const NOW = new Date('2026-12-01T12:00:00Z');

const note = (at: string, by: string, text = 'A note.'): TodoUpdate => ({
  kind: 'note',
  at,
  by,
  byName: by === ME.slug ? ME.name : 'Alex Sample',
  text,
  via: null,
  action: 'update',
});
const auto = (at: string, by: string): TodoUpdate => ({
  kind: 'auto',
  at,
  by,
  byName: by === ME.slug ? ME.name : 'Alex Sample',
  text: 'changed the due date to 3 Dec 2026',
  via: 'TDS Cortex',
  action: 'due',
});
const pass = (at: string, byName: string, text: string, by: string | null = null): TodoUpdate => ({
  kind: 'handover',
  at,
  by,
  byName,
  text,
  via: 'TDS Cortex',
  action: /^handed it back/.test(text) ? 'handback' : 'assignee',
});
const handover = (at: string): TodoHandover => ({
  by: 'alex-sample',
  byName: 'Alex Sample',
  at,
  from: 'alex-sample',
  via: 'TDS Cortex',
  source: 'stamp',
});
const actor = (slug: string, at: string): TodoActor => ({
  slug,
  name: slug === ME.slug ? ME.name : 'Alex Sample',
  at,
  source: 'stamp',
});

const held = (updates: TodoUpdate[], more: Partial<TodoItem> = {}): ChangeSubject => ({
  kind: 'held',
  todo: { id: 'a.md', scope: 'tds', updates, handover: null, ...more },
});
const asked = (updates: TodoUpdate[], more: Partial<AskedTodo> = {}): ChangeSubject => ({
  kind: 'asked',
  todo: {
    id: 'a.md',
    state: 'waiting',
    updates,
    done: null,
    asked: actor(ME.slug, '2026-11-28T09:00:00+00:00'),
    ...more,
  },
});

describe('todoChange: a task you hold', () => {
  it('is changed by a teammate’s entry you have not seen, newest first', () => {
    const subject = held([
      note('2026-11-30T10:00:00+00:00', 'alex-sample', 'First.'),
      auto('2026-11-30T11:00:00+00:00', 'alex-sample'),
    ]);
    const change = todoChange(subject, ME, undefined, NOW);
    expect(change?.count).toBe(2);
    expect(change?.entries.map((e) => e.kind)).toEqual(['auto', 'note']);
    expect(change?.at).toBe('2026-11-30T11:00:00+00:00');
    expect(change?.finished).toBeNull();
  });

  it('never counts your own entries', () => {
    expect(todoChange(held([note('2026-11-30T10:00:00+00:00', ME.slug)]), ME, undefined, NOW)).toBeNull();
  });

  it('never counts a personal task, or a task with no log', () => {
    const personal = held([note('2026-11-30T10:00:00+00:00', 'alex-sample')], { scope: 'personal' });
    expect(todoChange(personal, ME, undefined, NOW)).toBeNull();
    expect(
      todoChange({ kind: 'held', todo: { id: 'a.md', scope: 'tds', handover: null } }, ME, undefined, NOW),
    ).toBeNull();
  });

  it('is not changed once looked at, and is again when one more entry arrives in the same minute', () => {
    const first = note('2026-11-30T10:00:00+00:00', 'alex-sample', 'One.');
    const before = held([first]);
    const mark = lookedMark(before, ME, NOW);
    expect(mark).toEqual({ keys: [entryKey(first)], seen: NOW.toISOString() });
    expect(todoChange(before, ME, mark, NOW)).toBeNull();
    const after = held([first, note('2026-11-30T10:00:00+00:00', 'alex-sample', 'Two.')]);
    const change = todoChange(after, ME, mark, NOW);
    expect(change?.count).toBe(1);
    expect(change?.entries[0]?.text).toBe('Two.');
  });

  // Overseer pre-review: a count tagged the entry already read.
  it('an older entry a sync slots in late is the one shown as new, not the newer one already read', () => {
    const read = note('2026-11-30T14:05:00+00:00', 'alex-sample', 'Read already.');
    const mark = lookedMark(held([read]), ME, NOW);
    const late = note('2026-11-30T13:00:00+00:00', 'jo-other', 'Arrived late.');
    const change = todoChange(held([late, read]), ME, mark, NOW);
    expect(change?.entries.map((e) => e.text)).toEqual(['Arrived late.']);
  });

  it('your own later entry does not hide a teammate’s unseen one, and does not make one', () => {
    const mark = lookedMark(held([]), ME, NOW);
    expect(todoChange(held([note('2026-11-30T10:00:00+00:00', ME.slug)]), ME, mark, NOW)).toBeNull();
    const both = held([
      note('2026-11-30T10:00:00+00:00', 'alex-sample', 'Theirs.'),
      note('2026-11-30T11:00:00+00:00', ME.slug, 'Mine.'),
    ]);
    expect(todoChange(both, ME, mark, NOW)?.entries.map((e) => e.text)).toEqual(['Theirs.']);
  });

  it('only counts what happened after the task came to you, and not the pass-on that brought it', () => {
    const subject = held(
      [
        note('2026-11-29T09:00:00+00:00', 'alex-sample', 'Before it was passed on.'),
        pass('2026-11-30T10:00:00+00:00', 'Alex Sample', 'passed it from alex-sample to sam-example'),
        note('2026-11-30T10:00:00+00:00', 'alex-sample', 'Sent with the pass-on.'),
        note('2026-11-30T14:00:00+00:00', 'alex-sample', 'Later.'),
      ],
      { handover: handover('2026-11-30T10:00:42+00:00') },
    );
    expect(othersEntries(subject, ME, NOW).map((e) => e.text)).toEqual(['Later.', 'Sent with the pass-on.']);
  });

  it(`drops a change older than ${TODO_CHANGED_DAYS} days, even with no marker`, () => {
    const old = held([note('2026-11-20T10:00:00+00:00', 'alex-sample')]);
    expect(todoChange(old, ME, undefined, NOW)).toBeNull();
    const edge = held([note('2026-11-24T12:00:00+00:00', 'alex-sample')]);
    expect(todoChange(edge, ME, undefined, NOW)?.count).toBe(1);
  });

  it('an entry with a time that can’t be read is never news', () => {
    expect(todoChange(held([note('not a time', 'alex-sample')]), ME, undefined, NOW)).toBeNull();
  });

  it('a handover line is yours by its slug when the server matched one, else by its written name', () => {
    // Written under a git name, but the server matched it to you.
    const matched = pass('2026-11-30T10:00:00+00:00', 'Sam', 'passed it from open to sam-example', ME.slug);
    expect(todoChange(held([matched]), ME, undefined, NOW)).toBeNull();
    const byName = pass('2026-11-30T10:00:00+00:00', ME.name, 'passed it from open to sam-example');
    expect(todoChange(held([byName]), ME, undefined, NOW)).toBeNull();
    const theirs = pass('2026-11-30T10:00:00+00:00', 'Alex Sample', 'passed it from open to sam-example');
    expect(todoChange(held([theirs]), ME, undefined, NOW)?.count).toBe(1);
  });
});

describe('todoChange: a task you asked someone to do', () => {
  it('counts what others did after you passed it on, and nothing from before', () => {
    const subject = asked([
      note('2026-11-27T10:00:00+00:00', 'alex-sample', 'Before you asked.'),
      pass('2026-11-28T09:00:00+00:00', ME.name, 'passed it from sam-example to alex-sample'),
      note('2026-11-30T10:00:00+00:00', 'alex-sample', 'Since you asked.'),
    ]);
    const change = todoChange(subject, ME, undefined, NOW);
    expect(change?.entries.map((e) => e.text)).toEqual(['Since you asked.']);
  });

  // Overseer pre-review: right after a hand back the row said "3 new", all old.
  it('right after you hand a task back, nothing the other person wrote before is news', () => {
    const theirs = [
      note('2026-11-29T10:00:00+00:00', 'alex-sample', 'Brief.'),
      pass('2026-11-29T10:00:00+00:00', 'Alex Sample', 'passed it from alex-sample to sam-example'),
      auto('2026-11-30T09:00:00+00:00', 'alex-sample'),
      note('2026-11-30T09:30:00+00:00', 'alex-sample', 'Any news?'),
    ];
    // You read them all as its holder.
    const holding = held(theirs, { handover: handover('2026-11-29T10:00:10+00:00') });
    const mark = lookedMark(holding, ME, NOW);
    expect(mark.keys).toHaveLength(4);
    // Then you hand it back: now it is in your Asked list.
    const back = pass('2026-12-01T11:00:00+00:00', ME.name, 'handed it back to alex-sample');
    const now = asked([...theirs, back], {
      asked: actor(ME.slug, '2026-12-01T11:00:20+00:00'),
      handedBack: true,
    });
    expect(todoChange(now, ME, mark, NOW)).toBeNull();
    // Even with no marker at all, the cut holds.
    expect(todoChange(now, ME, undefined, NOW)).toBeNull();
  });

  it('on a task you handed back, a note is news and an automatic line or pass-on is not', () => {
    const subject = asked(
      [
        auto('2026-12-01T11:30:00+00:00', 'alex-sample'),
        pass('2026-12-01T11:40:00+00:00', 'Alex Sample', 'passed it from alex-sample to jo-other'),
        note('2026-12-01T11:45:00+00:00', 'alex-sample', 'Thanks, all good.'),
      ],
      { asked: actor(ME.slug, '2026-12-01T11:00:00+00:00'), handedBack: true },
    );
    expect(todoChange(subject, ME, undefined, NOW)?.entries.map((e) => e.text)).toEqual([
      'Thanks, all good.',
    ]);
  });

  it('is changed when someone else finishes it, once', () => {
    const done = actor('alex-sample', '2026-12-01T09:30:00+00:00');
    const subject = asked([], { state: 'done', done });
    const change = todoChange(subject, ME, undefined, NOW);
    expect(change).toEqual({
      entries: [],
      finished: { at: done.at, byName: 'Alex Sample' },
      count: 1,
      at: done.at,
    });
    const mark = lookedMark(subject, ME, NOW);
    expect(mark.done).toBe(true);
    expect(todoChange(subject, ME, mark, NOW)).toBeNull();
  });

  it('a note sent with the finish counts as well, and the finish is the newest', () => {
    const done = actor('alex-sample', '2026-12-01T09:30:20+00:00');
    const subject = asked([note('2026-12-01T09:30:00+00:00', 'alex-sample', 'All sent.')], {
      state: 'done',
      done,
    });
    const change = todoChange(subject, ME, undefined, NOW);
    expect(change?.count).toBe(2);
    expect(change?.at).toBe(done.at);
  });

  it('finishing it yourself, or long ago, is not news', () => {
    const mine = actor(ME.slug, '2026-12-01T09:30:00+00:00');
    expect(todoChange(asked([], { state: 'done', done: mine }), ME, undefined, NOW)).toBeNull();
    const old = actor('alex-sample', '2026-11-01T09:30:00+00:00');
    expect(todoChange(asked([], { state: 'done', done: old }), ME, undefined, NOW)).toBeNull();
  });
});

describe('markers', () => {
  it('entryKey is the same for the same entry and differs when anything a person sees differs', () => {
    const a = note('2026-11-30T10:00:00+00:00', 'alex-sample', 'One.');
    expect(entryKey(a)).toBe(entryKey({ ...a }));
    expect(entryKey(a)).toMatch(/^[0-9a-z]+$/);
    expect(entryKey(a)).toHaveLength(TODO_LOOKED_KEY_LENGTH);
    const others = [
      { ...a, text: 'Two.' },
      { ...a, at: '2026-11-30T10:01:00+00:00' },
      { ...a, by: 'jo-other' },
      { ...a, kind: 'auto' as const },
    ];
    expect(new Set([a, ...others].map(entryKey)).size).toBe(5);
  });

  it('a marker holds every recent entry by others, whatever your role, newest first, and no more than the limit', () => {
    const many = Array.from({ length: TODO_LOOKED_KEYS_MAX + 5 }, (_, i) =>
      note(`2026-11-30T10:${String(i % 60).padStart(2, '0')}:00+00:00`, 'alex-sample', `Note ${i}.`),
    );
    const mark = lookedMark(held(many, { handover: handover('2026-11-30T23:00:00+00:00') }), ME, NOW);
    expect(mark.keys).toHaveLength(TODO_LOOKED_KEYS_MAX);
    expect(isLookedMark(mark)).toBe(true);
    const old = lookedMark(held([note('2026-11-01T10:00:00+00:00', 'alex-sample')]), ME, NOW);
    expect(old.keys).toEqual([]);
  });

  it(`pruneLooked drops markers older than ${TODO_LOOKED_KEEP_DAYS} days and unreadable ones`, () => {
    const looked: TodoLooked = {
      'new.md': { keys: [], seen: '2026-11-30T10:00:00.000Z' },
      'old.md': { keys: [], seen: '2026-10-01T10:00:00.000Z' },
      'bad.md': { keys: [], seen: 'nope' },
    };
    expect(Object.keys(pruneLooked(looked, NOW))).toEqual(['new.md']);
  });

  it('fitLooked keeps the markers looked at most recently', () => {
    const looked: TodoLooked = {};
    for (let i = 0; i < TODO_LOOKED_MAX + 3; i++) {
      looked[`t${i}.md`] = { keys: [], seen: new Date(NOW.getTime() - i * 60_000).toISOString() };
    }
    const fitted = fitLooked(looked);
    expect(Object.keys(fitted)).toHaveLength(TODO_LOOKED_MAX);
    expect(fitted['t0.md']).toBeDefined();
    expect(fitted[`t${TODO_LOOKED_MAX + 2}.md`]).toBeUndefined();
    const small: TodoLooked = { 'a.md': { keys: [], seen: NOW.toISOString() } };
    expect(fitLooked(small)).toBe(small);
  });

  it('isLookedMark accepts the shape and refuses anything else', () => {
    const key = entryKey(note('2026-11-30T10:00:00+00:00', 'alex-sample'));
    const good = { keys: [key], seen: '2026-11-30T10:00:00.000Z' };
    expect(isLookedMark(good)).toBe(true);
    expect(isLookedMark({ ...good, keys: [], done: true })).toBe(true);
    for (const bad of [
      null,
      [],
      'x',
      { ...good, keys: 'abc' },
      { ...good, keys: ['short'] },
      { ...good, keys: ['<script>xx'] },
      { ...good, keys: [1] },
      { ...good, keys: Array.from({ length: TODO_LOOKED_KEYS_MAX + 1 }, () => key) },
      { ...good, done: false },
      { ...good, seen: 'nope' },
      { ...good, extra: 1 },
      { keys: [] },
    ]) {
      expect(isLookedMark(bad)).toBe(false);
    }
  });
});
