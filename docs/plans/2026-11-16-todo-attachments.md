# Files on to-dos (to-do programme, release 3)

Date: 2026-11-16 · Size: L · Branch: `todo-attachments` · Explainer: none (Ian: no)

## Objective

Let Ian link files to a to-do: pick an image or document already in the library, or upload new ones.
Uploads are stored in the library's folders, so they show in Images and Documents, and the to-do
links to them. Also carry over from release 1: details on a to-do added for someone else.

## User decisions (fixed)

- Release 3 of 3; releases 1 (v0.42.0) and 2 (v0.43.0) are pushed.
- Uploads go through a new `add` action in `brain-skills/tdsapp-files` (owner and scouts only until
  Pete releases it). The app never writes a brain file itself.
- A client's to-do: documents → `clients/<client>/files/`, images → `clients/<client>/images/`
  (Ian, 2026-11-16).
- A to-do with no client: uploads go to Ian's personal files (`personal/…`), knowing they never sync, so
  whoever the to-do is passed to can't open them (Ian, 2026-11-16).
- Standing rules: UK English in UI; the editor always saves markdown; never copy real to-do bodies
  into the repo; never save or tick in the real brain from a preview; keep older app versions, the
  Workbench and older brain files working. Copying the changed skills into the brain is a separate
  step that needs Ian's approval.

## Facts (live brain, read only, 2026-11-16)

- 46 of 182 open to-dos have `client:`; 136 have none.
- `personal/*` is git-ignored ("stays local, never synced"); `personal/CLAUDE.md` and `AGENTS.md` are the
  only tracked files. The library's personal scope is the whole `personal/` folder.
- No client has `files/` or `images/` folders yet; the library groups an unknown first folder under its
  humanised name, so they'd show as "Files" and "Images" cards.
- Two live to-dos already link brain files in the body: `[…](../clients/<c>/call-notes/….md)`, relative
  to `todo/`. The Workbench's frontmatter parser keeps only flat `key: value` lines, so a list in
  frontmatter would be invisible there; the body is what people, the Workbench and Claude all see.
- `tdsapp-todo` v0.4 `add` takes no body (so the Add panel has no details); `edit` replaces the body
  whole. `tdsapp-files` v0.1 has delete/restore/list-deleted/purge, roles owner and scout.
- The chat composer already uploads with `uploadFile` (staging in the app's data folder, 32 MB cap);
  the library has `librarySearch` for images and documents.

## Decisions

1. **The record lives in the body, in a `## Files` section.** One line per file:
   `- [name](path)`, path relative to the to-do's folder (`../clients/…` from `todo/`,
   `../../personal/…` from `personal/todo/`), in `<…>` when it holds a space or bracket. The section goes
   after the details and before any `## Title history` / `## Handover history` / done or deleted lines
   the skill writes. Readers resolve a link by dropping every leading `../` and keeping it only if what's
   left starts with `clients/`, `templates/` or `personal/`, so links still resolve after the file moves
   to `done/`.
   Plain: anyone opening the to-do (app, Workbench, Claude) sees the files listed, and nothing hidden is added.
2. **Only the to-do skill writes the section.** `tdsapp-todo` v0.5 adds `attach {file, path, expect?,
   scope?}` and `detach {…}` (create, append to, remove from, and drop the empty section), `add` takes an
   optional `body`, and `capabilities` lists "attach". `attach` refuses a path that isn't a real file
   (lstat, no links) under those three roots, and over TODO_ATTACHMENTS_MAX. Duplicates and missing
   paths are no-ops.
   `edit` gains `keep_files: true` (overseer B1): `body` is then details only, the skill puts the on-disk
   section back (placed by the same rule as `attach`), the 8,000 cap counts details only, and a body
   holding a `## Files` heading is refused. The server always sends it when canAttach. A personal file
   is written `- [name](path) (only on <slug>'s Mac)` with the adder's slug (overseer S3).
   Plain: linking a file is a to-do change like any other, with the same "changed since you read it" safety, and saving an edit can never drop a file someone else just linked.
