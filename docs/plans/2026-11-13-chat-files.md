# Chat files: open a chat's documents, attachments and links from the chat

Date: 2026-11-13 · Size: L · Branch: `chat-files` (worktree `../tds-brain-app-chat-files`) · Explainer: none

## Objective

When a chat reads, makes or names files in the brain, people can't open them from the chat. A
brain-relative link in a reply opens a broken page in a new tab (`client/src/markdown.tsx` sends
every link to `_blank`). Fix: the app keeps a list of each chat's files, attachments and web links,
shows it in a new **Files** tab in the "This chat" panel with a preview, and turns file paths in
replies and in steps into links that open the file there.

## User decisions (fixed)

- Build all the recommendations: server-side file list, Files tab with in-panel preview, links in
  replies, clickable steps, the list kept for reopened chats, a "What changed" view, and a line asking
  Claude to cite files as brain-relative paths.
- "Looked at" (read-only) files are listed but folded away by default.
- Preview opens in the panel for Markdown, text and pictures; PDFs and HTML pages open full size in
  Documents (or Images).
- Base: `origin/main` (v0.15.0). No explainer.

## Decisions

Overseer pre-review (fable) returned 4 blocking, 9 should and 4 nice items plus product decisions;
all blocking and should items are folded in below (decisions 15 to 19 are new).

1. **The server decides which files are real; the client only links to what the server reported.**
   A per-chat tracker (`server/engine/chat-files.ts`, `createChatFiles`) watches the engine's raw
   messages: Read / Write / Edit / MultiEdit / NotebookEdit inputs, Bash commands that copy a staged
   attachment, WebFetch URLs, and the text of finished replies. Every candidate path goes through
   `BrainReaders.libraryItemForPath` (new, `server/brain/library.ts`), which only answers for a path
   inside a listed scope (`personal/`, `clients/<slug>/`) that the library rules would list. Anything
   else (`.claude/`, skills, `os/`, `.env`, outside the brain) is never reported.
   Plain: the panel can only ever show files the person could already open in Documents.
2. **Keys, not paths, go back to the server.** `ChatFile.key` is the library id the path has, or would
   have, in its scope, so it equals `item.id` for a listed file and the existing `/api/library/*` routes
   serve the preview unchanged. The browser sends only keys.
   `libraryItemForPath(rel)` algorithm: (a) find the scope from the first segments (`personal/…`,
   `clients/<slug>/…`, slug must be a listed scope), else null; (b) `isNeverListed(rel)` or
   `classify(ext) === null` → null; (c) look the path up in that scope's listing, case-insensitively;
   on a hit, key = `item.id`, then run the existing `check()` for a fresh size and date; (d) on a miss,
   `lstat` the file: absent → `{ key: idFor(scope.id, rel), scope, item: null }`; present → bump the
   scope, re-list once, and use the hit; still unlisted (a symbolic link, deeper than 8 folders) → null.
   An item only ever comes from the listing plus `check()`, never from a direct stat.
   Plain: no new way to ask the server for an arbitrary file, and a file Claude has just made shows up
   straight away.
3. **One `files` chat event, a whole snapshot.** New `ChatEvent` `{ type: 'files' } & ChatFilesSnapshot`
   (`shared/contract.ts`). The session manager emits it after a step ends, after a finished reply and at
   turn end, coalesced (at most one resolution in flight per chat; a request during one re-runs once
   after it), only when `snapshot()` returns non-null. Like deltas, older `files` events are dropped
   from the replay log so it stays small. **Opt-in:** `files` events are sent only on streams opened
   with `files=1` (`ROUTES.stream`); `server/http/stream.ts` drops them otherwise, replay and live.
   A tab from before the update (whose reducer resets a chat on an unknown event) keeps working; the
   new reducer also gains `default: return next`. After awaiting a snapshot the session re-checks
   `s.closing`. Also emitted when a message with attachments is sent.
   Plain: the list updates as Claude works, and tabs left open across an update don't lose their chat.
