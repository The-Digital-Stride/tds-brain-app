import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter.ts';

describe('parseFrontmatter', () => {
  it('reads plain and quoted values', () => {
    const { data, body } = parseFrontmatter('---\nname: x\ntitle: "Hello: world"\nother: \'q\'\n---\nBody\n');
    expect(data.name).toBe('x');
    expect(data.title).toBe('Hello: world');
    expect(data.other).toBe('q');
    expect(body).toBe('Body\n');
  });

  it('reads inline and dash lists', () => {
    const { data } = parseFrontmatter('---\na: [one, "two"]\nb:\n  - x\n  - y\n---\n');
    expect(data.a).toEqual(['one', 'two']);
    expect(data.b).toEqual(['x', 'y']);
  });

  it('reads folded block text', () => {
    const { data } = parseFrontmatter('---\ndescription: >\n  first line\n  second line\nnext: v\n---\n');
    expect(data.description).toBe('first line second line');
    expect(data.next).toBe('v');
  });

  it('handles a missing block', () => {
    const r = parseFrontmatter('# Heading\n\ntext');
    expect(r.data).toEqual({});
    expect(r.body).toBe('# Heading\n\ntext');
  });

  it('handles Windows line ends and a BOM', () => {
    const { data, body } = parseFrontmatter('﻿---\r\nroles: owner, scout\r\n---\r\nBody\r\n');
    expect(data.roles).toBe('owner, scout');
    expect(body).toBe('Body\n');
  });

  it('never throws on junk', () => {
    for (const junk of ['', '---', '---\n', '---\n: : :\n\u0000\n', '---\nunterminated: yes', '\n\n---']) {
      expect(() => parseFrontmatter(junk)).not.toThrow();
    }
    expect(parseFrontmatter('---\nunterminated: yes').data).toEqual({});
  });
});
