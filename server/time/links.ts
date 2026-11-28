/**
 * My day (plan decisions 8 and 27): which Toolbox work item a project or client is.
 * `<dataDir>/time/links.json` (0600, folder 0700), written atomically, one write at a time. A file that
 * can't be read is renamed `.bad-<time>` and the links start empty. `assign` and `applyRemember` are pure.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseProjectKey } from '../../shared/projects.ts';
import {
  type Certainty,
  type ChatPlace,
  type DayDraft,
  type DraftEntry,
  TIME_DIR,
  TIME_LINKS_FILE,
  type TimeLinksFile,
  type WireWorkItem,
} from '../../shared/time-contract.ts';
import { defaultBillable, statusAfterEdit } from './changes.ts';

const WORK_ITEM_ID = /^[0-9a-f]{24}$/;
const CLIENT_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CLIENT_CHARS = 100;

export const emptyLinks = (): TimeLinksFile => ({ version: 1, projects: {}, clients: {} });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const validItem = (v: unknown): v is string => typeof v === 'string' && WORK_ITEM_ID.test(v);
const validClient = (c: string) => c.length <= MAX_CLIENT_CHARS && CLIENT_SLUG.test(c);
const validProject = (p: string) => parseProjectKey(p) !== null;

/** The links, checked: anything malformed is left out. */
export function parseLinks(raw: unknown): TimeLinksFile {
  const out = emptyLinks();
  if (!isObj(raw) || raw.version !== 1) return out;
  if (isObj(raw.projects)) {
    for (const [key, id] of Object.entries(raw.projects))
      if (validProject(key) && validItem(id)) out.projects[key] = id;
  }
  if (isObj(raw.clients)) {
    for (const [key, id] of Object.entries(raw.clients))
      if (validClient(key) && validItem(id)) out.clients[key] = id;
  }
  return out;
}

export interface Assignment {
  workItemId: string | null;
  certainty: Certainty;
  billable: boolean;
}

const UNASSIGNED: Assignment = { workItemId: null, certainty: 'unassigned', billable: false };

/**
 * A block's work item from its place (decision 8): the project's link or a work item whose `cortexKey` is
 * the project → certain; a client-only chat's client link → strong; a project with neither falls back to its
 * client's link as a suggestion; otherwise unassigned. A link is used only while the item is listed.
 */
export function assign(
  place: ChatPlace | null,
  links: TimeLinksFile,
  workItems: readonly WireWorkItem[],
): Assignment {
  if (!place) return UNASSIGNED;
  const listed = (id: string | undefined) =>
    id !== undefined && workItems.some((w) => w.id === id) ? id : null;
  const make = (workItemId: string, certainty: Certainty): Assignment => ({
    workItemId,
    certainty,
    billable: defaultBillable(workItemId, workItems),
  });
  if (place.project) {
    const linked = listed(
      Object.hasOwn(links.projects, place.project) ? links.projects[place.project] : undefined,
    );
    if (linked) return make(linked, 'certain');
    const keyed = workItems.find((w) => w.cortexKey === place.project);
    if (keyed) return make(keyed.id, 'certain');
  }
  if (place.client) {
    const linked = listed(
      Object.hasOwn(links.clients, place.client) ? links.clients[place.client] : undefined,
    );
    if (linked) return make(linked, place.project ? 'suggested' : 'strong');
  }
  return UNASSIGNED;
}

export const samePlace = (a: ChatPlace | null, b: ChatPlace | null): boolean =>
  a !== null && b !== null && a.client === b.client && a.project === b.project;

/**
 * "Remember for" applies at once (decision 27): the day's other live entries with the same place whose
 * work item the person hasn't picked take `workItemId` (billable from its kind unless they set billable).
 * Not a person's edit, so nothing is marked edited and no change is recorded.
 */
export function applyRemember(
  draft: DayDraft,
  place: ChatPlace,
  workItemId: string,
  workItems: readonly WireWorkItem[],
  now: Date = new Date(),
): DayDraft {
  const certainty: Certainty = place.project ? 'certain' : 'strong';
  let touched = false;
  const entries = draft.entries.map((e): DraftEntry => {
    if (e.deleted || !samePlace(e.place, place) || e.edited.includes('workItemId')) return e;
    const billable = e.edited.includes('billable')
      ? e.values.billable
      : defaultBillable(workItemId, workItems);
    if (e.values.workItemId === workItemId && e.values.billable === billable && e.certainty === certainty)
      return e;
    touched = true;
    return {
      ...e,
      certainty,
      values: { ...e.values, workItemId, billable },
      captured: e.captured ? { ...e.captured, workItemId, billable } : null,
    };
  });
  if (!touched) return draft;
  const next = { ...draft, entries, updatedAt: now.toISOString() };
  return { ...next, status: statusAfterEdit(next) };
}

// ─── The file ──────────────────────────────────────────────────────────────────────────────────────────

export interface LinksStore {
  /** The saved links (empty when none). Waits for queued writes. */
  read(): Promise<TimeLinksFile>;
  /**
   * Save the link for the place's project, or its client when it has no project; null forgets it.
   * Queued; resolves to the links as saved.
   */
  remember(place: ChatPlace, workItemId: string | null): Promise<TimeLinksFile>;
}

export function createLinksStore(
  dataDir: string,
  deps: { now?: () => Date; log?: (line: string) => void } = {},
): LinksStore {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const file = join(dataDir, TIME_LINKS_FILE);
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async function load(): Promise<TimeLinksFile> {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyLinks();
      throw err;
    }
    try {
      const raw: unknown = JSON.parse(text);
      if (isObj(raw) && raw.version === 1) return parseLinks(raw);
    } catch {
      // kept aside below
    }
    await fs.rename(file, `${file}.bad-${now().getTime()}`);
    log('The saved work item links could not be read. A copy was kept and they start empty.');
    return emptyLinks();
  }

  async function save(links: TimeLinksFile): Promise<void> {
    const dir = join(dataDir, TIME_DIR);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(links, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tmp, file);
      await fs.chmod(file, 0o600);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    read: () => enqueue(load),
    remember(place, workItemId) {
      return enqueue(async () => {
        const links = await load();
        const project = place.project && validProject(place.project) ? place.project : null;
        const client = !project && place.client && validClient(place.client) ? place.client : null;
        const table = project ? links.projects : client ? links.clients : null;
        const key = project ?? client;
        if (!table || !key) return links;
        if (workItemId === null) {
          if (!Object.hasOwn(table, key)) return links;
          delete table[key];
        } else {
          if (!validItem(workItemId)) return links;
          table[key] = workItemId;
        }
        await save(links);
        return links;
      });
    },
  };
}
