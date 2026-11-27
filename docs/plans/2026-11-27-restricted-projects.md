# Restricted projects: seen only by the project's team

Date: 2026-11-27 · Size: L · Branch: `restricted-projects` · Explainer: to follow (Ian said yes)

## Objective

A shared project can be marked **Restricted**. In Cortex it is then seen only by its Account Owner, its team,
and every owner and scout. Everyone else sees no trace of it: not in Projects, search, Home, pickers, tasks,
files, meetings or the chat assistant's notes. This is the app hiding it, not a lock: the folder still syncs
to every Mac through the brain. A stronger answer comes later (Ian, 2026-11-27).

## User decisions (fixed)

- Hide in Cortex only for now; a real lock is a later piece of work (Ian, 2026-11-27).
- Owners and scouts always see every project, and a restricted one is marked "Restricted" for them (Ian).
- A task in a restricted project can't be given to anyone outside it; the form says to add them to the
  project first (Ian).
- Visual explainer: yes. Merge and push once built, reviewed and checked in the browser: approved (Ian).
- Standing rules: the app never writes brain files (script only); backward compatibility first; UK English in
  copy; help page, picture and What's new in the same branch; UX/UI expert sign-off.

## Facts checked (2026-11-27)

- The brain has no per-person read control on shared files. Roles (`.team-config/roles.json`: owner, scout,
  team) gate writing and some skills only. `personal/` is one-person private. All 26 project cards already
  carry `owner` and `team`.
- The app reads cards itself (`server/brain/projects.ts` `walk()` → `load()` → `makeIndex`); only writes go
  through `tdsapp-projects.cjs` (v0.8.0, features via `capabilities`). The script keeps unknown frontmatter
  keys on edit.
- The server serves one person: `readIdentity(root, run)` is this Mac's identity and is already wired in
  `server/brain/index.ts`.
- `projects.index()` (no identity) feeds updates, email drafts, activity, meetings, business, the library's
  project stamp and `projectFiles`, the three to-do lists, `teamTodo`, the session manager and chat-summary
  save. `projects.list(identity)` feeds `/api/projects` and `savableCard`.
- The library lists client folders itself, so a project's files show there without the index.
- Chat sessions run with `cwd: brainRoot` and already have `PreToolUse` guard hooks
  (`draftsGuardHook`, `changeGuardHook`, `server/engine/session-manager.ts:2619`).
- To-do assignment runs through `changeTodo` (`server/brain/todos.ts`, wired at `server/brain/index.ts:312`).
- The script already has the permission rule we need: `ownerChangeRule` (Account Owner, owner or scout).

## Decisions

1. **One line on the card: `visibility: restricted`.** No line means everyone, as today. Placed after `team`.
   Any value other than empty or "everyone" reads as restricted (`parseVisibility`).
   Plain: a project is open unless its card says otherwise, and a typo can never open a restricted one.
2. **One rule, in one file: `shared/project-visibility.ts`.** `canSeeProject(card, viewer)`: open → everyone;
   restricted → Account Owner, team (either slug form), and any known owner or scout. Someone the roster
   doesn't know sees no restricted project. Personal projects are never restricted. Already written with 19
   tests.
   Plain: the server, the screens and the brain script all ask the same question the same way.
3. **Hide at the source.** `createProjects` takes `viewer: () => Promise<Identity>`. `load()` splits the
   walked cards into seen and hidden and builds the index from the seen ones only, so every reader that goes
   through `index()` or `list()` treats a hidden project as one that doesn't exist. The index gains
   `hiddenPath(rel)` and `hiddenCount`, and `resolve()` answers `{how:'restricted'}` for a hidden project's
   label. Labels and project codes are resolved from all cards first and masked afterwards, so nothing
   resolves differently per person. `duplicates`, `leftovers` and `skippedFolders` leave out hidden folders,
   `hiddenPath` covers a hidden project's duplicate, leftover and moved-from folders too, and a visible
   card's links into a hidden folder are stripped. `change`, `move` and `remove` refuse a hidden key
   (`hiddenKey`, old moved-from keys included) as not found before the script runs, because script 0.8.0
   would otherwise act on it. `viewer` missing or failing means an unknown viewer.
   Plain: instead of teaching fifteen screens to hide the project, the list they all read from never
   contains it.
