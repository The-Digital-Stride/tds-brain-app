/**
 * Raw Agent SDK messages → the small ChatEvent set in the contract (decision 7, A9).
 *
 * The SDK's message types are wide and change between releases, so this file reads them as loose
 * records and picks out only the fields it needs. Everything the client sees goes through here.
 */
import type { ChatEvent } from '../../shared/contract.ts';

/** Any SDK message, read loosely. */
export type RawMessage = { type: string; [key: string]: unknown };

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function humaniseMcpServer(server: string): string {
  const cleaned = server.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '');
  return cleaned.replace(/[_-]+/g, ' ').trim() || server;
}

/** A short, plain UK-English line for a tool call, shown in the chat. */
export function toolLabel(tool: string, input: Rec): string {
  const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  switch (tool) {
    case 'Read':
      return file ? `Reading ${baseName(file)}` : 'Reading a file';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return file ? `Editing ${baseName(file)}` : 'Editing a file';
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return 'Running a command';
    case 'Glob':
    case 'Grep':
      return 'Searching files';
    case 'Skill': {
      const name = str(input.skill) ?? str(input.name) ?? str(input.command);
      return name ? `Using the ${name.replace(/^\//, '')} skill` : 'Using a skill';
    }
    case 'Agent':
    case 'Task':
      return 'Asking a helper';
    case 'WebFetch':
    case 'WebSearch':
      return 'Looking on the web';
    case 'TodoWrite':
      return 'Planning the steps';
    case 'AskUserQuestion':
      return 'Asking you a question';
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp?.[1]) return `Using ${humaniseMcpServer(mcp[1])}`;
  return tool;
}

const RESULT_ERRORS: Record<string, string> = {
  error_max_turns: 'Claude stopped because it reached its limit of steps for one message.',
  error_max_budget_usd: 'Claude stopped because it reached its spending limit for this chat.',
  error_max_structured_output_retries:
    'Claude stopped because it could not produce the expected answer format.',
  error_during_execution: 'Something went wrong while Claude was working.',
};

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed:
    'Claude Code is not signed in. Open a terminal, run claude and sign in, then try again.',
  billing_error: 'Your Claude account has a billing problem, so Claude could not answer.',
  rate_limit: 'You have reached your Claude usage limit for now. Try again later.',
  overloaded: 'Claude is very busy right now. Try again in a minute.',
};

export interface EventMapper {
  map(msg: RawMessage, opts?: { interrupted?: boolean }): ChatEvent[];
}

/**
 * One mapper per chat. It is stateful only to pair streamed deltas with their finished block:
 * a text block's id is `<api message id>:t<n>`, where n counts text blocks within that API message.
 * Deltas count blocks as they start; finished `assistant` messages (which carry one block each)
 * count them as they arrive, so both sides agree without relying on the stream's block index.
 */
