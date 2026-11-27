// @vitest-environment jsdom
/**
 * The task changes the browser really builds, through the server's real request check. Client tests mock the
 * API and route tests hand-write their bodies, so a field only one side knew (`detailsOnly`, 2026-11-20) failed
 * every Save and tick in the panel while every other test passed.
 */
import { describe, expect, it } from 'vitest';
import { buildEditActions, type EditDraft } from '../../client/src/shell/TodoForms.tsx';
import { ROUTES, SESSION_COOKIE, type TodoAction, type TodoItem } from '../../shared/contract.ts';
import { parseTodoAction } from './routes.ts';
import { checkRequest, cookieValueFor } from './security.ts';

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

// ---------------------------------------------------------------------------
// Task updates (release 1): each new shape as the browser sends it, through the real gate (host, session,
// origin, JSON content type) and then the route's shape check. A route test that skipped the gate once
// missed a 415 on every request.
// ---------------------------------------------------------------------------

describe('the task update shapes pass the real request gate and the route check', () => {
  const PORT = 3877;
  const TOKEN = 'launch-token-abc123';
  const version = 'b'.repeat(64);
  const gate = (path: string) =>
    checkRequest(
      {
        method: 'POST',
        path,
        headers: {
          host: `127.0.0.1:${PORT}`,
          origin: `http://127.0.0.1:${PORT}`,
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
        },
      },
      { port: PORT, launchToken: TOKEN },
    );

  const shapes: [string, TodoAction][] = [
    [
      'update',
      { kind: 'update', id: 'a.md', text: 'Sent the quote.\nThey want it signed.', expect: version },
    ],
    [
      'update on a personal task',
      { kind: 'update', id: 'a.md', text: 'Note.', scope: 'personal', expect: version },
    ],
    [
      'update on an asked task (no scope)',
      { kind: 'update', id: 'a.md', text: 'Any news?', expect: version },
    ],
    ['link', { kind: 'link', id: 'a.md', url: 'https://example.com/spec', name: 'Spec', expect: version }],
    ['link without a name', { kind: 'link', id: 'a.md', url: 'https://example.com/spec', expect: version }],
    ['unlink', { kind: 'unlink', id: 'a.md', url: 'https://example.com/spec', expect: version }],
    [
      'assignee with a note',
      { kind: 'assignee', id: 'a.md', assignee: 'ben-mcadam', note: 'Over to you.', expect: version },
    ],
    [
      'assignee with a note, handed back',
      {
        kind: 'assignee',
        id: 'a.md',
        assignee: 'ben-mcadam',
        note: 'Back to you.',
        back: true,
        expect: version,
      },
    ],
    ['assignee handed back, no note', { kind: 'assignee', id: 'a.md', assignee: 'ben-mcadam', back: true }],
  ];

  for (const [name, action] of shapes) {
    it(name, () => {
      expect(gate(ROUTES.changeTodo)).toEqual({ action: 'allow' });
      expect(parseTodoAction(JSON.parse(JSON.stringify(action)))).toEqual(action);
    });
  }

  it('complete with a note (Add update and mark as done)', () => {
    expect(gate(ROUTES.completeTodo)).toEqual({ action: 'allow' });
    // The route reads `id`, `scope`, `expect` and `note` straight from the body; the client's request type
    // names exactly these.
    const body: import('../../shared/contract.ts').CompleteTodoRequest = {
      id: 'a.md',
      scope: 'tds',
      expect: version,
      note: 'All done.',
    };
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });
});
