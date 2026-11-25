import type { Role } from '../../../shared/contract.ts';

/**
 * Who sees Help: everyone who uses Cortex, whatever their role. Phases 1 and 2 kept it to owners; it opened to
 * everyone on 2026-11-15. Kept as one switch so it can be narrowed again in one place.
 */
export function helpVisible(_role: Role): boolean {
  return true;
}

/**
 * Who can start a skill from Cortex's own buttons: the Skills drawer (the rail item, the `s` key and "Go to
 * Skills"), the Pinned skills card on Home and skills in the search. Owners and scouts only (Ian, 2026-11-22; the card
 * and search since 2026-11-25). Home shortcuts never hold a skill, for anyone. Everyone can still start a skill by
 * typing it in a chat (`/name`) or from a button made for that one skill (Start my day). A new generic list or
 * picker of skills must check this.
 */
export function skillsMenuVisible(role: Role): boolean {
  return role === 'owner' || role === 'scout';
}
