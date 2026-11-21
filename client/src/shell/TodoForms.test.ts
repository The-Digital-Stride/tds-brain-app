// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../../shared/contract.ts';
import { buildEditActions, type EditDraft, todoProjectValue } from './TodoForms.tsx';

const todo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: 't1',
  scope: 'tds',
  key: 't1',
  path: 'todo/t1.md',
  handover: null,
  createdBy: null,
  title: 'Title',
  assignee: 'sam',
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  attachments: [],
  ...over,
});
const draftOf = (t: TodoItem, over: Partial<EditDraft> = {}): EditDraft => {
  const base = { title: t.title, details: '', due: t.due ?? '', assignee: t.assignee ?? '', scope: t.scope };
  return { ...base, version: t.version, base, ...over };
};
const kinds = (a: { kind: string }[]) => a.map((x) => x.kind);

describe('buildEditActions with a project', () => {
  it('saves in the order edit, due, project, assignee, each step after the first without a version', () => {
    const t = todo();
    const actions = buildEditActions(
      t,
      draftOf(t, { title: 'New', due: '2026-12-01', project: 'acme/site', stage: 'Build', assignee: 'jo' }),
      false,
      false,
      true,
    );
    expect(kinds(actions)).toEqual(['edit', 'due', 'project', 'assignee']);
    expect(actions[0]).toMatchObject({ expect: 'v1' });
    expect(actions[2]).toEqual({
      kind: 'project',
      id: 't1',
      client: 'acme',
      project: 'acme/site',
      stage: 'Build',
    });
    expect(actions[1]).not.toHaveProperty('expect');
  });

  it('sends nothing for the project when it is not touched, or the server cannot save one', () => {
    const t = todo({ projectMatch: { how: 'key', key: 'acme/site' }, stage: 'Build', client: 'acme' });
    expect(buildEditActions(t, draftOf(t), false, false, true)).toEqual([]);
    expect(buildEditActions(t, draftOf(t, { project: '' }), false, false, false)).toEqual([]);
  });

  it('does not clobber an old free-text label that never resolved', () => {
    const t = todo({ project: 'misc', projectMatch: { how: 'loose', label: 'misc' } });
    expect(buildEditActions(t, draftOf(t), false, false, true)).toEqual([]);
  });

  it("clearing the project removes it and its stage but keeps the to-do's client", () => {
    const t = todo({ projectMatch: { how: 'key', key: 'acme/site' }, stage: 'Build', client: 'acme' });
    const [a] = buildEditActions(t, draftOf(t, { project: '' }), false, false, true);
    expect(a).toMatchObject({ kind: 'project', client: 'acme', project: null, stage: null });
  });

  it('a personal project has no client', () => {
    const t = todo({ scope: 'personal' });
    const [a] = buildEditActions(t, draftOf(t, { project: 'personal/diary' }), false, false, true);
    expect(a).toMatchObject({ kind: 'project', scope: 'personal', client: null, project: 'personal/diary' });
  });

  it('moving a personal to-do out of a private project asks to drop it and sends dropProject', () => {
    const t = todo({ scope: 'personal', projectMatch: { how: 'key', key: 'personal/diary' }, stage: 'x' });
    const actions = buildEditActions(t, draftOf(t, { scope: 'tds' }), false, false, true);
    expect(actions).toEqual([
      { kind: 'move', id: 't1', scope: 'personal', to: 'tds', dropProject: true, expect: 'v1' },
    ]);
  });

  it('after the drop it can still put the to-do in a team project, addressed at its new place', () => {
    const t = todo({ scope: 'personal', projectMatch: { how: 'key', key: 'personal/diary' } });
    const actions = buildEditActions(
      t,
      draftOf(t, { scope: 'tds', project: 'acme/site' }),
      false,
      false,
      true,
    );
    expect(kinds(actions)).toEqual(['move', 'project']);
    expect(actions[1]).toMatchObject({ project: 'acme/site', client: 'acme' });
    expect(actions[1]).not.toHaveProperty('scope');
  });

  it('never sends a personal project for a to-do that is moving to the team', () => {
    const t = todo({ scope: 'personal' });
    const actions = buildEditActions(
      t,
      draftOf(t, { scope: 'tds', project: 'personal/diary' }),
      false,
      false,
      true,
    );
    expect(kinds(actions)).toEqual(['move']);
    expect(actions[0]).not.toHaveProperty('dropProject');
  });

  it('a move without a private project sends no dropProject', () => {
    const t = todo({ scope: 'personal' });
    const [a] = buildEditActions(t, draftOf(t, { scope: 'tds' }), false, false, true);
    expect(a).not.toHaveProperty('dropProject');
  });
});

describe('todoProjectValue', () => {
  it('reads the key for a key, legacy or missing match, and nothing for the rest or an older server', () => {
    expect(todoProjectValue({ projectMatch: { how: 'legacy', key: 'a/b' } })).toBe('a/b');
    expect(todoProjectValue({ projectMatch: { how: 'missing', key: 'a/b' } })).toBe('a/b');
    expect(todoProjectValue({ projectMatch: { how: 'client', client: 'a' } })).toBe('');
    expect(todoProjectValue({})).toBe('');
  });
});
