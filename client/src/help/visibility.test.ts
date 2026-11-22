import { describe, expect, it } from 'vitest';
import type { Role } from '../../../shared/contract.ts';
import { helpVisible, skillsMenuVisible } from './visibility.ts';

describe('helpVisible', () => {
  it('is true for every role', () => {
    for (const role of ['owner', 'scout', 'team', 'unknown'] as Role[]) expect(helpVisible(role)).toBe(true);
  });
});

describe('skillsMenuVisible', () => {
  it('gives the Skills drawer to owners and scouts only', () => {
    expect(skillsMenuVisible('owner')).toBe(true);
    expect(skillsMenuVisible('scout')).toBe(true);
    expect(skillsMenuVisible('team')).toBe(false);
    expect(skillsMenuVisible('unknown')).toBe(false);
  });
});
