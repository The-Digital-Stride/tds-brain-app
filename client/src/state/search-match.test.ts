import { describe, expect, it } from 'vitest';
import { matchRank, plain } from './search-match.ts';

describe('plain', () => {
  it('lowercases and drops accents', () => {
    expect(plain('Café Ünï')).toBe('cafe uni');
  });
});

describe('matchRank', () => {
  it('0: the title starts with the query', () => {
    expect(matchRank('ren', 'Renew contract', [])).toBe(0);
    expect(matchRank('renew con', 'Renew contract', [])).toBe(0);
  });

  it('1: every query word starts a title word, in any order', () => {
    expect(matchRank('contract ren', 'Renew contract', [])).toBe(1);
    expect(matchRank('con', 'Renew contract', [])).toBe(1);
  });

  it('2: the title contains every word, but not at a word start', () => {
    expect(matchRank('tract', 'Renew contract', [])).toBe(2);
    expect(matchRank('new tract', 'Renew contract', [])).toBe(2);
  });

  it('3: only the other fields hold some word', () => {
    expect(matchRank('acme', 'Renew contract', ['Acme Heating'])).toBe(3);
    expect(matchRank('renew acme', 'Renew contract', ['Acme Heating'])).toBe(3);
  });

  it('null when a word is nowhere', () => {
    expect(matchRank('renew zzz', 'Renew contract', ['Acme'])).toBeNull();
    expect(matchRank('zzz', 'Renew contract', [])).toBeNull();
  });

  it('ignores case and accents on both sides', () => {
    expect(matchRank('CAFE', 'Café menu', [])).toBe(0);
    expect(matchRank('cafe', 'Menu', ['Acme Café'])).toBe(3);
  });

  it('is null for an empty query', () => {
    expect(matchRank('   ', 'Anything', [])).toBeNull();
  });

  it('treats punctuation as a word break for word starts', () => {
    expect(matchRank('report', '2026-11-03-october-report', [])).toBe(1);
  });
});
