# To-do panel (release 1 of 3)

Date: 2026-11-16 · Size: XL (programme), this phase L · Branch: `todo-panel` · Explainer: none

## Objective

The To-dos drawer is 316px wide, too narrow to read a to-do's details or edit them. Opening or editing a
to-do now slides a wide panel out from the drawer's edge, shows the details formatted (not raw markdown),
and edits them in a small rich-text editor that never loses formatting it doesn't offer.

## Programme (user decisions, fixed)

- Three releases, each planned, built, reviewed and merged before the next:
  1. **This plan:** the slide-out panel, formatted reading, rich-text editor, extras.
  2. "Asked of others" (to-dos I passed on, open and finished, who finished them and when) and a
     history timeline in the panel, read from the brain's git record, read only (Ian, 2026-11-16).
  3. Attachments: link existing library files or images, or upload new ones through a new `add` action
     in `brain-skills/tdsapp-files` (the app never writes brain files itself).
- The panel **slides** (no centred popup), out from the To-dos drawer's edge, so it reads as part of it.
- Editor offers: heading, body text, bullet list, numbered list, tick list, **bold**, links. Nothing more.
- Extras in this release: tick tick-boxes while reading, previous/next to-do, "Add a to-do" uses the panel.
- No visual explainer.
- **The editor ALWAYS saves the to-do back as markdown** (Ian, 2026-11-16). The Tiptap document lives
  only in the open panel; what is sent to the `todo` skill and stored in the file is always markdown.

## Facts checked

- Bodies of the 179 live to-dos (counted read-only, 2026-11-16) use inline code (940), bold (646), bullets
  (~440, some nested), tick items (224), headings (~370, 124 of them `# `), table lines (130), numbered
  items (~135), quotes (11), links (4). A strict editor would strip most of this on save.
- `TodoItem.details` is the whole body below the frontmatter, trimmed; an edit replaces it whole
  (`shared/contract.ts:155`). Max `TODO_DETAILS_MAX` = 8000; longer ones are read-only in the app today.
- Every change goes through the brain's `todo` skill script (`server/brain/todo-skill.ts`) with `expect`
  = the file's fingerprint; `buildEditActions` (`client/src/shell/TodoForms.tsx:257`) only sends fields
  that changed.
- `renderMarkdown` (`client/src/markdown.tsx`) forbids `input`, so tick boxes can't render through it.
- The file viewer already slides a glass panel over the desk (`ViewerDrawer`, `styles/viewer.css`,
  `viewer-in` animation, resize handle, `useLayerWidth`). The left dock is 316px (`styles/shell.css:371`);
  under `modes.drawerOverlays` the drawer itself overlays the sheet.
- `@tiptap/markdown` (Tiptap v3) parses with MarkedJS tokens and lets each node define `parseMarkdown`
  / `renderMarkdown`, so a node can carry a block's raw source and write it back unchanged.

## Decisions

1. **One panel component, `TodoPanel`, slides out from the To-dos drawer's right edge** over the sheet,
   using the viewer's glass, radius, lift and `viewer-in` motion (reduced-motion: no animation). Its left
   edge sits on the drawer's right edge, width up to 760px, kept inside the window. When the drawer
   overlays (`modes.drawerOverlays`), the panel covers the drawer and sheet at full width less the pad.
   Plain: the to-do opens in a wide panel attached to the list, so long details are easy to read.
2. **Reading first, editing on request.** Opening a to-do (row click on its title or the Edit/Options
   button) shows it formatted, with an Edit button; the same panel switches to edit mode. Read-only users
   (`TodoDonePanel` case) see the same panel with only "Mark as done". The inline editor in the row goes.
   Plain: you see the to-do properly first and only edit when you mean to.
3. **Layout.** Header band: title (16/600), close button top right. Body: details as the main column; a
   side strip (stacked under the details below 640px panel width) with due date, assigned to, TDS or
   Personal, client/project, handed over by, linked chat. Footer: Start or Open chat, Mark as done, Delete
   on the left; in edit mode Save and Cancel on the right. Edit mode uses the existing fields (`Assignee`,
   `Seg`, date field, notes, conflict note) unchanged in behaviour.
   Plain: everything about the to-do and every action is on one screen.
