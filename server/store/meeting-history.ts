import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type KeptMeeting,
  MEETING_HISTORY_DAYS,
  MEETING_HISTORY_FILE,
  MEETING_HISTORY_MAX,
  type MeetingHistoryFile,
} from '../../shared/project-meetings-contract.ts';
import { parseProjectKey } from '../../shared/projects.ts';
import { meetingEndMs } from '../brain/meeting-match.ts';

/**
 * Past meetings matched to projects (Projects R2 phase 4, decision 2), in the app's own data folder, never the
 * brain. Only meetings that have ENDED are kept, keyed by id and start together, for MEETING_HISTORY_DAYS, at
 * most MEETING_HISTORY_MAX (oldest start dropped first). Attendee NAMES only: emails never reach this file. Same
 * pattern as project-seen.ts: queued writes, a bad read never wipes the file, no data folder → memory only.
 */
export { MEETING_HISTORY_FILE } from '../../shared/project-meetings-contract.ts';

export interface MeetingHistoryStore {
  /** Every kept meeting (a copy); empty when none are saved or the file can't be read. */
  all(): Promise<KeptMeeting[]>;
  /** Adds or refreshes meetings that have ended by `now`, then drops old ones and cuts to the cap. */
  merge(meetings: KeptMeeting[], now: Date): Promise<void>;
}

const MAX_PEOPLE = 20;
const empty = (): MeetingHistoryFile => ({ v: 1, meetings: [] });
const idOf = (m: KeptMeeting) => `${m.id}\u0000${m.start}`;

/** The meeting, checked and copied (names with an "@" dropped), or null when it is not one. */
function check(raw: unknown): KeptMeeting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '' || typeof r.title !== 'string') return null;
  if (typeof r.start !== 'string' || Number.isNaN(Date.parse(r.start))) return null;
  if (typeof r.key !== 'string' || parseProjectKey(r.key) === null) return null;
  if (r.match !== 'title' && r.match !== 'only' && r.match !== 'ref') return null;
  const end = typeof r.end === 'string' && !Number.isNaN(Date.parse(r.end)) ? r.end : null;
  const people = Array.isArray(r.people)
    ? r.people.filter((p): p is string => typeof p === 'string' && p.trim() !== '' && !p.includes('@'))
    : [];
  const others =
    typeof r.others === 'number' && Number.isFinite(r.others) ? Math.max(0, Math.trunc(r.others)) : 0;
  return {
    id: r.id,
    key: r.key,
    match: r.match,
    title: r.title,
    start: r.start,
    end,
    people: people.slice(0, MAX_PEOPLE),
    others: Math.max(others, Math.min(people.length, MAX_PEOPLE)),
  };
}

function clean(raw: unknown): MeetingHistoryFile {
  const out = empty();
  const list = (raw as { meetings?: unknown } | null)?.meetings;
  if (!Array.isArray(list)) return out;
  const seen = new Set<string>();
  for (const entry of list) {
    const m = check(entry);
    if (!m || seen.has(idOf(m))) continue;
    seen.add(idOf(m));
    out.meetings.push(m);
  }
  return out;
}

function trim(data: MeetingHistoryFile, now: Date): void {
  const oldest = now.getTime() - MEETING_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  data.meetings = data.meetings.filter((m) => Date.parse(m.start) >= oldest);
  data.meetings.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  if (data.meetings.length > MEETING_HISTORY_MAX) data.meetings.length = MEETING_HISTORY_MAX;
}

export function createMeetingHistoryStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
): MeetingHistoryStore {
  const file = dataDir ? join(dataDir, MEETING_HISTORY_FILE) : null;
  let memory: MeetingHistoryFile | null = file ? null : empty();
  let queue: Promise<void> = Promise.resolve();
  let loading: Promise<MeetingHistoryFile> | null = null;

  /** Read once and shared; throws when the file can't be read for any reason except being absent (nothing cached). */
  function load(): Promise<MeetingHistoryFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<MeetingHistoryFile> {
    const path = file as string;
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        memory = empty();
        return memory;
      }
      throw err;
    }
    try {
      memory = clean(JSON.parse(text));
    } catch {
      try {
        await fs.copyFile(path, `${path}.broken`);
      } catch {
        // a failed copy must not stop the app reading the file as empty
      }
      log('The saved meeting history could not be read. A copy was kept and it starts empty.');
      memory = empty();
    }
    return memory;
  }

  async function save(data: MeetingHistoryFile): Promise<void> {
    if (!file || !dataDir) return;
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  function enqueue(change: (data: MeetingHistoryFile) => boolean): Promise<void> {
    const job = queue.then(async () => {
      let data: MeetingHistoryFile;
      try {
        data = await load();
      } catch {
        log('The saved meeting history could not be read, so this change was not saved.');
        return;
      }
      if (!change(data)) return;
      try {
        await save(data);
      } catch {
        log('Could not save the meeting history.');
      }
    });
    queue = job.catch(() => {});
    return job.catch(() => {});
  }

  return {
    async all() {
      await queue;
      try {
        return structuredClone((await load()).meetings);
      } catch {
        return [];
      }
    },
    merge(meetings, now) {
      const ended = meetings
        .map(check)
        .filter((m): m is KeptMeeting => m !== null && meetingEndMs(m.start, m.end) <= now.getTime());
      return enqueue((data) => {
        const before = JSON.stringify(data.meetings);
        const byId = new Map(data.meetings.map((m) => [idOf(m), m]));
        for (const m of ended) byId.set(idOf(m), m);
        data.meetings = [...byId.values()];
        trim(data, now);
        return JSON.stringify(data.meetings) !== before;
      });
    },
  };
}
