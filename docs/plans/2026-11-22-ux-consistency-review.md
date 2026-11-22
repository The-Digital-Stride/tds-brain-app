# TDS Cortex: UX/UI consistency review and plan

Date: 2026-11-22 · App version reviewed: 0.62.0 (installed copy, 127.0.0.1:3877) and `main` at a292bd9
Status: **plan only, nothing changed.** Awaiting Ian's answers to section 6 before any build.

Team: two Fable expert reviewers (interaction and action placement; visual system and CSS), plus the lead's own
read-only walk through the live app. Every finding quoted below as "checked" was confirmed in code by the lead.
Paths are relative to `client/src/` unless they start with `docs/`.

---

## 1. Verdict in plain English

- **The basic pieces held up.** 244 of 284 buttons use the shared button styles; 42 of 46 inputs use the shared
  field, tick or switch; no stray shadows; one global focus ring; text contrast passes everywhere.
- **The *language* drifted, not the pieces.** Each tool answered the same questions on its own: what clicking a
  row does, where Edit and Delete go, whether a removal asks first, offers Undo or does neither, which side Save
  sits on, and what the X icon means. The design system never answered those questions, so each feature
  invented an answer.
- **The second tier of parts was rebuilt per tool.** Warning boxes, "are you sure?" strips, status dots, form
  labels, hint text, figure tiles and pop-up lists exist in 3 to 7 near-identical copies.
- **A handful of real bugs** turned up on the way (section 2). They're small and worth fixing first.

## 2. Real bugs to fix first (all checked in code)

| # | Bug | Where | What a user sees |
|---|---|---|---|
| B1 | Shell code uses classes defined only in `library.css`, which only loads with Documents, Images or Projects | `shell/ChatFiles.tsx:104-124`, `apps/shared/Viewer.tsx:28-60`; CSS in `apps/shared/library.css:94,333`; imported only by `apps/*/ui.ts:2` | The chat's Files tab and the viewer's "could not show" / text preview look different until you've opened a library app |
| B2 | `.todo-status` defined unscoped in two files; the panel's wins | `styles/drawers.css:432` vs `styles/todo-panel.css:274` (loads later, `main.tsx:11,18`) | The To-dos drawer's status line takes the panel's padding |
| B3 | `data-size="small"` on `.icon-btn` does nothing (only `.btn` has that rule; icon buttons use `data-size="28"`) | `tools/ad-manager/DeepDive.tsx:56,87,284`; `styles/base.css:252`; `styles/guide.css:191` | Ads deep-dive grip and full-width buttons render at 32px, not 28px |
| B4 | Project health shown by colour only; amber dot 2.45:1 on white | `apps/projects/ProjectList.tsx:64-71`; `--amber-edge` `styles/tokens.css:80` | A colour-blind person can't tell a red project from a green one in the list (WCAG 1.4.1, 1.4.11) |
| B5 | Home "Pinned to-dos" row starts a chat; the drawer and project page open the to-do to read | `shell/Home.tsx:229-238, 473` | Same to-do, two different results; the design system already calls this "surprising" (`docs/design-system.md:47`) |
| B6 | "Delete…" is red in one place and plain in another, same page | `apps/projects/ProjectPage.tsx:288` vs `:367` | Red doesn't reliably mean "careful" |
| B7 | Three-dots "Options" opens the read panel, not a menu | `shell/TodosDrawer.tsx:299-310` | Three dots promise a menu and give the page you could already open |
| B8 | Comment says Project Files rows behave like Documents; they don't (Documents row = select) | `apps/projects/ProjectFiles.tsx:37` | A file row opens in one place and only selects in another |
| B9 | To-do Undo never pauses on hover or focus, though focus is moved onto it; the file Undo does | `shell/TodosDrawer.tsx:115-149` vs `apps/shared/parts.tsx:464-474` | A keyboard or screen-reader user can lose the Undo mid-read (WCAG 2.2.1) |
| B10 | Unlink a project file: no message, no focus handling | `apps/projects/ProjectFiles.tsx:282-287` | The file just vanishes; keyboard focus drops to the page |
| B11 | Smaller visual bugs: `h4` in the triage pop-up gets the wrong font (`TriagePopup.tsx:88`); Ads note box has no top/bottom padding (`styles/ad-manager.css:381-386`); native `title` tooltip beside the app's own (`Approvals.tsx:167`); 3 browser-default tick boxes (`ProjectFiles.tsx:199`, `RemovePanel.tsx:225`, `TodoFiles.tsx:629`); confirm strips that focus the risky option (`TodoFiles.tsx:476-481`, `TodoPanel.tsx:624-626`); resize strip 20px wide, under the 24px minimum (`styles/viewer.css:43-47`) | | Small inconsistencies and keyboard/accessibility slips |
| B12 | ~100 lines of dead CSS for removed features (15 classes, e.g. `am-health`, `todo-delete`, `lib-viewer-bar`) | `styles/ad-manager.css:115-328`, `styles/drawers.css:288-366,425`, `library.css:239` | None directly; it misleads whoever edits next |

