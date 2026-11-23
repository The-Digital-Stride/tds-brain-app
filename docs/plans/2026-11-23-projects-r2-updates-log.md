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
   (their folder never syncs); card-less folders are allowed. Capability `projects-updates-v1`.
   Plain: anyone on the team can add a dated note to a project, and two people adding at once never collide.
2. **Entries are append-only in phase 2.** No edit or delete. A mistake is fixed by adding a correction.
   (Overseer to rule; see the open question below.)
   Plain: the log is a record; nothing in it changes behind anyone's back.
3. **Internal unless marked.** Each entry has `client_safe` (default false). The add form says "Fine to share
   with the client" as a checkbox, off by default. Only client-safe entries may ever appear in client-facing
   reports (later phases).
   Plain: nothing goes to a client unless someone ticked the box.
4. **Automatic entries on `edit`.** When an edit changes the status, the health light or the Account Owner,
   the script writes one entry per change after the card is written (`AUTO_UPDATE_FIELDS`, wording fixed in the
   contract). They are internal. A failure writing one never undoes the card change; the reply says
   `updatesFailed: true` and the app shows a notice. Comms light, dates and the rest do not log.
   Plain: the important changes are written into the log for you.
5. **Reading.** New `server/brain/project-updates.ts` lists `updates/*.md` for a project (live or archived;
   archived read-only), parses each with the flat frontmatter reader, sorts newest first, pages by
   `UPDATES_PAGE` with `before`, counts unreadable files, and fills `byName` from the team roster. A new
   `GET ROUTES.projectUpdates` returns `ProjectUpdatesResponse`. Cached with the projects index and dropped
   by the existing watcher (`projects.changed(path)`). `canAdd` = capability present, project live, and the
   person may change projects.
   Plain: the app reads the log straight from the project folder, so teammates' entries appear after a sync.
6. **An Updates tab on the project page**, after To-dos and before Files. Newest first: who, when (UK date and
   time), a small kind label (Note, Call, Status, Account Owner; later kinds shown as their name), an
   "Internal" or "Fine for the client" marker, and the summary rendered with the app's safe markdown renderer.
   "Show older" pages back. An "Add an update" form at the top (textarea, Note/Call choice, the client-safe
   checkbox, Add) uses `useSheetHold`, reuses Fold/btn/notice per `docs/design-system.md`, and is hidden when
   `canAdd` is false (with the existing read-only notice explaining why when the script is out of date).
   Plain: open a project, read its diary, and add to it in one place.
7. **Claude can add one.** The skill's SKILL.md documents `update`. The phase 1 project-chat instruction gains
   one sentence: "When the user asks you to log progress on this project, or after you file a call note for it,
   offer to add a short update with the tdsapp-projects skill's `update` action, marked internal unless the
   user says it's fine for the client." Brain-side: a one-line meeting-notes edit prepared in
   `brain-skills/tdsapp-projects/brain-rules/r2-updates-log.md` for Ian's yes.
   Plain: after a call, Claude can offer to note it in the project's diary.
8. **Backward compatibility.** Older apps ignore `updates/` (already hidden). An older script (0.3.x) answers
   no `projects-updates-v1`: the tab still lists any entries but can't add, with the usual "update the brain's
   skills" notice. A new script with an older app: `edit` still answers the same shape (the extra
   `updatesFailed` field is optional); auto entries just appear in the folder.
   Plain: every Mac keeps working whichever version it has, and nothing breaks before everyone updates.

### Open question for the overseer

- Decision 2: append-only, or let the author delete (or edit) their own `note`/`call` entry within a short
  window? Delete would need a script action and the protected-name rule loosened for that one case.

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
| `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts` | `update` writes the reserved layout with `by`/`at` from identity/clock; name matches `UPDATE_FILE_PATTERN`; clash retried; archived refused; empty/over-long/other kinds refused; personal and card-less allowed; `edit` writes one auto entry per changed status/health/owner with the fixed wording, none for other fields; auto-entry failure keeps the card change and answers `updatesFailed`; capability listed | A |
| `server/brain/project-updates.test.ts` | newest-first order and tie-break; paging with `before`; unreadable counted; unknown kinds kept; `byName`; archived read-only; `canAdd` rules | B |
| `server/http/routes.test.ts` | the GET route through the real gate; `update` action shape accepted by `projectsChange`, extra fields refused | B |
| `server/engine/session-manager.test.ts` | the decision 7 sentence is in a project chat's instructions | B |
| `client/src/apps/projects/ProjectUpdates.test.tsx` | list renders entries with markers; add form sends the action; form hidden when `canAdd` false; Show older pages | C |

## Gates

- [ ] Type-check · [ ] Tests (FULL suite, help page word caps) · [ ] Lint · [ ] Build
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (script writes brain files; summary text from people shown back and later read
  by Claude), UX (new tab and form)
- [ ] Browser check (throwaway brain): add a note, see it listed; change status and health, see two auto
  entries; client-safe marker; an older script without the capability hides the form.

## Review outcomes

(filled at the end)
