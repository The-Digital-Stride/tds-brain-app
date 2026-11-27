import { RESTRICTED_WHO } from '../../../shared/project-visibility.ts';
import { Icon } from './Icon.tsx';

/** The accessible name of the badge (the visible word is just "Restricted"). */
export const RESTRICTED_BADGE_NAME = `Restricted: ${RESTRICTED_WHO.charAt(0).toLowerCase()}${RESTRICTED_WHO.slice(1)}`;

/**
 * The mark on a restricted project (plan 2026-11-27-restricted-projects, decision 10): the app's small label pill
 * with the lock icon and the word, never colour alone. Shown beside a project's title wherever it is named.
 */
export function RestrictedBadge({ compact, id }: { compact?: boolean; id?: string }) {
  return (
    <span className="chip restricted-badge" data-tip={RESTRICTED_WHO}>
      <Icon name="lock" size={12} />
      {/* Compact: the lock alone, where the word would crowd out a chosen name (a closed picker). */}
      {compact ? null : <span aria-hidden="true">Restricted</span>}
      <span className="visually-hidden" id={id}>
        {RESTRICTED_BADGE_NAME}
      </span>
    </span>
  );
}