4. **When unsure, hide.** A card is restricted when its `visibility` value says so (`parseVisibility` on
   the raw value) or its frontmatter text has such a line (`rawTextRestricted`, which also catches
   `Visibility:` and a key doubled by a merge). An unreadable card with that line is restricted with nobody
   on it: owners and scouts see it (to fix it), nobody else does. If the index itself can't be read, the
   library hides every project folder and the task lists hide project-labelled tasks that aren't yours.
   Plain: a sync clash in the card can't suddenly show the project to everyone.
5. **Files.** The library leaves out anything under a hidden project's folder (`index.hiddenPath`) from
   every listing, search, Recent, starred and by-id read (thumb, text, page, PDF, file), and refuses an
   upload or delete aimed there as not found. The filter runs when a listing is served, never inside a
   cached listing or the search index. A file linked into the project from elsewhere stays where it is
   and stays visible; it just loses that project's stamp.
   Plain: a hidden project's files don't turn up in Images, Documents, search or Home.
6. **Tasks: one rule.** A task whose project is hidden from you is served, opened or changed only when
   it is assigned to you (in Asked: only when you asked for it). It then shows a "Restricted project" chip
   that links nowhere, with no project or stage text. The rule covers the Open list and its counts, Done,
   Asked, a teammate's task by id, a task's history, ticking it off and every change. Such labels never
   reach the tidy-up.
   Plain: you keep your own tasks, but you learn nothing about the project from them, and you can't open
   anyone else's.
7. **The assign block.** The server refuses, before the to-do script runs, any change that would leave a
   task in a restricted project with a person who can't see it (`canTakeTask`): `add` with a project,
   `assignee`, `project`, and `move` to TDS with a project. Message: "<Name> isn't on this restricted project.
   Add them to the project team first, then give them the task." People who can see it include owners and
   scouts, since they see everything. Unassigned is allowed. The pickers show the same people as unavailable
   with the same note, using `ProjectList.seesAll`. The server asks `projects.assignCheck(place, assignee)`,
   which reads all cards and ignores who is asking, so an outsider passing on their own task gets the same
   note.
   Plain: you can't hand a hidden project's task to someone who can't see the project; the form tells you to
   add them first.
8. **Who can switch it.** The Account Owner, an owner or a scout (the script's `ownerChangeRule`, the same
   rule as changing the Account Owner). The script is the authority; the app shows the control only when
   `canRestrict` and `mayRestrict(card, identity)`. Creating a restricted project adds its creator to the
   team unless they would see it anyway.
   Plain: a team member can't hide a project from the people running the agency, and can't lock themselves
   out by accident.