4. **One document model for reading and editing: Tiptap with `editable` false to read, true to edit.**
   Same schema, same look, so what you read is what you edit. Tick items are clickable in read mode.
   Plain: formatting looks the same whether you're reading or editing.
5. **Editor schema (allowed):** paragraph, heading (levels 1–3 shown as one "Heading" button that cycles
   or a small menu, builder's choice reviewed by UX), bullet list, ordered list, task list, bold, link,
   hard break; inline code is **kept** as a mark (no button). Italic and strike are kept as marks if
   present (no button). Toolbar: Heading, Body, Bullets, Numbers, Ticks, Bold, Link.
   Plain: a short toolbar, but nothing already in a to-do gets thrown away.
6. **Kept blocks.** Any block the schema doesn't offer (table, code block, quote, HTML, anything unknown)
   becomes a `keptBlock` atom node holding its exact markdown source. It renders formatted (through
   `renderMarkdown`) and read-only, with a quiet note "Edit this part in a chat" on hover/focus in edit
   mode; it can be moved or deleted as a whole but not edited.
   Plain: tables and code blocks show properly and are never mangled by the editor.
7. **Byte-for-byte round trip.** `toDoc(md)` records each top-level block's source; `toMarkdown(doc)`
   writes an unchanged top-level block's original source and re-serialises only blocks that changed, in
   brain style (`-` bullets, `- [ ]`/`- [x]`, `1.` numbering kept, `**bold**`, `[text](url)`, blank line
   between blocks). `toMarkdown(toDoc(md)) === md` for every input (after the existing trim). If nothing
   was changed, no details action is sent (as today).
   Plain: opening and saving a to-do never changes parts you didn't touch, so the brain's history stays
   clean.
   **Hardened (overseer blocking 1):**
   - "Unchanged" = the node's JSON deep-equals the re-parse of its stored source. No dirty flags (attrs
     are copied on split and paste).
   - A block is editable only if serialise then parse returns the same node; otherwise it's a `keptBlock`.
   - The original separator is kept only between original neighbours; anything else gets one blank line.
   - `isFaithful(md)` checks both identities; if false, details open read-only with the "edit in a chat"
     note (no risk of loss).
   - Use Tiptap's own lexer (marked 17, bundled with `@tiptap/markdown`) for splitting, `countTasks` and
     `setTask`, so the reader is one and the same; assert joined `raw` equals the input; claim `html`
     tokens as `keptBlock`. First confirm `MarkdownManager` runs without a mounted editor.
   - Packages pinned exactly at 3.32.2 (installed).
8. **Tick while reading** toggles one task item and saves at once as a details change with `expect`
   (same path as Save, same conflict handling). Only when the person may edit and details are within
   `TODO_DETAILS_MAX`. Pending tick shows busy; a refusal shows the existing error words and reverts.
   Plain: tick off a step in a to-do without opening the editor.
9. **Long to-dos** (details over 8000) open in read mode with the existing "too long to edit here" note
   in place of Edit for details; other fields stay editable.
10. **Previous / next.** Two icon buttons in the panel header (tooltips name the keys) and the single keys
    `P` / `N` (under the single-key rules in `client/src/state/keys.ts`; `[` is the rail's) move to the
    neighbouring to-do in the drawer's current visible order (tab, filters, sections), skipping held
    rows. In edit mode with unsaved changes they ask first (inline confirm), as does closing.
    Plain: go through your to-dos one after another without closing the panel.
11. **Add a to-do keeps today's fields** (title, due, assignee, scope; `add` carries no details:
    `shared/contract.ts:271`) and opens in the panel. After adding one for yourself, the panel stays on
    the new to-do in edit mode (found by diffing `result.todos`) so details can be written at once. Details
    on add for someone else needs a skill change: release 3. The inline add form in the drawer goes.
    Plain: add a to-do, then write its details straight away.
