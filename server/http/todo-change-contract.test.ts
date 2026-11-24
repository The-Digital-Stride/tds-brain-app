// @vitest-environment jsdom
/**
 * The task changes the browser really builds, through the server's real request check. Client tests mock the
 * API and route tests hand-write their bodies, so a field only one side knew (`detailsOnly`, 2026-11-20) failed
 * every Save and tick in the panel while every other test passed.
 */
import { describe, expect, it } from 'vitest';
import { buildEditActions, type EditDraft } from '../../client/src/shell/TodoForms.tsx';
import type { TodoItem } from '../../shared/contract.ts';
import { parseTodoAction } from './routes.ts';

const todo: TodoItem = {
  key: '20261115-calendar.md',
  id: '20261115-calendar.md',
  scope: 'tds',
  title: 'Calendar overview on the homepage for Cortex.',
  details: 'Introduce cards.\n\n- [ ] Install calendar',
  due: '2026-11-20',
  assignee: 'sam-example',
  version: 'a'.repeat(64),
} as TodoItem;

const draftOf = (t: TodoItem): EditDraft => {
  const base = {
    title: t.title,
    details: t.details,
    due: t.due ?? '',
    assignee: t.assignee ?? '',
    scope: t.scope,
  };
  return { ...base, version: t.version, base };
};

/** Each request as it goes over the wire (JSON drops undefined), checked by the route. */
const sent = (actions: ReturnType<typeof buildEditActions>) =>
  actions.map((a) => parseTodoAction(JSON.parse(JSON.stringify(a))));

describe('task changes from the panel pass the route check', () => {
  for (const canAttach of [false, true]) {
    describe(canAttach ? 'with files on' : 'with files off', () => {
      it('a tick in the details', () => {
        const draft = { ...draftOf(todo), details: 'Introduce cards.\n\n- [x] Install calendar' };
        const actions = buildEditActions(todo, draft, true, canAttach);
        expect(actions.length).toBe(1);
        expect(() => sent(actions)).not.toThrow();
      });

      it('title, details, date, place and person changed in one save', () => {
        const draft: EditDraft = {
          ...draftOf(todo),
          title: 'Calendar overview: "home" cards',
          details: 'New details.\n\n- [x] Install calendar',
          due: '2026-12-01',
          scope: 'personal',
          assignee: 'sam-example',
        };
        const actions = buildEditActions(todo, draft, true, canAttach);
        expect(actions.map((a) => a.kind)).toEqual(['edit', 'due', 'move']);
        expect(() => sent(actions)).not.toThrow();
        const passOn = buildEditActions(todo, { ...draftOf(todo), assignee: '' }, true, canAttach);
        expect(() => sent(passOn)).not.toThrow();
      });

      it('the date cleared, and a personal task changed', () => {
        expect(() =>
          sent(buildEditActions(todo, { ...draftOf(todo), due: '' }, true, canAttach)),
        ).not.toThrow();
        const mine = { ...todo, scope: 'personal' as const };
        const draft = { ...draftOf(mine), title: 'New', details: 'More', due: '' };
        expect(() => sent(buildEditActions(mine, draft, true, canAttach))).not.toThrow();
      });
    });
  }
});
