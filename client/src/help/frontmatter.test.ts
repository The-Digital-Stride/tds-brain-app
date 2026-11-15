import { describe, expect, it } from 'vitest';
import { parseHelpFile, splitFrontmatter } from './frontmatter.ts';

const page = (over: Record<string, string | null> = {}, body = '## What it does\nIt works.\n') => {
  const base: Record<string, string> = {
    id: 'todos',
    title: 'To-dos',
    area: 'todos',
    order: '10',
    summary: 'See what you need to do.',
    benefit: 'Nothing slips.',
    roles: 'all',
    related: '[skills, home]',
    since: '0.36.0',
    reviewed: '2026-11-20',
  };
  const lines = Object.entries({ ...base, ...over })
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
};

describe('splitFrontmatter', () => {
  it('reads key values, lists and comments', () => {
    const r = splitFrontmatter('---\n# a note\nid: x   # trailing\nrelated: [a, b]\nempty: []\n---\nBody');
    expect(r).toEqual({ data: { id: 'x', related: ['a', 'b'], empty: [] }, body: 'Body' });
  });
  it('fails without a frontmatter block', () => {
    expect(splitFrontmatter('No block')).toBeNull();
  });
});

describe('parseHelpFile', () => {
  it('accepts a valid file', () => {
    const r = parseHelpFile('todos.md', page());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.topic).toMatchObject({
        id: 'todos',
        order: 10,
        roles: 'all',
        related: ['skills', 'home'],
        area: 'todos',
      });
      expect(r.topic.body.startsWith('## What it does')).toBe(true);
    }
  });
  it('accepts owner and scout roles as a list', () => {
    const r = parseHelpFile('todos.md', page({ roles: '[owner, scout]' }));
    expect(r.ok && r.topic.roles).toEqual(['owner', 'scout']);
  });
  it('reports a missing field', () => {
    const r = parseHelpFile('todos.md', page({ benefit: null }));
    expect(r).toEqual({ ok: false, errors: [expect.stringContaining('benefit')] });
  });
  it('reports a bad area', () => {
    const r = parseHelpFile('todos.md', page({ area: 'nowhere' }));
    expect(!r.ok && r.errors.join()).toContain('area');
  });
  it('reports a summary that is too long', () => {
    const r = parseHelpFile('todos.md', page({ summary: 'x'.repeat(91) }));
    expect(!r.ok && r.errors.join()).toContain('summary');
  });
  it('reports an id that differs from the file name', () => {
    const r = parseHelpFile('other.md', page());
    expect(!r.ok && r.errors.join()).toContain('other.md');
  });
  it('reports a bad order, version, date and role', () => {
    const r = parseHelpFile(
      'todos.md',
      page({ order: 'ten', since: 'v1', reviewed: 'today', roles: '[boss]' }),
    );
    expect(!r.ok && r.errors.length).toBe(4);
  });
  it('reports a file without frontmatter', () => {
    expect(parseHelpFile('todos.md', '## Hi').ok).toBe(false);
  });
});