12. **Open from search.** Only search calls `revealTodo`; the drawer's reveal effect now opens the panel
    on that to-do in read mode. Home's pinned rows keep starting a chat (`Home.tsx:146`), unchanged.
13. **Panel state lives in the shell, not the drawer** (overseer blocking 3). `.dock` is
    `overflow: hidden` and swapping drawers unmounts `TodosDrawer`, so: the open panel (`todo` key, mode)
    is shell state like `viewer` (`client/src/state/shell.ts`), the panel is mounted beside the dock in
    `client/src/App.tsx`, and `keyAction` gates single keys and Esc while it's open. A dirty draft blocks
    drawer swaps with the inline confirm instead of being dropped.
    Focus: always `role="dialog"`. When the drawer overlays: `aria-modal`, veil and inert desk, as
    `FileViewer`. When docked: non-modal, sheet inert under a veil, the drawer stays live. Esc closes
    (asks first if dirty), E edits, Cmd/Ctrl+Enter saves, focus returns to the row's button on close.
    Tooltips on every icon button (`icon-buttons.test.ts`).
    Plain: shortcuts don't clash, and unsaved edits never vanish at a key press.
16. **Reading for everyone.** The panel opens with changes off too (read only); the row title becomes a
    real button that opens it; `docs/design-system.md:47` updated.
17. **Length.** No `maxLength` on a rich editor, so Save is blocked with a note when the markdown passes
    `TODO_DETAILS_MAX`.
18. **Held rows.** Mark as done and Delete close the panel and focus the row's Undo.
19. **Load Tiptap lazily** (a separate chunk loaded when the panel first opens).
20. **Heading button:** one toggle; it applies level 2 and keeps existing levels; Body turns it off.
14. **Links.** Only `http:`, `https:` and `mailto:` are links (open in the browser, `rel="noopener
    noreferrer"`); any other href is kept in the markdown but shown as plain text. The Link button asks
    for a URL in a small inline field (no browser prompt).
    Plain: links in to-dos are clickable and safe.
15. **Help and docs.** Update `help/adding-todos.md`, `help/change-todos-setting.md` and any to-do help
    page that describes the inline editor; add the panel to `docs/design-system.md`. UK English.

## Contract

`client/src/todo-doc/contract.ts`: the converter's functions and the editor's props, which both builders
build against.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off; domain: React UI + rich-text/markdown round-trip | (read-only) |
| Builder A | `builder`, opus | hard list: engine with tricky rules (byte-for-byte markdown round trip, kept blocks) | `client/src/todo-doc/**` (except `contract.ts`), `scripts/todo-roundtrip.ts` |
| Builder B | `builder`, sonnet | default (UI) | `client/src/shell/TodoPanel.tsx`, `client/src/shell/TodoDetailsEditor.tsx`, `client/src/styles/todo-panel.css`, `client/src/shell/TodosDrawer.tsx`, `client/src/shell/TodoForms.tsx`, `client/src/App.tsx`, `client/src/state/keys.ts`, `client/src/state/shell.ts`, `client/src/shell/contract.ts`, `client/src/shell/ShellProvider.tsx`, `client/src/styles/drawers.css`, `scripts/help-shots.ts`, their tests (incl. `TodosDrawer.*.test.tsx`), `help/*.md` to-do pages, `docs/design-system.md` |

Deps (Tiptap 3.32.2, exact) and `client/src/todo-doc/index.ts` stubs are already in place (lead).
| UX expert gate | `expert`, opus | domain gate | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `client/src/todo-doc/convert.test.ts` | round trip is exact for every feature in the counts above, mixed and nested; editing one block changes only that block; kept blocks survive edits around them; brain-style output for new content; unsafe link hrefs kept but not linked | A |
| `client/src/todo-doc/tasks.test.ts` | toggling the nth task item changes only that `[ ]`/`[x]` | A |
| `scripts/todo-roundtrip.ts` | dev-only: runs every live to-do body (read-only) through the round trip and lists any that differ; not in CI, never copies bodies into the repo | A |
| `client/src/shell/TodoPanel.test.tsx` | opens in read mode, Edit switches, Save sends only changed fields, tick while reading sends one details change, prev/next order, dirty guard, Esc and focus return, read-only users see only Mark as done | B |

