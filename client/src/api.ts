import {
  ADS_ERROR_MESSAGES,
  ADS_ROUTES,
  type AdsAccount,
  type AdsApprovals,
  type AdsBoard,
  type AdsCapabilities,
  type AdsChangeAction,
  type AdsChangeReply,
  type AdsRequests,
  type AdsTaskResultReply,
  type AdsTaskResultRequest,
  type AdsTaskRunReply,
  type AdsTaskRunRequest,
  type AdsTriageReply,
  type ProposalFull,
} from '../../shared/ads-contract.ts';
import type { ChatContextDetail } from '../../shared/context-contract.ts';
import type {
  ApiError,
  ApiErrorCode,
  AppPrefs,
  AskedTodoList,
  Bootstrap,
  ChangelogResponse,
  ChangeTodoRequest,
  ChatFileChanges,
  ChatKind,
  ClientGuessRequest,
  ClientGuessResponse,
  ClientPickOutcomeRequest,
  ClientPickReported,
  CompleteTodoRequest,
  EngineChoices,
  LibraryItem,
  LibraryItemsResponse,
  LibraryKind,
  LibraryListing,
  LibraryScope,
  LibrarySearchResponse,
  LibraryText,
  OkResponse,
  PermissionReply,
  QuestionReply,
  SendMessageRequest,
  SessionList,
  SetChatKindRequest,
  StartSessionRequest,
  StartSessionResponse,
  SyncStatus,
  TodoAction,
  TodoHistoryResponse,
  TodoList,
  TodoUploadRequest,
  TodoUploadResponse,
  UploadInfo,
  UploadResponse,
} from '../../shared/contract.ts';
import { ROUTES, UPLOAD_NAME_HEADER } from '../../shared/contract.ts';
import {
  SETUP_ROUTES,
  type SetBrainRequest,
  type SetBrainResponse,
  type SetupCandidatesResponse,
} from '../../shared/install-contract.ts';
import { type SavingsSummary, USAGE_SAVINGS_PATH } from '../../shared/kits-contract.ts';
import type {
  ChatLevelRequest,
  LevelTier,
  SetSkillLevelRequest,
  SkillLevels,
  TurnLevel,
} from '../../shared/levels-contract.ts';
import type { PageAskRequest } from '../../shared/pages-contract.ts';
import { type StartUpdateRequest, UPDATE_ROUTES, type UpdateStatus } from '../../shared/update-contract.ts';

/** Every failure from the server, or from reaching it, arrives as one of these. */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode | 'network';
  readonly status: number;
  /** The run's output, sent only with an ads `unknown-outcome` so the person can check the account. */
  readonly output?: string;
  constructor(code: ApiErrorCode | 'network', message: string, status: number, output?: string) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = status;
    if (output) this.output = output;
  }
  /** A 401 means the page was not opened from the launcher. */
  get notSignedIn(): boolean {
    return this.status === 401;
  }
}

