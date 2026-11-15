import { describe, expect, it } from 'vitest';
import type { Role } from '../../../shared/contract.ts';
import { helpVisible } from './visibility.ts';

describe('helpVisible', () => {
  it('is true for every role', () => {
    for (const role of ['owner', 'scout', 'team', 'unknown'] as Role[]) expect(helpVisible(role)).toBe(true);
  });
});
