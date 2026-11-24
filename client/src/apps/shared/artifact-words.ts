import type { ArtifactSource } from '../../../../shared/pages.ts';
import { isArtifactUrl } from '../../../../shared/pages.ts';

/** "23 November 2026" from a `YYYY-MM-DD` day; empty when it is not a date. */
function longDate(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at);
}

/** The artifact only when its address passes the same check the server uses; anything else is not shown. */
export function validArtifact(artifact: ArtifactSource | undefined): ArtifactSource | null {
  return artifact && isArtifactUrl(artifact.url) ? artifact : null;
}

/** "Copied from claude.ai on 23 November 2026", or "Link to a claude.ai page, added 23 November 2026". */
export function artifactWords(artifact: ArtifactSource): string {
  const date = artifact.copied ? longDate(artifact.copied) : '';
  if (artifact.kind === 'link')
    return date ? `Link to a claude.ai page, added ${date}` : 'Link to a claude.ai page';
  return date ? `Copied from claude.ai on ${date}` : 'Copied from claude.ai';
}
