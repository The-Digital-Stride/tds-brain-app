import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  PROJECT_SEEN_FILE,
  PROJECT_SEEN_LIST_MAX,
  PROJECT_SEEN_MAX,
  type ProjectSeen,
  type ProjectSeenFile,
} from '../../shared/project-activity-contract.ts';
import { parseProjectKey } from '../../shared/projects.ts';

/**
 * What this person had seen of each project when they last looked (Projects R2 phase 3, decision 1), in the
 * app's own data folder (never the brain). Writes are queued one at a time and a failed write is logged as one
 * short line. The same pattern as chat-places.ts: only a missing file reads as empty; any other read error is
 * not cached, reads answer "nothing saved" and the pending write is skipped, so a bad read never wipes the file.
 * With no data folder the snapshots live in memory only.
 */
export { PROJECT_SEEN_FILE } from '../../shared/project-activity-contract.ts';

export interface ProjectSeenStore {
  /** The saved snapshot, or null when none is saved (or the file can't be read). */
  get(key: string): Promise<ProjectSeen | null>;
  /** Saves a snapshot, cutting any list over PROJECT_SEEN_LIST_MAX (newest kept) and marking `cut`. */
  set(key: string, seen: ProjectSeen): Promise<void>;
}

const empty = (): ProjectSeenFile => ({ v: 1, projects: {} });

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null;

/** The snapshot, checked and copied, or null when it is not one. Lists are cut to the cap (newest = last kept). */
function checkSeen(raw: unknown): ProjectSeen | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
  if (typeof r.folder !== 'string' || r.folder === '') return null;
  const todos = strings(r.todos);
  const links = strings(r.links);
  const files = strings(r.files);
  if (!todos || !links || !files) return null;
  let cut = r.cut === true;
  const trimList = (list: string[]) => {
    if (list.length <= PROJECT_SEEN_LIST_MAX) return list;
    cut = true;
    return list.slice(list.length - PROJECT_SEEN_LIST_MAX);
  };
  const out: ProjectSeen = {
    at: r.at,
    folder: r.folder,
    todos: trimList(todos),
    links: trimList(links),
    files: trimList(files),
  };
  const titles = r.todoTitles;
  if (titles && typeof titles === 'object' && !Array.isArray(titles)) {
    const kept = new Set(out.todos);
    const copy: Record<string, string> = {};
    for (const [k, v] of Object.entries(titles)) if (typeof v === 'string' && kept.has(k)) copy[k] = v;
    if (Object.keys(copy).length > 0) out.todoTitles = copy;
  }
  if (cut) out.cut = true;
  return out;
}

function clean(raw: unknown): ProjectSeenFile {
  const out = empty();
  const projects = (raw as { projects?: unknown } | null)?.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return out;
  for (const [key, entry] of Object.entries(projects)) {
    if (parseProjectKey(key) === null) continue;
    const seen = checkSeen(entry);
    if (seen) out.projects[key] = seen;
  }
  return out;
}

function trim(data: ProjectSeenFile): void {
  const keys = Object.keys(data.projects);
  if (keys.length <= PROJECT_SEEN_MAX) return;
  const at = (k: string) => (data.projects[k] as ProjectSeen).at;
  keys.sort((a, b) => at(a).localeCompare(at(b)));
  for (const k of keys.slice(0, keys.length - PROJECT_SEEN_MAX)) delete data.projects[k];
}

export function createProjectSeenStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
): ProjectSeenStore {
  const file = dataDir ? join(dataDir, PROJECT_SEEN_FILE) : null;
  let memory: ProjectSeenFile | null = file ? null : empty();
  let queue: Promise<void> = Promise.resolve();
  let loading: Promise<ProjectSeenFile> | null = null;

  /** Read once and shared; throws when the file can't be read for any reason except being absent (nothing cached). */
  function load(): Promise<ProjectSeenFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<ProjectSeenFile> {
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
      log('The saved "last looked" times could not be read. A copy was kept and they start empty.');
      memory = empty();
    }
    return memory;
  }

  async function save(data: ProjectSeenFile): Promise<void> {
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

  function enqueue(change: (data: ProjectSeenFile) => boolean): Promise<void> {
    const job = queue.then(async () => {
      let data: ProjectSeenFile;
      try {
        data = await load();
      } catch {
        log('The saved "last looked" times could not be read, so this change was not saved.');
        return;
      }
      if (!change(data)) return;
      try {
        await save(data);
      } catch {
        log('Could not save when each project was last looked at.');
      }
    });
    queue = job.catch(() => {});
    return job.catch(() => {});
  }

  return {
    async get(key) {
      await queue;
      try {
        const s = (await load()).projects[key];
        return s ? structuredClone(s) : null;
      } catch {
        return null;
      }
    },
    set(key, seen) {
      const checked = parseProjectKey(key) === null ? null : checkSeen(seen);
      if (!checked) return Promise.resolve();
      return enqueue((data) => {
        data.projects[key] = checked;
        trim(data);
        return true;
      });
    },
  };
}
