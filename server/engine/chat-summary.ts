/**
 * Chat summaries as project updates (plan docs/plans/2026-11-24-chat-summary-updates.md, decisions 3-7, 10).
 *
 * The draft comes from a side copy of the chat: `engine.query` resumes the chat with `forkSession: true` and
 * `persistSession: false`, so the chat itself is never changed and no new chat appears in Earlier chats
 * (spikes 1 and 2). The copy gets no tools, no settings (so none of the brain's hooks, sync or usage log run),
 * no MCP servers and one turn; any tool call fails the draft. Nothing here saves anything: the person reviews
 * the draft and the route saves it through the `tdsapp-projects` script.
 *
 * The pure parts (`parseChatDraft`, `buildDraftPrompt`, `documentCandidates`, `usesEmailTool`) are tested
 * on their own; the service gets its chat facts from the session manager through `ChatSourcePort`.
 */
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { normaliseChatSummaryFields, writableChatTitle } from '../../shared/chat-summary.ts';
import {
  CHAT_DOC_NAME_MAX,
  CHAT_DOCUMENTS_CANDIDATES,
  CHAT_DOCUMENTS_MAX,
  CHAT_DRAFT_TIMEOUT_MS,
  CHAT_ID_PATTERN,
  CHAT_TITLE_MAX,
  type ChatSummaryDocChoice,
  type ChatSummaryDraft,
  type ChatSummaryFields,
  UNSAVED_CHATS_MAX,
  type UnsavedChat,
} from '../../shared/chat-summary-contract.ts';
import type { ApiErrorCode, ChatFilesSnapshot } from '../../shared/contract.ts';
import {
  PROJECT_CHATS_MAX,
  type ProjectChat,
  type ProjectChatsInput,
  type ProjectChatsResult,
} from '../../shared/project-chats-contract.ts';
import type { ProjectKey } from '../../shared/projects-contract.ts';
import type { ChatSummaryStore } from '../store/chat-summaries.ts';

// ─── Errors ─────────────────────────────────────────────────────────────────────────────────────

/** A draft refused or failed; `message` is a plain UK-English sentence fit to show. */
export class ChatDraftError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ChatDraftError';
    this.code = code;
  }
}

export const DRAFT_FAILED = "Claude couldn't write a summary this time. Try again.";
export const DRAFT_TOO_LONG =
  "This chat is too long for Claude to summarise. Add a note on the project's Updates tab instead.";
export const DRAFT_CHAT_BUSY = 'Claude is still working in this chat. Wait for it to finish, then try again.';
export const DRAFT_ALREADY = 'Claude is already writing a summary of this chat. Wait for it to finish.';
export const DRAFT_NO_CHAT = "That chat couldn't be found on this Mac.";
export const DRAFT_NO_ENGINE = 'Claude Code is not installed on this computer, or the app cannot find it.';

// ─── Parsing Claude's reply (decision 4) ─────────────────────────────────────────────────────────

export interface ParsedChatDraft {
  fields: Omit<ChatSummaryFields, 'documents'>;
  /** Picked candidate numbers (1-based, each at most once, only ones that were listed). */
  picked: number[];
  fromEmail: boolean;
  nothingNew: boolean;
}

/** The first balanced `{…}` in the text (strings respected), or null. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Claude's draft: the first JSON object in `text`, every field cut to the contract's limits, only document
 * numbers from 1 to `candidates`. Null for anything else (no object, wrong types, or no objective, outcome
 * or `nothingNew` at all), which the caller reports as DRAFT_FAILED.
 */
