import { Icon } from './Icon.tsx';

/** The accessible name of the badge (the visible word is just "Restricted"). */
export const RESTRICTED_BADGE_NAME = 'Restricted: only the project team can see it';

/**
 * The mark on a restricted project (plan 2026-11-27-restricted-projects, decision 10): the app's small label pill
 * with the lock icon and the word, never colour alone. Shown beside a project's title wherever it is named.
 */
export function RestrictedBadge() {
  return (
    <span className="chip restricted-badge" data-tip="Only the project team can see it">
      <Icon name="lock" size={12} />
      <span aria-hidden="true">Restricted</span>
      <span className="visually-hidden">{RESTRICTED_BADGE_NAME}</span>
    </span>
  );
}
