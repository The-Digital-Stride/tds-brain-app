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
   **Departs from parent decision 28's "from git history"** (overseer upheld: works for personal projects and
   tells "new to me" from "edited"; risks: per Mac, no backfill). In-folder paths are stored relative to the
   project folder and the folder itself is kept, so a moved project counts as a first visit. Capped at 200 projects.
   Plain: the app remembers what the project looked like last time you opened it, on your Mac only.
2. **What counts as a change.**
   - Updates log entries (phase 2) with `at` after `since`: notes and calls as `update`, automatic entries as
     `status`, with the writer's name.
   - To-dos: open now but not in the snapshot → `todo-added`; in the snapshot but not open now → `todo-closed`
     ("done" when `todo/done/<id>` exists, else "no longer in this project").
   - Links now but not in the snapshot → `link-added` (call notes, data pulls, ad files filed for the project).
   - Files now but not in the snapshot → `file-added`. A path both linked and in the folder shows once, as a file.
   - Removed links and files are not listed (quiet by design; the Files tab is the truth).
   - Update rows say who and what kind only, never the summary or an email subject; unknown kinds read
     "added an update". The person's own changes are left out where the data says who. A gone to-do whose
     title isn't known is skipped. Files are nameless.
   Plain: new notes, to-dos opened or closed, and new files are listed; nothing is listed twice, and your own
   changes aren't listed back to you.
3. **First visit.** With no snapshot, `since` is null and the card says "Changes will show here from your next
   visit." (no backfill).
   Plain: the first time you open a project it starts keeping track.
4. **Marking seen (overseer blocker 1).** The activity read returns a `token`; the server holds exactly that
   read's snapshot. The app posts `projectSeen {key, token}` when the person leaves the project page or switches
   project, and only if the "Since you last looked" card was on screen. Something that synced in while the page
   was open stays unseen. No "Mark as seen" button (overseer). A crash or quit just shows it again next time.
   Plain: only what you actually saw is ticked off.
5. **Coming up.** Open project to-dos due within 14 days or overdue (overdue first, then soonest), and the
   project's `end` date when within 14 days or past while the project is still open. **Departs from parent 28:**
   stage end dates don't exist (stages are names only; dates would need a card format change), so they're left
   out (overseer upheld); meetings arrive in phase 4.
   Plain: what's due soon on this project, at a glance.
6. **Where it shows.** Two cards at the top of the Overview tab: "Since you last looked" (up to 20 items, newest
   first, each a link: a to-do opens in the to-do panel, a file opens in its viewer, an update goes to the
   Updates tab; "N more" when cut) and "Coming up". Built from `.tray` / `.card` / `.line` rows and `StateNote`
   per `docs/design-system.md`. The Overview tab shows a `dot` when there's anything new. Archived projects show
   neither card.
   Plain: open a project and the top of its Overview tells you what's new and what's next.
7. **Privacy (overseer blocker 2).** To-dos follow the To-dos tab exactly: a person's own personal to-dos show
   in a shared project to them only (`server/brain/projects.ts:773`); nobody else's ever do. The snapshot holds
   keys, paths and to-do titles on this Mac only, never note text. Update rows never show a summary or email
   subject, so nothing that bypassed the email rule can surface here.
   Plain: the list agrees with the To-dos tab, and nothing private reaches anyone else.
8. **Backward compatibility.** New routes and a new app-data file only; no brain or script changes. An older app
   ignores `project-seen.json`.
   Plain: nothing changes in the brain, so every Mac keeps working.

### Overseer pre-review (2026-11-23)

Blockers folded in: 1 (seen commits the shown read's snapshot via a token, only if the card was on screen;
decision 4) and 2 (personal to-dos follow the To-dos tab; decision 7). Rulings: snapshot upheld over git (a);
mark on leaving, no button; no Projects-list marker yet (lastChanged would disagree with the page; later, from
the same read); files nameless (b); stage end date dropped (c); update rows never show summaries or subjects,
unknown kinds "added an update" (d); two Sonnet builders fine with correctness review on Opus (e). Should items
folded in: leave out your own changes, skip nameless gone to-dos, relative paths + move = first visit, cap 200.
The email exception for phase 1's "save without asking" is already in the project-chat line (phase 2).

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
| `server/brain/project-activity.test.ts` | first visit → since null, no items; to-do added / done / gone (gone with no known title skipped); link and file added; a path both linked and a file shows once; updates after `since` only, auto entries as `status`, rows never contain the summary, unknown kinds "added an update"; own changes left out; ordering and ACTIVITY_MAX/`more`; coming up (overdue first, 14 days, end date, done project none); archived → empty, token null; own personal to-dos shown, others' never; moved project (folder differs) → first visit; token: commit saves the READ's snapshot not the current state, a superseded/expired/unknown token saves nothing | A |
| `server/http/projects-routes.test.ts` | both routes through the real gate; seen body refuses extra fields; unknown key → 204 nothing saved | A |
| `client/src/apps/projects/ProjectActivity.test.tsx` | renders both cards; first-visit line; links open the right place; seen posted with the token on leaving, not on open, and not when the card was never shown; Overview dot | B |

## Gates

- [ ] Type-check · [ ] Tests (FULL suite, help word caps) · [ ] Lint · [ ] Build
- [ ] No unintended large deletions vs merge-base
- [ ] Domain gates: UX/UI expert sign-off from screenshots (Ian's rule); security (new routes, app-data file)
- [ ] Browser check (throwaway brain): open a project, leave, add a to-do / note / link, reopen: listed; Coming up.

## Review outcomes

(filled at the end)
