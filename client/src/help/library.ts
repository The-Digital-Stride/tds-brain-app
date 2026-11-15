import {
  HELP_AREA_LABELS,
  HELP_AREAS,
  type HelpGroup,
  type HelpLibrary,
  type HelpTopic,
} from './contract.ts';
import { parseHelpFile } from './frontmatter.ts';

export { parseHelpFile };

/** Builds a library from parsed topics. Pure; the bundled one is `helpLibrary`. */
export function createHelpLibrary(input: readonly HelpTopic[]): HelpLibrary {
  const areaIndex = (t: HelpTopic) => HELP_AREAS.indexOf(t.area);
  const topics = [...input].sort(
    (a, b) => areaIndex(a) - areaIndex(b) || a.order - b.order || a.title.localeCompare(b.title),
  );
  const ids = new Map(topics.map((t) => [t.id, t]));
  return {
    topics,
    byId: (id) => ids.get(id),
    groups(): readonly HelpGroup[] {
      return HELP_AREAS.map((area) => ({
        area,
        label: HELP_AREA_LABELS[area],
        topics: topics.filter((t) => t.area === area),
      })).filter((g) => g.topics.length > 0);
    },
    search(query, limit = 20) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const scored: { t: HelpTopic; score: number }[] = [];
      for (const t of topics) {
        const score = t.title.toLowerCase().includes(q)
          ? 3
          : t.summary.toLowerCase().includes(q)
            ? 2
            : t.body.toLowerCase().includes(q)
              ? 1
              : 0;
        if (score > 0) scored.push({ t, score });
      }
      // Array.sort is stable, so equal scores keep the library order.
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.t);
    },
  };
}

/** Parses raw files (keyed by path). A bad file is left out and warned about, never thrown. */
export function loadHelpTopics(files: Record<string, string>): HelpTopic[] {
  const topics: HelpTopic[] = [];
  for (const [path, raw] of Object.entries(files)) {
    const fileName = path.split('/').pop() ?? path;
    const result = parseHelpFile(fileName, raw);
    if (result.ok) topics.push(result.topic);
    else console.warn(`Help page left out. ${result.errors.join(' ')}`);
  }
  return topics;
}

// Vite root is `client`, so the repo's help folder is three levels up from here.
const pages = import.meta.glob('../../../help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const images = import.meta.glob('../../../help/images/*.webp', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const helpLibrary: HelpLibrary = createHelpLibrary(loadHelpTopics(pages));

const imageByName = new Map(
  Object.entries(images).map(([path, url]) => [path.split('/').pop() ?? path, url]),
);

/** Maps "images/x.webp" to the bundled URL, or null when there is no such picture. */
export function helpImageUrl(src: string): string | null {
  const m = /^images\/([A-Za-z0-9._-]+\.webp)$/.exec(src);
  return (m && imageByName.get(m[1] as string)) || null;
}

/** The badge words for a page written for some roles, or null when it is for everyone. */
export function helpRoleWords(roles: HelpTopic['roles']): string | null {
  if (roles === 'all') return null;
  const owner = roles.includes('owner');
  const scout = roles.includes('scout');
  if (owner && scout) return 'For owners and scouts';
  if (owner) return 'For owners';
  if (scout) return 'For scouts';
  return null;
}
