import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_PLACES_FILE,
  CHAT_PLACES_MAX,
  type ChatPlacesFile,
  type ChatScope,
  type ChatScopeStore,
} from '../../shared/chat-places-contract.ts';
import { parseProjectKey } from '../../shared/projects.ts';

/**
 * Each chat's place, the client and project it is for (Projects R2 phase 1, decision 3), in the app's own
 * data folder (never the brain), keyed by sdkSessionId. Only chats with a client or a project are listed.
 * Writes are queued one at a time and a failed write is logged as one short line; the live chat still
 * holds its place in memory. The same pattern as chat-kinds.ts.
 *
 * Only a missing file reads as empty. Any other read error is not cached, reads answer "nothing saved"
 * and the pending write is skipped, so a bad read can never wipe the saved places.
 */
export { CHAT_PLACES_FILE } from '../../shared/chat-places-contract.ts';

const MAX_ID_CHARS = 200;
const MAX_CLIENT_CHARS = 100;
const CLIENT_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS;

const validClient = (c: unknown): c is string | null =>
  c === null || (typeof c === 'string' && c.length <= MAX_CLIENT_CHARS && CLIENT_SLUG.test(c));

const validProject = (p: unknown): p is string | null =>
  p === null || (typeof p === 'string' && parseProjectKey(p) !== null);

/** The place, checked and copied, or null when it is not one (a bad field, or neither set counts as none). */
function checkPlace(raw: unknown): ChatScope | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { client = null, project = null } = raw as { client?: unknown; project?: unknown };
  if (!validClient(client) || !validProject(project)) return null;
  return { client, project };
}

const empty = (): ChatPlacesFile => ({ version: 1, chats: {} });

function clean(raw: unknown): ChatPlacesFile {
  const out = empty();
  const chats = (raw as { chats?: unknown } | null)?.chats;
  if (!chats || typeof chats !== 'object' || Array.isArray(chats)) return out;
  for (const [id, entry] of Object.entries(chats)) {
    if (!validId(id)) continue;
    const place = checkPlace(entry);
    const savedAt = (entry as { savedAt?: unknown } | null)?.savedAt;
    if (!place || (place.client === null && place.project === null)) continue;
    if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) continue;
    out.chats[id] = { ...place, savedAt };
  }
  return out;
}

function trim(data: ChatPlacesFile): void {
  const ids = Object.keys(data.chats);
  if (ids.length <= CHAT_PLACES_MAX) return;
  const at = (id: string) => (data.chats[id] as { savedAt: string }).savedAt;
  ids.sort((a, b) => at(a).localeCompare(at(b)));
  for (const id of ids.slice(0, ids.length - CHAT_PLACES_MAX)) delete data.chats[id];
}

export function createChatPlaceStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
  now: () => Date = () => new Date(),
): ChatScopeStore {
  const file = dataDir ? join(dataDir, CHAT_PLACES_FILE) : null;
  let memory: ChatPlacesFile | null = file ? null : empty();
  let queue: Promise<void> = Promise.resolve();
  let loading: Promise<ChatPlacesFile> | null = null;

  /**
   * The saved places, read once and shared: overlapping first reads wait on the same read, so a slow one
   * can never replace a copy a queued write has just changed. Throws when the file could not be read for
   * any reason except being absent; nothing is cached then, so the next call tries again.
   */
  function load(): Promise<ChatPlacesFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<ChatPlacesFile> {
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
      log('The saved chat places could not be read. A copy was kept and they start empty.');
      memory = empty();
    }
    return memory;
  }

  async function save(data: ChatPlacesFile): Promise<void> {
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

  /** Runs `change` on the saved places, one at a time; it answers false when there is nothing to write. */
  function enqueue(change: (data: ChatPlacesFile) => boolean): Promise<void> {
    const job = queue.then(async () => {
      let data: ChatPlacesFile;
      try {
        data = await load();
      } catch {
        log('The saved chat places could not be read, so this change was not saved.');
        return;
      }
      if (!change(data)) return;
      try {
        await save(data);
      } catch {
        log('Could not save which client and project each chat is for.');
      }
    });
    queue = job.catch(() => {});
    return job.catch(() => {});
  }

  /** The saved places, or null when they can't be read. */
  async function read(): Promise<ChatPlacesFile | null> {
    await queue;
    try {
      return await load();
    } catch {
      return null;
    }
  }

  const remove = (id: string) =>
    enqueue((data) => {
      if (!Object.hasOwn(data.chats, id)) return false;
      delete data.chats[id];
      return true;
    });

  return {
    async placeOf(id) {
      if (!validId(id)) return null;
      const entry = (await read())?.chats[id];
      return entry ? { client: entry.client, project: entry.project } : null;
    },
    async all() {
      const out = new Map<string, ChatScope>();
      for (const [id, e] of Object.entries((await read())?.chats ?? {}))
        out.set(id, { client: e.client, project: e.project });
      return out;
    },
    set(id, place) {
      const checked = checkPlace(place);
      if (!validId(id) || !checked) return Promise.resolve();
      if (checked.client === null && checked.project === null) return remove(id);
      const savedAt = now().toISOString();
      return enqueue((data) => {
        data.chats[id] = { ...checked, savedAt };
        trim(data);
        return true;
      });
    },
    remove(id) {
      if (!validId(id)) return Promise.resolve();
      return remove(id);
    },
  };
}
