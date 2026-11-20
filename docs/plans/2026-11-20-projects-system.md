# Projects system (programme plan; release 1 in detail)

Date: 2026-11-20 · Size: XL (programme) · Branch: `projects-system` · Explainer: to follow (after overseer pre-review)

## Objective

Let a person group everything about a piece of work (to-dos, files, images, documents, and later chats,
notes, pages, ads work and time) under a project that sits in a client (Client/Project/Task) or in their
personal space, then find and filter all of it by project anywhere in Cortex. Phase one is built so that
time tracking and reports ("all time on ClientA Project B this month, by team member") can follow without
re-filing anything, and so that Cortex can later replace Monday as the team's project tool.

## User decisions (fixed, Ian, 2026-11-20 interview)

- **Sharing:** client and TDS projects are shared with the team; personal projects are private to the
  person, like personal to-dos (`personal/` never syncs and isn't backed up).
- **Retainers are projects** of kind `ongoing`; one-off pieces of work are kind `one-off`.
- **Depth:** Project → To-do, plus an optional stage label on a to-do. No sub-tasks, no sub-projects.
- **Client/Task stays valid:** a to-do with a client and no project is normal.
- **Files:** a project has a folder inside its client; files saved there belong to it; files elsewhere,
  or used by two projects, are linked, not moved.
- **Existing work:** guided tidy-up. Old files keep working; a one-off tidy proposes a mapping for the
  60 old `project:` labels, approved row by row; `projects/` folders become TDS internal projects.
- **Monday:** mirror its shape (client, Account Owner, type, budget hours, traffic light, client-comms
  light), no live link in phase one. Monday stays the live system for now.
- **Card details in phase one:** status + health light + client-comms light; Account Owner + team;
  start and end dates; service type + budget hours.
- **Picker:** Client → Project, app-wide, like today's client picker, plus a project filter per app.
- **Also linkable (R2/R3):** chats, call and meeting notes, pages Claude makes, ads work.
- **Rights:** anyone on the team can create, edit and close any shared project. Every change records who
  and when.
- **Extras:** updates log, Claude asks "which project?", close-out summary. Templates: not now.
- **Releases:** R1 foundation (projects, picker, to-dos, Images/Documents, search, tidy-up);
  R2 chats, call notes, pages, updates log, "which project?"; R3 ads work, close-out summary.
  Phase 2: time tracking and reports.
- **Internal projects** sit under The Digital Stride (`clients/the-digital-stride`).
- **Time later comes from:** a timer in Cortex, Claude sessions, and suggestions from tracked activity,
  each approved by the person. (Tracket/Monday import not chosen, but the path stays open.)
- **Reports:** internal first, client-facing later; phase one keeps a billable flag and client-safe
  notes apart from internal ones.
- **Visual explainer:** yes.

## Facts checked (2026-11-20, read only)

- `projects/AGENTS.md`: "Active projects with deadlines or defined end states. One folder per project",
  `projects/<name>/README.md` plus anything; ongoing client work goes in `clients/`. 10 folders today
  (e.g. `client-portal`, `ai-blueprint`), some with a `todo.md`. Two in `projects-archive/`.
- `clients/AGENTS.md`: one folder per client with standard subfolders (`context/`, `call-notes/`,
  `notes/`, `plans/`, `reports/`, `created/`, …); owner in `profile.md` frontmatter. No client has a
  `projects/` subfolder today.
- `todo/AGENTS.md` lists `project` (optional) in frontmatter. Of 181 to-dos, 60 carry `project:` and 35
  `client:`; there is no `stage:` or `tags:`. Labels are free text: `harvey-nash` (8, a client),
  `h2o-restoration` / `h2o-restorations`, `bookvault` vs client folder `book-vault`, and one
  `optional-project-slug` (a template placeholder).
- App: `TodoItem.project` and `.client` are read from frontmatter (`server/brain/todos.ts` ~L218) and
  searchable; the To-dos drawer filters by scope and client (`client/src/state/todo-filter.ts`).
- Library (`server/brain/library.ts`): scopes are `personal`, `shared:templates`, and `client:<slug>` per
  client folder; `LibraryItem` (`shared/contract.ts:816`) records the scope, not a project. `projects/`
  is in no scope, so its files are not in Images or Documents today.
- App-wide client choice: `client/src/state/client-choice.ts` (`client:<slug>`, `personal`, `NO_CLIENT`, '').
- Writes: every brain change runs a brain skill script through `server/brain/skill-runner.ts` with one
  JSON object in, one line out (`todo-skill.ts`, `files-skill.ts`, `ads-skill.ts`). To-do changes carry
  `expect` = SHA-256 of the file and are refused as `changed` if it moved on.
- Monday "TDS Projects" board (5089802472, read 2026-11-20): item = project with Traffic Light, Client
  Comms, Account Manager, Hours Budget, Total Billable Hours (sum of subitems), Percentage used, Clients
  (relation), Type (PPC, SEO, Soc Med & Email, Website Hosting), Start Date, Status; groups Open /
  Completed. Subitem = task with Owner, Status (Not Started, Working on it, Stuck, Done), Start, End,
  Timeline, Task Type, Planned Hours, Billable Hours, Type (Recurring / Ad-hoc).
- Time today: the brain's `time` skill books time into Monday through Tracket at subitem level on the TDS
  Retainers and TDS Projects boards; nothing is submitted without approval.
- `personal/projects/` already exists on Ian's Mac with four card-less folders (`dogfight-flight-sim`,
  `jev`, `tds-brain-app`, `the-digital-stride`); four shared to-dos carry `project: tds-brain-app`.