export function parseChatDraft(text: string, candidates: number): ParsedChatDraft | null {
  if (typeof text !== 'string') return null;
  const raw = firstJsonObject(text);
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(v)) return null;
  for (const k of ['objective', 'outcome'] as const)
    if (v[k] !== undefined && v[k] !== null && typeof v[k] !== 'string') return null;
  for (const k of ['figures', 'nextSteps', 'documents'] as const)
    if (v[k] !== undefined && v[k] !== null && !Array.isArray(v[k])) return null;
  const norm = normaliseChatSummaryFields({
    objective: typeof v.objective === 'string' ? v.objective : '',
    outcome: typeof v.outcome === 'string' ? v.outcome : '',
    figures: strings(v.figures),
    documents: [],
    nextSteps: strings(v.nextSteps),
  });
  const nothingNew = v.nothingNew === true;
  if (!norm.objective && !norm.outcome && !nothingNew) return null;
  const picked: number[] = [];
  for (const n of Array.isArray(v.documents) ? v.documents : []) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > candidates || picked.includes(n))
      continue;
    picked.push(n);
    if (picked.length >= CHAT_DOCUMENTS_MAX) break;
  }
  return {
    fields: {
      objective: norm.objective,
      outcome: norm.outcome,
      figures: norm.figures,
      nextSteps: norm.nextSteps,
    },
    picked,
    fromEmail: v.fromEmail === true,
    nothingNew,
  };
}

// ─── Candidate documents (decision 5) ────────────────────────────────────────────────────────────

/** A document the draft may link, from the chat's own files list. `personal`: under `personal/`. */
export interface DocCandidate {
  ref: string;
  name: string;
  kind: ChatSummaryDocChoice['kind'];
  personal: boolean;
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Made or changed files and attachments filed in the brain (only ones the library lists now), then pages
 * (their claude.ai address, else their brain file), then https web links. No repeats, at most
 * CHAT_DOCUMENTS_CANDIDATES. Brain refs are paths from the brain's root.
 */
export function documentCandidates(snap: ChatFilesSnapshot | null): DocCandidate[] {
  if (!snap) return [];
  const out: DocCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: DocCandidate) => {
    if (out.length >= CHAT_DOCUMENTS_CANDIDATES || !c.ref || seen.has(c.ref)) return;
    seen.add(c.ref);
    out.push(c);
  };
  const personal = (path: string, scopeKind?: string) =>
    scopeKind === 'personal' || path.startsWith('personal/');
  const files = Array.isArray(snap.files) ? snap.files : [];
  for (const f of files) {
    if (!f.item) continue;
    if (!f.actions.some((a) => a === 'created' || a === 'changed' || a === 'filed')) continue;
    add({
      ref: f.path,
      name: oneLine(f.item.title || f.item.name || baseName(f.path), CHAT_DOC_NAME_MAX),
      kind: 'file',
      personal: personal(f.path, f.scope?.kind),
    });
  }
  for (const p of Array.isArray(snap.pages) ? snap.pages : []) {
    const file = p.fileKey ? files.find((f) => f.key === p.fileKey && f.item) : undefined;
    const ref = p.url && isHttps(p.url) ? p.url : (file?.path ?? '');
    if (!ref) continue;
    add({
      ref,
      name: oneLine(p.title || baseName(ref), CHAT_DOC_NAME_MAX),
      kind: 'page',
      personal: file !== undefined && ref === file.path && personal(file.path, file.scope?.kind),
    });
  }
  for (const l of Array.isArray(snap.links) ? snap.links : []) {
    if (!isHttps(l.url)) continue;
    add({ ref: l.url, name: oneLine(l.url, CHAT_DOC_NAME_MAX), kind: 'link', personal: false });
  }
  return out;
}

// ─── Email (decision 6) ──────────────────────────────────────────────────────────────────────────

/** A tool that reads or sends email (a Gmail or Outlook MCP tool, or any tool named for mail). */
const EMAIL_TOOL = /gmail|outlook|e-?mail|inbox|imap/i;

export function usesEmailTool(toolNames: Iterable<string>): boolean {
  for (const n of toolNames) if (typeof n === 'string' && EMAIL_TOOL.test(n)) return true;
  return false;
}

// ─── The prompt (decisions 4, 6, 7) ──────────────────────────────────────────────────────────────

export interface DraftPromptInput {
  projectTitle: string;
  candidates: readonly Pick<DocCandidate, 'name' | 'ref'>[];
  /** The newest earlier summary of this chat here, by this person. */
  earlier: { at: string; summary: string } | null;
}

