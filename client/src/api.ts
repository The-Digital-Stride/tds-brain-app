import type {
  ApiError,
  ApiErrorCode,
  AppPrefs,
  Bootstrap,
  ChangelogResponse,
  ChangeTodoRequest,
  ClientGuessRequest,
  ClientGuessResponse,
  CompleteTodoRequest,
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
  StartSessionRequest,
  StartSessionResponse,
  SyncStatus,
  TodoAction,
  TodoList,
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
import { type StartUpdateRequest, UPDATE_ROUTES, type UpdateStatus } from '../../shared/update-contract.ts';

/** Every failure from the server, or from reaching it, arrives as one of these. */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode | 'network';
  readonly status: number;
  constructor(code: ApiErrorCode | 'network', message: string, status: number) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = status;
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
  method: 'GET' | 'POST' | 'PUT',
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
    throw new ApiFailure('network', 'Could not reach TDS Brain. Is it still running on this computer?', 0);
  }
  if (!res.ok) {
    let code: ApiErrorCode = res.status === 401 ? 'unauthorised' : 'internal';
    let message = 'Something went wrong. Please try again.';
    try {
      const data = (await res.json()) as Partial<ApiError>;
      if (data.error) {
        code = data.error.code;
        message = data.error.message;
      }
    } catch {
      // The reply was not JSON; keep the plain defaults.
    }
    throw new ApiFailure(code, message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>('GET', ROUTES.bootstrap),
  todos: () => request<TodoList>('GET', ROUTES.todos),
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
  updatePrefs: (patch: Partial<AppPrefs>) => request<AppPrefs>('PUT', ROUTES.prefs, patch),
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
  clientGuess: (req: ClientGuessRequest) => request<ClientGuessResponse>('POST', ROUTES.clientGuess, req),
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
  return ROUTES.stream(sessionId, after);
}
