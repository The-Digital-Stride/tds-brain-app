# A project's Files tab works like Documents and Images

Date: 2026-11-23 · Size: L · Branch: `project-files-library-view` · Explainer: no (Ian)

## Objective (Ian, 2026-11-23)

"When showing the documents and images etc in the files section of the project, show the same detail and
filtering as the docs and images apps. Or use a shared component? Also, when [I] see the list of files in the
since you last looked, then they should have links to open the docs in the doc explorer."

## User decisions (fixed)

- Every UI change follows `docs/design-system.md` and gets a UX/UI expert sign-off from screenshots before merge.
- Merge and push once checks and reviews pass (standing approval for this programme's work).
- Prefer a shared component over a look-alike (Ian's question; memory "UI consistency: reuse components").

## Facts (from the code, 2026-11-23)

- Documents page: `client/src/apps/documents/DocumentsSheet.tsx` (275 lines). Images page: `client/src/apps/images/ImagesSheet.tsx`
  (259). Both are built from `client/src/apps/shared/parts.tsx`: `LibraryTools` (whose library, search, project filter,
  slot for the app's own controls), `FolderCard` (a card per group), `LibraryNotice`, `DeleteButton`, `ViewButton`,
  `DetailActions`, `SelectionBar` (Images). Each page adds: a Type `Seg` with counts (Docs: All/PDFs/Docs/Sheets/Decks),
  Sort `Seg` (Newest, A to Z), Layout `Seg` (Grid/List, Docs), a summary line, grid `Tile`s and list `Row`s, a star
  (`FileStar`), delete with Undo. Clicking a row SELECTS it; its details show in the app's right panel
  (`DocumentsPanel.tsx`, `ImagesPanel.tsx`: preview, name, DetailActions, Type/Size/Group/Changed/File path).
- Both pages already narrow to a project: `useLibraryData` (`client/src/apps/shared/data.ts:96-150`) loads
  `api.projectFiles(project, kind)` when the app's project filter (or the Home picker) holds one. Their state lives
  in app stores (`docsStore`, `imagesStore`) shared with the Documents/Images apps.
- The project Files tab: `client/src/apps/projects/ProjectFiles.tsx` (471 lines). Two plain sections (Images,
  Documents) of `li.line.lib-row.proj-file` rows; the row opens the viewer (deliberately, comment at :41); each row
  says its group and "added from the library" for linked files; an Unlink button (bin) for linked files; an "Add
  files" picker that searches the library and links files to the card (`Picker`, with its own hold/confirm). No type
  filter, sort, layout, search, details, star.
- The Projects app has NO right panel (`client/src/shell/apps.ts:38-47`), unlike Documents/Images.
- Opening a file in its app already exists: `openLibraryItem(app, scope, item)` + `openView('app:documents')`
  (`client/src/apps/shared/search.ts:17`, used by `FileViewer.tsx:144-149` "Open in Documents"). The scope comes
  from `api.libraryItems([id])` (`ProjectFiles.tsx:417-428`).
- Activity file rows (phase 3, `client/src/apps/projects/ProjectActivity.tsx` `openFile`) find the item among the
  project's files by path and open the viewer.

## Proposed decisions (for the overseer to rule on)

1. **One shared browser.** Extract the body the two pages share into `client/src/apps/shared/LibraryBrowser.tsx`:
   type filter with counts, sort, layout, summary, folder cards with tiles/rows, star, delete, select. It takes the
   items, the app's kind-specific bits (type options, tile/row renderers or a `kind` switch) and a state object
   (query, format, sort, layout, current) so it can run on the app stores OR on local state. Documents and Images
   use it unchanged in look and behaviour (their tests stay green). Plain: the three places show files the same way
   because they're the same component.
2. **The Files tab uses it**, on local state (never the Documents/Images app stores, so the project page doesn't
   change what those apps show). A Kind `Seg` (Documents · Images, with counts) picks which list; the items come
   from `api.projectFiles(key, kind)` as now. Project-only extras stay: "Add files" (the picker), "added from the
   library" in the row's meta, Unlink for linked files (instead of Delete: the project only links them).
   Plain: same filters, sort, layout and details as the apps, plus linking.
3. **Details on the project page.** The Projects app has no right panel. Options: (a) give the Projects app a
   panel that shows the shared document/image details while a file is selected on the Files tab; (b) keep the row
   opening the viewer, with "Open in Documents/Images" there (as today); (c) inline details under the list.
   Overseer to choose. Plain: where you see a file's type, size, group and path.
4. **Since you last looked: file rows open the file in its app** (Documents or Images) with the file selected, via
   `openLibraryItem` + `openView`, the scope found with `api.libraryItems`. "Linked file" rows the same. If the file
   can't be found, the existing "can't be opened from here" note. Plain: a new file in the list takes you to it in
   Documents.
5. **Backward compatibility.** Client only; no server or brain change (check this still holds after decision 6).
6. **"Since you last looked" stays until you clear it** (Ian, 2026-11-23: "Keep the files in the since you last
   looked unless you clear it. Or until new files are present?"). Today the card marks everything seen when you leave
   the page, if the card was shown (`ProjectActivity.tsx:36-71`, `postSeen`). Proposed: no mark on leave; a quiet
   "Clear" button on the card marks what's listed as seen (POST `projectSeen` with the read's token); new changes add
   to the list. Rejected: rolling the list over when newer files arrive, because changes you never looked at would
   vanish. Overseer to rule on: the token is per read and expires (`ACTIVITY_TOKEN_TTL_MS` 12h, or a restart), so what
   Clear does with a stale token (re-read and show the fresh list, never mark unseen rows); whether the list now grows
   past the 50-newest updates window (`project-activity.ts:201`, UPDATES_PAGE guard) and what the card says then;
   focus after Clear (design system Actions rules). Plain: the list stays until you say you've seen it.

## Overseer rulings (pre-review, 2026-11-23)

1. **LibraryBrowser** (`client/src/apps/shared/LibraryBrowser.tsx`) owns everything inside today's sheet root. Loading,
   state and what a press does stay outside and are passed in (no store imports). Each app exports a spec from a new
   `kind.tsx` (`documents/kind.tsx`, `images/kind.tsx`); no `kind` switch. Sketch:
   ```ts
   type View = { query; layout; format?; sort?; current?; ticked? };
   type ItemProps = { item; layout; current: boolean; onChoose(): void; onOpen?(): void; tick?; note?: string; edge: ReactNode };
   type KindSpec = { id; words; formats?; sorts?; filter; sort?; summary; name; Item };
   type Props = { spec: KindSpec; view: View; onView(patch: Partial<View>): void;
     data: Omit<LibraryData, 'scopes'|'project'>;
     pickers?: { scopes; scope; onScope; project; onProject };
     lead?: ReactNode; nested?: boolean; bin?: boolean;
     onChoose(item): void; onOpen?(item): void; onDeleted?(item): void;
     takeOut?(item): { label; tip; busy; run(): Promise<boolean> } | null;
     note?(item): string|undefined; selection?: { onAsk(items): void } };
   ```
2. **Files tab:** local state. A Kind Seg (Documents · Images, with counts) goes in `lead`, because one filter set can't
   drive two lists. Linked rows keep today's remove (X) in the bin's slot via `takeOut`; `bin={false}`. "Add files"
   stays in the tabs row. B refreshes quietly (one load key) on `card.version` and `libraryVersion`; the browser focuses
   the neighbour after `run()`.
3. **Details:** the viewer (option b). No `onOpen` on the Files tab, so no Open button and no gap (Actions rule 1). A
   Projects panel would sit empty on the other tabs. Risk noted: Ian may have meant the pane; it is one press away.
4. **Activity file rows open the app**, using `FileViewer.tsx:144-151`'s calls. Safe only with decision 6 (leaving no
   longer marks seen). Not narrowed to the project (an unasked filter would stick). `openItem`
   (`shared/store.ts:84-93`) must clear `project` unless `item.projects` includes it, or `useKeepCurrent` deselects the
   file.
5. **Decision 6: Clear, no roll-over, no server change** (a contract comment only).
   - With rows: never post on leave. Without rows (first visit, nothing new): keep today's post on leave, or `since`
     stays null for ever.
   - Clear posts the token, then re-reads quietly. The 204 is silent, so an unchanged `since` means a dead token: show
     the fresh list and "This list was out of date, so nothing was cleared." Never re-post.
   - The 50-update window holds; past 50 unseen updates the count runs short and Clear covers them (accepted).
   - Clear acts at once, with a status line and no Undo (rule 4). Quiet small "Clear" in the card head,
     `aria-disabled` while busy. Focus goes to the card's heading; on a dead token, it stays on Clear.
   - Card head `.count` = rows plus `more`, so Clear's reach shows.
6. **CSS:** `.doc-col`/`.doc-date` move from `documents.css` to `library.css` (Projects never loads `documents.css`).
   `nested` handles the `.lib` padding and `.lib[data-layout]` hooks inside a project card.
7. **A never edits `DocumentsApp.test.tsx` or `ImagesApp.test.tsx`**: they pin the DOM and prove nothing changed.
8. Nice (later): hold `view` in ProjectPage so Projects reopens its last page.

## Team and file ownership

| Role | Agent and model | Why | Owns |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique, decision 3, sign-off | read-only |
| Builder A | `builder`, sonnet | UI refactor (default) | `client/src/apps/shared/LibraryBrowser.tsx` (+test), `shared/parts.tsx`, `documents/DocumentsSheet.tsx`, `documents/kind.tsx` (new), `documents/documents.css`, `images/ImagesSheet.tsx`, `images/kind.tsx` (new), `shared/library.css`, `docs/design-system.md` |
| Builder B | `builder`, sonnet, after A | UI (default) | `client/src/apps/projects/ProjectFiles.tsx` (+test), `ProjectPage.tsx`, `client/src/styles/projects.css`, `help/projects.md`, panel wiring if decision 3a |
| Lead | me | small | plan, `shared/store.ts` (+test), `ProjectActivity.tsx` (+test), `shared/project-activity-contract.ts` comment, decisions 4 and 6 |
| UX/UI expert | `expert`, opus | design gate | read-only, screenshots |
| Reviewers | correctness opus; UX sonnet | | read-only |

## Tests

| Test | Proves | Owner |
|---|---|---|
| `DocumentsApp.test.tsx`, `ImagesApp.test.tsx` (existing) | the apps behave as before | A |
| `LibraryBrowser.test.tsx` | filter counts, sort, layout, select, local state never touches the app stores | A |
| `ProjectFiles.test.tsx` | kind switch, type filter, sort, details, Add files and Unlink still work, no app-store change | B |
| `ProjectActivity.test.tsx` | a file row opens the file in Documents/Images (openLibraryItem + view), fallback note | Lead |

## Gates

- [ ] Type-check · [ ] Tests (full) · [ ] Lint · [ ] Build · [ ] Large-deletion scan (a refactor moves lines: check each)
- [ ] UX/UI expert sign-off from screenshots · [ ] Browser check on a throwaway brain (3878)

## Review outcomes

- **Built as ruled**, plus one design change found in the browser: the Files tab groups files by where they sit in
  the project (`placeIn`: "In the project folder", subfolder names A to Z, "From the library"), in that fixed order,
  instead of the library's "Projects" group. The project tabs row now wraps on a phone ("Add files" overflowed on
  main too).
- **UX/UI expert (opus):** BLOCK on the kind switch clipping "Documents, 3" (fixed: options size to their words).
  Should: the switch was first on screen but second in Tab order (fixed: `LibraryTools` `lead` slot); Clear's name
  (kept, Ian's word; spoken "Clear Since you last looked"). Nice: one note after Clear, "From the library",
  design-system.md rule 1 and the `lead` entry. Re-check: SIGN OFF.
- **Correctness (opus):** group order followed the sort (fixed, tested); Home's "Working on" project beat `openItem`,
  so a file opened from activity could land deselected (fixed: `openItem` clears it when the file isn't in it;
  tested); missing tests for the Clear guards (added: no post on leaving after a stale Clear, one post on a double
  press, a Clear finishing after a project switch).
- **Overseer (fable) sign-off:** one blocker, switching kind remounted the switch and dropped keyboard focus (fixed:
  no `key`; a test fails without it). Ruled that clearing Home's picker is right (never set it to the file's
  project). Should: a Clear that finishes after a switch now says nothing (`'moved'`). Signed off on those fixes.
- **Gates:** typecheck, lint (one old warning in `server/engine/event-map.ts`), full suite, build. Browser check on a
  throwaway brain at 1440px and 390px: list stays after leaving, file row opens Documents with the file chosen,
  Clear empties the card and focuses its heading, Files tab filters, sorts, switches layout and kind, remove shows
  on linked files.
- **Watch:** "Working on" resets silently when a file outside it is opened; the 50-update window means very long
  unseen lists undercount (accepted in decision 6).