3. **Uploads: the server chooses where, the files skill writes.** `tdsapp-files` v0.2 adds `add {source,
   path, via?, by_name?}` that copies an existing regular file from outside the brain into the brain at
   `path`, without overwriting: a taken name gets " (2)", " (3)"… It only accepts
   `clients/<client>/(files|images)/<name>` (where the client folder exists and the path is not
   git-ignored, so it syncs) and `personal/(files|images)/<name>` (which must be git-ignored, so it never
   syncs). Images go in `images/`, documents in `files/`, by TODO_UPLOAD_TYPES (no svg/html/avif). Overseer
   S2: it reuses delete's guards (PROTECTED_NAMES such as CLAUDE.md/AGENTS.md/README.md/profile.md,
   `isNeverListed`, `requireRealPath` on the destination folder, the separate-git-project check), caps
   the source at 32 MB itself, needs the source extension to equal the destination's, and needs the
   source to be a regular file whose real path is outside the brain. It writes
   to a temp file in the same folder and renames, makes the `files`/`images` folder if missing (never
   the client folder), logs an `add` line (`holding: ''`) to the existing team log in `tdsapp-deleted/log/` for client adds
   only — never for personal adds, since the log syncs (overseer answer 3) — and replies with the
   final path. `capabilities` adds "files-add-v1". The app sends the staged file's real path, the
   destination it picked by decision 3 in the contract (`TodoUploadRequest`), then runs `attach`.
   Plain: an upload lands in the client's Files or Images folder (or your personal files), and the to-do links to it.
