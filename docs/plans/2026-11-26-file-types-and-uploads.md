# File type badges and uploads in Documents, Images and project Files

Date: 2026-11-26 · Size: L · Branch: `file-types-and-uploads` · Explainer: none (Ian said no)

## Objective (Ian, 2026-11-26)

"In files, documents and images, show the file type. Also, allow for upload of files and documents and images."
"And also when in projects, this functionality should be the same."

## User decisions (fixed)

- **A type badge on every file**: a small label such as PDF, DOCX or PNG on every tile and row, the same in
  Documents, Images and a project's Files tab, grid and list. Ian chose this sketch:
  ```
  Grid tile                List row
  +----------------+       [PDF]  Q3 report        12 Nov
  |   (preview)    |              840 KB
  |          [PDF] |       [PNG]  Logo dark         9 Nov
  +----------------+              1200 x 628, 184 KB
   Q3 report
   840 KB
  ```
- **A project upload is saved in the client's library and linked to the project** (personal library for a personal
  project). It shows under "From the library". No change to the brain's `tdsapp-files` script.
- Merge and push once checks and reviews pass. No explainer.
- Standing rules: every UI change follows `docs/design-system.md` and gets a UX/UI expert sign-off from screenshots;
  help page, picture and What's new note in the same branch; the app never writes brain files itself; older
  servers, clients and brain scripts keep working.

## Facts (from the code, 2026-11-26)

- Documents, Images and the project Files tab all draw through `client/src/apps/shared/LibraryBrowser.tsx` with a
  `KindSpec` per kind (`documents/kind.tsx`, `images/kind.tsx`). The type shows today only as words in the meta line:
  documents "PDF, 840 KB" (`documents/library.ts` `typeWords`/`metaWords`: "Word", "Excel", "Markdown"…), images
  "PNG, 1200 × 628, 184 KB" in the list but only "1200 × 628" on grid tiles (`tileWords`). A claude.ai link card says
  "Link to a claude.ai page". The panels (`DocumentsPanel.tsx`, `ImagesPanel.tsx`) and the viewer have a Type row.
- `.badge` (with `data-tone`) and `.chip` exist (`docs/design-system.md` "Shared pieces", "Controls"). A tile's bin
  sits on a corner of `.lib-tile-pic` (`edge`).
- Uploading exists for chat attachments and tasks: `POST ROUTES.uploads` (raw bytes, `client/src/api.ts`
  `uploadFile`) stages a file outside the brain (`server/uploads/staging.ts`, 32 MB, `UPLOAD_TYPES`);
  `uploadTodoFileRoute` (`server/http/routes.ts:1987`) claims the staged file, checks the type
  (`TODO_UPLOAD_TYPES`, `classify(ext).kind === file.kind`) and calls `uploadTodoFile` (`server/brain/todos.ts:808`),
  which picks the folder (`uploadDestination`, `cleanUploadName`), runs `filesSkill.add` (`server/brain/files-skill.ts`,
  `tdsapp-files add`, 'files-add-v1'), checks the script only changed the name, calls `onSaved` (`library.changed`,
  `projects.changed`) and then links. Permission: `canUseFilesAdd` (`todos.ts:339`: script there, `skillAccess`
  allowed, capability listed) plus the Tasks switch `prefs.directWrites`.
- `tdsapp-files add` accepts only `clients/<client>/files|images/<name>` and `personal/files|images/<name>`; refuses a
  client file from someone not on the team; never overwrites (" (2)"). Its `roles:` are owner and scout while in
  testing, so other team members get no upload until the brain guardian releases it (as for task uploads today).
- The closest project-scoped model is "Add a claude.ai page": `server/brain/project-artifact.ts`
  (`mayUseFilesSkill`, `artifactRefusal`), route at `routes.ts:1548`, flag `ProjectList.canAddArtifact` set by
  `withArtifactFlag`, client gate at `ProjectPage.tsx:600`, button in the tabs row (`ProjectPage.tsx:806`).
- Linking a file to a project: `changeProject({kind:'link', key, path, expect})`; refused when a shared project would
  link a `personal/` file; `PROJECT_LINKS_MAX` links per card.
- Library delete is gated by `deleteAccess()` (`server/brain/index.ts:117`), not by `prefs.directWrites`.
- The client refreshes lists through `libraryVersion` (`client/src/store.tsx:695`); the project tab also reloads on
  `card.version`. `TodoFiles.tsx:300-345` is the existing upload loop (one file at a time, status words,
  `discardUpload` on failure, "Saved in …" via `whereWords`).
