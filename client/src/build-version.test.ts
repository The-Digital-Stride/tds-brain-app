import { describe, expect, it } from 'vitest';
import { isOutdated } from './build-version.ts';

describe('isOutdated', () => {
  it('is true when the server runs a different version from this page', () => {
    expect(isOutdated('0.6.0', '0.7.0')).toBe(true);
  });
  it('is false when they match', () => {
    expect(isOutdated('0.7.0', '0.7.0')).toBe(false);
  });
  it('is false when either side is unknown', () => {
    expect(isOutdated('', '0.7.0')).toBe(false);
    expect(isOutdated('0.7.0', '')).toBe(false);
    expect(isOutdated('0.7.0', null)).toBe(false);
    expect(isOutdated('0.7.0', undefined)).toBe(false);
  });
  it('is false when the server could not read its own version', () => {
    expect(isOutdated('0.7.0', '0.0.0')).toBe(false);
  });
});