9. **Switching on warns first.** Turning Restricted on shows who will stop seeing the project (people with
   open tasks in it who aren't on it, by name) and says their tasks stay with them. It doesn't move tasks.
   Removing someone who still has open tasks from a restricted project's team shows the same warning.
   Plain: no surprises: you see who is affected before you confirm.
10. **The mark.** A "Restricted" badge (existing chip style, lock icon from the icon set) next to the title
    on the project list row, the project page header, the pickers, search rows and Home's Recent projects.
    The project form gets "Who can see it": "Everyone on the team" / "Only the project team", with the line
    "Hides this project in Cortex. Its files are still in the brain on every Mac."
    Plain: anyone who can see a restricted project is told it is restricted, and what that does and doesn't
    mean.
11. **The chat assistant.** Hidden projects never appear in the notes Cortex gives the assistant (follows
    from decision 3). A new `PreToolUse` guard denies Read, Grep, Glob, Edit, Write and NotebookEdit aimed at
    a hidden project's folder, and Bash commands that name it, with "That project is restricted to its
    team." It is in this release, in both `PreToolUse` arrays, matches the full folder path only, and isn't
    installed when nothing is hidden. It is a guard rail: a broad search from the brain's root, or a brain
    skill run in chat (such as /gm), can still surface a line from those files, and creating a project
    with the same name answers "that name already exists". The help page says all three.
    Plain: the assistant won't open a hidden project's folder when asked, but this is the weakest part and
    is described honestly.
12. **Codes and links.** A hidden project's code (TDS6A5) in text resolves to nothing and shows as plain
    text, like an unknown code. Direct routes by key answer not found. Nothing answers "restricted" to
    someone who can't see it, except their own task's chip (decision 6).
    Plain: the app doesn't confirm a hidden project exists.
13. **Backward compatibility.**
    - Old cards: no line, so nothing changes.
    - New app, old script (0.8.0): hiding still works (the app reads cards itself); the switch isn't shown
      (`projects-visibility-v1` missing). The old script keeps the `visibility` line when it edits a card.
    - New card, old app: **an older Cortex ignores the line and shows the project to everyone.** The
      restriction holds only for people on this version or later. Said in the help page and to Ian in the
      finish report; the switch's confirm text says "People on an older Cortex still see it until they
      update."
    - Other readers of `project.md` (Command Centre, `/gm`, brain skills) ignore an unknown key.
    Plain: nothing old breaks, but hiding only works once everyone has updated.
14. **Script 0.9.0.** `visibility` field on `create`, `card`, `edit`; the who-may rule; `not-found` for any
    change to a restricted card by someone who can't see it; capability `projects-visibility-v1`. Brain rules
    text (one new paragraph for `clients/AGENTS.md` and one line for `todo/AGENTS.md`) goes in
    `brain-skills/tdsapp-projects/brain-rules/restricted-projects.md` for Ian to paste; the tooling never
    writes the brain. The to-do script is not changed: the assign block lives in the app this release.
    Plain: the terminal obeys the same who-may-switch rule; the task block is Cortex-only for now.
15. **Help, What's new, tour.** New help page `help/restricted-projects.md` (in `client/src/help/topics.ts`),
    one picture (`pnpm help:shots --only restricted-projects`), `help/whats-new/0.95.0.md` and the
    `whats-new.test.ts` update. The tour is left alone (overseer: a control inside a form is not a new
    place; What's new covers it).
    Plain: people are told the feature exists and exactly what it does not protect.

## Overseer pre-review (2026-11-27)

Three blocking points, all folded in above: the task rule now covers Done, Asked, by-id, history and every
change (decision 6); writes on a hidden key are refused before the script runs (decision 3); the assign
block has a written hand-over, `projects.assignCheck` (decision 7, contract). Should-fixes folded in:
mask after resolving, fail closed, serve-time file filter, five more script actions.

Its decisions on the open questions:

- A. The assistant's guard hook ships in this release. Plain: the assistant refuses to open a hidden
  project's folder from day one.
- B. No to-do script change now. Plain: the terminal can still hand such a task to an outsider; they see it
  without project details.
- C. No tour bump. Plain: nobody is shown the whole tour again for one switch.
- D. Warn on removing someone with open tasks. Plain: you are told first.
- E. A hidden project's code shows as plain text. Plain: it looks like any unknown code, so nobody can
  probe which codes exist.
- F. S2 stays on Opus. Plain: the riskiest part keeps the stronger builder.

## Contract

`docs/plans/2026-11-27-restricted-projects-contract.ts` (types and the script's rules) and
`shared/project-visibility.ts` (the rule itself, real code).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Lead | this session | | `shared/project-visibility.ts` + test, plan, contract, explainer, commits |
| Overseer | `overseer`, fable | plan critique, decisions, sign-off (domain: permissions and access control in a local-first app) | (read-only) |
| Builder S1 | `builder`, opus | permissions: the hide-at-source rule every reader depends on | `shared/projects-contract.ts`, `server/brain/projects.ts`, `server/brain/project-refs.ts`, `server/brain/tidy.ts`, `server/brain/index.ts`, `server/engine/session-manager.ts`, and their tests |
| Builder S2 | `builder`, opus | permissions: file and task hiding, the assign block | `server/brain/library.ts`, `server/brain/library-*.ts`, `server/brain/todos.ts`, `server/brain/todo-asked.ts`, `server/brain/todo-done.ts`, `server/brain/todo-team.ts`, `server/brain/todo-timeline.ts`, `server/brain/todo-history.ts`, `server/http/routes.ts`, and their tests |
| Builder B | `builder`, opus | permissions in the brain script that every Mac runs | `brain-skills/tdsapp-projects/**` |
| Builder C | `builder`, sonnet | default (UI) | `client/src/**` (projects app, pickers, search, Home, task forms, CSS), client tests |
| Builder D | `builder`, sonnet | default (help, after C) | `help/**`, `client/src/help/**`, `scripts/help-shots.ts` |
| Security gate | `expert`, opus | domain gate: permissions | (read-only) |
| UX/UI gate | `expert`, opus | standing rule: design-system sign-off with screenshots | (read-only) |
| Reviewers | `reviewer` ×2: correctness (opus), UI + accessibility + copy and drift (sonnet) | | (read-only) |

S1 owns `index.ts` and adds S2's wires there from the contract: the index into `changeTodo`'s own list,
`assignCheck` into `changeTodo`, the index into the history read. The shared type additions
(`shared/projects-contract.ts`) are already committed by the lead. No file appears
in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `shared/project-visibility.test.ts` | the rule, fail-closed parsing, slug forms, the note (done) | Lead |
| `server/brain/projects.test.ts` | a hidden card is absent from `cards`, `byKey`, `keysForPath`, `refs`, `list`, duplicates and leftovers; `resolve` answers `restricted`; `hiddenPath` covers live and archived folders; owner/scout/team/unknown viewers; unreadable restricted card; `change`/`move`/`remove` on a hidden key → not found; `canRestrict`, `seesAll` | S1 |
| `server/brain/tidy.test.ts` | a restricted label is never a tidy row | S1 |
| `server/engine/session-manager.test.ts` | hidden projects absent from `whichProjectLine`; the guard denies each tool on a hidden folder and allows the same tool elsewhere; no guard when nothing is hidden | S1 |
| `server/brain/library*.test.ts` | hidden folder absent from list, search, recent, by-id reads and `projectFiles`; a linked outside file stays, unstamped | S2 |
| `server/brain/todos.test.ts`, `todo-asked.test.ts`, `todo-done.test.ts`, `todo-team.test.ts` | open tasks of a hidden project left out and uncounted; own task carries `restricted` and null project/stage; `teamTodo` not found | S2 |
| `server/http/todo-change-contract.test.ts`, `routes.test.ts` | the assign block on `add`, `assignee`, `project`, `move`, with the exact note; allowed for team, Account Owner, owner, scout and unassigned; `visibility` passes `parseProjectFields` and the real `checkRequest` | S2 |
| `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts` | write/remove the line; ORDER; who-may; creator added to team; not-found for outsiders on every action; capability; unknown value kept; personal refused | B |
| client tests (`ProjectsApp`, `ProjectForm`, `SaveToProject`, `Palette`, `Home`, `TodosDrawer.projects`) | badge shown; control gated by `canRestrict` + `mayRestrict`; confirm lists affected people; outsiders unavailable with the note; restricted chip links nowhere | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (`pnpm check`)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security expert; UX/UI expert with screenshots
- [ ] Browser check on port 3878 (demo mode, `/tmp/tba-preview-restricted-projects/`): as a team member not
  on the project (hidden everywhere: Projects, search, palette, Home, Images, Documents, tasks, pickers), as a
  team member on it, as a scout (badge); the switch and its confirm; the assign note; typed key by key
- [ ] Help page, picture, `help/whats-new/0.95.0.md`
- [ ] Brain copy after merge: diff the brain's `tdsapp-projects` against `origin/main` first

## Review outcomes

(Filled at the end.)
