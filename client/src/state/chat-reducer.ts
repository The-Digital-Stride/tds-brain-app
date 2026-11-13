import type {
  AskQuestion,
  AttachmentInfo,
  ChatEvent,
  ChatFilesSnapshot,
  ProposedChange,
  SequencedEvent,
  SessionState,
} from '../../../shared/contract.ts';
import { attentionFor } from '../../../shared/contract.ts';

export type Outcome = 'allowed' | 'denied' | 'answered' | 'cancelled';

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  text: string;
  /** True once the finished text has arrived. */
  done: boolean;
}

export interface ToolItem {
  kind: 'tool';
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'ok' | 'failed';
  /** Work done by a helper agent this tool started. */
  children: ChildItem[];
}

export type ChildItem = AssistantItem | ToolItem;

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  attachments?: AttachmentInfo[];
}

export interface PermissionItem {
  kind: 'permission';
  requestId: string;
  tool: string;
  title: string;
  detail: string;
  warning: string | null;
  sessionAllowLabel: string | null;
  /** The lines a Write or Edit will remove and add; null for other tools and older servers. */
  change: ProposedChange | null;
  outcome: Outcome | null;
}

export interface QuestionItem {
  kind: 'question';
  requestId: string;
  questions: AskQuestion[];
  outcome: Outcome | null;
}

export interface NoticeItem {
  kind: 'notice';
  id: string;
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface TurnEndItem {
  kind: 'turn-end';
  id: string;
  ok: boolean;
  interrupted: boolean;
  errorText: string | null;
  durationMs: number | null;
}

export type ChatItem =
  | UserItem
  | AssistantItem
  | ToolItem
  | PermissionItem
  | QuestionItem
  | NoticeItem
  | TurnEndItem;

export interface ChatState {
  lastSeq: number;
  items: ChatItem[];
  sessionState: SessionState;
  stateDetail: string | null;
  /** When (ms) the chat last changed attention state, from the events' own times. null until seen. */
  stateSince: number | null;
  sdkSessionId: string | null;
  /** The files, attachments and links this chat has touched. */
  files: ChatFilesSnapshot;
}

export const initialChatState: ChatState = {
  lastSeq: 0,
  items: [],
  sessionState: 'starting',
  stateDetail: null,
  stateSince: null,
  sdkSessionId: null,
  files: { files: [], attachments: [], links: [] },
};

export type ChatAction = { type: 'event'; item: SequencedEvent } | { type: 'reset' };

/** The permission or question card that is still waiting on the person, if any. */
export function pendingCard(state: ChatState): PermissionItem | QuestionItem | null {
  for (const item of state.items) {
    if ((item.kind === 'permission' || item.kind === 'question') && item.outcome === null) return item;
  }
  return null;
}

function findTool(items: ChildItem[] | ChatItem[], id: string): ToolItem | null {
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    if (item.id === id) return item;
    const inner = findTool(item.children, id);
    if (inner) return inner;
  }
  return null;
}

function newTool(id: string, tool: string, label: string): ToolItem {
  return { kind: 'tool', id, tool, label, status: 'running', children: [] };
}

/** Add or update an assistant block in a list. */
function upsertAssistant(list: ChildItem[], id: string, text: string, replace: boolean): void {
  const existing = list.find((i): i is AssistantItem => i.kind === 'assistant' && i.id === id);
  if (!existing) {
    list.push({ kind: 'assistant', id, text, done: replace });
    return;
  }
  if (replace) {
    existing.text = text;
    existing.done = true;
  } else if (!existing.done) {
    existing.text += text;
  }
}

/** The list that holds items for a parent tool, creating a stand-in parent if it is unknown. */
function listFor(items: ChatItem[], parentToolUseId: string | null): ChildItem[] | ChatItem[] {
  if (parentToolUseId === null) return items;
  let parent = findTool(items, parentToolUseId);
  if (!parent) {
    parent = newTool(parentToolUseId, 'Task', 'Helper');
    items.push(parent);
  }
  return parent.children;
}

function cloneItems(items: ChatItem[]): ChatItem[] {
  return structuredClone(items);
}

function applyEvent(state: ChatState, seqNo: number, event: ChatEvent, at: string): ChatState {
  const next: ChatState = { ...state, lastSeq: seqNo };
  switch (event.type) {
    case 'state':
      if (state.stateSince === null || attentionFor(event.state) !== attentionFor(state.sessionState)) {
        const t = Date.parse(at);
        next.stateSince = Number.isNaN(t) ? state.stateSince : t;
      }
      next.sessionState = event.state;
      next.stateDetail = event.detail ?? null;
      return next;
    case 'session-info':
      next.sdkSessionId = event.sdkSessionId;
      return next;
    case 'user-message': {
      next.items = [
        ...state.items,
        {
          kind: 'user',
          id: event.messageId,
          text: event.text,
          ...(event.attachments?.length ? { attachments: event.attachments } : {}),
        },
      ];
      return next;
    }
    case 'assistant-delta':
    case 'assistant-message': {
      const items = cloneItems(state.items);
      upsertAssistant(
        listFor(items, event.parentToolUseId) as ChildItem[],
        event.messageId,
        event.text,
        event.type === 'assistant-message',
      );
      next.items = items;
      return next;
    }
    case 'tool-start': {
      const items = cloneItems(state.items);
      const list = listFor(items, event.parentToolUseId) as ChildItem[];
      const existing = findTool(items, event.toolUseId);
      if (existing) {
        existing.tool = event.tool;
        existing.label = event.label;
      } else {
        list.push(newTool(event.toolUseId, event.tool, event.label));
      }
      next.items = items;
      return next;
    }
    case 'tool-end': {
      const items = cloneItems(state.items);
      const tool = findTool(items, event.toolUseId);
      if (tool) tool.status = event.ok ? 'ok' : 'failed';
      next.items = items;
      return next;
    }
    case 'permission-request':
      next.items = [
        ...state.items,
        {
          kind: 'permission',
          requestId: event.requestId,
          tool: event.tool,
          title: event.title,
          detail: event.detail,
          warning: event.warning,
          sessionAllowLabel: event.sessionAllowLabel,
          change: event.change ?? null,
          outcome: null,
        },
      ];
      return next;
    case 'question-request':
      next.items = [
        ...state.items,
        { kind: 'question', requestId: event.requestId, questions: event.questions, outcome: null },
      ];
      return next;
    case 'request-resolved':
      next.items = state.items.map((i) =>
        (i.kind === 'permission' || i.kind === 'question') && i.requestId === event.requestId
          ? { ...i, outcome: event.outcome }
          : i,
      );
      return next;
    case 'turn-end':
      next.items = [
        ...state.items,
        {
          kind: 'turn-end',
          id: `turn-${seqNo}`,
          ok: event.ok,
          interrupted: event.interrupted,
          errorText: event.errorText,
          durationMs: event.durationMs,
        },
      ];
      return next;
    case 'notice':
      next.items = [
        ...state.items,
        { kind: 'notice', id: `notice-${seqNo}`, level: event.level, text: event.text },
      ];
      return next;
    case 'files':
      next.files = { files: event.files, attachments: event.attachments, links: event.links };
      return next;
    default:
      // An event this app does not know yet: keep the chat as it is.
      return next;
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'reset') return initialChatState;
  // Replays and duplicates: anything at or before the last applied event is ignored.
  if (action.item.seq <= state.lastSeq) return state;
  return applyEvent(state, action.item.seq, action.item.event, action.item.at);
}