4. **Reopened chats rebuild the list from Claude Code's own history.** `replayHistory` already reads
   every stored message; it also feeds each one (including tool_use / tool_result and the attachment
   note's staged paths) to the tracker (`observe(m, { history: true })`), then emits one snapshot
   **without** `start()` awaiting it (cold scope walks must not delay reopening). No new store in the
   app's data folder, and nothing in the brain. A file since moved or deleted shows "No longer there".
   Stored history has no times and no helper-agent steps (the SDK keeps those apart), so the list is
   ordered by when things were seen (`order`), times are never shown, and the README notes the gap.
   Plain: an old chat still shows its files, with no extra saving.
5. **Created vs changed.** A Write with no earlier Read of that path in the chat is `created` (Claude
   Code refuses to overwrite a file it hasn't read). Everything else that edits is `changed`. Only
   steps whose tool_result is not an error count.
   Plain: "Made" means new files, without reading the disk to find out.
6. **Attachments.** The session tells the tracker each message's staged files (`TrackedAttachment`,
   paths stay on the server). A successful Bash command that contains a staged path files that
   attachment to any brain path in the same command that resolves (last wins). The attachment note
   (`ATTACHMENT_NOTE`) gains: "When you tell the user where a file went, give its path from the brain
   folder." So a renamed or differently-copied file still shows up as `mentioned`. An attachment not yet
   matched shows "Not filed yet".
   Plain: you can see where each attachment ended up, and open it.
7. **Claude is asked to cite paths.** Every chat's system prompt append gets one line (joined after the
   client line when there is one): "When you mention a file in the brain, give its path from the brain
   folder in backticks, for example `clients/acme/reports/audit.md`, so the app can open it." Backticks
   only: Markdown links break on paths with spaces. Exported as `FILES_LINE` from `session-manager.ts`.
   Plain: replies name files in a form the app can recognise.
8. **Files tab in "This chat".** `PanelTab` becomes `'steps' | 'files' | 'details'` (Seg order: Steps,
   Files, Details). Groups via `chatFileGroup`, in order: **Made or changed**, **Attached** (one row per
   attachment: its filed file, or "Not filed yet" while a turn runs and "Not filed" otherwise),
   **Mentioned in replies** (its own group: PDFs, sheets and decks made by scripts only arrive as
   mentions), **Looked at** (folded in a `Fold`, closed by default unless it is the only group, with
   its count), **Web links** (open in a new tab). No count on the tab. Each file row: type icon
   (`FORMAT_ICONS` / picture), title, client or "My personal files", and the strongest action word
   only: Made, Changed, Filed, Mentioned, Read. Rows are buttons. Empty: "No files yet. Files Claude
   reads, makes or names in this chat appear here." Reuse `Fold`, `Icon`, `.btn`, `dock-empty` per
   `docs/design-system.md`.
   Plain: one place to see everything the chat touched.
9. **Preview in the panel; big formats full size.** Choosing a row sets `panelFile` (shell action
   `show-chat-file`) and shows, in the panel: a Back button ("All files"), the title and where it is,
   then the body. `view` `text` and `image` render in the panel with the existing bodies (exported from
   `Viewer.tsx` as `TextBody` and `PictureBody`). `TextBody` gains an optional `version` passed to
   `useLoaded` (the library version), so it refreshes as Claude edits without re-keying (no "Loading…"
   flash, scroll kept). `page` and `pdf` show **Open in Documents** only. Word, Excel, CSV and PowerPoint
   (`view: null`): "This type can't be shown here." with **Download** first. Every listed file has
   **Open in Documents** / **Open in Images** (by `item.kind`; via `openLibraryItem` + `openView`, and a
   floating panel closes first, as `DocumentsPanel.tsx:19` does) and **Download** (`ROUTES.libraryFile`).
   A gone file says "No longer there" with no buttons. Escape in a preview returns to the list. Opening
   a preview announces "Opened <title>" through the `Announcer`. Tables and code scroll sideways in the
   narrow panel (`overflow-x: auto`).
   Plain: read a note without leaving the chat; open big documents properly.
10. **What changed.** A file with `edits > 0` shows a "What changed" toggle in its preview. It loads
    `GET ROUTES.sessionFileChanges(sessionId, key)` (live chats only; `SessionManager.fileChanges(id,
    key)`, also stubbed in `server/setup-mode.ts`) and renders each change with the approval card's
    diff view (`ChangeView`, exported from `Cards.tsx`, unchanged), newest first, with its time when
    known, and the card's notes when a change was cut short or had hidden characters shown. The server
    builds them from the kept tool inputs with `proposedChange` (`file-change.ts`), so the disk is never
    read. Answers only for a key whose latest resolution has an item. Not offered when the chat isn't live.
    Plain: see exactly what Claude changed in a file.
