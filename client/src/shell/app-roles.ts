import type { Role } from '../../../shared/contract.ts';
import { APPS } from './apps.ts';
import type { AppSlot } from './contract.ts';

/** Whether `role` sees `app`. An app with no `roles` is for everyone; with some, only those roles. */
export function appVisibleTo(app: AppSlot, role: Role | undefined): boolean {
  return !app.roles || (role !== undefined && app.roles.includes(role));
}

/** The apps this role sees, in rail order. Every place that lists or opens an app goes through this. */
export function appsFor(role: Role | undefined): AppSlot[] {
  return APPS.filter((a) => appVisibleTo(a, role));
}
