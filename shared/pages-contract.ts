/**
 * Pages in the app (plan docs/plans/2026-11-14-artifacts-in-app.md).
 *
 * A "page" is an HTML page Claude published with its Artifact tool (it lands on claude.ai). The app
 * keeps its own copy of each published version in its data folder (never in the brain), shows it in
 * the page viewer, and lets the person ask for changes or a TDS-branded version from there. Both of
 * those only send a message into the chat: Claude and the brain's skills make every change.
 *
 * CONTRACT FILE: signatures fixed by the lead. Bodies of the pure helpers are Builder A's
 * (`shared/pages.ts`, tests first); the server parts are Builder B's; the screen is Builder C's.
 *
 * Small additive edits to existing types live in `shared/contract.ts` and are listed in the plan's
 * Contract section (ChatFilesSnapshot.pages?, ROUTES.chatPage).
 */

// ---------------------------------------------------------------------------
// What the client sees (inside ChatFilesSnapshot)
// ---------------------------------------------------------------------------

export interface ChatPageVersion {
  /** 1, 2, 3… in the order this chat saw the publishes. The route's version key. */
  n: number;
  /** claude.ai's own version number from the result ("Version 3"), or null when it gave none. Shown when set. */
  remote: number | null;
  /** ISO time it was published; null for one rebuilt from a reopened chat's history. */
  at: string | null;
  /** The app holds a copy of this version, so `ROUTES.chatPage` can show it. */
  hasCopy: boolean;
}

export interface ChatPage {
  /**
   * Opaque and stable for the page within the chat: derived from its claude.ai address once known,
   * else from the source file path. The only thing the browser sends back.
   */
  key: string;
  /** The page's `<title>`, else its file name without `.html`. At most PAGE_TITLE_MAX characters. */
  title: string;
  /** The claude.ai address (always passes `isArtifactUrl`), or null when the result gave none. */
  url: string | null;
  /** Oldest first. At least one. At most PAGE_VERSIONS_MAX (oldest dropped). */
  versions: ChatPageVersion[];
  /**
   * The publish asked for runtime capabilities (shared data, "ask Claude", sign-in…): those parts
   * only work on claude.ai, so the viewer says so and leads with "Open on claude.ai".
   */
  live: boolean;
  /** The publish sent supporting files too; the copy is the page alone, so parts may be missing. */
  multiFile: boolean;
  /** The Artifact steps that published it, so a step can open it. */
  toolUseIds: string[];
  /** Orders the list only (as ChatFile.order). Newer is greater. */
  order: number;
}

export const PAGE_TITLE_MAX = 120;
export const PAGE_VERSIONS_MAX = 20;
/** A page copy larger than this is not kept (the page still shows, as link only). */
export const PAGE_COPY_MAX_BYTES = 16 * 1024 * 1024;
/** Pages listed per chat (newest kept). */
export const CHAT_PAGES_MAX = 50;

// ---------------------------------------------------------------------------
// Pure helpers (shared/pages.ts, Builder A, tests first)
// ---------------------------------------------------------------------------

/** What an Artifact tool call asked for, when it is a page publish the app should follow. */
export interface ArtifactPublish {
  /** Absolute path of the local page, as Claude gave it. Never sent to the browser. */
  filePath: string;
  /** `url` from the input: the existing artifact this publish updates, or null for a new one. */
  updatesUrl: string | null;
  live: boolean;
  multiFile: boolean;
}

