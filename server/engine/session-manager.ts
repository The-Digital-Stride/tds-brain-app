/**
 * Live chats (decisions 3, 4, 5, 6, 14 and amendments A1, A4–A6, A8).
 *
 * Each chat is one Agent SDK `query()` with streaming input, started in the brain root. Events are
 * numbered per chat and kept in memory so a page reload or a second tab can replay them.
 *
 * `query`, `listSessions` and `getSessionMessages` are injected, so tests never start Claude Code.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
  Options,
  PermissionResult,
  PermissionUpdate,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  type ApiErrorCode,
  type AppPermissionMode,
  type AskQuestion,
  type BrainReaders,
  type ChatEvent,
  type LiveSession,
  MAX_LIVE_SESSIONS,
  type PastSession,
  type PermissionReply,
  type QuestionReply,
  type SequencedEvent,
  type SessionList,
  type SessionState,
  type StartSessionRequest,
} from '../../shared/contract.ts';
import { createEventMapper, type EventMapper, type RawMessage } from './event-map.ts';
import { resolvePermissionMode } from './permission-mode.ts';
import { describeSessionAllow, narrowSuggestions, permissionCard } from './permissions.ts';

// ---------------------------------------------------------------------------
// Injected engine functions (the real ones come from the SDK)
// ---------------------------------------------------------------------------

export interface EngineQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  close(): void;
}

export interface PastInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
}

export interface HistoryMessage {
  type: string;
  uuid: string;
  message: unknown;
  parent_tool_use_id: string | null;
}

export interface EngineFns {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): EngineQuery;
  listSessions(opts: { dir: string }): Promise<PastInfo[]>;
  getSessionMessages(sessionId: string, opts: { dir: string }): Promise<HistoryMessage[]>;
}

export interface SessionManagerOptions {
  brain: Pick<BrainReaders, 'identity' | 'skillAccess' | 'clients'>;
  brainRoot: string;
  /** The installed `claude`, or null when it could not be found. */
  claudePath: string | null;
  engine: EngineFns;
  /** The server's environment; scrubbed before it reaches the engine (A6). */
  env?: NodeJS.ProcessEnv;
  idleMs?: number;
  maxLive?: number;
  /** How long a graceful close waits for the engine to finish its session-end hooks. */
  closeTimeoutMs?: number;
  /** Short status lines only. Never prompts, replies or tokens. */
  log?: (line: string) => void;
  /**
   * The approval mode for a new engine, read afresh each time (A18). Defaults to reading the
   * person's and the brain's Claude Code settings; tests inject their own.
   */
  permissionMode?: () => AppPermissionMode;
}

export class SessionError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export interface Subscription {
  replay: SequencedEvent[];
  unsubscribe(): void;
}

export interface SessionManager {
  list(): Promise<SessionList>;
  start(req: StartSessionRequest): Promise<LiveSession>;
  send(id: string, text: string): Promise<void>;
  replyPermission(id: string, reply: PermissionReply): Promise<void>;
  replyQuestion(id: string, reply: QuestionReply): Promise<void>;
  interrupt(id: string): Promise<void>;
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
  /** Events with seq > after, then live ones. Throws `not-found` / `session-closed`. */
  subscribe(id: string, after: number, listener: (item: SequencedEvent) => void): Subscription;
  /** Called when a chat is created, closed or changes state. */
  onChange(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_CLOSE_TIMEOUT_MS = 15_000;
const MAX_PROMPT_CHARS = 100_000;
const MAX_ANSWER_CHARS = 10_000;
const TITLE_CHARS = 60;
/** A6 and A16: nothing that could bill an API key or a cloud account instead of the person's sign-in. */
const SCRUBBED_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'AWS_BEARER_TOKEN_BEDROCK',
];

export function scrubEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || SCRUBBED_ENV.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export function makeTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= TITLE_CHARS) return flat;
  return `${flat.slice(0, TITLE_CHARS).trimEnd()}…`;
}

function clientLine(slug: string): string {
  return `The user is working on the client in clients/${slug}/ for this chat. Read that folder's context before client-specific work, and keep to that client unless the user says otherwise.`;
}