/** `keepalive` lets a request finish after the page closes (used to send held to-do changes). */
export interface SendOptions {
  keepalive?: boolean;
  /** Aborts the request (the global search drops a search the person has typed past). */
  signal?: AbortSignal;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  raw?: { body: BodyInit; headers: Record<string, string> },
  opts?: SendOptions,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      keepalive: opts?.keepalive === true,
      ...(opts?.signal ? { signal: opts.signal } : {}),
      // Every changing request (DELETE included) is JSON: the server's request check refuses any that isn't.
      headers: raw
        ? raw.headers
        : method === 'GET'
          ? { Accept: 'application/json' }
          : { 'Content-Type': 'application/json' },
      body: raw ? raw.body : method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch (err) {
    // An aborted request is the caller's own doing: let it through as it is.
    if (opts?.signal?.aborted) throw err;
    throw new ApiFailure('network', 'Could not reach TDS Cortex. Is it still running on this computer?', 0);
  }
  if (!res.ok) {
    let code: ApiErrorCode = res.status === 401 ? 'unauthorised' : 'internal';
    let message = 'Something went wrong. Please try again.';
    let output: string | undefined;
    try {
      const data = (await res.json()) as Partial<ApiError> | { error?: unknown; code?: unknown };
      if (data.error && typeof data.error === 'object') {
        const nested = data.error as ApiError['error'];
        code = nested.code;
        message = nested.message;
        const out = (nested as { output?: unknown }).output;
        if (typeof out === 'string' && out) output = out;
      } else if (typeof data.error === 'string') {
        // A flat `{ error, code }` body (the library delete's contract wording) reads the same way.
        message = data.error;
        if (typeof (data as { code?: unknown }).code === 'string') {
          code = (data as { code: ApiErrorCode }).code;
        }
      }
    } catch {
      // The reply was not JSON; keep the plain defaults.
    }
    throw new ApiFailure(code, message, res.status, output);
  }
  // A 204 (the library delete) has no body to read.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** `task-result` takes the browser's request (the server picks the file); every other change takes AdsRequests. */
type AdsChangeBody<A extends AdsChangeAction> = A extends 'task-result'
  ? AdsTaskResultRequest
  : AdsRequests[A];
type AdsChangeResult<A extends AdsChangeAction> = A extends 'task-result'
  ? AdsTaskResultReply
  : AdsChangeReply;

const adsQuery = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

export const api = {
  // Ad Manager (plan 2026-11-16-workbench-ad-manager). Apply is never retried; a network failure on it is an
  // unknown outcome, not a plain "could not reach", because the request may have got through.
  adsCapabilities: () => request<AdsCapabilities>('GET', ADS_ROUTES.capabilities),
  adsAccounts: () => request<AdsAccount[]>('GET', ADS_ROUTES.accounts),
  adsApprovals: (client?: string) =>
    request<AdsApprovals>('GET', `${ADS_ROUTES.approvals}${client ? adsQuery({ client }) : ''}`),
  adsProposal: (client: string, id: string) =>
    request<ProposalFull>('GET', `${ADS_ROUTES.proposal}${adsQuery({ client, id })}`),
  adsBoard: (account: string) => request<AdsBoard>('GET', `${ADS_ROUTES.board}${adsQuery({ account })}`),
  adsStandupBrief: (account: string) =>
    request<unknown>('GET', `${ADS_ROUTES.standupBrief}${adsQuery({ account })}`),
  /** The file as a library item, for the file viewer (`{ kind: 'file', item }`). */
  adsFile: (path: string) => request<LibraryItem>('GET', `${ADS_ROUTES.file}${adsQuery({ p: path })}`),
  /** Every account's latest standup verdict, worst first (only when the skill lists ADS_TRIAGE_CAPABILITY). */
  adsTriage: () => request<AdsTriageReply>('GET', ADS_ROUTES.triage),
  adsChange: async <A extends AdsChangeAction>(
    action: A,
    body: AdsChangeBody<A>,
  ): Promise<AdsChangeResult<A>> => {
    try {
      return await request<AdsChangeResult<A>>('POST', ADS_ROUTES.change(action), body);
    } catch (err) {
      if (action === 'apply' && err instanceof ApiFailure && err.code === 'network') {
        throw new ApiFailure('internal', ADS_ERROR_MESSAGES['unknown-outcome'], 0);
      }
      throw err;
    }
  },
  /** Records a task run in the brain (only when the skill lists ADS_TASK_RUNS_CAPABILITY). */
  adsTaskRun: (body: AdsTaskRunRequest) =>
    request<AdsTaskRunReply>('POST', ADS_ROUTES.change('task-run'), body),
  adsClearInflight: (client: string, id: string) =>
    request<OkResponse>('POST', ADS_ROUTES.clearInflight, { client, id }),
  bootstrap: () => request<Bootstrap>('GET', ROUTES.bootstrap),
  todos: () => request<TodoList>('GET', ROUTES.todos),
  /** To-dos passed on to others (its own request: it never blocks or fails `todos`). */
  askedTodos: () => request<AskedTodoList>('GET', ROUTES.askedTodos),
  todoHistory: (key: string) =>
    request<TodoHistoryResponse>('GET', `${ROUTES.todoHistory}?key=${encodeURIComponent(key)}`),
  sync: () => request<SyncStatus>('GET', ROUTES.sync),
  changelog: () => request<ChangelogResponse>('GET', ROUTES.changelog),
  /** `personal` ticks a personal to-do through the brain script: it carries `scope` and `expect`. */
  completeTodo: (id: string, opts?: SendOptions, personal?: { scope: 'personal'; expect: string }) =>
    request<TodoList>(
      'POST',
      ROUTES.completeTodo,
      { id, ...(personal ?? {}) } satisfies CompleteTodoRequest,
      undefined,
      opts,
    ),
  changeTodo: (action: TodoAction, opts?: SendOptions) =>
    request<TodoList>('POST', ROUTES.changeTodo, action satisfies ChangeTodoRequest, undefined, opts),
  /** Files a staged upload into the library and links it to the to-do (release 3). */
  uploadTodoFile: (req: TodoUploadRequest) => request<TodoUploadResponse>('POST', ROUTES.todoUpload, req),
  updatePrefs: (patch: Partial<AppPrefs>) => request<AppPrefs>('PUT', ROUTES.prefs, patch),
  engineChoices: () => request<EngineChoices>('GET', ROUTES.engineChoices),
  sessions: () => request<SessionList>('GET', ROUTES.sessions),
  startSession: (req: StartSessionRequest) => request<StartSessionResponse>('POST', ROUTES.sessions, req),
  sendMessage: (id: string, text: string, attachments?: string[]) =>
    request<OkResponse>('POST', ROUTES.sessionMessages(id), {
      text,
      ...(attachments?.length ? { attachments } : {}),
    } satisfies SendMessageRequest),
  answerPermission: (id: string, reply: PermissionReply) =>
    request<OkResponse>('POST', ROUTES.sessionPermission(id), reply),
  answerQuestion: (id: string, reply: QuestionReply) =>
    request<OkResponse>('POST', ROUTES.sessionAnswer(id), reply),
  interrupt: (id: string) => request<OkResponse>('POST', ROUTES.sessionInterrupt(id), {}),
  close: (id: string) => request<OkResponse>('POST', ROUTES.sessionClose(id), {}),
  /** Moves an earlier chat's history to the macOS Bin (the server refuses an open chat). */
  /** Asks Claude, in that chat, to change a page or turn it into a TDS-branded document. */
  askPage: (sessionId: string, key: string, req: PageAskRequest) =>
    request<OkResponse>('POST', ROUTES.chatPageAsk(sessionId, key), req),
  deletePastChat: (id: string) => request<Record<string, never>>('DELETE', ROUTES.pastSession(id)),
  setChatKind: (id: string, kind: ChatKind) =>
    request<StartSessionResponse>('POST', ROUTES.sessionKind(id), { kind } satisfies SetChatKindRequest),
  /**
   * Deletes a library file (it moves to the brain's holding folder for 30 days). JSON body like every
   * changing request: `{ expect }` (the version the person saw) or `{}`. `keepalive` lets it finish while
   * the page closes. Answers 204.
   */
  deleteLibraryFile: (id: string, expect?: string, opts?: SendOptions) =>
    request<void>('DELETE', ROUTES.libraryItem(id), expect ? { expect } : {}, undefined, opts),
  libraryItems: (ids: string[]) => request<LibraryItemsResponse>('POST', ROUTES.libraryItems, { ids }),
  libraryScopes: () => request<LibraryScope[]>('GET', ROUTES.libraryScopes),
  library: (scope: string) => request<LibraryListing>('GET', ROUTES.library(scope)),
  /** Global search over every library folder the person can see; `kind` is sent as `image` or `doc`. */
  librarySearch: (q: string, kind: LibraryKind, opts?: SendOptions) =>
    request<LibrarySearchResponse>(
      'GET',
      `${ROUTES.librarySearch}?q=${encodeURIComponent(q)}&kind=${kind === 'document' ? 'doc' : 'image'}`,
      undefined,
      undefined,
      opts,
    ),
  libraryText: (id: string) => request<LibraryText>('GET', ROUTES.libraryText(id)),
  chatFileChanges: (sessionId: string, key: string) =>
    request<ChatFileChanges>('GET', ROUTES.sessionFileChanges(sessionId, key)),
  clientGuess: (req: ClientGuessRequest) => request<ClientGuessResponse>('POST', ROUTES.clientGuess, req),
  /** Counted in the app's data folder only; a failure is ignored by the caller. */
  clientPickOutcome: (outcome: ClientPickReported) =>
    request<Record<string, never>>('POST', ROUTES.clientPickOutcome, {
      outcome,
    } satisfies ClientPickOutcomeRequest),
  skillLevels: () => request<SkillLevels>('GET', ROUTES.skillLevels),
  setSkillLevel: (req: SetSkillLevelRequest) => request<SkillLevels>('POST', ROUTES.skillLevels, req),
  setChatLevel: (sessionId: string, tier: LevelTier | null) =>
    request<{ level: TurnLevel }>('POST', ROUTES.chatLevel(sessionId), {
      tier,
    } satisfies ChatLevelRequest),
  chatContext: (sessionId: string) => request<ChatContextDetail>('GET', ROUTES.chatContext(sessionId)),
  /** Tokens saved and reused, for Settings. */
  usageSavings: () => request<SavingsSummary>('GET', USAGE_SAVINGS_PATH),
  updateStatus: () => request<UpdateStatus>('GET', UPDATE_ROUTES.status),
  updateCheck: () => request<UpdateStatus>('POST', UPDATE_ROUTES.check),
  updateStart: () =>
    request<UpdateStatus>('POST', UPDATE_ROUTES.start, { confirm: true } satisfies StartUpdateRequest),
  getSetupCandidates: () => request<SetupCandidatesResponse>('GET', SETUP_ROUTES.candidates),
  saveBrainFolder: (path: string) =>
    request<SetBrainResponse>('PUT', SETUP_ROUTES.brain, { path } satisfies SetBrainRequest),
};

/** Sends one file's bytes to the app's staging folder. It goes with a message later, by its id. */
export async function uploadFile(file: File | Blob, name: string): Promise<UploadInfo> {
  const { upload } = await request<UploadResponse>('POST', ROUTES.uploads, undefined, {
    body: file,
    headers: { 'Content-Type': 'application/octet-stream', [UPLOAD_NAME_HEADER]: encodeURIComponent(name) },
  });
  return upload;
}

/** Deletes an upload that was never sent. `keepalive` lets it finish while the page is going away. */
export async function discardUpload(id: string, keepalive = false): Promise<void> {
  try {
    await fetch(ROUTES.uploadDiscard(id), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive,
    });
  } catch {
    // The staging folder sweeps unsent files anyway.
  }
}

/** The URL for the one event stream a tab holds. */
export function streamUrl(sessionId: string | null, after: number): string {
  return ROUTES.stream(sessionId, after, true, true, true);
}

/** The file name in a Content-Disposition header (plain or RFC 5987 form), or null. */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return name || null;
}

/**
 * Fetches a TDS-branded copy of a page (same-origin GET) and saves it through a temporary object URL.
 * `partial` is true when the server could not make it fully self-contained (`X-Page-Self-Contained`).
 * Throws an `ApiFailure` when the fetch fails.
 */
export async function downloadBranded(path: string, title: string): Promise<{ partial: boolean }> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'text/html' } });
  } catch {
    throw new ApiFailure('network', 'Could not reach TDS Cortex. Is it still running on this computer?', 0);
  }
  if (!res.ok) {
    throw new ApiFailure('internal', "Couldn't download the page. Please try again.", res.status);
  }
  const blob = await res.blob();
  const fallback = `${title.replace(/[^\w .-]+/g, '').trim() || 'page'}-tds.html`;
  const name = dispositionName(res.headers.get('Content-Disposition')) ?? fallback;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { partial: res.headers.get('X-Page-Self-Contained') === 'partial' };
}
