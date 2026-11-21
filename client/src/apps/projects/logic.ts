import type { TeamMember } from '../../../../shared/contract.ts';
import { matchedKey } from '../../../../shared/projects.ts';
import {
  INTERNAL_CLIENT,
  type Light,
  PROJECT_BRIEF_MAX,
  PROJECT_BUDGET_MAX_HOURS,
  PROJECT_SLUG_MAX,
  PROJECT_SLUG_PATTERN,
  PROJECT_STAGE_MAX,
  PROJECT_STAGES_MAX,
  PROJECT_TEAM_MAX,
  PROJECT_TITLE_MAX,
  type ProjectCard,
  type ProjectFields,
  type ProjectStatus,
  type ProjectsErrorCode,
  type TodoProjectMatch,
} from '../../../../shared/projects-contract.ts';

/** Pure rules for the Projects app, kept out of the components so they are tested on their own. */

export const READ_ONLY_NOTICE = "Update the brain's skills to change projects.";

export const STATUS_WORDS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  'on-hold': 'On hold',
  done: 'Done',
};
export const STATUSES = Object.keys(STATUS_WORDS) as ProjectStatus[];

export const LIGHT_WORDS: Record<Light, string> = { green: 'Green', amber: 'Amber', red: 'Red' };

export const SERVICE_WORDS: Record<string, string> = {
  ppc: 'PPC',
  seo: 'SEO',
  'social-email': 'Social and email',
  hosting: 'Hosting',
};
export const KNOWN_SERVICES = Object.keys(SERVICE_WORDS);

export const serviceWords = (s: string): string => SERVICE_WORDS[s] ?? s;

/** A team slug as a name: the roster's name, else the slug tidied up. */
export function personName(slug: string, team: readonly TeamMember[] | undefined): string {
  const hit = team?.find((m) => m.slug === slug);
  if (hit) return hit.name;
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The status shown for a card: archived projects always read as done. */
export function statusOf(card: Pick<ProjectCard, 'status' | 'archived'>): ProjectStatus {
  return card.archived ? 'done' : card.status;
}

/** Decision 12: "Mine" = I am the owner, in `team`, or in `teamFromTodos`. */
export function isMine(card: ProjectCard, me: string): boolean {
  if (!me) return false;
  return card.owner === me || card.team.includes(me) || card.teamFromTodos.some((t) => t.person === me);
}

export interface Filters {
  mine: boolean;
  status: ProjectStatus | '';
  owner: string;
  service: string;
}
export const NO_FILTERS: Filters = { mine: false, status: '', owner: '', service: '' };

export function filterProjects(cards: readonly ProjectCard[], f: Filters, me: string): ProjectCard[] {
  return cards.filter((c) => {
    if (f.mine && !isMine(c, me)) return false;
    if (f.status && statusOf(c) !== f.status) return false;
    if (f.owner && c.owner !== f.owner) return false;
    if (f.service && !c.service.includes(f.service)) return false;
    return true;
  });
}

export interface ProjectGroup {
  /** Client slug, or 'personal'. */
  id: string;
  title: string;
  items: ProjectCard[];
}

/** Grouped by client name (A to Z), personal last; inside a group, open projects first, then by title. */
export function groupProjects(
  cards: readonly ProjectCard[],
  clients: readonly { slug: string; name: string }[],
): ProjectGroup[] {
  const byId = new Map<string, ProjectGroup>();
  for (const c of cards) {
    const id = c.space === 'personal' || c.client === null ? 'personal' : c.client;
    let g = byId.get(id);
    if (!g) {
      const name =
        id === 'personal'
          ? 'Personal'
          : (clients.find((x) => x.slug === id)?.name ??
            (id === INTERNAL_CLIENT ? 'The Digital Stride' : id));
      g = { id, title: name, items: [] };
      byId.set(id, g);
    }
    g.items.push(c);
  }
  const rank = (c: ProjectCard) => (statusOf(c) === 'done' ? 1 : 0);
  for (const g of byId.values())
    g.items.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'en-GB'));
  return [...byId.values()].sort((a, b) => {
    if (a.id === 'personal') return 1;
    if (b.id === 'personal') return -1;
    return a.title.localeCompare(b.title, 'en-GB');
  });
}

/** Everyone who owns a project in the list, for the Account Owner filter. */
export function ownersIn(cards: readonly ProjectCard[]): string[] {
  return [...new Set(cards.map((c) => c.owner).filter((o): o is string => !!o))].sort();
}

/** Every service named on some card, known ones first. */
export function servicesIn(cards: readonly ProjectCard[]): string[] {
  const all = new Set(cards.flatMap((c) => c.service));
  const known = KNOWN_SERVICES.filter((s) => all.has(s));
  const other = [...all].filter((s) => !KNOWN_SERVICES.includes(s)).sort();
  return [...known, ...other];
}

