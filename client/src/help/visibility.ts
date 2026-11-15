import type { Role } from '../../../shared/contract.ts';

/** Who sees Help. Phase 1: owners only. Flipped in one place at launch (plan decision 5). */
export function helpVisible(role: Role): boolean {
  return role === 'owner';
}
