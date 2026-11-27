/**
 * Restricted projects (plan docs/plans/2026-11-27-restricted-projects.md): the one rule for who can see a
 * project in the app, used by the server (hiding), the client (badges, pickers) and mirrored by the
 * `tdsapp-projects` script (who may switch it).
 *
 * This hides a project in the app only. Its folder still syncs to every Mac through the brain, so nothing
 * here is a security boundary: it is the app's own curtain, applied in one place.
 */

/** A card's `visibility:` line. No line means 'everyone'. */
export type ProjectVisibility = 'everyone' | 'restricted';

/** The script's `capabilities` feature for the `visibility` field. Absent: the app still hides, but can't switch. */
export const PROJECTS_VISIBILITY_CAPABILITY = 'projects-visibility-v1';

/** The frontmatter key on `project.md`. */
export const VISIBILITY_KEY = 'visibility';

/** What a to-do's project chip, a search row or a picker says in place of a hidden project's title. */
export const RESTRICTED_LABEL = 'Restricted project';
/**
 * Who sees a restricted project, in the words every screen uses. Owners and scouts are named on purpose: someone
 * restricting a pay review must not think the scouts are shut out.
 */
export const RESTRICTED_WHO = 'Only its team, owners and scouts can see it';

/** The person looking: this Mac's identity (shared/contract.ts Identity, structurally). */
export interface ProjectViewer {
  name: string;
  slug: string;
  role: 'owner' | 'scout' | 'team' | 'unknown';
  knownMember: boolean;
}

/** The parts of a card the rule reads. */
export interface VisibilityCard {
  space: 'client' | 'personal' | 'legacy';
  visibility?: ProjectVisibility;
  owner: string | null;
  team: string[];
}

/**
 * A card's raw `visibility` value. Fails closed: no value, an empty one or "everyone" (any case) is
 * 'everyone'; ANY other value is 'restricted', so a typo or a value from a newer version never opens a
 * project up.
 */
export function parseVisibility(raw: unknown): ProjectVisibility {
  if (raw === undefined || raw === null) return 'everyone';
  if (typeof raw !== 'string') return 'restricted';
  const v = raw.trim().toLowerCase();
  return v === '' || v === 'everyone' ? 'everyone' : 'restricted';
}

/**
 * For a card whose frontmatter can't be parsed (`card: 'unreadable'`): true when its text still carries a
 * `visibility:` line that isn't "everyone". Such a card is treated as restricted with nobody on it, so a
 * broken file (a merge conflict, say) never shows a restricted project to the whole team.
 */
export function rawTextRestricted(text: string): boolean {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^visibility\s*:\s*(.*?)\s*$/i.exec(line);
    if (m) {
      const value = (m[1] as string).replace(/^["']|["']$/g, '');
      if (parseVisibility(value) === 'restricted') return true;
    }
  }
  return false;
}

/** The two slug forms a name is written in: the brain's member slug, and the Workbench's. */
export function slugForms(name: string): string[] {
  const lower = name.toLowerCase();
  const member = lower.replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
  const workbench = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [...new Set([member, workbench].filter((s) => s !== ''))];
}

/** Every slug a person may be written as on a card: their own slug plus both forms of their name. */
export function personSlugs(person: { slug: string; name?: string }): string[] {
  return [...new Set([person.slug, ...(person.name ? slugForms(person.name) : [])].filter((s) => s !== ''))];
}

/** On the project: its Account Owner or on its team (either slug form). */
export function onProject(
  card: Pick<VisibilityCard, 'owner' | 'team'>,
  person: { slug: string; name?: string },
): boolean {
  const slugs = personSlugs(person);
  if (slugs.length === 0) return false;
  if (card.owner !== null && slugs.includes(card.owner)) return true;
  return card.team.some((t) => slugs.includes(t));
}

/** Owners and scouts see every project (Ian, 2026-11-27). Someone the roster doesn't know never does. */
export function seesEveryProject(viewer: ProjectViewer): boolean {
  return viewer.knownMember && (viewer.role === 'owner' || viewer.role === 'scout');
}

/** A personal project is never restricted: it is already this Mac's alone. */
export function isRestricted(card: Pick<VisibilityCard, 'space' | 'visibility'>): boolean {
  return card.space !== 'personal' && card.visibility === 'restricted';
}

/**
 * THE rule. An open project: everyone. A restricted one: its Account Owner, its team, and every owner and
 * scout. Someone the roster doesn't know sees no restricted project.
 */
export function canSeeProject(card: VisibilityCard, viewer: ProjectViewer): boolean {
  if (!isRestricted(card)) return true;
  if (!viewer.knownMember) return false;
  return seesEveryProject(viewer) || onProject(card, viewer);
}

/**
 * Who may switch a shared project between everyone and restricted: its Account Owner, an owner or a scout.
 * The script decides for real (same rule as changing the Account Owner); this is for showing the control.
 */
export function mayRestrict(card: VisibilityCard, viewer: ProjectViewer): boolean {
  if (card.space === 'personal' || !viewer.knownMember) return false;
  if (seesEveryProject(viewer)) return true;
  return card.owner !== null && personSlugs(viewer).includes(card.owner);
}

/**
 * Whether a task in this project may be given to this person: always for an open project; for a restricted
 * one, only someone who can see it. `seesAll` is ProjectList.seesAll (the owners' and scouts' slugs).
 */
export function canTakeTask(
  card: VisibilityCard,
  person: { slug: string; name?: string },
  seesAll: readonly string[],
): boolean {
  if (!isRestricted(card)) return true;
  if (onProject(card, person)) return true;
  return personSlugs(person).some((s) => seesAll.includes(s));
}

/** The note shown when a task can't go to someone outside a restricted project. `name` is their display name. */
export function outsideProjectNote(name: string): string {
  return `${name} isn't on this restricted project. Add them to the project team first, then give them the task.`;
}
