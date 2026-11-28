/**
 * My day (plan decision 9): one local draft per day, `<dataDir>/time/days/<YYYY-MM-DD>.json`.
 * Folders 0700, files 0600, each write a temp file renamed over the old one (the `server/settings.ts`
 * pattern), one queue per file. A draft that can't be read is renamed `.bad-<time>` and kept, never
 * overwritten silently. Nothing here logs entry text or paths.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  CERTAINTIES,
  type DayDraft,
  type DayStatus,
  type DraftEntry,
  ENTRY_SOURCES,
  type EntryValues,
  IMPORT_SOURCE,
  LOGGED_FIELDS,
  type LocalChange,
  TIME_DAYS_DIR,
  TIME_DIR,
} from '../../shared/time-contract.ts';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATUSES: readonly DayStatus[] = ['not-confirmed', 'confirmed', 'changed', 'not-sent', 'conflict'];
const SOURCES: readonly string[] = [...ENTRY_SOURCES, IMPORT_SOURCE];

export const MSG_DRAFT_SET_ASIDE =
  "The saved copy of this day couldn't be read, so it was kept aside and the day starts again.";

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A real calendar date written exactly `YYYY-MM-DD`. The only form a day's file name is made from. */
export function isWorkDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const LONDON_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Europe/London date (`YYYY-MM-DD`) of an instant (Intl knows BST), as Toolbox works it out. */
export function londonDate(instant: Date | number): string {
  const parts = LONDON_DATE.formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * The day's bounds as UTC milliseconds: London midnight at its start and at its end (23, 24 or 25 hours
 * apart). London changes clocks at 01:00 UTC, so midnight always exists and is 00:00 or 23:00 UTC.
 */
export function londonDayBounds(workDate: string): { start: number; end: number } {
  const midnight = (date: string): number => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const utc = Date.UTC(y, m - 1, d);
    // BST (UTC+1) puts London midnight an hour before UTC midnight.
    return londonDate(utc - 3_600_000) === date ? utc - 3_600_000 : utc;
  };
  const start = midnight(workDate);
  return { start, end: midnight(londonDate(start + 26 * 3_600_000)) };
}

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/** An ISO 8601 instant with an explicit offset, checked field by field as Toolbox does, or null. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = INSTANT.exec(value);
  if (!m) return null;
  if (!isWorkDate(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59)) return null;
  if (m[8] !== 'Z' && (Number(m[10]) > 14 || Number(m[11]) > 59)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function emptyDraft(workDate: string, now: Date): DayDraft {
  return {
    version: 1,
    workDate,
    entries: [],
    changes: [],
    revision: 0,
    pending: null,
    storedReadAt: null,
    status: 'not-confirmed',
    problems: [],
    updatedAt: now.toISOString(),
  };
}

// ─── Shape check (enough that the engine can trust what it reads) ──────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isField = (v: unknown) => isStr(v) && (LOGGED_FIELDS as readonly string[]).includes(v);

function isValues(v: unknown): v is EntryValues {
  return (
    isObj(v) &&
    isStrOrNull(v.startAt) &&
    isInt(v.minutes) &&
    isStrOrNull(v.workItemId) &&
    isStr(v.description) &&
    isBool(v.billable)
  );
}

function isPlace(v: unknown): boolean {
  return v === null || (isObj(v) && isStrOrNull(v.client) && isStrOrNull(v.project));
}

function isCaptured(v: unknown): boolean {
  if (v === null) return true;
  return (
    isValues(v) &&
    isObj(v) &&
    isStr(v.chatId) &&
    isStr(v.captureKey) &&
    isStr(v.endAt) &&
    typeof v.claudeMinutes === 'number' &&
    isInt(v.prompts)
  );
}

function isEntry(v: unknown): v is DraftEntry {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.source) &&
    SOURCES.includes(v.source) &&
    isStr(v.certainty) &&
    (CERTAINTIES as readonly string[]).includes(v.certainty) &&
    isValues(v.values) &&
    isCaptured(v.captured) &&
    Array.isArray(v.edited) &&
    v.edited.every(isField) &&
    isPlace(v.place) &&
    isBool(v.missing) &&
    isBool(v.fromToolbox) &&
    (v.confirmed === null || isValues(v.confirmed)) &&
    isBool(v.deleted)
  );
}

function isChange(v: unknown): v is LocalChange {
  return (
    isObj(v) &&
    isStr(v.entryId) &&
    isStr(v.at) &&
    (v.action === 'create' || v.action === 'update' || v.action === 'delete') &&
    (v.field === null || isField(v.field)) &&
    isStrOrNull(v.oldValue) &&
    isStrOrNull(v.newValue) &&
    isBool(v.redacted)
  );
}

function isPending(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v) || !isStr(v.submissionId) || !isObj(v.body)) return false;
  const body = v.body;
  return (
    body.submissionId === v.submissionId &&
    isStr(body.workDate) &&
    isInt(body.baseRevision) &&
    Array.isArray(body.entries) &&
    Array.isArray(body.changes)
  );
}

/** The draft, checked, or null when it isn't one for `workDate`. */
export function parseDraft(raw: unknown, workDate: string): DayDraft | null {
  if (!isObj(raw)) return null;
  const ok =
    raw.version === 1 &&
    raw.workDate === workDate &&
    Array.isArray(raw.entries) &&
    raw.entries.every(isEntry) &&
    Array.isArray(raw.changes) &&
    raw.changes.every(isChange) &&
    isInt(raw.revision) &&
    (raw.revision as number) >= 0 &&
    isPending(raw.pending) &&
    isStrOrNull(raw.storedReadAt) &&
    isStr(raw.status) &&
    (STATUSES as readonly string[]).includes(raw.status) &&
    Array.isArray(raw.problems) &&
    raw.problems.every((p) => isObj(p) && isStr(p.entryId) && isStr(p.message)) &&
    isStr(raw.updatedAt);
  return ok ? (raw as unknown as DayDraft) : null;
}

