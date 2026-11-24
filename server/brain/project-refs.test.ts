import { describe, expect, it } from 'vitest';
import { buildRefIndex, cleanRef, type RefCardInput } from './project-refs.ts';

const card = (key: string, ref: string | null, over: Partial<RefCardInput> = {}): RefCardInput => ({
  key,
  space: 'client',
  client: key.split('/')[0] as string,
  ref,
  ...over,
});
const codes = new Map<string, string | null>([
  ['ast', 'AST'],
  ['h2o', 'H2O'],
  ['bad', null],
  ['the-digital-stride', 'TDS'],
]);

describe('cleanRef', () => {
  it('upper-cases valid refs and drops invalid ones', () => {
    expect(cleanRef('ast4k7')).toBe('AST4K7');
    expect(cleanRef('AST1K7')).toBeNull();
    expect(cleanRef(null)).toBeNull();
  });
});

describe('buildRefIndex', () => {
  it('resolves a unique ref (any case, O/0 folded in the client part) and marks ok', () => {
    const { index, byKey } = buildRefIndex([card('ast/a', 'ast4k7'), card('h2o/b', 'H2O4K7')], codes);
    expect(index.resolve('AST4K7')).toBe('ast/a');
    expect(index.resolve('H204K7')).toBe('h2o/b');
    expect(byKey.get('ast/a')).toEqual({ ref: 'AST4K7', refState: 'ok' });
  });

  it('marks duplicates on each card and resolves neither', () => {
    const { index, byKey } = buildRefIndex([card('ast/a', 'AST4K7'), card('h2o/b', 'AST4K7')], codes);
    expect(index.resolve('AST4K7')).toBeNull();
    expect(byKey.get('ast/a')).toEqual({ ref: 'AST4K7', refState: 'duplicate', refDuplicateOf: ['h2o/b'] });
    expect(byKey.get('h2o/b')?.refDuplicateOf).toEqual(['ast/a']);
  });

  it('resolves archived cards', () => {
    const { index } = buildRefIndex([card('ast/a', 'AST4K7')], codes);
    expect(index.resolve('AST4K7')).toBe('ast/a');
  });

  it('never indexes personal cards, and a personal card makes no duplicate', () => {
    const { index, byKey } = buildRefIndex(
      [card('personal/p', 'AST4K7', { space: 'personal', client: null }), card('ast/a', 'AST4K7')],
      codes,
    );
    expect(byKey.get('personal/p')?.refState).toBe('personal');
    // Decision 3: its old code is neither shown nor searchable.
    expect(byKey.get('personal/p')?.ref).toBeNull();
    expect(byKey.get('ast/a')?.refState).toBe('ok');
    expect(index.resolve('AST4K7')).toBe('ast/a');
    const only = buildRefIndex([card('personal/p', 'AST4K7', { space: 'personal', client: null })], codes);
    expect(only.index.resolve('AST4K7')).toBeNull();
  });

  it('reports missing and no-client-code, internal using the-digital-stride', () => {
    const { byKey } = buildRefIndex(
      [
        card('ast/a', null),
        card('bad/b', null),
        card('nocode/c', null),
        card('the-digital-stride/d', null),
        card('x/y', null, { client: null, space: 'legacy' }),
      ],
      codes,
    );
    expect(byKey.get('ast/a')?.refState).toBe('missing');
    expect(byKey.get('bad/b')?.refState).toBe('no-client-code');
    expect(byKey.get('nocode/c')?.refState).toBe('no-client-code');
    expect(byKey.get('the-digital-stride/d')?.refState).toBe('missing');
    expect(byKey.get('x/y')?.refState).toBe('missing');
  });

  it('reads an invalid ref as none', () => {
    const { byKey } = buildRefIndex([card('ast/a', 'nonsense')], codes);
    expect(byKey.get('ast/a')).toEqual({ ref: null, refState: 'missing' });
  });

  it('resolves a moved card by its ref even when the letters name another client', () => {
    const { index, byKey } = buildRefIndex([card('h2o/moved', 'AST4K7')], codes);
    expect(index.resolve('AST4K7')).toBe('h2o/moved');
    expect(byKey.get('h2o/moved')?.refState).toBe('ok');
  });

  it('offers near refs from resolvable ones only', () => {
    const { index } = buildRefIndex(
      [card('ast/a', 'AST4K7'), card('h2o/b', 'H2O4K7'), card('x/y', 'AST4K7')],
      codes,
    );
    expect(index.near('AST4K8')).toEqual([]);
    const two = buildRefIndex([card('h2o/b', 'H2O4K7')], codes);
    expect(two.index.near('H2O4K8')).toEqual(['H2O4K7']);
  });
});
