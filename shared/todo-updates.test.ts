import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  handBackTarget,
  isTodoLinkUrl,
  parseTodoHandovers,
  parseTodoUpdates,
  splitTodoSections,
  todoTimeline,
  ukWallToIso,
} from './todo-updates.ts';
import type { HandBackTarget, TodoUpdate } from './todo-updates-contract.ts';
import { TODO_LINK_URL_MAX } from './todo-updates-contract.ts';

interface Fixtures {
  updates: { name: string; body: string; entries: TodoUpdate[]; extras: string[] }[];
  handovers: { name: string; body: string; entries: TodoUpdate[] }[];
  timeline: { name: string; body: string; updates: TodoUpdate[]; extras: string[] }[];
  split: { name: string; body: string; details: string; handover: string; files: string; updates: string }[];
  linkUrl: { url: string; ok: boolean }[];
  ukWall: { date: string; time: string; iso: string | null }[];
}
const fixtures = JSON.parse(
  readFileSync(new URL('./todo-updates.fixtures.json', import.meta.url), 'utf8'),
) as Fixtures;

describe('task ## Updates log (shared fixtures)', () => {
  for (const c of fixtures.updates) {
    it(`updates: ${c.name}`, () =>
      expect(parseTodoUpdates(c.body)).toEqual({ entries: c.entries, extras: c.extras }));
  }
  for (const c of fixtures.handovers) {
    it(`handovers: ${c.name}`, () => expect(parseTodoHandovers(c.body)).toEqual(c.entries));
  }
  for (const c of fixtures.timeline) {
    it(`timeline: ${c.name}`, () =>
      expect(todoTimeline(c.body)).toEqual({ updates: c.updates, extras: c.extras }));
  }
  for (const c of fixtures.split) {
    it(`split: ${c.name}`, () =>
      expect(splitTodoSections(c.body)).toEqual({
        details: c.details,
        handover: c.handover,
        files: c.files,
        updates: c.updates,
      }));
  }
  for (const c of fixtures.linkUrl) {
    it(`link URL ${JSON.stringify(c.url)} is ${c.ok ? 'accepted' : 'refused'}`, () =>
      expect(isTodoLinkUrl(c.url)).toBe(c.ok));
  }
  for (const c of fixtures.ukWall) {
    it(`UK wall time ${c.date} ${c.time} → ${c.iso}`, () => expect(ukWallToIso(c.date, c.time)).toBe(c.iso));
  }
});

describe('isTodoLinkUrl limits', () => {
  it('takes a URL of exactly the limit and refuses one character more', () => {
    const base = 'https://example.com/';
    const atLimit = base + 'a'.repeat(TODO_LINK_URL_MAX - base.length);
    expect(isTodoLinkUrl(atLimit)).toBe(true);
    expect(isTodoLinkUrl(`${atLimit}a`)).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, ['https://example.com']]) {
      expect(isTodoLinkUrl(value as unknown as string)).toBe(false);
    }
  });
});

describe('ukWallToIso', () => {
  it('gives an ISO time that names the same instant as the UK wall clock', () => {
    const iso = ukWallToIso('2026-07-01', '23:30') as string;
    expect(new Date(iso).toISOString()).toBe('2026-07-01T22:30:00.000Z');
  });
});

describe('handBackTarget', () => {
  const team = [
    { slug: 'sam-example', name: 'Sam Example' },
    { slug: 'ben-mcadam', name: 'Ben McAdam' },
    { slug: 'ian-hancock', name: 'Ian Hancock' },
  ];
  const ben = { slug: 'ben-mcadam', name: 'Ben McAdam' };
  const ian = { slug: 'ian-hancock', name: 'Ian Hancock' };
  type Todo = Parameters<HandBackTarget>[0];
  const todo = (over: Partial<Todo>): Todo => ({
    scope: 'tds',
    assignee: 'sam-example',
    createdBy: 'ian-hancock',
    handover: { by: 'ben-mcadam' },
    ...over,
  });
  const cases: [string, Todo, { slug: string; name: string } | null][] = [
    ['the person who passed it on', todo({}), ben],
    ['who added it, when nobody passed it on', todo({ handover: null }), ian],
    ['who added it, when the pass-on names nobody', todo({ handover: { by: null } }), ian],
    ['nobody, when it was itself handed back', todo({ handover: { by: 'ben-mcadam', back: true } }), null],
    [
      'a pass-on that was not a hand back still counts',
      todo({ handover: { by: 'ben-mcadam', back: false } }),
      ben,
    ],
    ['nobody, when the holder picked it up themself', todo({ handover: { by: 'sam-example' } }), null],
    [
      'nobody, when the holder added it and nobody passed it',
      todo({ createdBy: 'sam-example', handover: null }),
      null,
    ],
    ['nobody, when nobody is known', todo({ createdBy: null, handover: null }), null],
    ['nobody, when that person is not on the team', todo({ handover: { by: 'someone-else' } }), null],
    ['nobody, when it is not assigned to me', todo({ assignee: 'ben-mcadam' }), null],
    ['nobody, when it is open', todo({ assignee: null }), null],
    ['nobody, for a personal task', todo({ scope: 'personal' }), null],
  ];
  it.each(cases)('%s', (_, t, expected) => expect(handBackTarget(t, 'sam-example', team)).toEqual(expected));
});
