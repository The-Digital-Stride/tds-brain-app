import { describe, expect, it, vi } from 'vitest';
import { ADS_ERROR_MESSAGES } from '../../../../shared/ads-contract.ts';

vi.mock('../../api.ts', () => ({ ApiFailure: class extends Error {} }));
const { fmt, sortRows, actionLabel } = await import('./words.ts');

describe('fmt', () => {
  it('formats the Workbench column types', () => {
    expect(fmt(1234.4, 'money', 'GBP')).toBe('£1,234');
    expect(fmt(5, 'money', 'USD')).toBe('$5');
    expect(fmt(12.34, 'num1', 'GBP')).toBe('12.3');
    expect(fmt(3.456, 'x', 'GBP')).toBe('3.46x');
    expect(fmt(8, 'pct', 'GBP')).toBe('8.0%');
    expect(fmt(null, 'int', 'GBP')).toBe('—');
  });
});

describe('sortRows', () => {
  it('sorts numbers by value and puts empty last', () => {
    const rows = [
      ['a', 2],
      ['b', null],
      ['c', 10],
    ] as (string | number | null)[][];
    expect(sortRows(rows, 1, 'desc').map((r) => r[0])).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['a', 'b', 'c']);
  });
});

describe('actionLabel', () => {
  it('uses the account labels, then the known ones, then words', () => {
    expect(actionLabel('NONE')).toBe('Hold');
    expect(actionLabel('NONE', { NONE: 'Leave it' })).toBe('Leave it');
    expect(actionLabel('SOME_NEW_THING')).toBe('Some new thing');
  });
});

it('keeps the unknown-outcome wording', () => {
  expect(ADS_ERROR_MESSAGES['unknown-outcome']).toMatch(/don't know whether/);
});