export function createEventMapper(): EventMapper {
  let lastInfo = '';
  let anon = 0;
  /** parent → current streamed API message id */
  const streamMsg = new Map<string, string>();
  /** `${parent}|${index}` → messageId for a streamed text block */
  const streamBlocks = new Map<string, string>();
  /** api message id → text blocks started in the stream */
  const streamTextCount = new Map<string, number>();
  /** api message id → text blocks finished */
  const doneTextCount = new Map<string, number>();

  function parentOf(msg: RawMessage): string | null {
    return str(msg.parent_tool_use_id);
  }

  function mapSystem(msg: RawMessage): ChatEvent[] {
    if (msg.subtype !== 'init') return [];
    const sdkSessionId = str(msg.session_id);
    if (!sdkSessionId) return [];
    const ev: ChatEvent = {
      type: 'session-info',
      sdkSessionId,
      model: str(msg.model),
      claudeVersion: str(msg.claude_code_version),
    };
    const key = JSON.stringify(ev);
    if (key === lastInfo) return [];
    lastInfo = key;
    return [ev];
  }

  function mapStream(msg: RawMessage): ChatEvent[] {
    const ev = msg.event;
    if (!isRec(ev)) return [];
    const parent = parentOf(msg);
    const pkey = parent ?? '';
    if (ev.type === 'message_start') {
      const id = isRec(ev.message) ? str(ev.message.id) : null;
      streamMsg.set(pkey, id ?? `anon-${++anon}`);
      return [];
    }
    if (ev.type === 'content_block_start') {
      const block = ev.content_block;
      if (!isRec(block) || block.type !== 'text' || typeof ev.index !== 'number') return [];
      const apiId = streamMsg.get(pkey) ?? `anon-${++anon}`;
      streamMsg.set(pkey, apiId);
      const n = streamTextCount.get(apiId) ?? 0;
      streamTextCount.set(apiId, n + 1);
      streamBlocks.set(`${pkey}|${ev.index}`, `${apiId}:t${n}`);
      return [];
    }
    if (ev.type === 'content_block_delta') {
      const delta = ev.delta;
      if (!isRec(delta) || delta.type !== 'text_delta' || typeof ev.index !== 'number') return [];
      const text = str(delta.text);
      const messageId = streamBlocks.get(`${pkey}|${ev.index}`);
      if (!text || !messageId) return [];
      return [{ type: 'assistant-delta', messageId, text, parentToolUseId: parent }];
    }
    return [];
  }

  function mapAssistant(msg: RawMessage): ChatEvent[] {
    const message = msg.message;
    if (!isRec(message)) return [];
    const parent = parentOf(msg);
    const apiId = str(message.id) ?? `anon-${++anon}`;
    const out: ChatEvent[] = [];
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (!isRec(block)) continue;
      if (block.type === 'text') {
        const n = doneTextCount.get(apiId) ?? 0;
        doneTextCount.set(apiId, n + 1);
        const text = str(block.text) ?? '';
        if (!text) continue;
        out.push({ type: 'assistant-message', messageId: `${apiId}:t${n}`, text, parentToolUseId: parent });
      } else if (block.type === 'tool_use') {
        const toolUseId = str(block.id);
        const tool = str(block.name);
        if (!toolUseId || !tool) continue;
        const input = isRec(block.input) ? block.input : {};
        out.push({
          type: 'tool-start',
          toolUseId,
          tool,
          label: toolLabel(tool, input),
          parentToolUseId: parent,
        });
      }
    }
    const err = str(msg.error);
    if (err && parent === null) {
      const text = ASSISTANT_ERRORS[err];
      if (text) out.push({ type: 'notice', level: 'error', text });
    }
    return out;
  }

  function mapUser(msg: RawMessage): ChatEvent[] {
    const message = msg.message;
    if (!isRec(message) || !Array.isArray(message.content)) return [];
    const out: ChatEvent[] = [];
    for (const block of message.content) {
      if (!isRec(block) || block.type !== 'tool_result') continue;
      const toolUseId = str(block.tool_use_id);
      if (!toolUseId) continue;
      out.push({ type: 'tool-end', toolUseId, ok: block.is_error !== true });
    }
    return out;
  }

  function mapResult(msg: RawMessage, interrupted: boolean): ChatEvent[] {
    const durationMs = typeof msg.duration_ms === 'number' ? msg.duration_ms : null;
    const ok = !interrupted && msg.subtype === 'success' && msg.is_error !== true;
    let errorText: string | null = null;
    if (!ok && !interrupted) {
      if (msg.subtype === 'success') {
        errorText = str(msg.result) || RESULT_ERRORS.error_during_execution || null;
      } else {
        const errors = Array.isArray(msg.errors)
          ? msg.errors.filter((e): e is string => typeof e === 'string')
          : [];
        const subtype = str(msg.subtype) ?? '';
        errorText =
          (subtype !== 'error_during_execution' ? RESULT_ERRORS[subtype] : undefined) ??
          (errors.length > 0 ? errors.join('\n') : (RESULT_ERRORS[subtype] ?? 'Something went wrong.'));
      }
    }
    return [{ type: 'turn-end', ok, interrupted, durationMs, errorText }];
  }

  return {
    map(msg, opts) {
      switch (msg.type) {
        case 'system':
          return mapSystem(msg);
        case 'stream_event':
          return mapStream(msg);
        case 'assistant':
          return mapAssistant(msg);
        case 'user':
          return mapUser(msg);
        case 'result':
          return mapResult(msg, opts?.interrupted === true);
        default:
          return [];
      }
    },
  };
}