## 3. Action language: what's inconsistent (the main ask)

What I saw in the live app, confirmed by the interaction review:

| Action | How it appears today |
|---|---|
| **Create** | "New chat" primary button in the drawer **header** · `+` primary icon in the To-dos **filter row** · "New project" primary at the end of the **filter row** · "Add a to-do" **standard** button on the project tabs row · "Add a file" standard with `+` in the to-do panel |
| **Open** | Chat, skill, project rows: **whole-row click** · To-do: **title button** (row isn't clickable) · Documents/Images: row click **selects**, a hover **"Open"** button opens · Project Files: row click **opens** · Chat Files: row click **previews**, then "Open" · To-do file: **underlined name** · Ads: labelled button |
| **Edit** | Pencil icon on to-do rows · "Edit" button **bottom right** of the to-do panel · "Edit" button **beside the title, top left** of a project page · three dots "Options" when you can't edit |
| **Delete / remove** | Bin icon trailing (chat rows; document rows on hover) · red "Delete" **bottom left** of the to-do panel · bin in the file viewer header · **no delete** in the Documents details pane · "Archive…" / "Delete…" **inline beside the Status value** on a project page · "Unlink" (projects) vs X "Remove" (to-do files) |
| **Safety net** | Delete earlier chat: inline confirm · delete file: Undo line at top of page · delete to-do: Undo in the row · unlink file: nothing · remove to-do file: status line only · archive project: confirm panel |
| **The X icon** | Close a drawer or panel · **end a chat session** (Open chat rows, chat top bar) · detach a file from a to-do · remove a chip |
| **Footers** | Primary on the **left** (to-do add form, project form, Ads, permission card) · to-do panel puts Save on the **right** while editing but the primary on the left while reading |
| **Cancel with unsaved work** | Asks (project form) · never asks (to-do panel edit) · asks once a title is typed (to-do add) · silently discards (project to-do add) |
| **Favourite** | Called "Pinned" (Home cards), "Favourite" (button labels) and "Star a…" (hints). Star on chat, to-do and skill rows, file details and viewer; **not** on Home rows, file rows, the to-do panel or the chat page, so you can't unpin from the card that lists your pins |
| **Back / step** | "All projects" standard button, no chevron · "Back" quiet with chevron (Help, Chat Files) · to-do panel steps with up/down icons in the header · Ads proposal steps with "Previous / Next" text above the title |
| **Choose one of a few** | Seg everywhere, except radio buttons for 7 / 30 / 90 days in the Ads Account Summary (`SummarySheet.tsx:49`) |
| **Wording** | Close / Cancel / Dismiss for the same job; "Mark as done" vs "Mark done"; "Save" vs "Save changes"; "Add" vs "Add to-do"; an ellipsis on some buttons that open a further step but not others; "Clear filters" as a button in one place and a link in others |

## 4. Proposed design-system additions

These go into `docs/design-system.md` as a new **"Actions"** section (rules 1 to 10) plus a **component
catalogue** and **corrected scales**. Each rule follows what most of the app already does, so the change list
stays short. Sources: NN/g (confirmation dialogs, icon usability), Apple HIG (buttons, alerts), GOV.UK Design
System (button), WCAG 2.2 (3.2.4 consistent identification, 2.2.1 timing, 2.5.8 target size, 1.4.1, 1.4.11).

### 4.1 Action placement standard

1. **A row click opens what the row names, and never creates anything.** One named exception: in a list with a
   details pane (Documents, Images), the row click selects and a trailing "Open" opens it large. Project Files
   joins that exception (it has no pane today, so it keeps row click = open; fix the comment).
2. **Trailing order in a row, left to right:** star → the item's utility (Edit, Open, expand chevron) → remove
   (bin or X) at the very edge. At most three icons. Where the title is the opener and the row's main action
   is an icon (to-dos), that icon takes the edge and nothing destructive sits in the row. (This is what chat,
   skill, document and to-do rows already do.)
3. **One icon, one verb.**

   | Icon | Means only |
   |---|---|
   | X | put a surface away, or take a chip out of a set. Never ends running work |
   | bin | delete |
   | pencil | edit |
   | three dots | opens a menu, nothing else |
   | star | favourite |
   | speech bubble | start or open a chat |
   | chevron | disclose, step, or go back |
   | `wide` | full width (today it also means "Open full screen" in `Chat.tsx:205`) |
   | *new* end-chat icon | end a chat session (replaces X on Open chat rows and the chat top bar) |

4. **One safety net per kind of action.**

   | Kind | Pattern |
   |---|---|
   | Easily put back (unlink, detach, clear, star) | do it at once + a status line; focus moves to the next row |
   | Recoverable delete (to-do, file, chat to the Bin) | do it at once + **one shared Undo line**: 10 s, pauses on hover and focus, same place and look everywhere |
   | Stops running work or throws away typing | inline confirm strip, safe option focused, Esc keeps |
   | Permanent or structural (delete or move a project, apply to a live ad account) | a panel that spells out the consequences; type the name only for permanent deletion |

5. **Red marks the point of no return.** A button that leads to an Undo or a confirm stays neutral (bin icon or
   standard). The button that commits something with no Undo is danger. A constructive but irreversible step
   ("Apply now") stays primary behind a confirm.
6. **Button groups:** primary first on the left, then alternatives, then Cancel last (GOV.UK, and most of the
   app). **Panel footers** are the one named layout: item actions on the left (Start a chat, Mark as done,
   Delete), mode actions on the right (Edit while reading; Save and Cancel while editing).
7. **Create sits at the right end of the row it acts on**: the drawer's filter row, the sheet's tools row, the
   tabs row. Never in a dock header (move "New chat" out of the Chats header into the Open/Earlier row, as
   To-dos does), always primary, always with `+`.
8. **Edit is a pencil icon in rows and a labelled "Edit" (with pencil) in a panel or page, at the right end of
   the header band** (project page moves its Edit from beside the title to the right; the to-do panel keeps it in
   the footer per rule 6, the one exception, because the footer holds the mode switch).
9. **Unsaved changes:** every form asks "Discard your changes?" on Cancel, Esc, Back and close once anything
   has changed, in one strip under the header band.
10. **Header band order, right side:** item actions → star → bin → Help → previous/next → close, with close
    always last at top right (matches the viewer and to-do panel today).

### 4.2 Wording table

| Word | Use for | Replaces |
|---|---|---|
| Delete | the item leaves its list (with Undo, or Bin) | |
| Remove | taken out of a set, still exists | "Unlink" |
| Archive / Unarchive | hidden, kept | |
| Close | put a surface away | "Dismiss" on pickers |
| End chat | stop a session | X "Close chat" |
| Hide / Show | fold in place | |
| Dismiss | put a message away | |
| Cancel | leave without doing it | |
| Clear filters | always a button, never a link | "Show all projects", "Clear" link |
| Mark as done | complete a to-do | "Mark done" |
| New … / Add … | new = top-level thing; add = into a list or parent | |
| Save | always | "Save changes" |
| Favourite | the star, the card titles ("Favourite to-dos") and the hints ("Favourite a to-do to keep it here") | "Pinned …", "Star a …" (prefs key `pins` stays, for older app versions) |
| All {things} | back to a list: quiet small with chevron | standard "All projects" |
| Try again | always a standard button | links in `AskedList.tsx:135,171`, `TodoHistory.tsx:56` |
| No ellipsis | on any button; the confirm itself signals the next step | "Move…", "Archive…", "Delete…" |

### 4.3 Component catalogue: "use this, not that"

One owner file per piece; tools compose them and never restyle them.

| Need | Use | Instead of |
|---|---|---|
| Warning, error or info box | `.notice[data-level][data-shape]` | `.proj-banner`, `.error-banner`, `.update-banner`, `.offline-banner`, `.health-summary`, `.am-line`, `.home-skill` |
| "Are you sure?" strip | `Confirm` (promote `tools/ad-manager/Confirm.tsx` to `shell/`) | `.close-confirm`, `.todo-ask`, `.proj-ask`, `.am-confirm` |
| Undo line | one `UndoLine` | the two current builds |
| Status dot | `.dot[data-state="ok|warn|bad|idle|working|asking"]`, always with a visible word | `.attn-dot`, `.health-dot`, `.cc-dot`; and decide red = "problem" only (Ads board uses red for "Running") |
| Form field with label, hint, error | `.form-field` + `.label` + `.hint` + `.error`; style `[aria-invalid]` and `:disabled`; one `textarea.field` | `.todo-field`, `.proj-field`, `.am-field`, `.note-field` |
| Hint or meta text | `.hint` (12) and `.note` (13) | 20+ one-off classes |
| Pop-up list or menu | `.popover` + `.menu-row` | `.ss-pop`, `.cc-triage`, `.level-menu` and their rows |
| Headline figure | `.stat` in a `.card` | `.am-fact`, `.sm-fact` |
| "Show all N / Show fewer" | `ShowMore` | three builds |
| Panel header band | `.panel-head` (one inset, one centring) | five header builds with title insets of 14, 16 and 18px |
| Empty / loading / error | one `StateNote` (generalise `LibraryNotice`), one size, "Loading…" | 12/13/14px variants, three spellings |
| Text that acts | `.link-btn` (only inside a sentence) | `.cc-link`, `.todo-file-open` |
| One of a few | `Seg` | radios in Account Summary |
| Copy to clipboard | one `copyText` with feedback | three builds; Board's fails silently |

### 4.4 Corrected scales and new tokens

The doc's short lists contradict its own detailed specs, so nothing can be enforced today. Fix the lists to what
the app really uses, then make them tokens:

- **Radii:** 5, 6, 8, 9, 10, 12, 14, 16, 18 (16 = every glass layer; 12 = pop-ups).
- **Spacing:** 2, 4, 6, 8, 10, 12, 16, 24, 32.
- **Type:** the seven sizes plus 12.5 mono. Bring the rail (10/11px), the tour (rem), Ads figures (20/16px) and
  home/palette one-offs onto the scale.
- **New tokens** in `styles/tokens.css`: `--sp-*`, `--r-*`, `--fs-*`, named `--z-*` (see below),
  `--t-fast`/`--t-mid` (120ms is typed 31 times), `--surface` (for the 38 literal `#fff`), `--veil` (typed four
  times), `--state-*` for dots at 3:1 or better.
- **Layer scale (z-index):** name every layer (tour 200, tooltip 80, palette 70, skip link 60, viewer 50,
  pop-up 45, floating dock 41, veil 40, hover rail 39, docked to-do panel 8, rail and chat drawer 5) and add the
  rule "a pop-up always sits above the layer that hosts it" (today the to-do panel's project picker ties at 45 and
  wins only by DOM order).
- **Delete** the stale "Old tokens being retired" section (all retired tokens are gone) and the references to
  `LibraryBar` and `.lib-viewer-bar`.

### 4.5 CSS structure and a guard

- Adopt `@layer tokens, primitives, patterns, features, tools;`. Move shared pieces out of feature files
  (`.tray`/`.card-head` live in `home.css`; `.kv`, `.notice`, `.spinner`, `.close-confirm`, `.setting` in
  `chat.css`; `.link-btn` in `drawers.css`; `.icon-btn[data-size]` in `guide.css`) into `primitives.css` and
  `patterns.css`, loaded eagerly. Settings styles get their own `settings.css`.
- Add `styles/design-system.test.ts` (same style as `shell/icon-buttons.test.ts`), **frozen at today's counts and
  only allowed to go down**: font sizes, radii and z-index from the token sets; no raw colours outside
  `tokens.css`; no unscoped class defined in two files (catches B2); every CSS class used somewhere (catches
  B12); classes used by eager shell code defined in eager CSS (catches B1); `data-size` values from a known set
  (catches B3); checkboxes and radios carry `.tick` or `.switch`.

### 4.6 Other UX enhancements (smaller, worth doing as they come up)

- Unpin/unfavourite straight from Home's cards (star on hover), and a star in the to-do panel header.
- Delete in the Documents/Images details pane (bin in the action row, per rule 2), so the pane is complete.
- HTML documents show a generic icon in the details preview; a first-screen thumbnail would help recognition.
- Ads right panel opens with an empty "Choose a proposal" state; open it only when something is chosen.
- "Rate calls" panel repeats its title as the first heading, and its long form has no visible Save in view:
  give it the panel footer from rule 6.
- Project to-dos that aren't yours are plain text with no reason: add a meta line ("Assigned to Pete").
- Project list shows the health word (B4) and uses the same row meta order as other lists.
- The message box border at rest is about 1.4:1; raise it to 3:1 (WCAG 1.4.11).
- Ads load errors are grey where Projects uses red: errors always use the error notice.

## 5. Delivery plan

Four releases, smallest risk first. Each one follows the usual flow: its own worktree, plan in `docs/plans/`,
UX/UI gate before merge, a browser check on the preview (port 3878, own data folder), `wt-finish --merge`.
No brain data is touched by any of this; prefs keys stay as they are (backward compatibility).

### Release 1: fix what's broken + freeze the drift (patch, `fix:`)

Scope: B1 to B4, B6, B8 to B12 (B5 and B7 wait for Ian's answers, section 6). Plus the guard test from 4.5,
frozen at today's counts so nothing gets worse from here.

- B1: move file-stage and `lib-note/lib-failed/lib-file` rules into an eager sheet; delete the 47-line copy in
  `viewer.css:175-221`.
- B2: scope to `.todo-panel .todo-status`.
- B3: one `[data-size="small"]` rule for both `.btn` and `.icon-btn`; retire `data-size="28"` (4 ways today).
- B4: show the health word in the list; amber dots use `--attn-asking-edge` (3.19:1).
- B6, B9 to B12 as listed.
- Size M. Team: lead builds; one Sonnet UI/accessibility reviewer; UX gate. Tests: guard test, B2/B3 computed
  sizes, B9 pause on focus.

### Release 2: the action standard (minor, `feat:` only where behaviour is new, else `fix:`/`refactor:`)

Scope: write section 4.1 and 4.2 into `docs/design-system.md`, then bring every surface in section 3 into line.

- Row clicks (B5, Project Files comment), trailing order, the X/end-chat split, the three-dots fix (B7).
- One shared `UndoLine`; safety nets per rule 4; red per rule 5.
- Footers, Cancel/discard everywhere (rule 9), Create placement (rule 7), Edit placement (rule 8).
- Favourite wording and star coverage; Back and stepper; Seg for Ads periods; wording sweep; no ellipsis.
- Size L. Team: Fable overseer (UX), two Sonnet builders split by area (shell/drawers/Home vs
  projects/library/ads, disjoint files), Sonnet UI/accessibility reviewer, Opus correctness reviewer (Undo and
  focus logic), UX gate. Help pages (`help/`) updated where wording changes.

### Release 3: shared patterns (refactor, `refactor:`)

Scope: the component catalogue (4.3). Build `Confirm`, `Notice`, `Dot`, form field, `.hint`/`.note`,
`.popover`/`.menu-row`, `.stat`, `ShowMore`, `.panel-head`, `StateNote`, `copyText`; swap every copy over;
delete the old classes. The guard's numbers go down and get re-frozen.

- Size L. Team: Fable overseer (frontend design systems), two or three Sonnet builders by component family,
  Sonnet UI reviewer, numstat deletion scan (memory: a truncated CSS file once passed every gate).

### Release 4: tokens and CSS layers (refactor, `refactor:`)

Scope: 4.4 and 4.5. Add the tokens, correct the doc's scales, introduce `@layer`, move primitives out of
feature files, bring off-scale sizes onto the scale, tighten the guard to "zero raw values" per file as each
file is cleaned. This is also the groundwork for a dark theme later.

- Size L. Team: Fable overseer, Sonnet builders by stylesheet (disjoint), visual comparison of every screen
  before and after in the preview, UX gate.

Rough order of value: Release 2 is what you asked for; Release 1 is cheap and removes real bugs, so it goes
first; Releases 3 and 4 stop the drift coming back.

## 6. Decisions for Ian

1. **Home "Pinned to-dos" click**: open the to-do panel (consistent with everywhere else; the chat button stays
   on the row) — *recommended* — or keep it starting a chat.
2. **Ending a chat**: give it its own icon and the words "End chat" (X then only ever closes panels) —
   *recommended* — or keep X.
3. **Pinned vs Favourite**: "Favourite" everywhere, matching the star — *recommended* — or "Pinned"
   everywhere.
4. **Deleting an earlier chat**: keep the inline "are you sure?" (it goes to the Mac's Bin) or switch to the
   shared Undo line like files and to-dos — *recommended: Undo*, for one pattern.
5. **Red buttons**: red only for things with no Undo — *recommended* — which makes the to-do panel's Delete a
   standard button; or keep red on every Delete.
6. **"New chat" placement**: move from the Chats header to the end of the Open/Earlier row like To-dos and
   Projects — *recommended* — or leave it in the header.
7. **Scope**: all four releases, or Release 1 and 2 now and 3 and 4 later.