- `projects/` stays a live write location: `.claude/rules/save-locations.md` L31 and the Command
  Centre's "Archive project" write there. `clients/_archive/` holds archived clients; `sig-roofing`
  and `tritax-big-box` exist both live and archived.
- `POST /api/todos/change` only accepts to-dos in this person's `mine` or `open` lists
  (`server/brain/todos.ts` ~L535); 49 of the 60 labelled to-dos belong to teammates.
- `tdsapp-todo` `move` copies the file's bytes unchanged; its link roots are `clients/`, `templates/`,
  `personal/` (`FILE_ROOTS`, L724), so `projects/` paths can't be attached today.
- The brain's sync hook aborts the rebase on any textual conflict and stops syncing until someone sorts
  it out (`.claude/hooks/sync.sh` L231–235).
- Brain readers of `project:` (Command Centre `todo-parser.cjs`, `cc.js`, the 8020tasks mirror) only
  show it as text, so a full key there is harmless.
- Team slugs (`ian-hancock`, `simon-jones`, …) come from the `time` skill's `config/team.json` and match
  to-do `assignee` values.

## Decisions (release 1 unless marked)

1. **A project is a folder with a card.** Client projects: `clients/<client>/projects/<slug>/project.md`.
   Internal: `clients/the-digital-stride/projects/<slug>/`. Personal: `personal/projects/<slug>/`.
   Legacy `projects/<slug>/` folders are read in place (decision 4). **Every folder in a projects
   location is a project, card or not**, in all three spaces (overseer B3); `ProjectCard.card` says
   `ok`, `none` or `unreadable`. A card-less or unreadable project still resolves its key (so its to-dos
   never look unfiled) and is read-only until "Add a card" or a fix.
   Plain: every project has one home inside its client, so the folder tree itself shows Client/Project,
   and a damaged card never makes to-dos look unfiled.
2. **The card is `project.md`, frontmatter + markdown brief**, fields exactly as `ProjectCard` in the
   contract (Monday-shaped: kind, status, health, comms, owner, team, service, start, end,
   budget_hours, billable, stages, monday_id, created stamps). Body = brief, then an optional
   `## Linked files` section. Status values: Planned, Active, On hold, Done. **No `updated` stamps**:
   two card edits between syncs would always clash and stall the brain's sync; "last changed by and
   when" comes from git on read (overseer S2). Empty fields are left out, not written as null.
   Plain: a project's details are a short, readable file anyone (or Claude) can open in the brain.
3. **The folder name is permanent; the title is not.** Everything links by `ProjectKey`
   (`<client>/<slug>` or `personal/<slug>`). `create` fixes the slug; no R1 action renames or moves a
   project. A future "move project" is a script action that rewrites every reference in one go.
   Plain: renaming a project never breaks a to-do, file link or, later, a time report.