/** A push-based async iterable: the engine's streaming input. */
function createInputQueue() {
  const items: SDKUserMessage[] = [];
  let waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  let ended = false;
  const done = (): IteratorResult<SDKUserMessage> => ({ value: undefined, done: true });
  return {
    push(text: string): void {
      if (ended) return;
      const msg: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      };
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: msg, done: false });
      } else {
        items.push(msg);
      }
    },
    end(): void {
      ended = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w(done());
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        next: () => {
          const next = items.shift();
          if (next) return Promise.resolve({ value: next, done: false });
          if (ended) return Promise.resolve(done());
          return new Promise((r) => {
            waiting = r;
          });
        },
        return: () => {
          ended = true;
          return Promise.resolve(done());
        },
      };
    },
  };
}

type InputQueue = ReturnType<typeof createInputQueue>;

type Outcome = 'allowed' | 'denied' | 'answered' | 'cancelled';

interface Pending {
  kind: 'permission' | 'question';
  requestId: string;
  input: Record<string, unknown>;
  kept: PermissionUpdate[];
  questions: AskQuestion[];
  settle(result: PermissionResult, outcome: Outcome): void;
}

interface Session {
  id: string;
  sdkSessionId: string | null;
  title: string;
  client: string | null;
  appendLine: string | null;
  state: SessionState;
  startedAt: string;
  lastActivityAt: string;
  lastActivityMs: number;
  events: SequencedEvent[];
  seq: number;
  listeners: Set<(item: SequencedEvent) => void>;
  mapper: EventMapper;
  query: EngineQuery | null;
  input: InputQueue | null;
  pump: Promise<void> | null;
  pending: Map<string, Pending>;
  /** Tool calls refused on a card (or by the app), so the engine's later denial is not shown twice. */
  deniedTools: Set<string>;
  turnRunning: boolean;
  interruptRequested: boolean;
  warnedKeySource: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  closed: Promise<void> | null;
  userCounter: number;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseQuestions(input: Rec): AskQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  const out: AskQuestion[] = [];
  for (const q of input.questions) {
    if (!isRec(q) || typeof q.question !== 'string') continue;
    const options = Array.isArray(q.options)
      ? q.options
          .filter((o): o is Rec => isRec(o) && typeof o.label === 'string')
          .map((o) => ({
            label: o.label as string,
            description: typeof o.description === 'string' ? o.description : '',
          }))
      : [];
    out.push({
      question: q.question,
      header: typeof q.header === 'string' ? q.header : '',
      options,
      multiSelect: q.multiSelect === true,
    });
  }
  return out;
}

function historyText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is Rec => isRec(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n\n');
}

/** Turns a stored user turn into what the person typed, or null for Claude Code's own wrappers. */
function cleanUserText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const name = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text)?.[1];
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    const slash = name.startsWith('/') ? name : `/${name}`;
    return args ? `${slash} ${args}` : slash;
  }
  if (
    /^<(local-command-[\w-]+|command-message|system-reminder|bash-[\w-]+|user-prompt-submit-hook)>/.test(text)
  ) {
    return null;
  }
  if (text.startsWith('Caveat: The messages below were generated by the user while running local commands'))
    return null;
  return text;
}