4. **The panel shows a Files block, not the raw section.** `shared/todo-files.ts` (written by the lead,
   with `shared/todo-files.fixtures.json` run by both the app's and the skill's tests) exports
   `parseTodoFiles(body) → {path, name, holder}[]`, `resolveTodoFilePath(target)` and
   `splitTodoFiles(body) → {details, files}`. Read view: details without the section, then a "Files" list
   (icon by kind, name; opens in the file viewer when `libraryId` is set; "Can't be found" for a missing
   client or template file; "Only on <name>'s Mac" for someone else's personal file; a quiet "Only on your
   Mac" note on your own personal file in a TDS to-do), each with a "Remove from this to-do" button when
   canAttach, whose wording says the file stays in the library (overseer N2). Edit view (canAttach): the
   editor edits only the details part and Save sends only that (decision 2 keeps the section). Ticking a
   tick box in read view works on the split details too. Without canAttach, the whole body as before. Asked-of-others to-dos show the list read only.
   Plain: files sit in their own tidy list under the details, and editing the details can't break them.
5. **Adding a file.** An "Add a file" button under the list (when canAttach) offers "From the library"
   (a search over images and documents with `librarySearch`, pick one or more) and "Upload" (when
   canUpload; a file input, several files, TODO_UPLOAD_TYPES only, 32 MB each). Each upload goes
   `uploadFile` → `POST /api/todos/upload` one at a time, carrying the fresh `version` each time; a partial failure
   says "2 of 3 added" and names the one that failed. Where it goes is the server's choice
   (`uploadDestination` in Builder B's code): an exact match of the trimmed `client:` against a brain client
   slug → that client, else personal; a personal to-do is always personal (overseer answer 2). The client
   predicts "personal" with the same exact rule (as `todoChatClient`) only to show the warning. Before
   an upload to a personal location for a TDS to-do, say so once:
   "This saves to your personal files, so only you can open it."
   Plain: two clear ways to add a file, and a warning when a teammate won't be able to open it.
6. **Add panel gets details**, using the release 1 editor, sent as `add` `details` when canAttach.
   Plain: a to-do you add for someone can say what needs doing.
7. **`attachments` on TodoItem and AskedTodo** are parsed server-side with the same shared function;
   `libraryId` comes from the library index (null if not listed). Additive only; `details` is unchanged.
   Plain: the app knows which files are linked without changing anything older readers see.
8. **Backward compatibility.** The Workbench and older apps see the `## Files` section as ordinary
   markdown links. An older script ignores `body` on add and answers unknown commands with an error, which
   is why canAttach/canUpload come from `capabilities`. Copying the skills into the brain waits for Ian.
   Plain: nothing breaks for teammates on older versions; the new buttons appear once the new skills are in the brain.

Accepted risk (overseer N3): two Macs adding the same new name before a sync can clash in git; rare,
shows in `.claude/sync-errors.log`.

## Contract

`shared/contract.ts`: `TodoAttachment`, `TODO_ATTACHMENTS_MAX`, `TodoItem.attachments`,
`AskedTodo.attachments`, `TodoAction` `add.details` / `attach` / `detach`, `TodoList.canAttach` /
`canUpload`, `TODO_UPLOAD_TYPES`, `TodoUploadRequest`, `TodoUploadResponse`, `ROUTES.todoUpload`,
`BrainReaders.uploadTodoFile`. `shared/todo-files.ts` + `shared/todo-files.fixtures.json` + `shared/todo-files.test.ts` (written by the
lead before building; builders don't change the rules, only add fixture cases if one is missing and say
so).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (skills) | `builder`, opus | hard list: scripts that write files into the shared brain (data integrity, path safety, git-ignore rules) | `brain-skills/tdsapp-files/**`, `brain-skills/tdsapp-todo/**`, `brain-skills/README.md`, `scripts/help-demo/brain/.claude/skills/tdsapp-todo/**` |
| Builder B (server) | `builder`, opus | hard list: path validation and the upload → add → attach sequence (data integrity, permissions) | `server/brain/todos.ts`, `todo-skill.ts`, `files-skill.ts`, `todo-asked.ts`, `index.ts`, `server/setup-mode.ts`, `server/http/routes.ts`, server tests and every server/engine test fixture the contract change breaks |
| Builder C (client) | `builder`, sonnet | default (UI) | `client/src/**` (api, store, TodoPanel, TodoForms, AskedList, new `TodoFiles.tsx`, styles, every client test fixture the contract change breaks), `help/*.md` |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-files/scripts/tdsapp-files.test.ts` | add: only the four destination shapes; client must exist; client path not ignored, personal path ignored; no overwrite, " (2)"; temp+rename; links/symlinked folders refused; type by folder; capabilities | A (tests first) |
| `brain-skills/tdsapp-todo/scripts/tdsapp-todo.test.ts` | attach/detach create, append, remove, drop empty section, position before history sections; `<…>` paths; relative path per folder; max; expect; add with body; Workbench parser still reads the frontmatter | A (tests first) |
| `shared/todo-files.test.ts` | the shared fixtures (written by the lead, 16 passing) | lead |
| `server/brain/todos.test.ts`, route tests | attachments + libraryId; canAttach/canUpload from capabilities; upload picks the destination; attach-after-add failure message; bad types refused | B |
| client tests | Files block, open/remove, picker, upload sequence with fresh version, personal warning, editor keeps the section, Add details | C |

## Gates

- [x] Type-check · [x] Tests · [x] Lint · [x] Build
- [x] No unintended large deletions
- [x] Domain gates: security (uploads, writes into the brain, path handling), UX
- [x] Browser check (preview on port 3878, own data folder, a throwaway copy of the demo brain for
      uploads — never upload into the real brain from a preview)

## Review outcomes

- Gates: type-check, 3,917 tests, lint (0 errors), build, deletion scan (nothing over 40 lines) all pass.
- Correctness (opus): picker dropped picks from an earlier search (fixed; picks kept whole). A failed
  capabilities probe at save time could drop the Files section (fixed: the server refuses as "changed").
  Non-link lines under `## Files` were hidden (fixed: `todoFileExtras`, shown as plain text).
- Security (opus): a look-alike letter ("AGENTſ.md") got past the protected-name check on the Mac's disk
  (fixed: NFKC before comparing, skill and server). Linking a personal library file to a team to-do shows
  its name to the team with no warning (fixed: the same once-per-panel confirm; help corrected).
- UX (opus expert): kept rejected-file notes, named the allowed types, progress "Adding 1 of 3…", focus
  kept on Add a file, friendly "<Client>'s Files", clearer personal warning, help wording, and a new
  to-do opens in read view when files can be added (all fixed).
- Browser check (throwaway demo brain under ~/.tba-preview, never the real brain): client upload to
  files/ and images/, team log for client adds only, personal upload git-ignored with the holder
  suffix, edit keeps the section, remove keeps the file, two-search pick, personal-pick warning, phone
  width. The picker was shrink-wrapped (fixed in CSS).
- Fix-round re-review (opus): a body-diff guard blocked renaming a hand-written "## Files" heading on
  older brains (replaced by the browser's `detailsOnly` flag); focus no longer jumps after an upload if
  the person moved on; the link and upload warnings are asked separately.
- Overseer sign-off: the Files block now also shows, read only, to anyone who can't edit to-dos here
  (team role, or changes switched off), so a passed-on to-do's files can be opened. Its should-fix: the
  section finder ignores `## Files` inside code fences, in the skill and the app alike (shared fixture).
- Not changed: the help-demo `tdsapp-todo` is a stand-in that changes nothing, so the demo shows no
  attach buttons (by design).
