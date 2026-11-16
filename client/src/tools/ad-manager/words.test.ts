import { describe, expect, it, vi } from 'vitest';
import { ADS_ERROR_MESSAGES } from '../../../../shared/ads-contract.ts';

vi.mock('../../api.ts', () => ({ ApiFailure: class extends Error {} }));
const { fmt, sortRows, actionLabel, moneyDigits, isLow, isQuietZero } = await import('./words.ts');

describe('fmt', () => {
  it('formats the Workbench column types', () => {
    expect(fmt(1234.4, 'money', 'GBP')).toBe('£1,234');
    expect(fmt(5, 'money', 'USD')).toBe('US$5');
    expect(fmt(12.34, 'num1', 'GBP')).toBe('12.3');
    expect(fmt(3.456, 'x', 'GBP')).toBe('3.46x');
    expect(fmt(8, 'pct', 'GBP')).toBe('8.0%');
    expect(fmt(null, 'int', 'GBP')).toBe('—');
  });
});

describe('fmt by column', () => {
  it('uses the real currency, and survives a bad code', () => {
    expect(fmt(10, 'money', 'EUR')).toBe('€10');
    expect(fmt(10, 'money', 'CAD')).toBe('CA$10');
    expect(fmt(10, 'money', 'nonsense!')).toBe('nonsense! 10');
    expect(fmt('n/a', 'money', 'GBP')).toBe('n/a');
  });
  it('picks money decimals per column', () => {
    expect(moneyDigits([3.5, 99.9, null])).toBe(2);
    expect(moneyDigits([3.5, 100])).toBe(0);
    expect(moneyDigits([-250, 4])).toBe(0);
    expect(fmt(3.5, 'money', 'GBP', 2)).toBe('£3.50');
    expect(fmt(1234.5, 'money', 'GBP', 0)).toBe('£1,235');
  });
  it('formats Quality Score and conversions', () => {
    expect(fmt(7, 'qs', 'GBP')).toBe('7');
    expect(fmt(6.5, 'qs', 'GBP')).toBe('6.5');
    expect(fmt(2, 'num1', 'GBP')).toBe('2.0');
    expect(fmt(0, 'x', 'GBP')).toBe('0.00x');
  });
  it('flags low ROAS and Quality Score', () => {
    expect(isLow(0.8, 'x', [0.8, 2])).toBe(true);
    expect(isLow(1, 'x', [1, 2])).toBe(false);
    expect(isLow(0, 'x', [0, 0])).toBe(false);
    expect(isLow(0, 'x', [0, 3])).toBe(true);
    // A row that spent nothing has no return to judge: its 0.00x is not low.
    expect(isLow(0, 'x', [0, 3], false)).toBe(false);
    expect(isLow(0.5, 'x', [0.5, 3], true)).toBe(true);
    expect(isLow(4, 'qs', [4])).toBe(true);
    expect(isLow(5, 'qs', [5])).toBe(false);
    expect(isLow(null, 'qs', [null])).toBe(false);
    expect(isLow(0.1, 'money', [0.1])).toBe(false);
  });
  it('quietens true zeros but not a ROAS of 0', () => {
    expect(isQuietZero(0, 'num1')).toBe(true);
    expect(isQuietZero(0, 'money')).toBe(true);
    expect(isQuietZero(0, 'x')).toBe(false);
    expect(isQuietZero(0, 'text')).toBe(false);
    expect(isQuietZero(2, 'int')).toBe(false);
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