## Gates

- [x] Type-check · [x] Tests · [x] Lint (0 errors) · [x] Build (preview on 3878, `/tmp/tba-preview-todo-panel/`)
- [x] `scripts/todo-roundtrip.ts` reports 0 differences on the live brain (173 bodies)
- [x] No unintended large deletions: only `TodoForms.tsx` (inline editor removed) and `TodosDrawer.tsx` (rework)
- [x] Domain gates: UX/UI expert; link handling checked by the correctness reviewer
- [x] Browser check: open, read, edit, Esc ask, sticky toolbar, view change, narrow window (600px), CSP.
      Not done in the browser: saving and ticking, which would write to the real, shared brain (covered by tests).

## Review outcomes

- **Overseer pre-review:** 3 blocking (exact round trip not proven by source copying; `add` carries no details;
  key clashes, `.dock` clipping and drafts lost on drawer swap) → plan revised (decisions 7 Hardened, 10–13, 16–20).
- **Correctness (Opus):** 4 confirmed, all fixed: search reveal of the to-do being edited dropped the draft;
  Start a chat in edit dropped the draft; heading ending in `#`; a changed list merging with its neighbour. Its
  probes also showed link hrefs with `)` or spaces, code edge spaces and mark-edge whitespace reading back
  differently: fixed.
- **UX expert (Opus):** 2 blocking + 8 should + 4 nice, all fixed (Start chat, invisible pressed state, tick boxes,
  focus ring, kept-block hint, aria-disabled Save, title size, one status region, side strip, disabled arrows,
  roving toolbar, slide direction).
- **Drift and copy (Sonnet):** Esc in Add closed without asking; stale help screenshots; missing E and
  Cmd/Ctrl+Enter in the shortcuts help → all fixed (screenshots regenerated from the demo brain).
- **Lead browser check:** Tiptap's injected `<style>` broke the CSP (`injectCSS: false`, rules in
  `todo-panel.css`); a view change left the panel over an inert page; Esc inside the editor did nothing; toolbar
  scrolled away; drawer drawn over the panel at narrow widths; table code wrapping per letter → all fixed. The fix
  round added a crash (`editor.view` read before mount) → fixed by the lead.
- **Fix-round re-review (Opus):** "Dr."/"OK." paragraphs fell back to escaping every punctuation mark → fixed in
  `escapeLineStart`; Add form Esc also closed the drawer → `preventDefault`; app-view change asked twice → fixed.
  Unclosed code fences now open read-only; comment-only kept blocks are hidden. Tests added for each.
- **Overseer sign-off:** signed off, no blockers. Its pre-merge shoulds were done: right dock `inert` while the
  panel is open; the editor's first document built once, not on every keystroke.
- **Known and accepted:**
  - When an edit would make two lists run together, the editor writes `<!-- -->` between them (the CommonMark way
    to end a list). Older app versions and the Workbench show it as raw text in the details. Seen only after an
    edit that needs it (33 of 1,033 simulated deletions on the live brain; none of 1,008 in-place rewrites).
  - `client/src/todo-doc/convert.ts` replaces Tiptap's internal `encodeTextForMarkdown` on its own instance.
    Tiptap is pinned at 3.32.2: **any Tiptap upgrade must re-run `node scripts/todo-roundtrip.ts`** and the
    todo-doc tests before merging.
  - 7 lint warnings in `todo-panel.css` from ProseMirror's base rules; the Add panel is full height with space
    below the form; editing a paragraph with a bare web address rewrites it as `[url](url)` (follow-up).
  - No unit tests for "Keep editing" after a view change, a double Save while busy, or the editor being
    re-created on previous/next (checked by code path and in the browser).
