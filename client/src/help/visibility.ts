import type { Role } from '../../../shared/contract.ts';

/**
 * Who sees Help: everyone who uses Cortex, whatever their role. Phases 1 and 2 kept it to owners; it opened to
 * everyone on 2026-11-15. Kept as one switch so it can be narrowed again in one place.
 */
export function helpVisible(_role: Role): boolean {
  return true;
}

/**
 * Who has the Skills drawer (the rail item, the `s` key and "Go to Skills"): owners and scouts only
 * (Ian, 2026-11-22). Everyone else still starts skills from Home, the search and chat.
 */
export function skillsMenuVisible(role: Role): boolean {
  return role === 'owner' || role === 'scout';
}