11. **Links in replies.** `renderMarkdown(text, link?)` takes an optional linker
    `(raw: string) => string | null` (raw path → key). With it: a Markdown link whose target normalises
    to a known path, and an inline code span whose text does, become `<a href="#chat-file=<encodeURIComponent(key)>">`
    (for code: the `<code>` inside the link). Everything still goes through DOMPurify with the same
    allow list; no class or data attributes. **The rule is enforced after sanitising**, because raw HTML
    in a reply bypasses the renderer: the DOMPurify hook keeps a `#chat-file=` href only if the linker
    issued that exact href in this render (and gives it no `target`), keeps `http:`, `https:` and
    `mailto:` links as today, and unwraps every other link to its text. `Markdown` is memoised on text
    and index. `Markdown` takes `onFile?: (key) => void` and handles
    clicks on links starting with `CHAT_FILE_HREF_PREFIX` (preventDefault, then `onFile`). Assistant
    text (not helper text) in `Transcript` gets the linker from the chat's `indexChatFiles`. Any other
    relative link (not http/https/mailto, not a chat file) is rendered as plain text, so it no longer
    opens a broken page. Styled in `chat.css` with `.markdown a[href^="#chat-file="]` (a small file
    icon via CSS mask, same colour as links).
    Plain: click a file name in Claude's reply and it opens beside the chat.
12. **Clickable steps.** In the Steps tab and in the transcript's activity list, a step whose tool use
    id is in `byToolUse` renders its label as a link-styled button that dispatches `show-chat-file`.
    Plain: "Editing brief.md" opens brief.md.
13. **Shell state.** `ShellState.panelFile: { chat, key } | null` (not saved; cleared on
    `set-panel-tab`), action `show-chat-file { chat, key }` (see `client/src/shell/contract.ts`). The
    Inspector shows a preview only when `panelFile.chat` is the active chat and the key is in its
    snapshot, so switching chats needs no clearing. `show-chat-file` is added to `opensPanel` in
    `ShellProvider.tsx` (a floating panel must take focus, as `main` goes inert). `loadShell` accepts the
    saved `files` tab.
    Plain: the panel remembers the tab, never a stale file.
14. **Limits.** At most `CHAT_FILES_MAX` (200) files and `CHAT_LINKS_MAX` (100) links per snapshot (most
    recent kept); at most `CHAT_FILE_CHANGES_MAX` (20) edits per file and `CHAT_FILE_CHANGES_BUDGET`
    (4 MB) of kept edit input per chat, oldest dropped; `CHAT_FILE_TOOL_IDS_MAX` (50) step ids per file;
    links over `CHAT_LINK_MAX_CHARS` (2,000) or with a user name or password are dropped; reply scanning
    capped at 200 paths per message; tool uses still waiting at turn end are forgotten (`endTurn`).
    Mid-turn snapshots re-resolve only touched paths; turn end re-resolves all.
    Plain: a very long chat can't slow the app down.
15. **Helper agents.** Their file steps count and are clickable; their text never creates mentions.
    Plain: work done by a helper still shows its files.
16. **Brain root behind a link.** The session passes the tracker both the configured root and its real
    path; tool paths are normalised against each.
    Plain: files are found however the brain folder is reached.
17. **Bash filing into a folder.** A destination token that is a folder also tries
    `<token>/<staged file name>`.
    Plain: "copy this into the client's folder" still links the attachment.

## Contract

- `shared/contract.ts`: `ChatFileAction`, `ChatFileGroup`, `ChatFile`, `ChatAttachment`, `ChatWebLink`,
  `ChatFilesSnapshot`, `ChatFileChanges`, the limits, the `files` ChatEvent, `ROUTES.sessionFileChanges`,
  `BrainReaders.libraryItemForPath?`.
- `shared/chat-files.ts`: `normaliseBrainPath`, `findPathMentions`, `findWebLinks`, `chatFileGroup`,
  `indexChatFiles`, `ChatFileIndex`, `CHAT_FILE_HREF_PREFIX`.
- `server/engine/chat-files.ts`: `createChatFiles`, `ChatFilesTracker`, `ResolvePath`, `TrackedAttachment`.
- `client/src/shell/contract.ts`: `PanelTab` with `files`, `ShellState.panelFile`, `show-chat-file`.
- `SessionManager.fileChanges(id: string, key: string): ChatFileChanges | null` (throws `not-found` /
  `session-closed` for the chat as the other methods do; null → the route answers 404).