/**
 * Signatures implemented in `shared/pages.ts`:
 *
 * Shapes are pinned by `test/fixtures/artifact-calls.json` (invented values, real shapes).
 *
 * - `artifactPublish(input: unknown): ArtifactPublish | null`
 *   Non-null only for what may be a page publish: `action` missing or 'publish'; no `asset: true`;
 *   no `type_url`; `file_path` a string that is absolute, ends `.html` / `.htm` (any case), has no
 *   `[\x00-\x1f\x7f]` and is at most 1024 characters. `live` when `capabilities` is a non-empty
 *   object. `multiFile` when `files` is a non-empty object or array. `updatesUrl` only when `url`
 *   passes `isArtifactUrl`. (Whether it WAS a page publish is decided by the result, below.)
 *
 * - `isArtifactUrl(url: string): boolean`
 *   `https://claude.ai/artifact/<id>` or `https://claude.ai/code/artifact/<id>`, id 1–64 of
 *   `[A-Za-z0-9-]`, nothing after it except an optional trailing slash. No user name, port, query
 *   or fragment. Exact host (not `claude.ai.evil.com`, not `www.claude.ai`).
 *
 * - `artifactPublishResult(content: unknown): { url: string; remote: number | null } | null`
 *   Content is a string or an array of `{ type: 'text', text }` blocks. Non-null only when the text
 *   (trimmed) starts `Published ` and its first line has ` at <address>` passing `isArtifactUrl`
 *   (trailing punctuation dropped); `remote` from a following `(Version <n>`. Anything else
 *   (quickstart, list, read, open, "Updated the Artifact" for a typed artifact, refusals) → null,
 *   even though those texts contain claude.ai addresses. The caller also requires `is_error` false.
 *
 * - `pageTitle(html: string, filePath: string): string`
 *   The first `<title>` within the first 64 KB, entities `&amp; &lt; &gt; &quot; &#39; &rsquo;
 *   &ndash; &mdash; &middot;` decoded, control characters removed, whitespace collapsed, trimmed,
 *   capped at PAGE_TITLE_MAX; else the file's base name without its extension.
 *
 * - `suggestionMessage(page: PageRef, note: string): PageMessage`
 *   `visible`: `Change the page “<title>”: <note>` (note trimmed, verbatim otherwise; title with
 *   control characters stripped). `note` (engine only): names the page as data (“the page titled
 *   “…””), its address, the source path in a code span; says to edit that file and republish it to
 *   the same address so the link and versions carry on. When `sourceIsCopy`: says it is the app's
 *   stored copy, to copy it to a new file in the scratchpad first and edit and publish that, with
 *   `url` set to the same address.
 *
 * - `brandingMessage(page: PageRef, client: string | null): PageMessage`
 *   `visible`: `/tds-doc Convert the page “<title>” to TDS branding` (leading `/tds-doc`, so the
 *   existing `checkSkill` role check applies and Claude Code loads the skill). `note` (engine only):
 *   the source path in a code span and address; rebuild its content as a TDS-branded client document
 *   with the tds-doc skill (self-contained HTML plus PDF); save in `clients/<client>/reports/` when
 *   the client is known, else ask which client; keep every figure and finding; interactive parts
 *   become static; don't publish it to claude.ai; say where both files went.
 *
 * UK English in all of it.
 */
export interface PageMessage {
  /** What the transcript shows as the person's words (live and when the chat is reopened). */
  visible: string;
  /**
   * Instructions only Claude sees: appended to the prompt behind a marker the way `attachmentNote`
   * is, and split off again on replay (as `splitAttachmentNote` does), so paths never reach the screen.
   */
  note: string;
}
export interface PageRef {
  title: string;
  url: string | null;
  /**
   * The best local source for Claude to read: the original file while it exists, else the app's
   * copy of the newest version. Server side only: the messages are composed on the server.
   */
  sourcePath: string;
  /** `sourcePath` is the app's stored copy (read-only, 0o444), not Claude's own file. */
  sourceIsCopy: boolean;
}

// ---------------------------------------------------------------------------
// Asking from the viewer (server composes and sends; the browser never sees a path)
// ---------------------------------------------------------------------------

/**
 * `POST ROUTES.chatPageAsk(sessionId, key)`, JSON body. The server builds the message with
 * `suggestionMessage` / `brandingMessage` and sends it into that chat like a typed message (same
 * checks, same busy rule as the composer); the transcript echoes only `visible`. An `idle` chat
 * (reopened, not running) takes it like the composer does. 404 `not-found` for an
 * unknown chat or key; 409 `busy` when the chat is mid-turn; 400 `bad-request` for an empty note or
 * one over PAGE_NOTE_MAX characters.
 */
export type PageAskRequest = { kind: 'change'; note: string } | { kind: 'brand' };
export const PAGE_NOTE_MAX = 4000;