// ─── The store ─────────────────────────────────────────────────────────────────────────────────────────

export interface DayRead {
  draft: DayDraft | null;
  /** Set when a saved draft couldn't be read and was kept aside (plain UK English, for the screen). */
  note: string | null;
}

export interface DayStore {
  /** The saved draft, or null when none (or it was unreadable and kept aside). Waits for queued writes. */
  read(workDate: string): Promise<DayRead>;
  /** Queued; atomic. Throws for a draft whose date isn't a real `YYYY-MM-DD`. */
  write(draft: DayDraft): Promise<void>;
  /**
   * Read, change and save in the day's queue, so no other write can land in between. `change` gets the
   * saved draft (or null) and answers the draft to save, or null to save nothing. Resolves to what is saved.
   */
  update(workDate: string, change: (current: DayDraft | null) => DayDraft | null): Promise<DayDraft | null>;
}

export interface DayStoreDeps {
  now?: () => Date;
  /** Status lines only: never a path or entry text. */
  log?: (line: string) => void;
}

function checkDate(workDate: unknown): string {
  if (!isWorkDate(workDate)) throw new Error('not a work date');
  return workDate;
}

export function createDayStore(dataDir: string, deps: DayStoreDeps = {}): DayStore {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const daysDir = join(dataDir, TIME_DAYS_DIR);
  const queues = new Map<string, Promise<unknown>>();

  const fileOf = (workDate: string) => join(daysDir, `${workDate}.json`);

  function enqueue<T>(workDate: string, job: () => Promise<T>): Promise<T> {
    const prev = queues.get(workDate) ?? Promise.resolve();
    const run = prev.then(job, job);
    const settled = run.then(
      () => {},
      () => {},
    );
    queues.set(workDate, settled);
    void settled.then(() => {
      if (queues.get(workDate) === settled) queues.delete(workDate);
    });
    return run;
  }

  async function ensureDirs(): Promise<void> {
    for (const dir of [join(dataDir, TIME_DIR), daysDir]) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.chmod(dir, 0o700);
    }
  }

  async function readNow(workDate: string): Promise<DayRead> {
    const file = fileOf(workDate);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { draft: null, note: null };
      throw err;
    }
    let draft: DayDraft | null = null;
    try {
      draft = parseDraft(JSON.parse(text), workDate);
    } catch {
      draft = null;
    }
    if (draft) return { draft, note: null };
    await fs.rename(file, `${file}.bad-${now().getTime()}`);
    log('A saved day could not be read. It was kept aside and the day starts again.');
    return { draft: null, note: MSG_DRAFT_SET_ASIDE };
  }

  async function writeNow(draft: DayDraft): Promise<void> {
    await ensureDirs();
    const file = fileOf(draft.workDate);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tmp, file);
      await fs.chmod(file, 0o600);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    async read(workDate) {
      const date = checkDate(workDate);
      return enqueue(date, () => readNow(date));
    },
    async write(draft) {
      const date = checkDate(draft.workDate);
      return enqueue(date, () => writeNow(draft));
    },
    async update(workDate, change) {
      const date = checkDate(workDate);
      return enqueue(date, async () => {
        const { draft } = await readNow(date);
        const next = change(draft);
        if (next === null) return null;
        if (next.workDate !== date) throw new Error('draft is for another day');
        await writeNow(next);
        return next;
      });
    },
  };
}
