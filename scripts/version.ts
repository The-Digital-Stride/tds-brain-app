/**
 * The rules behind the automatic version bump (scripts/bump-version.ts), kept pure so they can be tested.
 * The version lives in package.json, which the server reads for Settings and its log.
 *
 *   feat → minor; fix, perf, refactor → patch; `!` or a BREAKING CHANGE footer (any type) → major;
 *   anything else (chore, docs, style, test, ci, build, releases, merges) → no bump.
 * A release covers several commits; the largest bump among them wins.
 */

export type Bump = 'major' | 'minor' | 'patch';

export interface ParsedCommit {
  type: string;
  subject: string;
  bump: Bump | null;
}

const PATCH_TYPES = new Set(['fix', 'perf', 'refactor']);

/** Reads a conventional commit message. Null when the first line isn't one. */
export function parseCommit(message: string): ParsedCommit | null {
  const firstLine = message.split('\n', 1)[0] ?? '';
  const m = firstLine.match(/^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/);
  if (!m) return null;
  const type = m[1] ?? '';
  const scope = m[2] ?? '';
  const subject = (m[4] ?? '').trim();
  if (type === 'chore' && scope === '(release)') return { type, subject, bump: null };
  const breaking = m[3] === '!' || /^BREAKING[ -]CHANGE:/m.test(message);
  const bump: Bump | null = breaking
    ? 'major'
    : type === 'feat'
      ? 'minor'
      : PATCH_TYPES.has(type)
        ? 'patch'
        : null;
  return { type, subject, bump };
}

const RANK: Record<Bump, number> = { patch: 1, minor: 2, major: 3 };

/** The bump a release of these commits needs: the largest of theirs, or null if none needs one. */
export function releaseBump(commits: Array<ParsedCommit | null>): Bump | null {
  let best: Bump | null = null;
  for (const c of commits) {
    if (c?.bump && (!best || RANK[c.bump] > RANK[best])) best = c.bump;
  }
  return best;
}

export function nextVersion(version: string, bump: Bump): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Can't bump version "${version}": expected x.y.z`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  items: Array<{ type: string; subject: string }>;
}

/** Adds the entry above the newest one (or after the heading when there are none). */
export function addChangelogEntry(changelog: string, e: ChangelogEntry): string {
  const lines = e.items.map((i) => `- **${i.type}**: ${i.subject}\n`).join('');
  const block = `## v${e.version} — ${e.date}\n\n${lines}`;
  const at = changelog.indexOf('\n## ');
  if (at === -1) return `${changelog.replace(/\n*$/, '')}\n\n${block}`;
  return `${changelog.slice(0, at + 1)}${block}\n${changelog.slice(at + 1)}`;
}

/** Rewrites only the top-level "version" line, so package.json keeps its formatting. */
export function setPackageVersion(pkgText: string, version: string): string {
  const re = /^(\s{2}"version":\s*")[^"]*(")/m;
  if (!re.test(pkgText)) throw new Error('package.json has no top-level "version" to bump');
  return pkgText.replace(re, `$1${version}$2`);
}