- Chat attachments accept drag and drop (`components/Attachments.tsx`, `Composer.tsx`); the library screens don't.
- Memory "Test new requests through the gate": route tests skip `checkRequest` and client tests mock `api`, so a new
  request must also be tested through the real gate (`server/http/security.ts`, `server.test.ts`).

## Decisions (proposed; the overseer rules on the open ones)

1. **One badge component, the extension in capitals.** `TypeBadge` in `client/src/apps/shared/parts.tsx` shows
   `item.ext.toUpperCase()` (PDF, DOCX, XLSX, MD, PNG, JPG). Drawn by both kinds' `Item`s: on the picture's corner in
   a grid tile (not the bin's corner), at the start of a list row. Uses the design system's existing badge or chip
   look, no new colour. Open: exact placement in a list row beside the document glyph and image thumb; whether a
   claude.ai link card says LINK or HTML; whether JPEG shows as JPG.
   Plain: every file carries a small label saying what kind of file it is.
2. **The meta line stops repeating the type.** With the badge, documents' meta is the size ("840 KB"), images'
   is "1200 × 628, 184 KB" in both layouts. The panel and viewer Type rows stay as they are ("Word", "PDF").
   Open: keep the friendly word anywhere on the row (e.g. as the badge's tooltip or hidden text for screen readers)?
   Plain: the label replaces the type word, so it isn't said twice.
3. **One upload route for the three screens.** `POST ROUTES.libraryUpload` with a `LibraryUploadRequest`
   (`shared/library-upload-contract.ts`): `{upload, scope}` for Documents and Images, `{upload, project, expect}` for
   a project. The server picks the folder from the scope or the project's client and the file's own type; the
   browser never sends a path. It reuses `filesSkill.add` and the same post-save path check as `uploadTodoFile`.
   Plain: uploading works the same way wherever you start it.
4. **A project upload is one request: save, then link.** The server saves through `add`, then runs the existing
   `link`. If the link fails after the save, the file stays in the library and the message says where and to use
   "Add files". Refused up front: archived, card-less or legacy projects, a card whose links are full
   (`PROJECT_LINKS_MAX`), a changed card (`expect`). Open: check link limits before saving (proposed: yes).
   Plain: one press puts the file in the client's folder and on the project.
5. **Who may upload.** `LibraryListing.canUpload` (per scope: personal and client scopes only, and
   `canUseFilesAdd`-style checks) and `ProjectList.canUploadFiles` (as `canAddArtifact`, with 'files-add-v1'; the
   route also needs `PROJECTS_SKILL` access and `canChange`). The route re-checks everything; the script checks again.
   Open (security expert and overseer): must a library upload also need the Tasks switch `prefs.directWrites`, as a
   task upload does? Proposed: no, the same as delete and "Add a claude.ai page", because that switch is worded for
   tasks. Plain: you only see Upload where you're allowed to add files.
6. **The button.** "Upload" (`.btn`, upload or plus icon) in the tools row of Documents and Images (a new
   `actions` slot on `LibraryBrowser`/`LibraryTools`), and in a project's tabs row on Files beside "Add files"
   (`ProjectPage.tsx`). It opens the system file picker (several files, `accept` from `LIBRARY_UPLOAD_TYPES`).
   Shared logic in a new `client/src/apps/shared/upload.tsx` (`useLibraryUpload`): client checks (type, 32 MB, at most
   10 files a go), one file at a time, a `role="status"` line ("Adding 2 of 3…", then "Added 3 files to Acme
   Heating's library."), failures named, `discardUpload` on failure, then a library refresh. Busy is `aria-disabled`.
   Open: drag and drop onto the page (proposed: not in this release); whether a personal upload asks first (proposed:
   no ask, since the person chose "My personal files"; the status says "Only this Mac has it").
   Plain: an Upload button on all three screens.
7. **A file of the other kind still uploads.** A PDF uploaded from Images is saved in the client's `files/` folder
   and the status says so ("Saved in Acme Heating's Documents"), with the list unchanged. Open: or refuse it with
   "Upload documents from Documents"? Proposed: accept, since Ian asked to upload "files, documents and images".
   Plain: you don't have to be on the right screen to upload a file.
8. **Documents or Images narrowed to a project.** With the app's project filter (or Home's picker) set, the list is
   that project's files. Proposed: Upload then sends `{upload, project, expect}` when that project can take uploads,
   so the file appears in the list; otherwise no Upload button. Open: or always upload to the chosen library.
   Plain: uploading while looking at a project's files adds to that project.
9. **Backward compatibility.** New optional fields and one new route only. An older server sends no flag, so no
   button. A brain without 'files-add-v1' (or whose `roles:` refuse the person) gives no button. No brain file or
   script changes; `brain-skills/tdsapp-files` is untouched.
   Plain: nothing changes for anyone on an older app or brain.
10. **Help.** `help/documents.md`, `help/images.md` and the project files help get the badge and Upload; pictures
    `documents-grid.webp` and `images-grid.webp` are retaken (`pnpm help:shots --only`); `help/whats-new/<next
    version>.md` and `client/src/help/whats-new.test.ts`. No tour step (no new app, rail item or Home feature).

## Overseer rulings (pre-review, 2026-11-26). These win over the proposals above.

1. **Badge.** `TypeBadge({ ext })` in `parts.tsx` renders
   `<span class="badge lib-type" data-tone="muted" aria-hidden="true">`. `muted` already exists
   (`client/src/styles/base.css:562`); add it to the design system's "Badge tones" row. No new colour.
   - Label: the file's own extension in capitals, no mapping (`.jpeg` shows JPEG; a link card shows HTML and its meta
     still says "Link to a claude.ai page").
   - Grid tile, both kinds: inside `.lib-tile-pic`, after the `Thumb`, bottom-left (`left: 6px; bottom: 6px`,
     `pointer-events: none`), always shown. The other corners are taken (tick top left, star and Open top right, bin or
     Remove bottom right). This differs from the corner in Ian's sketch: tell him.
   - List row: inside `.lib-open`, straight after `.doc-glyph` (documents) or the thumb (images), before `.line-text`,
     in a fixed slot (`flex: none; width: 52px`) so titles line up. It stays at every width.
   - Accessible name: the meta line starts with `<span class="visually-hidden">PDF, </span>` in both layouts, so a row
     reads "Q3 report, PDF, 840 KB" as today.
   Plain: every file shows a small grey label with its type, in the same place on every screen.
2. **Meta words.** Documents: "840 KB" in both layouts; a claude.ai copy "840 KB, from claude.ai". Images list:
   "1200 × 628, 184 KB". The image tile stays as it is (dimensions, else size). No tooltip or friendly word on the row;
   "Word" and "Markdown" stay in the panel and viewer Type rows. Update the example at `docs/design-system.md:503`.
   Plain: the type is said once, by the label.
3. One route, two shapes: agreed.
4. **Check before saving.** Order: claim the upload; type and kind; the person's permission; then for a project:
   found, not archived, card ok, not legacy, `expect`, links not full. Only then `add`, the path check, the library
   `brain-changed` publish (as `server/http/routes.ts:2290`), and `link`. **A link failure answers 200 with
   `linked: false` and `problem`**, never an error (the project client swaps a `changed` error's words for "reload,
   try again", and a retry would save a second copy). No automatic retry.
   Plain: a file is only saved when it can also go on the project; in the rare case it can't, you're told where it is.
5. **No Tasks switch.** Delete and "Add a claude.ai page" already write without `prefs.directWrites`. The skill's
   `roles:` is then the only gate, so the route re-checks it on every request (security expert confirms).
   **One function for destination and permission** in `server/brain/library-upload.ts`, used by both flags and both
   request shapes; the client slug comes from the listed scope or `card.folder`, never from the browser or the card's
   `client:` text. A table test proves the flag and the route agree in every case.
   Plain: uploading doesn't depend on the tasks setting.
6. **Button.** "Upload" with the `plus` icon.
   - Documents and Images: `.btn[data-variant="primary"]`, 32px, last in the tools row after Layout.
     `LibraryBrowser` takes `actions?: ReactNode` and passes it as the last child of `LibraryTools` (which already
     draws `children` last, `parts.tsx:159`): no new slot on `LibraryTools`.
   - Project Files tab: `.btn[data-size="small"]`, standard, between "Add files" (keeps the primary) and "Add a
     claude.ai page". The hidden file input goes after the last button (`.proj-tabrow > .btn + .btn`,
     `client/src/styles/projects.css:40`, breaks otherwise), so no CSS change.
   - Name: hidden text gives the destination, "Upload to Acme Heating's library" or "Upload to {project title}".
   - `aria-disabled` while busy, label unchanged. `accept` is every type in `LIBRARY_UPLOAD_TYPES` on all screens.
   - Status and errors: an always-mounted `role="status"` line above the tray (`.lib-note` when it has words, else
     `visually-hidden`); failures in `.notice[data-level="error"][data-shape="box"][role="alert"]`; saved-not-linked as
     `data-level="warn"`. The project tab uses its existing `done` line and `message` notice.
   - **Capture the target when the files are chosen**: changing the Library picker or the project during "Adding 2
     of 5…" must not redirect files 3 to 5.
   - Refuse a full project on the client first: `card.links.length + files.length > PROJECT_LINKS_MAX` sends nothing.
   - No drag and drop in this release. No ask before a personal upload; the status says so.
   Plain: one Upload button in the same spot on each screen, which says where files will go.
7. **Accept the other kind.** The server files by the file's own type; the status names the app it went to.
   Plain: a PDF uploaded from Images is saved in Documents, and you're told.
8. **Narrowed to a project: send `{upload, project, expect}`.** The card comes from `useProjects()`, and the
   response's `list` goes through `apply`. Never the Library picker's scope here (it can be another client's). If the
   project can't take uploads, no button.
   Plain: uploading while looking at a project's files adds to that project.
9. Agreed. 10. Agreed; Builder B writes the badge, the `muted` tone and the meta lines in `docs/design-system.md`;
   Builder H, who runs last, adds the Upload button rules (one writer at a time).

**Words** (stop at the first failure on every screen):
- Working: "Adding quote.pdf…" or "Adding 2 of 3…".
- Done, library: "Added quote.pdf to Acme Heating's Documents." or "Added 3 files to Acme Heating's Documents and
  Images."
- Done, personal: "Added quote.pdf to your personal files. Only this Mac has it."
- Done, project: "Added 3 files to this project. Saved in Acme Heating's Documents."
- Before sending: `"x.svg" wasn't added: that type can't be added.` plus the types sentence
  (`TodoFiles.tsx:26`); `"x.pdf" wasn't added: it is over 32 MB.`; "Choose up to 10 files at a time." (nothing sent).
- Failure: `2 of 5 added. "x.pdf" couldn't be added: {server message}`.

**Extra tests the overseer asked for:** scope ids shaped like `client:../x`, `client:_archive` and capitals are
refused; a body with both `scope` and `project` is a 400; `linked: false` on the server and the client (shown, loop
stops, no blind retry); Documents narrowed to a project sends the project shape; the image tile's meta is unchanged;
no flag means no button on all three screens; the target is captured when files are chosen.

**Nice, taken:** the "script may only change the name" check becomes one helper in `server/brain/files-skill.ts`,
used by the new code only (Builder S owns that file for this helper).

## Contract

`shared/library-upload-contract.ts` (new), plus `ROUTES.libraryUpload` and `LibraryListing.canUpload` in
`shared/contract.ts`, and `ProjectList.canUploadFiles` in `shared/projects-contract.ts`. Written by the lead.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Lead | me | contract, plan, small fixes, browser check | `shared/library-upload-contract.ts`, `shared/contract.ts`, `shared/projects-contract.ts`, this plan |
| Overseer | `overseer`, fable | plan critique, open decisions, sign-off | read-only |
| Builder S (server) | `builder`, opus | hard list: permissions and writes into shared brain data through a new route | `server/brain/library-upload.ts` (+test), `server/brain/index.ts`, `server/brain/library.ts` (the `canUpload` flag only, +test), `server/http/routes.ts`, new `server/http/library-upload-routes.test.ts`, gate test in `server/http/server.test.ts` or `security.test.ts`, `server/setup-mode.ts` |
| Builder B (badge) | `builder`, sonnet | UI (default) | `client/src/apps/shared/parts.tsx`, `shared/library.css`, `documents/kind.tsx`, `documents/library.ts` (+test), `images/kind.tsx`, `images/library.ts` (+test), `DocumentsApp.test.tsx`, `ImagesApp.test.tsx`, `ProjectFiles.test.tsx`, `docs/design-system.md` |
| Builder U (upload UI) | `builder`, sonnet | UI (default) | new `client/src/apps/shared/upload.tsx` (+test), `shared/LibraryBrowser.tsx` (+test), `documents/DocumentsSheet.tsx`, `images/ImagesSheet.tsx`, `shared/data.ts`, `projects/ProjectFiles.tsx`, `projects/ProjectPage.tsx`, new `projects/ProjectFilesUpload.test.tsx`, `client/src/api.ts`, `client/src/styles/projects.css` |
| Builder H (help), after B and U | `builder`, sonnet | copy and pictures (default) | `help/documents.md`, `help/images.md`, `help/projects*.md`, `help/shots.json`, `scripts/help-shots.ts`, `help/images/*.webp`, `help/whats-new/*.md`, `client/src/help/whats-new.test.ts` |
| Security expert | `expert`, opus | domain gate: file uploads, permissions | read-only |
| UX/UI expert | `expert`, opus | domain gate from screenshots | read-only |
| Reviewers | correctness `reviewer` opus; UI, accessibility and copy `reviewer` sonnet | | read-only |

Builder U needs one line in `parts.tsx` (`LibraryTools` gains an `actions` slot): Builder B adds that slot, named in
both briefs, so no file has two owners.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/brain/library-upload.test.ts` | destination by scope and by project (client, personal; shared, legacy, archived, card-less refused); folder by the file's kind; refused without skill, role or capability; the script's answer may only change the name; link failure keeps the file and says where; links-full and `expect` refused before saving | S (tests first) |
| `server/http/library-upload-routes.test.ts` | body parsing (exactly the two shapes), the staged upload is used up once, type and kind checks, status codes, flags on the listing and the project list | S (tests first) |
| gate test (`server.test.ts`/`security.test.ts`) | a real `POST /api/library/upload` with JSON passes `checkRequest` (no 415/403 from the gate) | S |
| `documents/library.test.ts`, `images/library.test.ts` | the new meta words; badge label by extension | B |
| `DocumentsApp.test.tsx`, `ImagesApp.test.tsx`, `ProjectFiles.test.tsx` | every tile and row shows its badge; nothing else moved | B |
| `shared/upload.test.tsx` | client checks (type, size, count), one at a time, status words, failure names the file and discards the upload, refresh after | U |
| `LibraryBrowser.test.tsx`, `ProjectFilesUpload.test.tsx` | Upload shows only with the flag; sends `scope` or `project`+`expect`; a project upload carries the fresh card version to the next file | U |

## Gates

- [ ] Type-check · [ ] Tests (full) · [ ] Lint · [ ] Build
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Security expert on the route, the destination rule and the flags
- [ ] UX/UI expert sign-off from screenshots (badge in grid and list, Upload in all three places, status and errors)
- [ ] Browser check on a throwaway brain (port 3878, own `TDS_BRAIN_APP_DATA`): upload a PDF and a PNG in Documents,
      Images and a project; a refused type; a personal library; keyboard only
- [ ] Help page, pictures and What's new note; `ls help/whats-new | tail -1` matches the version that ships

## Review outcomes

Every finding was checked in code before it was acted on.

- **Overseer pre-review (Fable).** One blocking item, applied: a file saved but not linked answers 200 with
  `linked: false` and `problem`, never an error. Its ten rulings are above.
- **Security expert (Opus).** No blocking or should findings. One nice, not done here: a file's contents are
  not checked against its extension (task uploads have the same gap; files are served `nosniff` and
  sandboxed; the fix belongs in the brain's `tdsapp-files` `add`). Follow-up.
  Plain: a file named like a picture that isn't one would be saved; the app never runs it.
- **Correctness (Opus).** Should, fixed: Documents or Images narrowed to a project reloaded before the link
  was written, so a new file could be missing; the route now publishes `brain-changed` again after a
  successful link. Nice, fixed: the done line said "this project" after the person had moved on; it now names
  the project.
- **UI, accessibility and copy (Sonnet).** Should, fixed: the saved-but-not-linked words named a button that
  Documents and Images don't have; a run with some files turned away now shows as a warning. Three nice items
  dropped: the wording matches the task panel's, and no listed extension is longer than four letters.
- **UX/UI expert (Opus, from real-browser screenshots).** Signed off. Fixed: the project status line uses
  `.lib-note` (on the gutter, 12px); under 480px a document row drops its kind icon so titles keep their room;
  the first uploaded file a screen lists is chosen and scrolled into view; wrapped action buttons stay
  right-aligned. Noted, unchanged: on Images the badge repeats the file name's ending (ruling 1).
- **Correctness re-check of the fix round (Opus).** Nothing blocking. Nice, fixed: a file the person chose
  while a slow upload ran is no longer replaced by the uploaded one.
- **Overseer sign-off (Fable).** Signed off; no fix contradicts a ruling. Should, fixed: a project upload that
  stops (refused, or saved but not linked) now reloads the projects list, so "Try again" sends the fresh
  version instead of relying on the window regaining focus.
- **Browser check.** Real Chrome on a demo brain with the real `tdsapp-files` and projects scripts: upload
  from Documents, Images and a project's Files tab, a refused type, a rename on a name clash, a cross-kind
  upload, the narrowed case, and a 390px window.
- **Help.** `help/documents.md`, `help/images.md`, `help/projects.md`, both grid pictures retaken,
  `help/whats-new/0.94.0.md`, Upload and badge rules in `docs/design-system.md`.