function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<void>((r) => {
    timer = setTimeout(r, ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------

export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const maxLive = opts.maxLive ?? MAX_LIVE_SESSIONS;
  const closeTimeoutMs = opts.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  const env = scrubEnv(opts.env ?? process.env);
  const log = opts.log ?? (() => {});
  const resolveMode = opts.permissionMode ?? (() => resolvePermissionMode(opts.brainRoot, homedir()));
  const live = new Map<string, Session>();
  const closedIds = new Set<string>();
  const changeListeners = new Set<() => void>();

  function notifyChanged(): void {
    for (const l of changeListeners) {
      try {
        l();
      } catch {
        // a broken listener must not break a chat
      }
    }
  }

  function emit(s: Session, event: ChatEvent): void {
    const now = new Date();
    s.lastActivityAt = now.toISOString();
    s.lastActivityMs = now.getTime();
    const item: SequencedEvent = { seq: ++s.seq, at: s.lastActivityAt, event };
    if (event.type === 'assistant-message') {
      // The finished block replaces its deltas; keep the replay log small.
      s.events = s.events.filter(
        (e) => !(e.event.type === 'assistant-delta' && e.event.messageId === event.messageId),
      );
    }
    s.events.push(item);
    for (const l of s.listeners) {
      try {
        l(item);
      } catch {
        // ignore a broken stream
      }
    }
  }

  function setState(s: Session, state: SessionState, detail?: string): void {
    if (s.state === state) return;
    if (s.closing && state !== 'closed') return;
    s.state = state;
    emit(s, detail ? { type: 'state', state, detail } : { type: 'state', state });
    notifyChanged();
  }

  function snapshot(s: Session): LiveSession {
    return {
      id: s.id,
      sdkSessionId: s.sdkSessionId,
      title: s.title,
      client: s.client,
      state: s.state,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
    };
  }

  function clearIdle(s: Session): void {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.idleTimer = null;
  }

  function armIdle(s: Session): void {
    clearIdle(s);
    if (s.closing) return;
    s.idleTimer = setTimeout(() => {
      log('Closing a chat that has been idle for 30 minutes.');
      void closeSession(s);
    }, idleMs);
    s.idleTimer.unref?.();
  }

  function getLive(id: string): Session {
    const s = live.get(id);
    if (s) return s;
    if (closedIds.has(id))
      throw new SessionError('session-closed', 'That chat has been closed. Start a new one.');
    throw new SessionError('not-found', 'That chat could not be found. It may have been closed.');
  }

  function newSession(fields: {
    title: string;
    client: string | null;
    sdkSessionId: string | null;
  }): Session {
    const now = new Date();
    return {
      id: randomUUID(),
      sdkSessionId: fields.sdkSessionId,
      title: fields.title,
      client: fields.client,
      appendLine: fields.client ? clientLine(fields.client) : null,
      state: 'idle',
      startedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      lastActivityMs: now.getTime(),
      events: [],
      seq: 0,
      listeners: new Set(),
      mapper: createEventMapper(),
      query: null,
      input: null,
      pump: null,
      pending: new Map(),
      deniedTools: new Set(),
      turnRunning: false,
      interruptRequested: false,
      warnedKeySource: false,
      idleTimer: null,
      closing: false,
      closed: null,
      userCounter: 0,
    };
  }

  // -- permissions and questions --------------------------------------------

  function settleAll(s: Session, message: string): void {
    for (const p of [...s.pending.values()])
      p.settle({ behavior: 'deny', message, interrupt: true }, 'cancelled');
  }

  function canUseToolFor(s: Session): NonNullable<Options['canUseTool']> {
    return (toolName, input, ctx) => {
      if (s.closing)
        return Promise.resolve({ behavior: 'deny', message: 'The chat was closed.', interrupt: true });
      const requestId = typeof ctx.requestId === 'string' && ctx.requestId ? ctx.requestId : randomUUID();
      const isQuestion = toolName === 'AskUserQuestion';
      const questions = isQuestion ? parseQuestions(input) : [];
      if (isQuestion && questions.length === 0) {
        return Promise.resolve({
          behavior: 'deny',
          message: 'The app could not show that question. Ask it in plain text instead.',
        });
      }
      const card = isQuestion
        ? null
        : permissionCard(toolName, input, {
            title: ctx.title,
            blockedPath: ctx.blockedPath,
            brainRoot: opts.brainRoot,
          });
      if (card?.refuse) {
        if (ctx.toolUseID) s.deniedTools.add(ctx.toolUseID);
        // A12: the person cannot review what they cannot see, so never ask about it.
        emit(s, {
          type: 'notice',
          level: 'warning',
          text: 'Claude tried to run a command that was too long to show you in full, so the app refused it. Claude has been asked to split it into smaller steps.',
        });
        return Promise.resolve({
          behavior: 'deny',
          message:
            'This command is too long for the user to review. Split it into smaller steps, each short enough to read, and try again.',
        });
      }
      return new Promise<PermissionResult>((resolve) => {
        const signal = ctx.signal;
        const onAbort = () => pending.settle({ behavior: 'deny', message: 'Cancelled.' }, 'cancelled');
        const pending: Pending = {
          kind: isQuestion ? 'question' : 'permission',
          requestId,
          input,
          kept: isQuestion ? [] : narrowSuggestions(ctx.suggestions, ctx.suppressAlwaysAllowRule),
          questions,
          settle(result, outcome) {
            if (s.pending.get(requestId) !== pending) return;
            s.pending.delete(requestId);
            if (result.behavior === 'deny' && ctx.toolUseID) s.deniedTools.add(ctx.toolUseID);
            signal?.removeEventListener('abort', onAbort);
            emit(s, { type: 'request-resolved', requestId, outcome });
            if (s.pending.size === 0 && s.turnRunning) setState(s, 'working');
            resolve(result);
          },
        };
        s.pending.set(requestId, pending);
        clearIdle(s);
        if (isQuestion) {
          emit(s, { type: 'question-request', requestId, questions });
        } else if (card) {
          emit(s, {
            type: 'permission-request',
            requestId,
            tool: toolName,
            title: card.title,
            detail: card.detail,
            warning: card.warning,
            sessionAllowLabel: describeSessionAllow(pending.kept),
          });
        }
        setState(s, 'waiting');
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
  }

  // -- the engine -----------------------------------------------------------

  function handleMessage(s: Session, raw: RawMessage): void {
    if (raw.type === 'system' && raw.subtype === 'init') {
      const sid = typeof raw.session_id === 'string' ? raw.session_id : null;
      if (sid && sid !== s.sdkSessionId) {
        s.sdkSessionId = sid;
        notifyChanged();
      }
      if (s.turnRunning && s.state === 'starting') setState(s, 'working');
      if (!s.warnedKeySource && typeof raw.apiKeySource === 'string' && raw.apiKeySource !== 'none') {
        s.warnedKeySource = true;
        emit(s, {
          type: 'notice',
          level: 'warning',
          text: 'This chat is using an API key or a cloud account, not your Claude sign-in, so it may be charged separately. Close this chat and tell whoever looks after the brain.',
        });
      }
    }
    for (const event of s.mapper.map(raw, {
      interrupted: s.interruptRequested,
      deniedByPerson: s.deniedTools,
    }))
      emit(s, event);
    if (raw.type === 'result') {
      s.turnRunning = false;
      s.interruptRequested = false;
      settleAll(s, 'The turn ended.');
      setState(s, 'idle');
      armIdle(s);
    }
  }

  async function pump(s: Session, q: EngineQuery): Promise<void> {
    try {
      for await (const raw of q) {
        if (isRec(raw) && typeof raw.type === 'string') handleMessage(s, raw as RawMessage);
      }
    } catch {
      // The engine's own error text is technical and can echo the conversation: never show or log it.
    } finally {
      s.query = null;
      s.input?.end();
      s.input = null;
      settleAll(s, 'Claude Code stopped.');
      if (!s.closing) {
        log('A chat engine stopped unexpectedly.');
        if (s.turnRunning) {
          emit(s, {
            type: 'turn-end',
            ok: false,
            interrupted: s.interruptRequested,
            durationMs: null,
            errorText: 'Claude stopped before it finished. Send your message again to carry on.',
          });
          s.turnRunning = false;
          s.interruptRequested = false;
        }
        emit(s, {
          type: 'notice',
          level: 'error',
          text: 'Claude stopped unexpectedly. Send your message again to carry on.',
        });
        setState(s, 'error');
      }
    }
  }

  function startEngine(s: Session): void {
    const input = createInputQueue();
    const options: Options = {
      cwd: opts.brainRoot,
      pathToClaudeCodeExecutable: opts.claudePath ?? undefined,
      // Never 'bypassPermissions', and never allowDangerouslySkipPermissions: the app always asks.
      permissionMode: resolveMode(),
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: s.appendLine
        ? { type: 'preset', preset: 'claude_code', append: s.appendLine }
        : { type: 'preset', preset: 'claude_code' },
      env,
      canUseTool: canUseToolFor(s),
      // Swallow the engine's own stderr: it can echo prompts and must never reach the server log.
      stderr: () => {},
    };
    if (s.sdkSessionId) options.resume = s.sdkSessionId;
    s.input = input;
    try {
      const q = opts.engine.query({ prompt: input, options });
      s.query = q;
      s.pump = pump(s, q);
    } catch {
      s.input = null;
      throw new SessionError('engine-missing', 'Claude Code could not be started on this computer.');
    }
  }

  async function checkSkill(text: string): Promise<void> {
    const name = /^\/([A-Za-z0-9][\w.:-]*)(?:\s|$)/.exec(text.trimStart())?.[1];
    if (!name) return;
    const identity = await opts.brain.identity();
    const access = await opts.brain.skillAccess(identity, name);
    if (access === 'restricted') {
      throw new SessionError(
        'not-allowed',
        `Your role can't run /${name}. It is kept for owners and scouts; ask one of them if you need it.`,
      );
    }
  }

  function validText(text: unknown, what: string): string {
    if (typeof text !== 'string') throw new SessionError('bad-request', `The ${what} must be text.`);
    const trimmed = text.trim();
    if (!trimmed) throw new SessionError('bad-request', 'Type a message first.');
    if (trimmed.length > MAX_PROMPT_CHARS)
      throw new SessionError('bad-request', 'That message is too long to send.');
    return trimmed;
  }

  function beginTurn(s: Session, text: string): void {
    if (s.closing) throw new SessionError('session-closed', 'That chat has been closed. Start a new one.');
    clearIdle(s);
    s.turnRunning = true;
    s.interruptRequested = false;
    const needsEngine = !s.query;
    setState(s, needsEngine ? 'starting' : 'working');
    emit(s, { type: 'user-message', messageId: `u${++s.userCounter}`, text });
    if (needsEngine) {
      try {
        startEngine(s);
      } catch (err) {
        s.turnRunning = false;
        setState(s, 'error');
        throw err;
      }
    }
    s.input?.push(text);
  }

  // -- closing --------------------------------------------------------------

  function closeSession(s: Session): Promise<void> {
    if (s.closed) return s.closed;
    s.closing = true;
    live.delete(s.id);
    closedIds.add(s.id);
    clearIdle(s);
    notifyChanged();
    s.closed = (async () => {
      settleAll(s, 'The chat was closed.');
      const q = s.query;
      if (q) {
        if (s.turnRunning) {
          s.interruptRequested = true;
          await q.interrupt().catch(() => {});
        }
        // End the input so Claude Code finishes cleanly and runs the brain's session-end hooks.
        s.input?.end();
        const wait = delay(closeTimeoutMs);
        await Promise.race([s.pump ?? Promise.resolve(), wait.promise]);
        wait.cancel();
        try {
          q.close();
        } catch {
          // already gone
        }
      }
      setState(s, 'closed');
      s.listeners.clear();
      notifyChanged();
    })();
    return s.closed;
  }

  /** At the cap, close the longest-idle chat; refuse when every chat is busy. */
  function makeRoom(): void {
    if (live.size < maxLive) return;
    const idle = [...live.values()]
      .filter((s) => !s.turnRunning && s.pending.size === 0 && (s.state === 'idle' || s.state === 'error'))
      .sort((a, b) => a.lastActivityMs - b.lastActivityMs);
    const victim = idle[0];
    if (!victim) {
      throw new SessionError(
        'too-many-chats',
        `You already have ${maxLive} chats working. Wait for one to finish, or close one, then try again.`,
      );
    }
    log('Closing the longest-idle chat to make room for a new one.');
    void closeSession(victim);
  }

  async function listPast(): Promise<PastInfo[]> {
    try {
      return await opts.engine.listSessions({ dir: opts.brainRoot });
    } catch {
      return [];
    }
  }

  async function replayHistory(s: Session, sdkSessionId: string): Promise<void> {
    let messages: HistoryMessage[] = [];
    try {
      messages = await opts.engine.getSessionMessages(sdkSessionId, { dir: opts.brainRoot });
    } catch {
      emit(s, {
        type: 'notice',
        level: 'warning',
        text: 'The earlier messages in this chat could not be loaded.',
      });
      return;
    }
    for (const m of messages) {
      if (m.parent_tool_use_id) continue;
      const content = isRec(m.message) ? m.message.content : undefined;
      if (m.type === 'user') {
        const text = cleanUserText(historyText(content));
        if (text) emit(s, { type: 'user-message', messageId: `h:${m.uuid}`, text });
      } else if (m.type === 'assistant') {
        const text = historyText(content).trim();
        if (text)
          emit(s, { type: 'assistant-message', messageId: `h:${m.uuid}`, text, parentToolUseId: null });
      }
    }
  }

  // -- the public face ------------------------------------------------------

  return {
    async list() {
      const liveList = [...live.values()]
        .map(snapshot)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const liveIds = new Set(liveList.map((s) => s.sdkSessionId).filter(Boolean));
      const past: PastSession[] = (await listPast())
        .filter((p) => typeof p.sessionId === 'string' && !liveIds.has(p.sessionId))
        .sort((a, b) => b.lastModified - a.lastModified)
        .map((p) => ({
          sdkSessionId: p.sessionId,
          title: makeTitle(p.customTitle || p.summary || p.firstPrompt || 'Untitled chat'),
          lastModified: new Date(p.lastModified).toISOString(),
        }));
      return { live: liveList, past };
    },

    async start(req) {
      if (!isRec(req)) throw new SessionError('bad-request', 'That request was not understood.');
      const prompt =
        req.prompt === undefined || req.prompt === null ? null : validText(req.prompt, 'message');
      const resume = req.resume === undefined || req.resume === null ? null : req.resume;
      if (resume !== null && (typeof resume !== 'string' || !resume)) {
        throw new SessionError('bad-request', 'That past chat was not understood.');
      }
      if (prompt === null && resume === null) throw new SessionError('bad-request', 'Type a message first.');
      if (!opts.claudePath) {
        throw new SessionError(
          'engine-missing',
          'Claude Code is not installed on this computer, or the app cannot find it.',
        );
      }
      if (prompt) await checkSkill(prompt);

      let client: string | null = null;
      let title = prompt ? makeTitle(prompt) : 'Chat';
      if (resume) {
        if ([...live.values()].some((s) => s.sdkSessionId === resume)) {
          throw new SessionError('already-open', 'That chat is already open.');
        }
        const past = (await listPast()).find((p) => p.sessionId === resume);
        if (!past) throw new SessionError('not-found', 'That past chat could not be found.');
        title = makeTitle(past.customTitle || past.summary || past.firstPrompt || 'Earlier chat');
      } else if (req.client !== undefined && req.client !== null) {
        const slug = req.client;
        const known = typeof slug === 'string' && (await opts.brain.clients()).some((c) => c.slug === slug);
        if (!known)
          throw new SessionError('bad-request', 'That client is not in the brain. Pick one from the list.');
        client = slug;
      }

      // Re-check synchronously: other requests may have run while we awaited.
      if (resume && [...live.values()].some((s) => s.sdkSessionId === resume)) {
        throw new SessionError('already-open', 'That chat is already open.');
      }
      makeRoom();
      const s = newSession({ title, client, sdkSessionId: resume });
      live.set(s.id, s);
      notifyChanged();
      log(resume ? 'Reopened a past chat.' : 'Started a chat.');

      if (resume) {
        await replayHistory(s, resume);
        // The chat may have been closed while its history loaded: never start an engine for it then.
        if (s.closing) throw new SessionError('session-closed', 'That chat was closed while it was opening.');
        emit(s, { type: 'state', state: 'idle' });
      }
      if (prompt) beginTurn(s, prompt);
      return snapshot(s);
    },

    async send(id, text) {
      const s = getLive(id);
      const body = validText(text, 'message');
      if (s.turnRunning)
        throw new SessionError(
          'busy',
          'Claude is still working on the last message. Wait, or stop it first.',
        );
      if (!opts.claudePath) {
        throw new SessionError(
          'engine-missing',
          'Claude Code is not installed on this computer, or the app cannot find it.',
        );
      }
      await checkSkill(body);
      if (s.closing) throw new SessionError('session-closed', 'That chat has been closed. Start a new one.');
      if (s.turnRunning)
        throw new SessionError(
          'busy',
          'Claude is still working on the last message. Wait, or stop it first.',
        );
      beginTurn(s, body);
    },

    async replyPermission(id, reply) {
      const s = getLive(id);
      if (!isRec(reply) || typeof reply.requestId !== 'string') {
        throw new SessionError('bad-request', 'That answer was not understood.');
      }
      const p = s.pending.get(reply.requestId);
      if (p?.kind !== 'permission') {
        throw new SessionError('not-found', 'That request has already been answered or has expired.');
      }
      const note = typeof reply.note === 'string' ? reply.note.trim().slice(0, MAX_ANSWER_CHARS) : '';
      switch (reply.decision) {
        case 'allow':
          p.settle({ behavior: 'allow', updatedInput: p.input }, 'allowed');
          return;
        case 'allow-session':
          p.settle(
            p.kept.length > 0
              ? { behavior: 'allow', updatedInput: p.input, updatedPermissions: p.kept }
              : { behavior: 'allow', updatedInput: p.input },
            'allowed',
          );
          return;
        case 'deny':
          p.settle(
            {
              behavior: 'deny',
              message: note
                ? `The user said no to this. Their note: ${note}`
                : 'The user said no to this. Do not try it again another way without asking.',
            },
            'denied',
          );
          return;
        default:
          throw new SessionError('bad-request', 'That answer was not understood.');
      }
    },

    async replyQuestion(id, reply) {
      const s = getLive(id);
      if (!isRec(reply) || typeof reply.requestId !== 'string' || !isRec(reply.answers)) {
        throw new SessionError('bad-request', 'That answer was not understood.');
      }
      const p = s.pending.get(reply.requestId);
      if (p?.kind !== 'question') {
        throw new SessionError('not-found', 'That question has already been answered or has expired.');
      }
      const asked = new Set(p.questions.map((q) => q.question));
      const answers: Record<string, string> = {};
      for (const [question, value] of Object.entries(reply.answers)) {
        if (!asked.has(question))
          throw new SessionError('bad-request', 'That answer does not match the question asked.');
        let text: string;
        if (typeof value === 'string') text = value;
        else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) text = value.join(', ');
        else throw new SessionError('bad-request', 'That answer was not understood.');
        if (text.length > MAX_ANSWER_CHARS) throw new SessionError('bad-request', 'That answer is too long.');
        answers[question] = text;
      }
      const freeText = typeof reply.freeText === 'string' ? reply.freeText.trim() : '';
      if (freeText.length > MAX_ANSWER_CHARS)
        throw new SessionError('bad-request', 'That answer is too long.');
      if (Object.keys(answers).length === 0 && !freeText)
        throw new SessionError('bad-request', 'Choose an answer first.');
      p.settle(
        {
          behavior: 'allow',
          updatedInput: { ...p.input, answers, ...(freeText ? { response: freeText } : {}) },
        },
        'answered',
      );
    },

    async interrupt(id) {
      const s = getLive(id);
      if (!s.turnRunning) return;
      s.interruptRequested = true;
      settleAll(s, 'The user stopped this.');
      const q = s.query;
      if (q) await q.interrupt().catch(() => {});
    },

    async close(id) {
      const s = live.get(id);
      if (!s) {
        if (closedIds.has(id)) return;
        throw new SessionError('not-found', 'That chat could not be found.');
      }
      await closeSession(s);
    },

    async closeAll() {
      await Promise.all([...live.values()].map((s) => closeSession(s)));
    },

    subscribe(id, after, listener) {
      const s = getLive(id);
      const from = Number.isFinite(after) && after > 0 ? after : 0;
      const replay = s.events.filter((e) => e.seq > from);
      s.listeners.add(listener);
      return {
        replay,
        unsubscribe: () => {
          s.listeners.delete(listener);
        },
      };
    },

    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
  };
}