/** "28 Feb 2027" from YYYY-MM-DD (or an ISO time); the text as written when it can't be read. */
export function dateWords(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const todoWords = (n: number): string =>
  n === 0 ? 'No open to-dos' : `${n} open to-do${n === 1 ? '' : 's'}`;

/** The label that goes under a row's title. */
export function rowMeta(card: ProjectCard): string {
  const bits = [STATUS_WORDS[statusOf(card)]];
  if (card.end) bits.push(`ends ${dateWords(card.end)}`);
  bits.push(todoWords(card.openTodos).toLowerCase());
  return bits.join(' · ');
}

/** The health light's colour as the app's `.health-dot` state. */
export function dotState(light: Light | null): 'ok' | 'note' | 'problem' | undefined {
  if (light === 'green') return 'ok';
  if (light === 'amber') return 'note';
  if (light === 'red') return 'problem';
  return undefined;
}

/** True when the card can be edited: a real card, not archived. */
export function isEditable(card: ProjectCard): boolean {
  return card.card === 'ok' && !card.archived;
}

// ─── Team (decision 26) ───────────────────────────────────────────────────────────────────────────

export interface TeamRow {
  person: string;
  role: 'owner' | 'team' | 'from-todos';
  openTodos?: number;
}

/** Owner first, then the team, then people from their to-dos (tagged "from to-dos"). */
export function teamRows(card: ProjectCard): TeamRow[] {
  const rows: TeamRow[] = [];
  if (card.owner) rows.push({ person: card.owner, role: 'owner' });
  for (const p of card.team) if (p !== card.owner) rows.push({ person: p, role: 'team' });
  for (const t of card.teamFromTodos)
    if (!rows.some((r) => r.person === t.person))
      rows.push({ person: t.person, role: 'from-todos', openTodos: t.openTodos });
  return rows;
}

// ─── To-dos ───────────────────────────────────────────────────────────────────────────────────────

export interface StageGroup<T> {
  /** The stage name; '' for to-dos with no stage (or one the card does not list). */
  stage: string;
  title: string;
  items: T[];
}

/** To-dos whose `projectMatch` resolves to this key. */
export function todosForProject<T extends { projectMatch?: TodoProjectMatch }>(
  todos: readonly T[],
  key: string,
): T[] {
  return todos.filter((t) => matchedKey(t.projectMatch) === key);
}

/** In the card's stage order; stages the card does not list, and no stage, go last as "No stage". */
export function groupByStage<T extends { stage?: string | null }>(
  todos: readonly T[],
  stages: readonly string[],
): StageGroup<T>[] {
  const out: StageGroup<T>[] = stages.map((s) => ({ stage: s, title: s, items: [] }));
  const none: StageGroup<T> = { stage: '', title: 'No stage', items: [] };
  for (const t of todos) {
    const g = out.find((x) => x.stage === t.stage);
    (g ?? none).items.push(t);
  }
  return [...out.filter((g) => g.items.length > 0), ...(none.items.length > 0 ? [none] : [])];
}

// ─── Errors ───────────────────────────────────────────────────────────────────────────────────────

/** Plain words for each error code (UK English). `message` is the server's own wording, used for bad-request. */
export function errorWords(code: string, message?: string): string {
  switch (code as ProjectsErrorCode) {
    case 'bad-request':
      return message || "Something in this isn't right. Check the details and try again.";
    case 'not-found':
      return "That project can't be found. It may have been moved or removed.";
    case 'exists':
      return 'A project with that folder name already exists. Choose another folder name.';
    case 'changed':
      return 'Someone changed this project while you were looking at it. Reload to see the latest version.';
    case 'not-allowed':
      return message || "You can't make that change. A shared project can't use your personal files.";
    case 'internal':
      return 'Something went wrong on our side. Try again in a moment.';
    default:
      return message || 'Something went wrong. Please try again.';
  }
}

// ─── The form ─────────────────────────────────────────────────────────────────────────────────────

/** A folder name made from a title: lower case, dashes, at most PROJECT_SLUG_MAX. */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** Stages typed one per line or separated by commas. */
export function parseStages(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface FormValues {
  title: string;
  slug: string;
  /** Client slug, or 'personal'. Only used when creating. */
  client: string;
  kind: 'one-off' | 'ongoing' | '';
  status: ProjectStatus;
  health: Light | '';
  comms: Light | '';
  owner: string;
  team: string[];
  service: string[];
  start: string;
  end: string;
  budget: string;
  billable: boolean;
  stages: string;
  brief: string;
}

export function valuesFromCard(card: ProjectCard): FormValues {
  return {
    title: card.title,
    slug: card.slug,
    client: card.space === 'personal' ? 'personal' : (card.client ?? ''),
    kind: card.kind ?? '',
    status: card.status,
    health: card.health ?? '',
    comms: card.comms ?? '',
    owner: card.owner ?? '',
    team: card.team,
    service: card.service,
    start: card.start ?? '',
    end: card.end ?? '',
    budget: card.budgetHours === null ? '' : String(card.budgetHours),
    billable: card.billable ?? false,
    stages: card.stages.join('\n'),
    brief: card.brief,
  };
}

export const EMPTY_VALUES: FormValues = {
  title: '',
  slug: '',
  client: '',
  kind: 'one-off',
  status: 'planned',
  health: '',
  comms: '',
  owner: '',
  team: [],
  service: [],
  start: '',
  end: '',
  budget: '',
  billable: false,
  stages: '',
  brief: '',
};

export type FormErrors = Partial<Record<keyof FormValues, string>>;

/** What is wrong with the form, in plain words, keyed by field. {} means it can be sent. */
export function validate(v: FormValues, mode: 'create' | 'edit' | 'card'): FormErrors {
  const e: FormErrors = {};
  const title = v.title.trim();
  if (!title) e.title = 'Give the project a title.';
  else if (title.length > PROJECT_TITLE_MAX) e.title = `Keep the title to ${PROJECT_TITLE_MAX} characters.`;
  if (mode === 'create') {
    if (!v.client) e.client = 'Choose a client, or Personal.';
    if (!v.slug) e.slug = 'Give the project a folder name.';
    else if (v.slug.length > PROJECT_SLUG_MAX)
      e.slug = `Keep the folder name to ${PROJECT_SLUG_MAX} characters.`;
    else if (!PROJECT_SLUG_PATTERN.test(v.slug))
      e.slug = 'Use lower-case letters and numbers, with single dashes between words.';
  }
  if (v.start && v.end && v.end < v.start) e.end = 'The end date must not be before the start date.';
  if (v.budget.trim()) {
    const n = Number(v.budget);
    if (!Number.isFinite(n) || n < 0) e.budget = 'Enter hours as a number, such as 40.';
    else if (n > PROJECT_BUDGET_MAX_HOURS)
      e.budget = `Keep the hours to ${PROJECT_BUDGET_MAX_HOURS.toLocaleString('en-GB')} or fewer.`;
  }
  const stages = parseStages(v.stages);
  if (stages.length > PROJECT_STAGES_MAX) e.stages = `Use ${PROJECT_STAGES_MAX} stages or fewer.`;
  else if (stages.some((s) => s.length > PROJECT_STAGE_MAX))
    e.stages = `Keep each stage to ${PROJECT_STAGE_MAX} characters.`;
  else if (new Set(stages.map((s) => s.toLowerCase())).size !== stages.length)
    e.stages = 'Each stage needs a different name.';
  if (v.team.length > PROJECT_TEAM_MAX) e.team = `Keep the team to ${PROJECT_TEAM_MAX} people or fewer.`;
  if (v.brief.length > PROJECT_BRIEF_MAX) e.brief = 'The brief is too long.';
  return e;
}

/** All the form's fields as ProjectFields (empty ones left out, or null where a clear is meant). */
export function fieldsFromValues(v: FormValues): ProjectFields & { title: string } {
  const ongoing = v.kind === 'ongoing';
  return {
    title: v.title.trim(),
    kind: v.kind || null,
    status: v.status,
    health: v.health || null,
    comms: v.comms || null,
    owner: v.owner || null,
    team: v.team,
    service: v.service,
    start: v.start || null,
    // `end` belongs to one-off projects only.
    end: ongoing ? null : v.end || null,
    budgetHours: v.budget.trim() ? Number(v.budget) : null,
    billable: v.billable,
    stages: parseStages(v.stages),
    brief: v.brief.trim(),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only what differs from the card, so an edit changes nothing else. {} means nothing changed. */
export function changedFields(card: ProjectCard, v: FormValues): ProjectFields {
  const next = fieldsFromValues(v);
  const was: ProjectFields = {
    title: card.title,
    kind: card.kind,
    status: card.status,
    health: card.health,
    comms: card.comms,
    owner: card.owner,
    team: card.team,
    service: card.service,
    start: card.start,
    end: card.end,
    budgetHours: card.budgetHours,
    billable: card.billable,
    stages: card.stages,
    brief: card.brief,
  };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof ProjectFields)[]) {
    // An untouched billable box on a card that never set it is not a change.
    if (k === 'billable' && card.billable === null && next.billable === false) continue;
    if (!same(next[k], was[k])) out[k] = next[k];
  }
  return out as ProjectFields;
}