4. **Legacy `projects/<slug>/` folders are internal TDS projects, read in place.** Key
   `the-digital-stride/<slug>`; title from `README.md`'s first heading, else the folder name tidied up;
   `card: 'none'` until someone presses "Add a card" (`card` action, which only adds `project.md`, and
   works on any card-less folder). A legacy `todo.md` checklist is linked from Overview, not counted.
   Nothing is moved in R1. `projects/` stays a place people and skills still write to.
   Plain: the existing project folders show up straight away and nothing that points at them breaks.
4b. **Fixed reader precedence and archives (overseer B4).** Internal keys resolve in the order
   `clients/the-digital-stride/projects/` → `projects/` → `projects-archive/` (contract
   `INTERNAL_PRECEDENCE`); a shadowed same-slug folder is listed in `ProjectList.duplicates` and shown
   as a notice, never as a second project. Other clients: live folder, then
   `clients/_archive/<client>/projects/`. Archive locations are read only, status forced Done. `create`
   checks every location, including archives.
   Plain: archiving a project or a client never orphans its to-dos or, later, its time reports.
5. **To-dos link by `project: <ProjectKey>` and keep `client:`.** New writes always set both
   (`client: skyseal`, `project: skyseal/website-rebuild`); personal projects write
   `project: personal/<slug>` with no client. Old slash-less labels are read leniently through
   `resolveTodoProject` (contract `TodoProjectMatch`: key, then client slug, then project slug within
   the to-do's `client:`) and never rewritten except by the tidy-up. A well-formed key with no folder
   is `missing` (shown, never tidied: the folder may arrive with the next sync). **A TDS to-do resolves
   only against shared projects**, so it reads the same on every Mac. v0.6 `add` takes client, project
   and stage in one write. Older app versions and the brain's own readers just show the value as text.
   Plain: old to-dos keep showing as they do; new ones link to a project that really exists.
6. **Stage is an optional `stage:` on the to-do**, chosen from the card's `stages`. A stage not on the
   card is shown as written. The project's To-dos tab groups by stage, then "No stage".
   Plain: big projects can group their to-dos into phases like Discovery, Build, Launch.
7. **Files belong by folder or by link.** A file under a project folder belongs to it; a card's
   `## Linked files` lines (same format and parser as to-do attachments, `shared/todo-files.ts`) add
   files from elsewhere. `LibraryItem` gains `projects: ProjectKey[]`, **computed when serving**, never
   cached with the item, since a card edit in one scope changes items in another. Files under a project
   folder group in Images/Documents under the project's title. A new scope `shared:projects`
   (`LEGACY_PROJECTS_SCOPE`) lists legacy `projects/` folders with its own watch folder and no deletion
   in R1; the builder must untangle the places where `kind: 'shared'` is assumed to mean templates
   (watcher, owner-only delete, hidden-in-templates, `TEMPLATES_GROUP`). Because a project's files can
   span scopes, **`GET /api/projects/files?key=&kind=`** returns them (folder prefix plus each link via
   `itemForPath`); the Files tab and the picker's project choice in Images/Documents both use it.
   `tdsapp-todo` adds `projects/` to its link roots.
   Plain: a project's images and documents appear in the normal Images and Documents apps and can be
   filtered by project, without moving files that other things already point at.
8. **Privacy rule.** A shared (TDS) to-do or a shared project may never point at a `personal/` project or
   file: the scripts refuse with `not-allowed`, and the server drops any such link when reading.
   Personal items may point at shared projects. **v0.6 `move`** of a personal to-do with a `personal/`
   key into TDS is refused unless the app sends `dropProject: true` after asking, and then the moved
   copy loses its `project:`/`stage:` lines (overseer B2), so a private name never reaches git.
   Plain: nothing private ever leaks into what the team sees.
9. **All writes go through brain skills.** New `brain-skills/tdsapp-projects` (actions in
   `ProjectAction`: create, card, edit, link, unlink, capabilities) and `tdsapp-todo` v0.6 with a new
   `project` action (`TodoProjectAction`). Same safety as today: temp file then swap, new files never
   overwrite, `expect` fingerprint refuses overlapping edits as `changed`, unknown frontmatter keys and
   body bytes kept; who did it comes from this Mac's git identity (as `tdsapp-files`) and only goes into
   `created_by` on create.
   Plain: the app changes the brain the same careful way it already does for to-dos.
10. **Reading: `server/brain/projects.ts`** walks the three locations (plus legacy), parses cards, counts
    open to-dos, and caches like the library (30 s stale without a watcher). Routes
    `GET /api/projects` → `ProjectList`, `POST /api/projects/change` → `ProjectList`, both through the
    existing request gate (`checkRequest`), with the same body limits and validation style as to-dos.
    Plain: the app reads the projects list quickly and only accepts well-formed changes.
11. **Picker: Client → Project.** `client/src/state/client-choice.ts` gains a project choice
    (`ProjectChoice`) held in **one store with one `{client, project}` snapshot and one atomic set**, so
    the two never disagree mid-render; choosing a project narrows Home, the To-dos drawer, Images,
    Documents (via the project files route) and search; choosing a different client, or the project
    leaving the list, clears it. Each of those also gets its own project filter, locked while the picker
    holds a project. Choosing only a client behaves exactly as today.
    Plain: pick a project once and the whole app shows just that project's work.
12. **Projects app.** New entry in `client/src/shell/apps.ts`: list grouped by client (personal last),
    filters for status, Account Owner and service, a "Mine" view (owner or team includes me); rows show
    health light, end date, open to-dos. Project page with `SheetTabs`: Overview (card fields, brief,
    lights, budget hours), To-dos (by stage; "Add a to-do" pre-fills client and project), Files (the
    existing Images and Documents views filtered by key, plus "Link a file" using the attachments
    picker). Create and edit forms reuse `SearchSelect`, `Seg`, `.field`, `Fold`. UK English copy.
    Plain: one place to see and run a project, built from pieces people already know.
13. **Tidy-up screen** in the Projects app, shown while `looseLabels > 0` (count of unskipped rows,
    open to-dos only, never `todo/done/`). Its own routes, `GET`/`POST /api/projects/tidy` (overseer B1):
    unlike the to-do change route, **it may change any open TDS to-do, a teammate's included, but only
    the `client:`/`project:`/`stage:` lines**, each with its own `expect`; personal to-dos are own only.
    Server-side pure function `suggestTidy` (rules in the contract above `TidyRow`): legacy match → link;
    a client slug → client only, never overwriting a different `client:` (those to-dos are listed apart);
    merge only on plural, hyphen or distance 1 with both labels ≥ 6 characters; placeholder → clear;
    else new project under the to-do's client, else The Digital Stride, or skip. Skips live in the app's
    data folder (`tidy-skips.json`). Each row: Approve / Change / Skip. After every apply the rows are
    re-read from disk, so a partial failure just shows what's left and an `exists` becomes a link.
    Plain: the old messy labels get cleaned up once, with you saying yes to each change.
14. **Search.** `client/src/shell/search-sources.ts` gains a Projects group (title, client name and
    aliases, slug); to-do and file hits show "Client · Project"; choosing a project hit offers
    "Filter to this project" (sets the picker).
    Plain: typing a project's name finds it, and its to-dos and files say which project they belong to.
15. **Backward compatibility.** The app checks `capabilities` for both scripts; without `projects-v1`
    the Projects app is read-only with a notice ("Update the brain's skills to change projects"), and
    without `todo-project-v1` the to-do Project field is hidden. Older servers send no `projects`,
    `stage` or `projectMatch`; the client treats them as empty. Older app versions ignore new
    frontmatter. Nothing in R1 deletes or moves a brain file.
    Plain: team members on older versions or older brain skills keep working; new parts appear when they
    update.
16. **Ready for time and Monday (no build in R1).** Stable ids everywhere (client slug, ProjectKey, to-do
    key, team slug); `billable` and `budget_hours` on the card; `monday_id` slot so a later import never
    runs twice. Phase 2 `TimeEntry` is sketched in the contract (one file per person per month,
    suggestions count for nothing until approved). The switch-over maps Monday projects → cards,
    subitems → to-dos (Task Type → stage or tag, Planned Hours kept), Tracket hours → entries with
    source `tracket`.
    Plain: when time tracking arrives, nothing filed now needs re-filing, and reports by client,
    project and person just work.
17. **Brain rules text is prepared, not written.** The app repo carries the new text for
    `projects/AGENTS.md`, `clients/AGENTS.md`, `todo/AGENTS.md`, `.claude/rules/save-locations.md` and
    the `client-setup` skill (the layout, the key format, the privacy rule) under `brain-skills/tdsapp-projects/brain-rules/`, for Ian to apply with the usual
    brain-skill copy step. The app and its tooling never write the brain directly.
    Plain: every Claude session in the brain, not just the app, learns the new layout once Ian copies it in.

### Release 2 (decided in outline; planned in full before building)

18. Chats carry `client` and `project`; new chats guess both (extending `POST /api/client-guess`);
    the Chats drawer filters by project.
19. Call and meeting notes carry `project:` in frontmatter; the brain's meeting-notes skill fills it in
    (brain-side change, prepared for Ian).
20. Pages Claude makes in a project chat are saved in the project folder.
21. Updates log: an `updates/` folder in the project, **one file per entry** (so two people adding
    updates never clash on sync), each marked internal or client-safe,
    appended by a new `update` action; Claude can add one after a call; status and health changes add one
    automatically. New Updates tab.
22. "Which project?": when Claude adds a to-do or files something for a client with open projects, it
    picks the obvious one or asks (a brain rule plus app prompt context).

### Release 3

23. Ads work: Ad Manager changes and runs carry an optional project key.
24. Close-out: closing asks what happens to each open to-do (move, close, keep), Claude writes
    `summary.md` (what was done, key files, what's left), status becomes Done, folder stays in place.

### Phase 2 (time and reports)

25. Time entries per `TimeEntry`, from a timer, Claude sessions and approved activity suggestions; the
    Overview gains budget against actual; reports filter and group by client, project, stage, person
    and month; client-facing reports use only billable entries and client-safe notes.

## Contract

`shared/projects-contract.ts`: paths, key format, `ProjectCard`, `ProjectList`, `ProjectAction`,
`TodoProjectAction`, `TodoProjectMatch`, `LibraryProjectFields`, `ProjectChoice`, `TidyRow`, and the
reserved `TimeEntry`. R1 also adds `stage` and `projectMatch` to `TodoItem` and `projects` to
`LibraryItem` in `shared/contract.ts`, and the two routes to `ROUTES`.

## Team and file ownership (release 1)

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique, product calls, sign-off | (read-only) |
| Builder A | `builder`, opus | data model and data integrity: key resolution, precedence, privacy rule, script writes with fingerprint checks | `brain-skills/tdsapp-projects/**`, `brain-skills/tdsapp-todo/**` (v0.6: `project`, `add` fields, `move` drop, `projects/` link root), `shared/projects.ts` (+ test), `server/brain/projects.ts`, `server/brain/projects-skill.ts`, `server/brain/tidy.ts` (+ tests), `server/brain/todo-skill.ts` |
| Builder B | `builder`, sonnet | default (UI) | `client/src/apps/projects/**`, `client/src/shell/apps.ts`, `client/src/styles/projects.css`, `help/**` (Projects pages, UK English) |
| Builder C | `builder`, sonnet | default (wiring); starts after A's `server/brain/projects.ts` exports are fixed | `client/src/state/client-choice.ts`, `client/src/state/todo-filter.ts`, `client/src/shell/TodoPanel.tsx` + `TodoForms.tsx` (Project/Stage fields), `client/src/shell/search-sources.ts`, `client/src/shell/Home.tsx`, `client/src/apps/shared/**`, `client/src/apps/images/**`, `client/src/apps/documents/**` (project filter), `server/brain/library.ts` + `server/brain/library-rules.ts` (`projects` at serve time, `shared:projects` scope) |
| Lead | me | contract edits and route wiring | `shared/contract.ts` (`TodoAction` gains `project`, `TodoList.canProject`), `shared/projects-contract.ts`, `server/http/routes.ts`, `server/brain/todos.ts` (stage + projectMatch), `client/src/api.ts`, `client/src/store.tsx`, `client/src/shell/contract.ts` (`TodoFilter`), `client/src/shell/Palette.tsx`, `brain-skills/README.md` |
| Gates | `expert` UX/UI (opus, domain gate), `reviewer` correctness (opus), `reviewer` security (opus: paths, input, privacy), `reviewer` UI and accessibility (sonnet) | domain gates and review lenses per agent-workforce | (read-only) |

No file appears in two rows.

## Tests (release 1)

| Test file | Proves | Owner |
|---|---|---|
| `shared/projects.test.ts` | `resolveTodoProject`: key, missing, legacy unique slug, slug within `client:`, client slug, loose, none; ambiguous slug → loose; **a TDS to-do never resolves to `personal/`** (the real `tds-brain-app` case); key's client wins over a disagreeing `client:` | A |
| `brain-skills/tdsapp-projects/test/*.test.ts` | create refuses bad slug, clash (incl. internal vs `projects/`), `end` before `start`; edit keeps unknown keys and body bytes; `expect` mismatch → `changed`; link of a `personal/` file from a shared project → `not-allowed`; `card` adds only `project.md` | A |
| `brain-skills/tdsapp-todo/test/project.test.ts` | `project` action writes/removes `client`/`project`/`stage` lines only; TDS to-do + `personal/` key → `not-allowed`; client must match key | A |
| `brain-skills/tdsapp-todo/test/move-privacy.test.ts` | `move` to TDS with a `personal/` key → `not-allowed`; with `dropProject` → moved copy has no `project:`/`stage:` | A |
| `server/brain/projects.test.ts` | walk finds client, personal, legacy, archive and archived-client projects; card-less and unreadable folders are projects; `INTERNAL_PRECEDENCE` order and `duplicates`; bad folder names skipped; personal never read from another person; privacy drop on read; open to-do counts | A |
| `server/brain/tidy.test.ts` | the real label set (harvey-nash → client-only, h2o-restorations → merge, optional-project-slug → clear, bookvault → merge into book-vault); negatives (`os` never fuzzy-merged, a different `client:` never overwritten, `missing` keys never offered, TDS `new-project` never personal); partial failure re-reads and `exists` becomes link | A |
| `server/http/projects-routes.test.ts` | all four routes go through `checkRequest` (bad origin or content type refused) and reject malformed bodies; **tidy changes a teammate's TDS to-do** through the gate, touching only the three lines; tidy refuses another person's personal to-do | Lead |
| `server/brain/library.test.ts` (extend) | `projects` filled by folder and by link at serve time (a card edit shows without re-walking the other scope); `shared:projects` lists legacy folders and refuses delete; `/api/projects/files` spans scopes and hides links the person can't see | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (port 3248, own data folder per project rule)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI (new app, picker); security (paths from the brain, input, privacy rule)
- [ ] Browser check: Projects list, project page (all three tabs), create/edit, picker narrowing Home,
      To-dos, Images and Documents, search, tidy-up rows, read-only notice without the new skill

## Pre-review outcomes (overseer, 2026-11-20)

Blocking, all fixed in this plan and the contract: B1 tidy-up couldn't reach teammates' to-dos and never
finished (decision 13); B2 privacy holes through `move` and per-Mac legacy matching (decisions 5, 8);
B3 card-less and unreadable folders undefined (decision 1, `CardState`, `missing`); B4 key uniqueness
and archives (decision 4b); B5 project files span library scopes (decision 7, files route).
Should, all taken: ownership gaps (team table), no `updated` stamps (decision 2) and one file per entry
or per Mac for R2 updates and phase 2 time, label precedence via `client:`, safer tidy rules, `add`
with project fields in one write, one atomic picker store, archive read-only, brain rules coverage,
extra tests. Nice, taken: omit empty keys, key segment cap, skip bad folder names. Left for the build:
the stage-rename note in the edit form, the add/add "already exists" message after a sync.

## Review outcomes

<Filled at step 10.>