/** Text placed between our own tags can't close them early. */
const fence = (s: string, tag: string) => s.replace(new RegExp(`<(/?)${tag}>`, 'gi'), `<$1${tag}​>`);

function dayOf(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'an earlier day';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The one user message the side copy of the chat gets. */
export function buildDraftPrompt(i: DraftPromptInput): string {
  const title = oneLine(i.projectTitle, 200).replace(/"/g, "'");
  const lines = [
    `This is a request from the TDS Cortex app, not a message from the person. They want a short summary of this chat saved as an update on the project "${title}".`,
    'This is only a draft: the person reviews and can change every word on a review screen before anything is saved, and nothing is saved by you. Do not use any tools, and do not save, send or change anything. Answer from this chat alone.',
    'Use only facts from this chat. Give every figure with its unit (for example "£4,200", "12 pages", "3 weeks"). Name people by their names, never by email address. Write in UK English.',
    "You may include what came from the person's own email: they approve exactly this text on the review screen, which is their OK for it to go on the project. If any of it came from email, set fromEmail to true.",
  ];
  if (i.earlier) {
    lines.push(
      '',
      `The person already saved a summary of this chat on ${dayOf(i.earlier.at)}, shown between <earlier-summary> tags. Write only what is new since then. If nothing is new, set nothingNew to true.`,
      `<earlier-summary>\n${fence(i.earlier.summary, 'earlier-summary')}\n</earlier-summary>`,
    );
  }
  lines.push('');
  if (i.candidates.length > 0) {
    lines.push(
      'Documents from this chat, by number. Pick the key ones for "documents" by their numbers; never add any others:',
      ...i.candidates.map(
        (c, n) =>
          `${n + 1}. ${oneLine(c.name, CHAT_DOC_NAME_MAX).replace(/`/g, "'")} (${c.ref.replace(/`/g, '')})`,
      ),
    );
  } else {
    lines.push('This chat has no documents to link, so leave "documents" empty.');
  }
  lines.push(
    '',
    'Reply with one JSON object only, with no other text:',
    '{"objective": "what the person set out to do, in one or two sentences", "outcome": "what was done or decided", "figures": ["a key figure with its unit"], "documents": [1], "nextSteps": ["one next step, short enough to be a to-do title"], "fromEmail": false, "nothingNew": false}',
  );
  return lines.join('\n');
}

// ─── Running the side copy ───────────────────────────────────────────────────────────────────────

/** Same shape as `EngineFns['query']` in the session manager. */
export type DraftQueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AsyncIterable<unknown> & { close(): void };

export interface DraftRun {
  query: DraftQueryFn;
  claudePath: string | null;
  env: Record<string, string>;
  brainRoot: string;
  /** The chat's model (null: leave Claude Code's built-in default). */
  model: string | null;
  timeoutMs: number;
  log: (line: string) => void;
}

/** What Claude Code says when a chat no longer fits in one request. */
const TOO_LONG = /prompt is too long|too many tokens|context (?:window|length|limit)|exceeds? the maximum/i;

/** Options for the side copy (exported for the tests). */
export function draftOptions(chat: string, run: Omit<DraftRun, 'query' | 'timeoutMs' | 'log'>): Options {
  const options: Options = {
    cwd: run.brainRoot,
    pathToClaudeCodeExecutable: run.claudePath ?? undefined,
    resume: chat,
    forkSession: true,
    persistSession: false,
    maxTurns: 1,
    tools: [],
    // No settings: none of the brain's hooks (sync, the usage log) run for a draft (overseer blocking 2).
    settingSources: [],
    // Only the MCP servers passed here, and none are.
    strictMcpConfig: true,
    env: run.env,
    canUseTool: async () => ({ behavior: 'deny', message: 'A summary draft uses no tools.' }),
    // The engine's own stderr can echo the chat: never let it reach the server log.
    stderr: () => {},
  };
  if (run.model) options.model = run.model;
  return options;
}

function hasToolUse(m: Rec): boolean {
  if (m.type !== 'assistant' || !isRec(m.message)) return false;
  const content = m.message.content;
  return Array.isArray(content) && content.some((b) => isRec(b) && b.type === 'tool_use');
}

/** Runs the side copy once and answers Claude's reply text. Throws ChatDraftError. */
export async function runDraft(chat: string, prompt: string, run: DraftRun): Promise<string> {
  if (!run.claudePath) throw new ChatDraftError('engine-missing', DRAFT_NO_ENGINE);
  const message: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: prompt },
    parent_tool_use_id: null,
  };
  let q: ReturnType<DraftQueryFn>;
  try {
    q = run.query({
      prompt: (async function* () {
        yield message;
      })(),
      options: draftOptions(chat, run),
    });
  } catch {
    throw new ChatDraftError('internal', DRAFT_FAILED);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), run.timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  const read = (async (): Promise<string> => {
    for await (const m of q) {
      if (!isRec(m)) continue;
      if (hasToolUse(m)) {
        run.log('A chat summary draft tried to use a tool, so it was stopped.');
        throw new ChatDraftError('internal', DRAFT_FAILED);
      }
      if (m.type !== 'result') continue;
      const text = typeof m.result === 'string' ? m.result : '';
      const errors = Array.isArray(m.errors) ? m.errors.filter((e) => typeof e === 'string').join(' ') : '';
      if (
        TOO_LONG.test(`${text} ${errors}`) &&
        (m.subtype !== 'success' || m.is_error === true || text.length < 200)
      )
        throw new ChatDraftError('internal', DRAFT_TOO_LONG);
      if (m.subtype !== 'success' || m.is_error === true || !text)
        throw new ChatDraftError('internal', DRAFT_FAILED);
      return text;
    }
    throw new ChatDraftError('internal', DRAFT_FAILED);
  })();
  try {
    const out = await Promise.race([read, timeout]);
    if (out === 'timeout') {
      run.log('A chat summary draft took too long and was stopped.');
      throw new ChatDraftError('internal', DRAFT_FAILED);
    }
    return out;
  } catch (err) {
    if (err instanceof ChatDraftError) throw err;
    throw new ChatDraftError('internal', DRAFT_FAILED);
  } finally {
    if (timer) clearTimeout(timer);
    read.catch(() => {});
    try {
      q.close();
    } catch {
      // already gone
    }
  }
}

// ─── The service ─────────────────────────────────────────────────────────────────────────────────

/** What the session manager knows of one chat on this Mac, for a draft. */
export interface ChatSource {
  /** Replying, waiting on a question or permission, starting, or closing. */
  busy: boolean;
  title: string;
  model: string | null;
  files: ChatFilesSnapshot | null;
  /** The chat's history names an email tool. */
  emailTool: boolean;
}

/** A chat of this Mac with a saved project. */
export interface PlacedChat {
  chat: string;
  title: string;
  project: ProjectKey;
  /** Ms of the chat's last activity (its file time, or live activity). */
  lastModified: number;
  /** Live and replying (or waiting): left out of the nudge. */
  replying: boolean;
}

/** The session manager's side (built in createSessionManager). */
export interface ChatSourcePort {
  owns(chat: string): Promise<boolean>;
  /** Null: not on this Mac. */
  source(chat: string): Promise<ChatSource | null>;
  /** User + assistant messages in the chat's history, or null when it can't be read. */
  messages(chat: string): Promise<number | null>;
  placed(): Promise<PlacedChat[]>;
}

export interface ChatSummaryServiceOptions {
  port: ChatSourcePort;
  store: ChatSummaryStore;
  query: DraftQueryFn;
  claudePath: string | null;
  env: Record<string, string>;
  brainRoot: string;
  timeoutMs?: number;
  log?: (line: string) => void;
  now?: () => Date;
}

export interface ChatDraftInput {
  chat: string;
  project: { key: ProjectKey; title: string; personal: boolean };
  /** This person's `chat` entries for this chat here, newest first (whole log). */
  earlier: readonly { path: string; at: string; summary: string }[];
}

export interface UnsavedInput {
  /** The project's live key and its moved_from keys. */
  keys: readonly ProjectKey[];
  /** Only chats active since (ms). */
  since: number;
  /** Whether this person has a `chat` entry for the chat on the project. */
  hasEntry(chat: string): Promise<boolean>;
}

export interface ChatSummaryService {
  owns(chat: string): Promise<boolean>;
  /** Throws ChatDraftError: not-found | busy | internal | engine-missing. */
  draft(input: ChatDraftInput): Promise<ChatSummaryDraft>;
  /** After a successful save: records the chat's message count for the project. Never rejects. */
  recordSaved(chat: string, key: ProjectKey): Promise<void>;
  /** The nudge's list (contract count rule), newest first, at most UNSAVED_CHATS_MAX. */
  unsaved(input: UnsavedInput): Promise<UnsavedChat[]>;
  /** The project's Chats tab: every chat placed there, newest first, with whether its summary was saved. */
  forProject(input: ProjectChatsInput): Promise<ProjectChatsResult>;
}

/** Chats looked at for the nudge at most, newest first. */
const UNSAVED_LOOK_MAX = 40;

export function createChatSummaryService(opts: ChatSummaryServiceOptions): ChatSummaryService {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const running = new Set<string>();
  // The chat's message count when its newest draft for a project was taken (correctness review): Save records
  // this, not the count at Save, so messages sent while the form was open still count as not saved.
  const draftedAt = new Map<string, number>();
  const draftKey = (chat: string, key: string) => `${chat}\u0000${key}`;

  return {
    owns: (chat) =>
      CHAT_ID_PATTERN.test(chat) ? opts.port.owns(chat).catch(() => false) : Promise.resolve(false),

    async draft(input) {
      const { chat, project } = input;
      if (!CHAT_ID_PATTERN.test(chat)) throw new ChatDraftError('not-found', DRAFT_NO_CHAT);
      // One draft per chat at a time, claimed before anything is awaited.
      if (running.has(chat)) throw new ChatDraftError('busy', DRAFT_ALREADY);
      running.add(chat);
      try {
        if (!(await opts.port.owns(chat).catch(() => false)))
          throw new ChatDraftError('not-found', DRAFT_NO_CHAT);
        const src = await opts.port.source(chat).catch(() => null);
        if (!src) throw new ChatDraftError('not-found', DRAFT_NO_CHAT);
        if (src.busy) throw new ChatDraftError('busy', DRAFT_CHAT_BUSY);
        const counted = await opts.port.messages(chat).catch(() => null);
        const candidates = documentCandidates(src.files);
        const newest = input.earlier[0] ?? null;
        const prompt = buildDraftPrompt({
          projectTitle: project.title,
          candidates,
          earlier: newest ? { at: newest.at, summary: newest.summary } : null,
        });
        const reply = await runDraft(chat, prompt, {
          query: opts.query,
          claudePath: opts.claudePath,
          env: opts.env,
          brainRoot: opts.brainRoot,
          model: src.model,
          timeoutMs: opts.timeoutMs ?? CHAT_DRAFT_TIMEOUT_MS,
          log,
        });
        const parsed = parseChatDraft(reply, candidates.length);
        if (!parsed) {
          log('A chat summary draft came back in a shape the app could not read.');
          throw new ChatDraftError('internal', DRAFT_FAILED);
        }
        if (counted === null) draftedAt.delete(draftKey(chat, project.key));
        else draftedAt.set(draftKey(chat, project.key), counted);
        // A personal file can't be linked from a shared project (decision 5): offered unticked, flagged.
        const lockPersonal = !project.personal;
        const documents: ChatSummaryDocChoice[] = candidates.map((c, i) => ({
          ref: c.ref,
          name: c.name,
          kind: c.kind,
          picked: parsed.picked.includes(i + 1) && !(lockPersonal && c.personal),
          ...(c.personal ? { personal: true as const } : {}),
        }));
        return {
          chat,
          project: project.key,
          title: writableChatTitle(src.title) || 'Untitled chat',
          fields: parsed.fields,
          documents,
          fromEmail: parsed.fromEmail || src.emailTool,
          earlier: input.earlier.map((e) => ({ path: e.path, at: e.at })),
          nothingNew: input.earlier.length > 0 && parsed.nothingNew,
        };
      } finally {
        running.delete(chat);
      }
    },

    async recordSaved(chat, key) {
      try {
        const drafted = draftedAt.get(draftKey(chat, key));
        const messages = drafted ?? (await opts.port.messages(chat));
        if (messages === null) return;
        draftedAt.delete(draftKey(chat, key));
        await opts.store.record(chat, key, { savedAt: now().toISOString(), messages });
      } catch {
        log('Could not note that a chat was saved to a project.');
      }
    },

    async unsaved(input) {
      const keys = new Set<string>(input.keys);
      const placed = (await opts.port.placed().catch(() => [] as PlacedChat[]))
        .filter((p) => keys.has(p.project) && p.lastModified >= input.since && !p.replying)
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, UNSAVED_LOOK_MAX);
      const out: UnsavedChat[] = [];
      for (const p of placed) {
        if (out.length >= UNSAVED_CHATS_MAX) break;
        const records = await opts.store.forChat(p.chat);
        let rec: { savedAt: string; messages: number } | null = null;
        for (const [k, r] of records) if (keys.has(k) && (!rec || r.savedAt > rec.savedAt)) rec = r;
        const count = await opts.port.messages(p.chat).catch(() => null);
        if (count === null) continue;
        if (rec) {
          if (count <= rec.messages) continue;
        } else if (await input.hasEntry(p.chat).catch(() => true)) {
          continue;
        }
        out.push({
          chat: p.chat,
          title: oneLine(p.title, CHAT_TITLE_MAX) || 'Untitled chat',
          lastActive: new Date(p.lastModified).toISOString(),
          savedAt: rec?.savedAt ?? null,
        });
      }
      return out;
    },

    async forProject(input) {
      const keys = new Set<string>(input.keys);
      const all = (await opts.port.placed().catch(() => [] as PlacedChat[]))
        .filter((p) => keys.has(p.project))
        .sort((a, b) => b.lastModified - a.lastModified);
      const placed = all.slice(0, PROJECT_CHATS_MAX);
      // Read at most once, and only when some chat has no record: the updates log is the slow part.
      let entries: Promise<Map<string, string> | null> | null = null;
      const readEntries = () => {
        entries ??= input.entries().catch(() => null);
        return entries;
      };
      const chats: ProjectChat[] = [];
      for (const p of placed) {
        const records = await opts.store.forChat(p.chat);
        let rec: { savedAt: string; messages: number } | null = null;
        for (const [k, r] of records) if (keys.has(k) && (!rec || r.savedAt > rec.savedAt)) rec = r;
        const lastActive = new Date(p.lastModified).toISOString();
        let saved: ProjectChat['saved'];
        let savedAt: string | null = null;
        if (rec) {
          savedAt = rec.savedAt;
          saved = 'saved';
          // Same counting rule as the Overview card: only a chat active since the save is counted.
          if (lastActive > rec.savedAt) {
            const count = await opts.port.messages(p.chat).catch(() => null);
            if (count !== null && count > rec.messages) saved = 'new';
          }
        } else {
          const mine = await readEntries();
          const at = mine?.get(p.chat);
          if (!mine) saved = null;
          else if (at !== undefined) {
            saved = 'saved';
            savedAt = at;
          } else saved = 'never';
        }
        chats.push({
          chat: p.chat,
          title: oneLine(p.title, CHAT_TITLE_MAX) || 'Untitled chat',
          lastActive,
          busy: p.replying,
          saved,
          savedAt,
        });
      }
      return { chats, more: all.length > PROJECT_CHATS_MAX };
    },
  };
}
