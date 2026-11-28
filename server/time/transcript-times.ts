/**
 * My day (plan decisions 6 and 24): when the person chatted, read from Claude Code's history of the brain
 * folder, `<configDir>/projects/<folder>/<id>.jsonl`. Top-level files only (never `<id>/subagents/`), and
 * only those changed on or after the day began. Streamed line by line; each line is reduced to its time
 * and whether it is a person's prompt or Claude's answer. No text, title, path or tool detail is kept,
 * returned or logged. Files over `maxTranscriptBytes` are skipped and noted. Marks are cached per file by
 * size and modified time.
 */
import { createReadStream, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CHAT_TIME, type ChatMarks, type TranscriptMark } from '../../shared/time-contract.ts';
import { isWorkDate, londonDayBounds } from './day-store.ts';

/** Same rules as `server/engine/trash-session.ts`. */
const MAX_DIR_NAME = 200;
const SAFE_DIR_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const CHAT_FILE = /^([A-Za-z0-9_-]{1,100})\.jsonl$/;

/** Marks this far either side of the day are kept, so merges and overlaps across midnight come out right. */
const BEFORE_MS = 24 * 3_600_000;
const AFTER_MS = 3_600_000;

export const MSG_NO_HISTORY = 'No chat history is kept this far back.';
const tooLargeNote = (n: number) =>
  n === 1
    ? "One chat is too large to read, so its time isn't shown."
    : `${n} chats are too large to read, so their time isn't shown.`;

/** How Claude Code names a project's history folder: the real path, NFC, everything but letters and digits to `-`. */
export function projectDirName(realBrainPath: string): string {
  return realBrainPath.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-');
}

// ─── Which lines count (decision 24) ───────────────────────────────────────────────────────────────────

/** `promptSource` values a person makes; their lines are prompts whatever the text starts with. */
const PERSON_SOURCES = new Set(['typed', 'queued', 'suggestion_accepted']);
/** `promptSource` values allowed at all (`sdk` = a Cortex chat), checked further by their text. */
const ALLOWED_SOURCES = new Set([...PERSON_SOURCES, 'sdk']);
const ALLOWED_ORIGINS = new Set(['human', 'sdk']);
/** Tag-led text a person makes: slash commands, shell input, pasted content, Cortex attachments. */
const PERSON_TAGS = new Set([
  'command-name',
  'command-message',
  'bash-input',
  'pasted_content',
  'tds-attachments',
]);
const LEADING_TAG = /^<([A-Za-z][A-Za-z0-9_-]*)/;
const COMPACTION = 'This session is being continued from a previous conversation';
const INTERRUPTED = '[Request interrupted';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const absent = (v: unknown) => v === undefined || v === null;

/**
 * `answer` for a main-thread assistant line, `prompt` for a person's turn, else null. Reads the text only to
 * tell machine notices from prompts; nothing from it leaves this function.
 */
export function classifyLine(raw: unknown): TranscriptMark['kind'] | null {
  if (!isObj(raw)) return null;
  if (typeof raw.timestamp !== 'string' || !Number.isFinite(Date.parse(raw.timestamp))) return null;
  if (raw.isSidechain === true) return null;
  if (raw.type === 'assistant') return 'answer';
  if (raw.type !== 'user') return null;
  if (raw.isMeta === true || raw.isCompactSummary === true || raw.isVisibleInTranscriptOnly === true)
    return null;
  if (Object.hasOwn(raw, 'toolUseResult')) return null;

  const source = raw.promptSource;
  if (!absent(source) && !(typeof source === 'string' && ALLOWED_SOURCES.has(source))) return null;
  const turn = raw.turnOrigin;
  if (!absent(turn) && !(typeof turn === 'string' && ALLOWED_ORIGINS.has(turn))) return null;
  if (!absent(raw.origin) && !(isObj(raw.origin) && raw.origin.kind === 'human')) return null;

  const content = isObj(raw.message) ? raw.message.content : undefined;
  let text: string | null = null;
  let other = false;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      const type = isObj(block) ? block.type : undefined;
      if (type === 'tool_result') return null;
      if (type === 'text' && text === null && typeof (block as { text?: unknown }).text === 'string') {
        text = (block as { text: string }).text;
      } else if (type !== 'text') {
        other = true;
      }
    }
  } else {
    return null;
  }
  if (typeof source === 'string' && PERSON_SOURCES.has(source)) return 'prompt';

  const lead = (text ?? '').trimStart();
  if (lead === '') return other ? 'prompt' : null;
  if (lead.startsWith('<')) {
    const tag = LEADING_TAG.exec(lead)?.[1];
    return tag !== undefined && PERSON_TAGS.has(tag) ? 'prompt' : null;
  }
  if (lead.startsWith(INTERRUPTED) || lead.startsWith(COMPACTION)) return null;
  return 'prompt';
}

