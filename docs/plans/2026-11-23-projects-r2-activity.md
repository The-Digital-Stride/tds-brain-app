# Projects R2, phase 3: activity on the project home

Date: 2026-11-23 · Size: XL programme, phase 3 of 6 (L) · Branch: `projects-r2-activity` · Explainer: https://claude.ai/artifact/EZs8Q3qxjV1jAHJZ39tySh (programme)

Parent plan: `docs/plans/2026-11-20-projects-system.md`, Release 2 decision 28. Phase 2:
`docs/plans/2026-11-23-projects-r2-updates-log.md` (v0.66.0).

## Objective

Opening a project shows what changed since you last looked (to-dos added or done, files and links added,
notes, calls and status changes) and what's coming up (to-dos due soon, the project's end date). Meetings
join "Coming up" in phase 4.

## User decisions (fixed)

- Merge and push each phase once checks and reviews pass. Brain edits prepared in `brain-skills/` and copied
  into the brain as soon as the phase is merged (Ian, 2026-11-23), files only, never git.
- Every UI change follows `docs/design-system.md` and gets a UX/UI expert sign-off from screenshots before merge
  (Ian, 2026-11-23).
- Nothing from an email reaches a project without the inbox owner's approval (Ian, 2026-11-23). This phase only
  reads; it must not surface email content that bypassed that (it shows what's already in the project).

## Facts (from the code, 2026-11-23)

- Phase 2 auto entries already record status, health and Account Owner changes in `updates/`
  (`server/brain/project-updates.ts`, `ProjectUpdateItem.change/from/to`), so "status changes" need no git diff.
- The card has `links` (Linked files), `end`, `stages` (names only, no dates), `lastChanged` from `git log -1`
  (`shared/projects-contract.ts:120-175`, `server/brain/projects.ts:579`).
- Open project to-dos: `GET ROUTES.projectTodos` → `ProjectTodoRow {key, title, assignee, due, stage, mine}`
  (`shared/projects-contract.ts:601-616`). Done TDS to-dos move to `todo/done/<id>` (`server/brain/todos.ts:884`).
- Project files: `GET ROUTES.projectFiles` → `LibraryItem[]` (`shared/projects-contract.ts:588`).
- Read-only git runner with scrubbed env, timeout and output cap: `server/brain/todo-history.ts:20-60` (`runGit`).
- App-data stores with queued writes and "a bad read never wipes the file": `server/store/chat-places.ts`.
- The Overview tab: `client/src/apps/projects/ProjectPage.tsx:234` (`Overview`); `SheetTabs` items already
  take a `dot` (`ProjectPage.tsx:611`).

## Decisions

1. **Snapshot, not git.** When the person leaves a project page, the app saves what they had seen: the time,
   the open to-do keys, the card's links and the project's file paths (`ProjectSeen`, `project-seen.json` in the
   app data folder; capped like `chat-places.json`). "Since you last looked" compares now with that snapshot.
   This works the same for personal projects (not in git) and needs no git parsing. Git is used for nothing new.
   Plain: the app remembers what the project looked like last time you opened it, on your Mac only.
2. **What counts as a change.**
   - Updates log entries (phase 2) with `at` after `since`: notes and calls as `update`, automatic entries as
     `status`, with the writer's name.
   - To-dos: open now but not in the snapshot → `todo-added`; in the snapshot but not open now → `todo-closed`
     ("done" when `todo/done/<id>` exists, else "no longer in this project").
   - Links now but not in the snapshot → `link-added` (call notes, data pulls, ad files filed for the project).
   - Files now but not in the snapshot → `file-added`. A path both linked and in the folder shows once, as a file.
   - Removed links and files are not listed (quiet by design; the Files tab is the truth).
   Plain: new notes, to-dos opened or closed, and new files are listed; nothing is listed twice.
3. **First visit.** With no snapshot, `since` is null and the card says "Changes will show here from your next
   visit." (no backfill).
   Plain: the first time you open a project it starts keeping track.
4. **Marking seen.** The app posts `projectSeen` when the person leaves the project page or switches project,
   never on open, so the list stays put while they read it. A crash or quit just means it shows again next time.
   Plain: the list doesn't vanish the moment you open the page.
5. **Coming up.** Open project to-dos due within 14 days or overdue (overdue first, then soonest), and the
   project's `end` date when within 14 days or past while the project is still open. Stage end dates don't exist
   (stages have no dates), so they're left out; meetings arrive in phase 4.
   Plain: what's due soon on this project, at a glance.
6. **Where it shows.** Two cards at the top of the Overview tab: "Since you last looked" (up to 20 items, newest
   first, each a link: a to-do opens in the to-do panel, a file opens in its viewer, an update goes to the
   Updates tab; "N more" when cut) and "Coming up". Built from `.tray` / `.card` / `.line` rows and `StateNote`
   per `docs/design-system.md`. The Overview tab shows a `dot` when there's anything new. Archived projects show
   neither card.
   Plain: open a project and the top of its Overview tells you what's new and what's next.
7. **Privacy.** Personal to-dos and personal files only ever show in personal projects (the existing project
   readers already scope them). The snapshot holds keys and paths only, never text.
   Plain: nothing private shows in a shared project, and the remembered list holds no content.
8. **Backward compatibility.** New routes and a new app-data file only; no brain or script changes. An older app
   ignores `project-seen.json`.
   Plain: nothing changes in the brain, so every Mac keeps working.

### Open questions for the overseer

- Decision 4: is "mark seen on leaving" right, or should there be a visible "Mark as seen" too?
- Decision 6: should the Projects list also show a "changed since you looked" marker per project (cheap: compare
  `lastChanged.at` with `since`), or keep that for later?
- Decision 2: should `file-added` say who added it (one `git log -1` per new file, capped), or stay nameless?

## Contract

`shared/project-activity-contract.ts`. The lead adds `ROUTES.projectActivity` and `ROUTES.projectSeen` to
`shared/contract.ts` before builders start.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off (same agent as phases 1-2) | (read-only) |
| Builder A (server) | `builder`, sonnet | default | `server/store/project-seen.ts` (+test), `server/brain/project-activity.ts` (+test), `server/brain/index.ts`, `server/index.ts`, `server/http/routes.ts`, `server/http/projects-routes.test.ts` |
| Builder B (screens) | `builder`, sonnet | default | `client/src/apps/projects/ProjectActivity.tsx` (new, +test), `ProjectPage.tsx`, `client/src/api.ts`, `client/src/styles/projects.css`, `help/projects.md` |
| UX/UI expert | `expert`, opus | design-system gate (Ian's rule) | (read-only, screenshots) |
| Lead | me | small | contract, `shared/contract.ts`, plan, explainer |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/store/project-seen.test.ts` | set/get, queued writes, bad read never wipes, cap at PROJECT_SEEN_MAX (oldest dropped), list cap marks `cut` | A |
| `server/brain/project-activity.test.ts` | first visit → since null, no items; to-do added / done / gone; link and file added; a path both linked and a file shows once; updates after `since` only, auto entries as `status`; ordering and ACTIVITY_MAX/`more`; coming up (overdue first, 14 days, end date, done project none); archived → empty; personal items never in a shared project | A |
| `server/http/projects-routes.test.ts` | both routes through the real gate; seen body refuses extra fields; unknown key 404 | A |
| `client/src/apps/projects/ProjectActivity.test.tsx` | renders both cards; first-visit line; links open the right place; seen posted on leaving, not on open; Overview dot | B |

## Gates

- [ ] Type-check · [ ] Tests (FULL suite, help word caps) · [ ] Lint · [ ] Build
- [ ] No unintended large deletions vs merge-base
- [ ] Domain gates: UX/UI expert sign-off from screenshots (Ian's rule); security (new routes, app-data file)
- [ ] Browser check (throwaway brain): open a project, leave, add a to-do / note / link, reopen: listed; Coming up.

## Review outcomes

(filled at the end)
