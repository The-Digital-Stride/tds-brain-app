import { describe, expect, it } from 'vitest';
import type { LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import type { PaletteData } from '../shell/contract.ts';
import { paletteGroups } from './palette.ts';

const skill = (name: string, title: string): SkillInfo => ({
  name,
  title,
  description: '',
  kind: 'skill',
  maturity: 'live',
  argumentHint: null,
  restrictedTo: null,
});
const chat = (id: string, title: string): LiveSession => ({
  id,
  sdkSessionId: null,
  title,
  client: 'acme',
  todoId: null,
  state: 'idle',
  startedAt: '',
  lastActivityAt: '',
});
const todo = (id: string, title: string): TodoItem => ({
  id,
  title,
  assignee: null,
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
});

const data: PaletteData = {
  live: [chat('c1', 'Monthly reports check'), chat('c2', 'Call tracking case')],
  skills: [
    skill('a', 'Account auditor'),
    skill('meeting-notes', 'Meeting notes'),
    skill('search-term', 'Search term audit'),
  ],
  pins: ['search-term'],
  todos: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map((t) =>
    todo(t.toLowerCase(), `${t} thing`),
  ),
};

const titles = (q: string, d = data) => paletteGroups(q, d).map((g) => g.title);
const labels = (q: string, title: string, d = data) =>
  paletteGroups(q, d)
    .find((g) => g.title === title)
    ?.options.map((o) => o.label);

describe('paletteGroups', () => {
  it('with an empty query gives Go to, open chats, pinned skills and the first five to-dos', () => {
    expect(titles('')).toEqual(['Go to', 'Open chats', 'Run a skill', 'Start a chat on a to-do']);
    expect(labels('', 'Go to')).toEqual(['Home', 'To-dos', 'Chats', 'Skills', 'Settings']);
    expect(labels('', 'Open chats')).toEqual(['Monthly reports check', 'Call tracking case']);
    expect(labels('', 'Run a skill')).toEqual(['Search term audit']);
    expect(labels('', 'Start a chat on a to-do')).toHaveLength(5);
  });

  it('gives the drawer commands and key hints', () => {
    const go = paletteGroups('', data)[0]?.options ?? [];
    expect(go.find((o) => o.label === 'To-dos')?.hint).toBe('T');
    expect(go.find((o) => o.label === 'Chats')?.command).toEqual({ kind: 'drawer', drawer: 'chats' });
    expect(go[0]?.command).toEqual({ kind: 'home' });
    expect(go.at(-1)?.command).toEqual({ kind: 'settings' });
  });

  it('matches case-insensitively on every word, in any order', () => {
    expect(labels('SEARCH audit', 'Run a skill')).toEqual(['Search term audit']);
    expect(labels('audit term', 'Run a skill')).toEqual(['Search term audit']);
    expect(labels('reports', 'Open chats')).toEqual(['Monthly reports check']);
  });

  it('drops empty groups', () => {
    expect(titles('zzzz')).toEqual([]);
    expect(titles('meeting')).toEqual(['Run a skill']);
  });

  it('searches all skills and puts pinned ones first', () => {
    expect(labels('t', 'Run a skill')).toEqual(['Search term audit', 'Account auditor', 'Meeting notes']);
  });

  it('shows at most six per group', () => {
    const many: PaletteData = {
      ...data,
      todos: Array.from({ length: 10 }, (_, i) => todo(`t${i}`, `Thing ${i}`)),
    };
    expect(labels('thing', 'Start a chat on a to-do', many)).toHaveLength(6);
  });

  it('gives every option a unique id', () => {
    const ids = paletteGroups('', data).flatMap((g) => g.options.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('orders to-dos by due date, undated last, before slicing', () => {
    const dated = (id: string, due: string | null): TodoItem => ({ ...todo(id, `${id} thing`), due });
    const d: PaletteData = {
      ...data,
      todos: [
        dated('none1', null),
        dated('later', '2026-11-20'),
        dated('overdue', '2026-11-01'),
        dated('none2', null),
        dated('soon', '2026-11-12'),
        dated('x1', '2026-12-01'),
        dated('x2', '2026-12-02'),
      ],
    };
    expect(labels('', 'Start a chat on a to-do', d)).toEqual([
      'overdue thing',
      'soon thing',
      'later thing',
      'x1 thing',
      'x2 thing',
    ]);
    expect(labels('thing', 'Start a chat on a to-do', d)?.slice(0, 2)).toEqual([
      'overdue thing',
      'soon thing',
    ]);
    expect(labels('none', 'Start a chat on a to-do', d)).toEqual(['none1 thing', 'none2 thing']);
  });
});
