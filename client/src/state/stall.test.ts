import { describe, expect, it } from 'vitest';
import { isStalled } from './stall.ts';

describe('isStalled', () => {
  it('is false while things are arriving, true once the silence reaches the limit', () => {
    expect(isStalled(1000, 20_000, 40_000)).toBe(false);
    expect(isStalled(1000, 41_000, 40_000)).toBe(true);
  });
});
