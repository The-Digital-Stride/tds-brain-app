// Project codes (plan docs/plans/2026-11-24-projects-r2-project-codes.md, decision 7). Cases live in
// project-refs-vectors.json so the tdsapp-projects script's test runs the same ones.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foldClientCode, foldRef, isValidRef, nearRefs, refCandidates } from './project-refs.ts';
import { REF_CANDIDATE_SOURCE, REF_DIGITS, REF_LETTERS, REF_PATTERN } from './project-refs-contract.ts';

interface Vectors {
  candidates: { text: string; expect: string[] }[];
  valid: { ref: string; expect: boolean }[];
  foldRef: { in: string; out: string }[];
  foldClientCode: { in: string; out: string }[];
  near: { candidate: string; refs: string[]; expect: string[] }[];
}

const V = JSON.parse(
  readFileSync(new URL('./project-refs-vectors.json', import.meta.url), 'utf8'),
) as Vectors;

describe('project refs', () => {
  it.each(V.candidates)('refCandidates($text)', ({ text, expect: want }) => {
    expect(refCandidates(text)).toEqual(want);
  });
  it.each(V.valid)('isValidRef($ref)', ({ ref, expect: want }) => {
    expect(isValidRef(ref)).toBe(want);
  });
  it.each(V.foldRef)('foldRef($in)', ({ in: input, out }) => {
    expect(foldRef(input)).toBe(out);
  });
  it.each(V.foldClientCode)('foldClientCode($in)', ({ in: input, out }) => {
    expect(foldClientCode(input)).toBe(out);
  });
  it.each(V.near)('nearRefs($candidate)', ({ candidate, refs, expect: want }) => {
    expect(nearRefs(candidate, refs)).toEqual(want);
  });

  it('pattern and alphabets agree', () => {
    expect(REF_DIGITS).toBe('23456789');
    expect(REF_LETTERS).toHaveLength(20);
    for (const c of 'BILOSZ') expect(REF_LETTERS).not.toContain(c);
    expect(REF_PATTERN.source).toBe(
      `^[A-Z0-9]{2,4}[${REF_DIGITS[0]}-${REF_DIGITS.at(-1)}][${REF_LETTERS}][2-9]$`,
    );
    expect(REF_CANDIDATE_SOURCE).toBe('[A-Z0-9]{2,4}[0-9][A-Z][0-9]');
  });

  it('a long text is scanned without trouble', () => {
    const text = `${'word '.repeat(50_000)}[AST4K7]`;
    expect(refCandidates(text)).toEqual(['AST4K7']);
  });
});
