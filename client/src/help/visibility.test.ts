import { describe, expect, it } from 'vitest';
import type { Role } from '../../../shared/contract.ts';
import { helpVisible } from './visibility.ts';

describe('helpVisible', () => {
  it('is true for owners only', () => {
    expect(helpVisible('owner')).toBe(true);
    for (const role of ['scout', 'team', 'unknown'] as Role[]) expect(helpVisible(role)).toBe(false);
  });
});
