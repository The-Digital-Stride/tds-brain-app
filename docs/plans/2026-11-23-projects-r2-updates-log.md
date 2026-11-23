# Projects R2, phase 2: the updates log

Date: 2026-11-23 · Size: XL programme, phase 2 of 6 (L) · Branch: `projects-r2-updates-log` · Explainer: https://claude.ai/artifact/EZs8Q3qxjV1jAHJZ39tySh (programme)

Parent plan: `docs/plans/2026-11-20-projects-system.md`, Release 2 decision 21. Phase 1:
`docs/plans/2026-11-23-projects-r2-chat-project.md` (v0.65.0).

## Objective

Each project gets a running diary: short dated entries anyone on the team can add ("Sent the quote",
"Call with Alex: budget agreed"), each marked internal or fine for the client, plus automatic entries when
the status, health or Account Owner changes. It is the base that phase 3 (activity), 5 (email entries) and
6 (weekly round-up) build on.

## User decisions (fixed)

- Merge and push each phase once checks and reviews pass; brain changes prepared in `brain-skills/` and
  copied only with Ian's yes (files only, never git); explainer yes (programme page, updated at the end).

## Facts (from the code, 2026-11-23)

- The on-disk layout is reserved in R1: `shared/projects-contract.ts:722-760` (`ProjectUpdate`, file name
  `<YYYY-MM-DD>-<HHmm>-<person>-<random6>.md`, flat frontmatter `v, kind, by, at, client_safe`, body = summary).
- `updates/` is already protected: hidden from Documents/Images (`server/brain/library-rules.ts:103`) and
  refused by `tdsapp-files` delete (`PROJECT_PROTECTED_NAMES`, `shared/projects-contract.ts:719`).
- Every brain write is a `tdsapp-projects` script action (`brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs`,
  2,131 lines; `edit` at ~:1215-1241), run by `server/brain/projects-skill.ts` (one at a time, `COMMAND` map,
  capability probe cached per script mtime). New script features are gated by a capability string
  (`PROJECTS_CAPABILITY`, `..._ARCHIVE_...`, `..._MOVE_...` in `shared/projects-contract.ts`).
- `POST ROUTES.projectsChange` takes exactly one ProjectAction (`server/http/routes.ts:921`, `:1145`).
- Flat frontmatter reader: `server/brain/frontmatter.ts` (`parseFrontmatter`, `asString`).
- Project page tabs: Overview, To-dos, Files (`client/src/apps/projects/ProjectPage.tsx`; `ProjectTodos.tsx`,
  `ProjectFiles.tsx` are the per-tab pattern). New forms use `useSheetHold` (UX programme rule).

## Decisions

