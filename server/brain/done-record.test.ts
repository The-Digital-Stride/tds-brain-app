import { describe, expect, it } from 'vitest';
import { stampDone } from './done-record.ts';
import { parseFrontmatter } from './frontmatter.ts';

const ian = { name: 'Ian Hancock', slug: 'ian-hancock' };
const winter = new Date('2026-11-11T17:07:38Z'); // GMT: UK time equals UTC
const summerLateEvening = new Date('2026-06-30T23:30:05Z'); // BST: already 1 July in the UK

const stamp = (text: string, at = winter, by = ian, via = 'TDS Brain App') =>
  stampDone(text, { by, at, via });

describe('stampDone', () => {
  it('adds who, when and where to the frontmatter and a Done section to the body', () => {
    const out = stamp(
      '---\nassignee: ian-hancock\ntitle: Send the report\ncreated: 2026-10-27\n---\n\nSome notes.\n',
    );
    expect(out).toBe(
      [
        '---',
        'assignee: ian-hancock',
        'title: Send the report',
        'created: 2026-10-27',
        'status: done',
        'completed: 2026-11-11',
        'completed_at: 2026-11-11T17:07:38+00:00',
        'completed_by: ian-hancock',
        'completed_via: TDS Brain App',
        '---',
        '',
        'Some notes.',
        '',
        '## Done 2026-11-11',
        '',
        'Ticked off by Ian Hancock at 17:07 UK time (TDS Brain App).',
        '',
      ].join('\n'),
    );
  });

  it('uses the UK date and clock in summer time, with the offset shown', () => {
    const { data, body } = parseFrontmatter(stamp('---\ntitle: x\n---\n', summerLateEvening));
    expect(data.completed).toBe('2026-07-01');
    expect(data.completed_at).toBe('2026-07-01T00:30:05+01:00');
    expect(body).toContain('## Done 2026-07-01');
    expect(body).toContain('at 00:30 UK time');
  });

  it('replaces an earlier status or completion line rather than adding a second', () => {
    const out = stamp(
      '---\ntitle: x\nstatus: in progress\ncompleted: 2026-01-01\ncompleted_by: someone-else\n---\nBody\n',
    );
    const head = out.slice(0, out.indexOf('\n---\n', 4));
    for (const key of ['status', 'completed', 'completed_at', 'completed_by', 'completed_via']) {
      expect(head.split('\n').filter((l) => l.startsWith(`${key}:`))).toHaveLength(1);
    }
    expect(parseFrontmatter(out).data).toMatchObject({
      title: 'x',
      status: 'done',
      completed: '2026-11-11',
      completed_by: 'ian-hancock',
    });
  });

  it('keeps every other frontmatter line and the body exactly as written', () => {
    const original =
      '---\nassignee: ian-hancock\ntitle: "Quoted: title"\ntags: [a, b]\nnotes: >\n  folded text\n  second line\ndue: 2026-11-20\n---\n# Heading\n\n- [ ] a box\n';
    const out = stamp(original);
    const { data, body } = parseFrontmatter(out);
    expect(data.title).toBe('Quoted: title');
    expect(data.tags).toEqual(['a', 'b']);
    expect(data.notes).toBe('folded text second line');
    expect(data.due).toBe('2026-11-20');
    expect(body.startsWith('# Heading\n\n- [ ] a box\n')).toBe(true);
    expect(out).toContain('title: "Quoted: title"\ntags: [a, b]\nnotes: >\n  folded text\n  second line\n');
  });

  it('removes the whole of an earlier multi-line value, and nothing after it', () => {
    const out = stamp(
      '---\ntitle: x\nstatus: |\n  one\n\n  two\ncompleted_by:\n- a\n- b\nnext: y\n\ndue: 2026-11-20\n---\nBody\n',
    );
    expect(out.startsWith('---\ntitle: x\nnext: y\n\ndue: 2026-11-20\nstatus: done\n')).toBe(true);
    expect(out).not.toMatch(/ {2}one| {2}two|- a|- b/);
    expect(parseFrontmatter(out).data).toMatchObject({ title: 'x', next: 'y', due: '2026-11-20' });
  });

  it('keeps a byte-order mark at the very start', () => {
    const out = stamp('\uFEFF---\ntitle: x\n---\nBody\n');
    expect(out.startsWith('\uFEFF---\ntitle: x\nstatus: done\n')).toBe(true);
    expect(out.indexOf('\uFEFF', 1)).toBe(-1);
    expect(stamp('\uFEFF# No frontmatter').startsWith('\uFEFF---\nstatus: done\n')).toBe(true);
  });

  it('treats frontmatter that never closes as body text', () => {
    const out = stamp('---\nunclosed: yes\n');
    expect(out.startsWith('---\nstatus: done\n')).toBe(true);
    const { data, body } = parseFrontmatter(out);
    expect(data.completed_by).toBe('ian-hancock');
    expect(data.unclosed).toBeUndefined();
    expect(body.startsWith('---\nunclosed: yes\n\n## Done 2026-11-11\n')).toBe(true);
  });

  it('leaves --- rules in the body alone', () => {
    const out = stamp('---\ntitle: x\n---\nAbove\n\n---\n\nstatus: not frontmatter\n\n---\nBelow\n');
    expect(out).toContain(
      '---\nAbove\n\n---\n\nstatus: not frontmatter\n\n---\nBelow\n\n## Done 2026-11-11\n',
    );
    expect(out.split('\n').filter((l) => l === 'status: done')).toHaveLength(1);
  });

  it('gets the offset right either side of both clock changes', () => {
    const at = (iso: string) =>
      parseFrontmatter(stamp('---\ntitle: x\n---\n', new Date(iso))).data.completed_at;
    expect(at('2026-03-29T00:59:59Z')).toBe('2026-03-29T00:59:59+00:00');
    expect(at('2026-03-29T01:00:00Z')).toBe('2026-03-29T02:00:00+01:00');
    expect(at('2026-10-25T00:30:00Z')).toBe('2026-10-25T01:30:00+01:00');
    expect(at('2026-10-25T01:30:00.900Z')).toBe('2026-10-25T01:30:00+00:00');
  });

  it('gives a file with no frontmatter a frontmatter block', () => {
    const out = stamp('# Just a heading\n\nNo frontmatter here.');
    expect(out.startsWith('---\nstatus: done\ncompleted: 2026-11-11\n')).toBe(true);
    const { data, body } = parseFrontmatter(out);
    expect(data.completed_by).toBe('ian-hancock');
    expect(body).toContain('# Just a heading\n\nNo frontmatter here.\n\n## Done 2026-11-11\n');
  });

  it('copes with an empty file and a frontmatter-only file', () => {
    expect(parseFrontmatter(stamp('')).data.status).toBe('done');
    const out = stamp('---\nassignee: ian-hancock\n---\n');
    expect(out).toBe(
      '---\nassignee: ian-hancock\nstatus: done\ncompleted: 2026-11-11\ncompleted_at: 2026-11-11T17:07:38+00:00\ncompleted_by: ian-hancock\ncompleted_via: TDS Brain App\n---\n\n## Done 2026-11-11\n\nTicked off by Ian Hancock at 17:07 UK time (TDS Brain App).\n',
    );
  });

  it('keeps Windows line endings', () => {
    const out = stamp('---\r\ntitle: x\r\n---\r\nBody\r\n');
    expect(out).toContain('\r\nstatus: done\r\n');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('adds to an earlier Done section rather than replacing it', () => {
    const out = stamp('---\ntitle: x\n---\n## Done 2026-11-10\n\nClosed by hand with a long note.\n');
    expect(out).toContain('## Done 2026-11-10\n\nClosed by hand with a long note.\n');
    expect(out).toContain('\n\n## Done 2026-11-11\n\nTicked off by Ian Hancock');
  });

  it('never lets a name or source break out of its line', () => {
    const out = stampDone('---\ntitle: x\n---\n', {
      by: { name: 'Mal\nicious\r\n---\nassignee: boss', slug: 'bad slug\nassignee: boss' },
      at: winter,
      via: 'Some\nApp: v2',
    });
    const { data } = parseFrontmatter(out);
    expect(data.assignee).toBeUndefined();
    expect(data.completed_by).toBe('bad-slug-assignee-boss');
    expect(data.completed_via).toBe('Some App: v2');
    expect(out).toContain('Ticked off by Mal icious --- assignee: boss at 17:07 UK time (Some App: v2).');
    expect(out.split('\n').filter((l) => l === '---')).toHaveLength(2);
  });

  it('falls back to "unknown" when there is no usable name', () => {
    const out = stampDone('---\ntitle: x\n---\n', { by: { name: '  ', slug: '' }, at: winter, via: '' });
    const { data } = parseFrontmatter(out);
    expect(data.completed_by).toBe('unknown');
    expect(data.completed_via).toBe('unknown');
    expect(out).toContain('Ticked off by unknown at 17:07 UK time.');
  });
});
