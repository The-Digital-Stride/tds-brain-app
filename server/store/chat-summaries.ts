import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CHAT_SUMMARIES_FILE } from '../../shared/chat-summary-contract.ts';
import { parseProjectKey } from '../../shared/projects.ts';

/**
 * When each chat was last saved to each project as a summary, and how many messages it had then (plan
 * 2026-11-24-chat-summary-updates, decision 10: "new" is counted, not timed). In the app's own data folder,
 * never the brain, keyed by sdkSessionId then project key. Same pattern as chat-places.ts: writes are queued
 * one at a time, a failed write is one short log line, and only a missing file reads as empty. Any other read
 * error is not cached, reads answer "nothing saved" and the pending write is skipped, so a bad read never wipes.
 */
export { CHAT_SUMMARIES_FILE } from '../../shared/chat-summary-contract.ts';

export interface ChatSummaryRecord {
  /** ISO time of the save. */
  savedAt: string;
  /** User + assistant messages in the chat's history at that save. */
  messages: number;
}

interface ChatSummariesFile {
  version: 1;
  chats: Record<string, Record<string, ChatSummaryRecord>>;
}

export interface ChatSummaryStore {
  /** The record for one chat on one project, or null (none, or the file can't be read). */
  get(chat: string, key: string): Promise<ChatSummaryRecord | null>;
  /** Every record of one chat, by project key (a fresh copy; empty when none or unreadable). */
  forChat(chat: string): Promise<Map<string, ChatSummaryRecord>>;
  /** Saves (replaces) the record for one chat on one project. Never rejects. */
  record(chat: string, key: string, rec: ChatSummaryRecord): Promise<void>;
}

/** Chats kept; the ones saved longest ago go first. */
export const CHAT_SUMMARIES_MAX = 2000;
const MAX_ID_CHARS = 200;

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS;

function checkRecord(raw: unknown): ChatSummaryRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { savedAt, messages } = raw as { savedAt?: unknown; messages?: unknown };
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null;
  if (typeof messages !== 'number' || !Number.isInteger(messages) || messages < 0) return null;
  return { savedAt, messages };
}

const empty = (): ChatSummariesFile => ({ version: 1, chats: {} });

function clean(raw: unknown): ChatSummariesFile {
  const out = empty();
  const chats = (raw as { chats?: unknown } | null)?.chats;
  if (!chats || typeof chats !== 'object' || Array.isArray(chats)) return out;
  for (const [id, byKey] of Object.entries(chats)) {
    if (!validId(id) || !byKey || typeof byKey !== 'object' || Array.isArray(byKey)) continue;
    const kept: Record<string, ChatSummaryRecord> = {};
    for (const [key, rec] of Object.entries(byKey)) {
      const checked = parseProjectKey(key) ? checkRecord(rec) : null;
      if (checked) kept[key] = checked;
    }
    if (Object.keys(kept).length > 0) out.chats[id] = kept;
  }
  return out;
}

function newest(byKey: Record<string, ChatSummaryRecord>): string {
  let at = '';
  for (const r of Object.values(byKey)) if (r.savedAt.localeCompare(at) > 0) at = r.savedAt;
  return at;
}

function trim(data: ChatSummariesFile): void {
  const ids = Object.keys(data.chats);
  if (ids.length <= CHAT_SUMMARIES_MAX) return;
  const at = (id: string) => newest(data.chats[id] as Record<string, ChatSummaryRecord>);
  ids.sort((a, b) => at(a).localeCompare(at(b)));
  for (const id of ids.slice(0, ids.length - CHAT_SUMMARIES_MAX)) delete data.chats[id];
}

export function createChatSummaryStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
): ChatSummaryStore {
  const file = dataDir ? join(dataDir, CHAT_SUMMARIES_FILE) : null;
  let memory: ChatSummariesFile | null = file ? null : empty();
  let queue: Promise<void> = Promise.resolve();
  let loading: Promise<ChatSummariesFile> | null = null;

  /** Read once and shared; throws (nothing cached) when the file exists but can't be read. */
  function load(): Promise<ChatSummariesFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<ChatSummariesFile> {
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
      log('The saved chat summaries list could not be read. A copy was kept and it starts empty.');
      memory = empty();
    }
    return memory;
  }

  async function save(data: ChatSummariesFile): Promise<void> {
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

  function enqueue(change: (data: ChatSummariesFile) => void): Promise<void> {
    const job = queue.then(async () => {
      let data: ChatSummariesFile;
      try {
        data = await load();
      } catch {
        log('The saved chat summaries list could not be read, so this change was not saved.');
        return;
      }
      change(data);
      try {
        await save(data);
      } catch {
        log('Could not save when a chat was last saved to a project.');
      }
    });
    queue = job.catch(() => {});
    return job.catch(() => {});
  }

  async function read(): Promise<ChatSummariesFile | null> {
    await queue;
    try {
      return await load();
    } catch {
      return null;
    }
  }

  return {
    async get(chat, key) {
      if (!validId(chat)) return null;
      const rec = (await read())?.chats[chat]?.[key];
      return rec ? { ...rec } : null;
    },
    async forChat(chat) {
      const out = new Map<string, ChatSummaryRecord>();
      if (!validId(chat)) return out;
      for (const [key, rec] of Object.entries((await read())?.chats[chat] ?? {})) out.set(key, { ...rec });
      return out;
    },
    record(chat, key, rec) {
      const checked = checkRecord(rec);
      if (!validId(chat) || !parseProjectKey(key) || !checked) return Promise.resolve();
      return enqueue((data) => {
        data.chats[chat] = { ...(data.chats[chat] ?? {}), [key]: checked };
        trim(data);
      });
    },
  };
}