/** Cheap filter before parsing: only `user` and `assistant` lines can count. */
const MAYBE = /"type"\s*:\s*"(?:user|assistant)"/;

// ─── The reader ────────────────────────────────────────────────────────────────────────────────────────

export interface TranscriptTimes {
  chats: ChatMarks[];
  /** Plain UK English, for `DayView.captureNotes`. */
  notes: string[];
}

export interface TranscriptReaderDeps {
  configDir?: string;
  env?: Record<string, string | undefined>;
  realpath?: (p: string) => Promise<string>;
  maxBytes?: number;
  /** Status lines only: never a path, name or text. */
  log?: (line: string) => void;
}

interface Cached {
  size: number;
  mtimeMs: number;
  /** Every mark in the file, sorted by time. */
  marks: Array<{ ms: number; kind: TranscriptMark['kind'] }>;
}

async function readMarks(file: string): Promise<Cached['marks']> {
  const marks: Cached['marks'] = [];
  const input = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of rl) {
      if (!MAYBE.test(line)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const kind = classifyLine(parsed);
      if (kind) marks.push({ ms: Date.parse((parsed as { timestamp: string }).timestamp), kind });
    }
  } finally {
    rl.close();
    input.destroy();
  }
  return marks.sort((a, b) => a.ms - b.ms);
}

/**
 * `read(brainRoot, workDate)`: each chat's marks near the day, and notes for the screen. A missing folder
 * reads as nothing. Never throws for an unreadable file (it is left out and one status line logged).
 */
export function createTranscriptReader(deps: TranscriptReaderDeps = {}) {
  const env = deps.env ?? process.env;
  const realpath = deps.realpath ?? ((p: string) => fsp.realpath(p));
  const maxBytes = deps.maxBytes ?? CHAT_TIME.maxTranscriptBytes;
  const log = deps.log ?? (() => {});
  const cache = new Map<string, Cached>();

  async function projectDir(brainRoot: string): Promise<string | null> {
    const configDir = deps.configDir ?? env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    let folder: string;
    if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CODE_PROJECT_DIR_NAME !== undefined) {
      if (!SAFE_DIR_NAME.test(env.CLAUDE_CODE_PROJECT_DIR_NAME)) return null;
      folder = env.CLAUDE_CODE_PROJECT_DIR_NAME;
    } else {
      try {
        folder = projectDirName(await realpath(brainRoot));
      } catch {
        return null;
      }
    }
    if (folder.length > MAX_DIR_NAME) return null;
    return join(configDir, 'projects', folder);
  }

  return async function readTranscriptTimes(brainRoot: string, workDate: string): Promise<TranscriptTimes> {
    const none: TranscriptTimes = { chats: [], notes: [] };
    if (!isWorkDate(workDate)) return none;
    const dir = await projectDir(brainRoot);
    if (!dir) return none;
    let names: string[];
    try {
      names = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
    } catch {
      return none;
    }

    const { start, end } = londonDayBounds(workDate);
    const from = start - BEFORE_MS;
    const to = end + AFTER_MS;
    const seen = new Set<string>();
    const chats: ChatMarks[] = [];
    let tooLarge = 0;
    let olderHistory = false;
    let anyFile = false;
    // A file skipped unread may hold the day, so "no history" can't be said then.
    let unread = false;
    let earliest = Number.POSITIVE_INFINITY;

    for (const name of names.sort()) {
      const chatId = CHAT_FILE.exec(name)?.[1];
      if (!chatId) continue;
      const file = join(dir, name);
      seen.add(file);
      let stat: { size: number; mtimeMs: number; isFile(): boolean };
      try {
        stat = await fsp.lstat(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      anyFile = true;
      if (stat.mtimeMs < start) {
        olderHistory = true;
        continue;
      }
      if (stat.size > maxBytes) {
        tooLarge++;
        unread = true;
        continue;
      }
      let entry = cache.get(file);
      if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
        try {
          entry = { size: stat.size, mtimeMs: stat.mtimeMs, marks: await readMarks(file) };
        } catch {
          log('A chat history file could not be read, so its time is left out.');
          cache.delete(file);
          unread = true;
          continue;
        }
        cache.set(file, entry);
      }
      if (entry.marks.length > 0) earliest = Math.min(earliest, (entry.marks[0] as { ms: number }).ms);
      const marks = entry.marks
        .filter((m) => m.ms >= from && m.ms < to)
        .map((m): TranscriptMark => ({ at: new Date(m.ms).toISOString(), kind: m.kind }));
      if (marks.length > 0) chats.push({ chatId, marks });
    }
    for (const key of cache.keys()) if (key.startsWith(`${dir}/`) && !seen.has(key)) cache.delete(key);

    const notes: string[] = [];
    if (tooLarge > 0) notes.push(tooLargeNote(tooLarge));
    if (anyFile && !olderHistory && !unread && !(earliest < end)) notes.push(MSG_NO_HISTORY);
    return { chats, notes };
  };
}
