import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ChatKind } from '../../shared/contract.ts';

/**
 * Which chats the person marked Personal, in the app's own data folder (never the brain). Only
 * personal chats are listed: TDS is the default. Writes are queued one at a time and a failed write is
 * logged as one short line; the live chat still holds its kind in memory.
 *
 * Only a missing file reads as empty. Any other read error is not cached and the pending write is
 * skipped, so a bad read can never wipe the saved marks.
 */
export const CHAT_KINDS_FILE = 'chat-kinds.json';
const MAX_ENTRIES = 2000;
const MAX_ID_CHARS = 200;

export interface ChatKindsFile {
  version: 1;
  /** sdkSessionId → ISO time it was marked. */
  personal: Record<string, string>;
}

export interface ChatKindStore {
  /** The sdkSessionIds of every saved personal chat (a fresh copy). */
  personal(): Promise<Set<string>>;
  kindOf(sdkSessionId: string): Promise<ChatKind>;
  /** Queued; never rejects (a failed write is logged). */
  set(sdkSessionId: string, kind: ChatKind): Promise<void>;
}

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS;

function clean(raw: unknown): ChatKindsFile {
  const out: ChatKindsFile = { version: 1, personal: {} };
  const personal = (raw as { personal?: unknown } | null)?.personal;
  if (!personal || typeof personal !== 'object' || Array.isArray(personal)) return out;
  for (const [id, savedAt] of Object.entries(personal)) {
    if (!validId(id) || typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) continue;
    out.personal[id] = savedAt;
  }
  return out;
}

function trim(data: ChatKindsFile): void {
  const ids = Object.keys(data.personal);
  if (ids.length <= MAX_ENTRIES) return;
  ids.sort((a, b) => (data.personal[a] as string).localeCompare(data.personal[b] as string));
  for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete data.personal[id];
}

export function createChatKindStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
  now: () => Date = () => new Date(),
): ChatKindStore {
  const file = dataDir ? join(dataDir, CHAT_KINDS_FILE) : null;
  let memory: ChatKindsFile | null = file ? null : { version: 1, personal: {} };
  let queue: Promise<void> = Promise.resolve();

  let loading: Promise<ChatKindsFile> | null = null;

  /**
   * The saved marks, read once and shared: overlapping first reads wait on the same read, so a slow one
   * can never replace a copy a queued `set` has just changed. Throws when the file could not be read for
   * any reason except being absent; nothing is cached then, so the next call tries again.
   */
  function load(): Promise<ChatKindsFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<ChatKindsFile> {
    const path = file as string;
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        memory = { version: 1, personal: {} };
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
      log('The saved chat kinds could not be read. A copy was kept and they start empty.');
      memory = { version: 1, personal: {} };
    }
    return memory;
  }

  async function save(data: ChatKindsFile): Promise<void> {
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

  return {
    async personal() {
      await queue;
      return new Set(Object.keys((await load()).personal));
    },
    async kindOf(id) {
      if (!validId(id)) return 'tds';
      await queue;
      return Object.hasOwn((await load()).personal, id) ? 'personal' : 'tds';
    },
    set(id, kind) {
      if (!validId(id) || (kind !== 'tds' && kind !== 'personal')) return Promise.resolve();
      const savedAt = now().toISOString();
      const job = queue.then(async () => {
        let data: ChatKindsFile;
        try {
          data = await load();
        } catch {
          log('The saved chat kinds could not be read, so this change was not saved.');
          return;
        }
        if (kind === 'tds') {
          if (!Object.hasOwn(data.personal, id)) return;
          delete data.personal[id];
        } else {
          data.personal[id] = savedAt;
          trim(data);
        }
        try {
          await save(data);
        } catch {
          log('Could not save which chats are personal.');
        }
      });
      queue = job.catch(() => {});
      return job.catch(() => {});
    },
  };
}
