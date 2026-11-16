import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTodoFiles, resolveTodoFilePath, splitTodoFiles, todoFileExtras } from './todo-files.ts';

interface Fixtures {
  parse: { name: string; body: string; files: { path: string; name: string; holder: string | null }[] }[];
  split: { name: string; body: string; details: string; files: string }[];
}
const fixtures = JSON.parse(
  readFileSync(new URL('./todo-files.fixtures.json', import.meta.url), 'utf8'),
) as Fixtures;

describe('to-do ## Files section (shared fixtures)', () => {
  for (const c of fixtures.parse) {
    it(`parse: ${c.name}`, () => expect(parseTodoFiles(c.body)).toEqual(c.files));
  }
  for (const c of fixtures.split) {
    it(`split: ${c.name}`, () =>
      expect(splitTodoFiles(c.body)).toEqual({ details: c.details, files: c.files }));
  }
});

describe('todoFileExtras', () => {
  it('returns the section lines that are not brain-file links', () => {
    const body =
      'Intro.\n\n## Files\n\n- [a.pdf](../clients/acme/files/a.pdf)\n- [Spec](https://example.com/spec)\n### Drafts\n\n## Handover history\n\n- note';
    expect(todoFileExtras(body)).toEqual(['- [Spec](https://example.com/spec)', '### Drafts']);
    expect(todoFileExtras('No section.')).toEqual([]);
  });
});

describe('resolveTodoFilePath', () => {
  it('drops leading ../ and keeps only the three roots', () => {
    expect(resolveTodoFilePath('../../../clients/a/b.pdf')).toBe('clients/a/b.pdf');
    expect(resolveTodoFilePath('clients/a/b.pdf')).toBe('clients/a/b.pdf');
    expect(resolveTodoFilePath('../todo/x.md')).toBeNull();
    expect(resolveTodoFilePath('../clients/a//b.pdf')).toBeNull();
    expect(resolveTodoFilePath('../clients/a/b.pdf/..')).toBeNull();
    expect(resolveTodoFilePath('file:clients/a.pdf')).toBeNull();
  });
});