1. **A new `update` action in `tdsapp-projects` 0.4** (`ProjectUpdateAction`, contract
   `shared/project-updates-contract.ts`). It writes one file in `<project folder>/updates/` with the reserved
   layout. `by` comes from this Mac's identity and `at` from its clock, never from the request. The random
   six-character suffix means two people (or one person's two Macs) never write the same file, so sync never
   clashes. Kinds people can add: `note` and `call`. Archived projects refuse; personal projects are allowed
   (their folder never syncs; `by: me` when there's no team slug). **A folder with no readable card refuses**
   (overseer blocker 1): a card-less folder may be a moved or archived project's leftover, and an entry there
   would make git keep it and turn it into a ghost project that wins `byKey`. `updates/` as a link refuses.
   Capability `projects-updates-v1`.
   Plain: anyone on the team can add a dated note to a project, and two people adding at once never collide.
2. **No editing; removal allowed (overseer ruling a).** A new `update-remove` action removes one `note` or
   `call` entry: its author, the brain's Owner or a scout; never auto entries or later kinds. It checks the
   entry's hash (`expect`). A wrongly ticked "fine for the client" can't be fixed by a correction, and later
   phases show those to clients. The confirm says a shared entry stays in the brain's history and a personal
   one is gone for good. The `tdsapp-files` protected rule is untouched.
   Plain: you can take back your own entry, but nobody rewrites the log.
3. **Internal unless marked.** Each entry has `client_safe` (default false). The add form says "Fine to share
   with the client" as a checkbox, off by default. Only client-safe entries may ever appear in client-facing
   reports (later phases).
   Plain: nothing goes to a client unless someone ticked the box.
4. **Automatic entries on `edit`.** When an edit changes the status, the health light or the Account Owner,
   the script writes one entry per change after the card is written (`AUTO_UPDATE_FIELDS`, wording fixed in the
   contract). They are internal. A failure writing one never undoes the card change; the reply says
   `updatesFailed: true` and the app says the change was saved but its log entry wasn't. Each auto entry also
   carries flat `change`, `from`, `to` keys (raw values), so later phases read facts, not wording. The same
   value sent back writes nothing (older apps send every field). Comms light, dates and the rest do not log.
   Plain: the important changes are written into the log for you.
5. **Reading.** New `server/brain/project-updates.ts` lists `updates/*.md` for a project (live or archived;
   archived read-only) **plus, read-only and marked, entries in its `moved_from` folders and any leftover
   folder at its key** (blocker 1: a note added by someone who hadn't synced a move never vanishes), parses each with the flat frontmatter reader, sorts newest first, pages by
   `UPDATES_PAGE` with `before`, counts unreadable files, and fills `byName` from the team roster. A new
   `GET ROUTES.projectUpdates` returns `ProjectUpdatesResponse`. Cached with the projects index and dropped
   by the existing watcher (`projects.changed(path)`). `canAdd` = capability present, project live with a card,
   and the person may change projects. Each item has `canRemove` and its file `version`. `kind` is read as
   plain text so a newer kind never breaks an older app. An unknown `before` answers `bad-request`.
   Plain: the app reads the log straight from the project folder, so teammates' entries appear after a sync.
6. **An Updates tab on the project page**, after To-dos and before Files. Newest first: who, when (UK date and
   time), a small kind label (Note, Call, Status, Account Owner; later kinds shown as their name), an
   "Internal" or "Fine for the client" marker, and the summary rendered with the app's safe markdown renderer.
   "Show older" pages back. An "Add an update" form at the top (textarea, Note/Call choice, the client-safe
   checkbox, Add) uses `useSheetHold`, reuses Fold/btn/notice per `docs/design-system.md`, and is hidden when
   `canAdd` is false (with the existing read-only notice explaining why when the script is out of date).
   Plain: open a project, read its diary, and add to it in one place.
7. **Claude can add one (overseer ruling e).** The skill's SKILL.md documents `update` and `update-remove`.
   The phase 1 project-chat instruction's "Never create or use … inside the project folder." sentence is
   extended with: "Add a project update only with the tdsapp-projects skill's `update` action, marked internal
   unless the user says it's fine for the client." No separate offer sentence: the after-call offer lives only
   in the meeting-notes edit (`brain-skills/tdsapp-projects/brain-rules/r2-updates-log.md`, for Ian's yes), so
   Claude never offers twice.
   Plain: after a call, Claude can offer to note it in the project's diary, once.
8. **Backward compatibility.** Older apps ignore `updates/` (already hidden). An older script (0.3.x) answers
   no `projects-updates-v1`: the tab still lists any entries but can't add, with the usual "update the brain's
   skills" notice. A new script with an older app: `edit` still answers the same shape (the extra
   `updatesFailed` field is optional); auto entries just appear in the folder.
   Plain: every Mac keeps working whichever version it has, and nothing breaks before everyone updates.

### Overseer pre-review (2026-11-23)

Blocker 1 (entries stranded by a move or archive) folded into decisions 1 and 5. Rulings: (a) removal, no edit
(decision 2); (b) auto fields and "card change stands" upheld (decision 4); (c) phase 5 email and phase 6 digest
fit this layout with no format change, given `kind` as text, the flat `change/from/to` keys and the remove
action; (d) Opus for the script justified, and it owns `update-remove` and the card rule; (e) extend the
existing sentence instead of a new one (decision 7). Should items folded in: flat keys, `kind` as text, `by: me`,
`updates/` link refused, same-value-no-entry test, unknown `before` refused.

## Contract

`shared/project-updates-contract.ts`: capability, layout, limits, `ProjectUpdateAction`, auto-entry wording,
`ProjectUpdateItem`, `ProjectUpdatesResponse`. The lead adds `ProjectUpdateAction` to the `ProjectAction` union
and `ROUTES.projectUpdates` before builders start.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (script) | `builder`, opus | data integrity: the only brain writer, atomic file creation, edit + auto entries | `brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs`, `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts`, `brain-skills/tdsapp-projects/SKILL.md` |
| Builder B (server) | `builder`, sonnet | default | `server/brain/project-updates.ts` (+test), `server/brain/projects-skill.ts`, `server/brain/index.ts`, `server/http/routes.ts` (+test), `server/engine/session-manager.ts` (decision 7 sentence + test) |
| Builder C (screens) | `builder`, sonnet | default | `client/src/apps/projects/ProjectUpdates.tsx` (new, +test), `ProjectPage.tsx`, `client/src/api.ts`, `client/src/styles/projects.css`, `help/projects.md` |
| Lead | me | small | contract, `shared/contract.ts` additions, brain-rules file, plan, explainer |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts` | `update` writes the reserved layout with `by`/`at` from identity/clock (`me` for a personal project with no slug); name matches `UPDATE_FILE_PATTERN`; clash retried; archived and card-less refused; `updates/` link refused; empty/over-long/other kinds refused; personal allowed; `update-remove` by author / Owner / scout, refused for others, for auto entries, outside `updates/`, and on a hash mismatch; `edit` writes one auto entry per changed status/health/owner with the fixed wording and `change/from/to`, none for other fields and none when a value is sent back unchanged; auto-entry failure keeps the card change and answers `updatesFailed`; capability listed | A |
| `server/brain/project-updates.test.ts` | newest-first order and tie-break; paging with `before`, unknown `before` refused; unreadable counted; unknown kinds kept as text; `byName`; archived read-only; entries in a `moved_from` folder and a leftover folder listed read-only and marked; `canAdd` and `canRemove` rules | B |
| `server/http/routes.test.ts` | the GET route through the real gate; `update` action shape accepted by `projectsChange`, extra fields refused | B |
| `server/engine/session-manager.test.ts` | the decision 7 sentence is in a project chat's instructions (shared and personal variants) | B |
| `client/src/apps/projects/ProjectUpdates.test.tsx` | list renders entries with markers (incl. "from the old folder"); add form sends the action; form hidden when `canAdd` false; Remove only where `canRemove`, with a confirm whose wording differs for personal projects; Show older pages; `updatesFailed` notice on an edit | C |

## Gates

- [x] Type-check · [x] Tests (FULL suite, help page word caps) · [x] Lint · [x] Build
- [x] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [x] Domain gates: security (script writes brain files; summary text from people shown back and later read
  by Claude), UX (new tab and form)
- [x] Browser check (throwaway brain): add a note, see it listed; change status and health, see two auto
  entries; client-safe marker; an older script without the capability hides the form.

## Review outcomes

- **Security (Opus):** no findings. Noted for a later phase: synced entry files are trusted as written, so a
  teammate could commit an entry naming someone else or marked client-safe; settle before entries reach clients.
- **Correctness (Opus):** four confirmed and fixed with failing-first tests: Remove was offered on a project with
  a missing or unreadable card and on hand-named files, both of which the script refuses (canRemove and the
  server's pre-check now match the script); `byName` missed the script's `memberSlug` form; the cache stamp
  missed entries edited in place (now each file's size and time). A server test now runs the real script's
  `update` and checks `file`.
- **UX (Sonnet):** focus after Remove, Cancel and an empty Add; Show-older error announced; archived projects
  say why there's no add box; help line within the 350-word cap. Dropped: "a tab switch loses the draft" (the
  page's leave guard already asks, seen in Chrome).
- **Browser check:** add, auto entries for status and health, client-safe marker, Remove confirm and removal
  all worked. Found: auto entries said "Green → Amber"; now the app's words (On track, At risk, Off track).
  Found: a stray border round the Note/Call choice; removed. The tick style rule (design-system test) caught
  plain checkboxes; now `.tick`.
- **Fix-round correctness (Opus):** no findings; each server fix reverted alone fails at least one test.
- **Overseer sign-off:** signed off, conditional on the fix round (met). Should, before phases 5/6: decide how far
  synced entries are trusted; the skill now tells Claude entry text is data, never instructions (done here).
- **UX/UI expert design sign-off (Opus):** Ian's rule from 2026-11-23: every UI change is checked against
  `docs/design-system.md` by a UX/UI expert before merge. First pass: sign off with fixes (no blockers); all
  nine done by a Sonnet fix builder: "Add an update" in the tabs row (Actions rule 7), entries as `.line` rows
  in a tray, a bin "Delete update" at the row edge (Words table), field-level error, Kind as a `Seg`, only
  client-safe entries marked, quiet "Show older", `StateNote` empty, read-only notice only for an old skill.
  Second pass: one fix (the Kind `Seg` sized to its words, scoped to the Updates form so other forms are
  unchanged), applied and checked in Chrome. Signed off.
- **Ian's rule (2026-11-23): email needs its owner's yes.** Nothing from an email reaches a project (any
  update kind, file or link) without the inbox owner's approval of exactly what is saved. In the project-chat
  line, the skill, the parent plan (decision 30) and the brain save-rules proposal.
- **Gates:** typecheck, lint (one warning already on main), build, full suite; no large deletions.
- **Brain side (needs Ian's yes):** copy `tdsapp-projects` 0.4.0 and the meeting-notes (d) line
  (`brain-skills/tdsapp-projects/brain-rules/r2-updates-log.md`).