- Client additions owned by Builder D: `ChatState.files: ChatFilesSnapshot` (empty lists initially;
  replaced on each `files` event); `api.chatFileChanges(sessionId, key): Promise<ChatFileChanges>`; the
  stream URL built with `files = true`.

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable | (read-only) |
| Security expert | `expert`, opus | (read-only gate) |
| Builder A: shared text helpers + reply links | `builder`, sonnet | `shared/chat-files.ts`, `shared/chat-files.test.ts`, `client/src/markdown.tsx`, `client/src/markdown.test.tsx` |
| Builder B: tracker + library lookup | `builder`, opus | `server/engine/chat-files.ts`, `server/engine/chat-files.test.ts`, `server/brain/library.ts`, `server/brain/index.ts`, `server/brain/library.test.ts` |
| Builder C: session + route wiring | `builder`, opus | `server/engine/session-manager.ts` (+ test), `server/http/routes.ts` (+ test), `server/http/stream.ts` (+ test), `server/setup-mode.ts` (+ test) |
| Builder D: client state | `builder`, sonnet | `client/src/state/chat-reducer.ts` (+ test), `client/src/state/shell.ts` (+ test), `client/src/shell/ShellProvider.tsx`, `client/src/api.ts` (+ test), `client/src/store.tsx` |
| Builder E: client UI | `builder`, sonnet | `client/src/shell/Inspector.tsx` (+ test), `client/src/shell/ChatFiles.tsx` (new, + test), `client/src/shell/Icon.tsx`, `client/src/apps/shared/Viewer.tsx`, `client/src/components/Cards.tsx` (+ test), `client/src/components/Transcript.tsx`, `client/src/components/Chat.tsx` (+ test), `client/src/styles/chat.css`, `client/src/styles/shell.css`, `client/src/shell/Shell.test.tsx` |
| Lead | | contract files, `README.md`, `docs/design-system.md`, this plan |

No file appears in two rows. B and C build against the tracker contract in parallel; C's tests use a
fake tracker or the real one once B lands. A's `shared/chat-files.ts` is used by B, C (server) and E.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `shared/chat-files.test.ts` | normalising (absolute in/out of root, `..`, `~`, URLs, `:12` suffix, `%20`, backticks); mentions from links, code spans, bare paths, not fenced code; web links trimmed of trailing punctuation; groups; index | A |
| `client/src/markdown.test.tsx` | known path link and code span become `#chat-file=` links; unknown relative link becomes plain text; raw HTML `<a href="#chat-file=x">` or `<a href="clients/…">` in a reply is unwrapped; http links unchanged; no class/data attributes; click calls `onFile` and prevents default | A |
| `server/engine/chat-files.test.ts` | Read/Write/Edit counted only on success; Write without Read = created; failed step not counted; paths outside scopes dropped; Bash copy of staged path files the attachment; mentions and links from text; snapshot null when unchanged; gone file → `item: null`; edits kept and capped; history-shaped messages work | B |
| `server/brain/library.test.ts` | `libraryItemForPath`: client and personal paths resolve with key = item id; never-listed paths (e.g. `.env`, `.claude/`) and paths outside scopes → null; missing file → key with `item: null` | B |
| `server/engine/chat-files.test.ts` (extra) | an `observe` during an in-flight `snapshot` makes the next `snapshot` non-null; helper text makes no mentions; budget drops oldest edits and sets `truncated`; Bash copy into a folder files the attachment | B |
| `server/engine/session-manager.test.ts` | `files` event after a successful step; older `files` dropped from replay; resumed chat emits one snapshot from history and `start()` does not wait for it; no emit after close; `FILES_LINE` in the append with and without a client; attachment note line | C |
| `server/http/stream.test.ts` | `files` events left out without `files=1`, replay and live; sent with it | C |
| `server/http/routes.test.ts` | file-changes route: 200 with changes; 404 for unknown key or chat | C |
| `client/src/state/*.test.ts` | reducer stores the snapshot; an unknown event type leaves the chat as it was; `show-chat-file` opens panel on files; `panelFile` cleared on tab change; not saved; `files` tab loads; the stream URL asks for `files=1` | D |
| `client/src/shell/ChatFiles.test.tsx` | groups and order; Looked at folded; Not filed yet; gone file text; text preview in panel; pdf shows Open full size only | E |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview build to `/tmp/tba-preview/dist/client`; no dev server on the output)
- [ ] Domain gates: security (file exposure, path handling, link rewriting); UX (panel, copy, a11y)
- [ ] Browser check: preview server on 3878 with its own data folder; a chat that reads, edits and names a file; reply link opens preview; PDF opens full size; reopened chat shows files

## Review outcomes

(Filled at step 10.)
