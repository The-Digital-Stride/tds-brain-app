import { describe, expect, it, vi } from 'vitest';
import type { HelpArea, HelpTopic } from './contract.ts';
import { createHelpLibrary, loadHelpTopics } from './library.ts';

const topic = (id: string, area: HelpArea, order: number, over: Partial<HelpTopic> = {}): HelpTopic => ({
  id,
  title: id.toUpperCase(),
  area,
  order,
  summary: `About ${id}`,
  benefit: 'It helps.',
  roles: 'all',
  related: [],
  since: '0.36.0',
  reviewed: '2026-11-20',
  body: `Body of ${id}`,
  ...over,
});

const lib = createHelpLibrary([
  topic('b-todos', 'todos', 10),
  topic('a-home-2', 'home', 20),
  topic('a-home-1', 'home', 10),
  topic('c-chats', 'chats', 5, { summary: 'Find the keyword here', body: 'nothing' }),
  topic('d-skills', 'skills', 1, { body: 'The keyword hides in the body' }),
  topic('keyword', 'help', 1, { title: 'Keyword' }),
]);

describe('createHelpLibrary', () => {
  it('orders by area, then order, then title', () => {
    expect(lib.topics.map((t) => t.id)).toEqual([
      'a-home-1',
      'a-home-2',
      'c-chats',
      'b-todos',
      'd-skills',
      'keyword',
    ]);
  });
  it('finds by id', () => {
    expect(lib.byId('b-todos')?.id).toBe('b-todos');
    expect(lib.byId('nope')).toBeUndefined();
  });
  it('groups non-empty areas in area order', () => {
    expect(lib.groups().map((g) => [g.area, g.label, g.topics.length])).toEqual([
      ['home', 'Home', 2],
      ['chats', 'Chats', 1],
      ['todos', 'Tasks', 1],
      ['skills', 'Skills', 1],
      ['help', 'Help', 1],
    ]);
  });
  it('ranks title, then summary, then body; empty query gives nothing', () => {
    expect(lib.search('keyword').map((t) => t.id)).toEqual(['keyword', 'c-chats', 'd-skills']);
    expect(lib.search('  ')).toEqual([]);
    expect(lib.search('KEYWORD', 2)).toHaveLength(2);
  });
  it('is empty without pages', () => {
    const empty = createHelpLibrary([]);
    expect(empty.topics).toEqual([]);
    expect(empty.groups()).toEqual([]);
    expect(empty.search('x')).toEqual([]);
  });
});

describe('loadHelpTopics', () => {
  it('leaves out a bad file and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good =
      '---\nid: good\ntitle: Good\narea: home\norder: 1\nsummary: s\nbenefit: b\nroles: all\nsince: 0.36.0\nreviewed: 2026-11-20\n---\nBody';
    const topics = loadHelpTopics({ '../../../help/good.md': good, '../../../help/bad.md': 'nothing' });
    expect(topics.map((t) => t.id)).toEqual(['good']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
