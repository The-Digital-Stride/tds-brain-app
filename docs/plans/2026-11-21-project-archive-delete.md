# Archive and delete a project

Date: 2026-11-21 · Size: L · Branch: `project-archive-delete` · Explainer: none

## Objective

Let people finish a project by archiving it (reversible, keeps every link working) and remove a
project for good by deleting it, with a warning that names everything that goes with it.

## User decisions (fixed)

- Archive moves the folder to a `projects-archive/` folder beside `projects/`, at the same level
  (`clients/<c>/projects-archive/<slug>`, `personal/projects-archive/<slug>`), matching the brain's
  existing `projects/` → `projects-archive/` convention.
- On delete, to-dos are asked about each time: the panel lists them with "delete" or "keep, unlinked";
  defaults: delete for the person's own and unassigned ones, keep for teammates'.
- Anyone who can edit a project can archive and unarchive it. Only the card's Account Owner (or the
  brain's Owner, role `owner`) can delete a shared project. Personal projects: the person.
- No explainer.

## Facts

- Archive locations already read (read only, status Done, keys resolve): `projects-archive/<slug>`
  (legacy) and `clients/_archive/<client>/projects/<slug>` (archived clients). Nothing in the app writes them.
- The Command Centre's "Archive project" (`tools/members/command-centre/server.cjs` ~1517) moves
  `projects/<slug>` to `projects-archive/<slug>`, renaming to `<slug>-2` on a clash (breaks keys).
- Nothing in the brain deletes projects. Brain is git-synced: a delete is recoverable from git history,
  but not from the app (the app never runs git).
- Chats: `LiveSession.todoId` exists only while a chat is open; History chats carry no to-do or project.
  So "this project's chats" can't be found today.
- Pre-existing brain bug: `tools/lib/save-locations.cjs` CLIENT_ROOT_ALLOWED lacks `projects`, so the
  save-location hook tells sessions a file in `clients/<c>/projects/<slug>/` is in the wrong place.

## Decisions (revised after the overseer pre-review: B1–B3, S1–S9 taken; chats cut by Ian)

1. **Archive locations.** Live → archive, same slug, same depth (`archiveFolderFor` / `liveFolderFor` in
   `shared/projects.ts`): `clients/<c>/projects/<s>` ↔ `clients/<c>/projects-archive/<s>`,
   `personal/projects/<s>` ↔ `personal/projects-archive/<s>`, legacy `projects/<s>` ↔ `projects-archive/<s>`.
   `clients/_archive/**` (archived clients) stays read only: no archive, unarchive or delete there.
   Reader order, INTERNAL: `clients/the-digital-stride/projects` → `projects` →
   `clients/the-digital-stride/projects-archive` → `projects-archive`; other clients: live →
   `clients/<c>/projects-archive` → `clients/_archive/<c>/projects`; personal: `personal/projects` →
   `personal/projects-archive`. Every location entry is explicit about `archived` and `space` (S6: no
   deriving from `startsWith('projects-archive/')`). `requirePrivate` and the walk's tracked check cover
   `personal/projects-archive` (`.gitignore` already covers `personal/`).
   Plain: an archived project sits beside the live ones, keeps its name, and every to-do still finds it.
2. **Leftovers (B1).** A card-less live folder whose key also has a CARDED archive twin is a `leftover`
   (ProjectList.leftovers, as move's) and the archive wins, in the server walk AND the script's locate. A
   card-less folder holding only git-ignored files (`.DS_Store` etc.) is also a leftover; any team member
   may delete a leftover. Tests for both.
   Plain: stray files left on another Mac never bring an archived or deleted project back.
3. **`archive` (tdsapp-projects 0.3).** As `move`: every check before any write (live location only; real
   paths; walk refuses symlinks, nested `.git`, `nlink>1`, non-regular files, 5000-entry cap; `expect` when
   a card exists; `filesExpect` against the fingerprint; destination exists anywhere for the key → `exists`,
   never renamed). Parent: ONE-level non-recursive `mkdirSync` of `projects-archive/` under a folder that
   must already be real (`requireClientFolder`/`requireRealPath`, B2), then one `renameSync`. Card not
   edited. Card-less folders may be archived. Legacy: refused while any `.claude/skills/**` or `tools/**`
   file names the folder (S4: a skill would recreate it); the refusal names them.
   Plain: archiving is one quick folder move that happens completely or not at all.
4. **`unarchive`.** Reverse to `liveFolderFor`; `exists` if any folder holds the key; never creates a
   client folder (B2: `clients/<c>/` must already be real). Same checks.
   Plain: an archived project comes back with one press, but never recreates an archived client.
5. **`delete`.** Allowed for an archived project, a live one holding only `project.md`, or a leftover.
   Permission (S1) only in the script, from its own `identity()` and `.team-config/roles.json`: personal →
   yes; leftover → any team member; card with `owner` → that person (compare with both slug forms, as
   `personOf`) or role `owner`; card-less → role `owner`. The check returns `allowed` and `allowedWho`;
   the server relays them and adds no second rule. `filesExpect` required. Procedure (B3): checks, then
   rename to `<parent>/.tdsapp-projects-<slug>-<hex>.deleting~` (`*~` is git-ignored; confirm with
   `check-ignore`), then `rmSync({recursive, force, maxRetries: 3})`; every script call first sweeps stale
   `*.deleting~` siblings. A failed remove answers `internal` and stays local.
   Plain: delete is final, only the owner can do it, and a failure can't leak half a project to the team.
6. **Honest warnings (B3).** The check counts `localOnlyCount` (git-ignored files, or every file of a
   personal project): "N files exist only on this Mac and can't be recovered." Other files are recoverable
   from the brain's git history by someone technical; the panel says so in one line.
   Plain: the warning says exactly what can and can't come back.
7. **To-dos (S3).** Only OPEN to-dos are listed (key and `movedFrom` aliases; TDS and this person's
   personal ones); done ones are counted and never changed. Archive: "Mark done" / "Keep open" (default
   keep). Delete: "Delete" / "Keep, unlinked" (defaults: delete for mine and unassigned, keep for
   teammates'); the panel says deleted to-dos go to `todo/deleted/` (tdsapp-todo's delete is soft). Order:
   folder first, then each to-do through tdsapp-todo (`done`, `delete`, or `project` with project null);
   failures are returned as ids (`todosFailed`) and named in the result.
   Plain: you choose what happens to each open to-do; finished ones stay as the record.
8. **References (S4).** On check only: grep brain text files (`.md .json .cjs .js .yaml .yml`) outside
   the folder for its brain path on path boundaries (`<path>` followed by `/`, `)`, `>`, whitespace, quote
   or end), skipping `.git`, `node_modules`, `todo/done`, `todo/deleted`, `z-logs`, `z-backup`; at most 20
   listed, "at least N". Archive: "These files point into this folder". Delete: "These links will break".
   Plain: you see what else in the brain mentions the project, without false alarms.
9. **Links inside an archived project (S5).** `archivedFolderPath` (shared) maps a card's links into its
   old live folder to the archive folder at read time, like `movedFolderPath`; no card write.
   Plain: an archived project still shows its files.
10. **Chats: out (Ian, 2026-11-21).** Delete never touches chats; the panel says "Chats are kept."
    Linking chats to projects comes with R2 activity.
11. **Who sees what.** `ProjectList.canArchive` (capability `projects-archive-v1`). Live editable project:
    "Archive…" (Overview); "Delete…" too when empty. Archived page: banner, "Unarchive", "Delete…" when
    `allowed`, else a line with `allowedWho` (from the check). Delete confirm: type the title
    (case-insensitive, trimmed); focus on Cancel; Esc cancels; a `fieldset` like Move's.
    Plain: buttons show only for people who can use them, and delete takes a deliberate step.
12. **Archived projects leave the Projects list (Ian, 2026-11-21; S7).** The list and its count leave
    archived projects out by default. The status filter gains **Archived** (only archived ones); **Done**
    no longer includes archived (`statusOf` maps archived to done: filter on `archived` first). The empty
    state counts live projects and offers "N archived". Opening a project by key never depends on the
    filtered list. Pickers, search, the drawer filter and Tidy already skip archived.
    Plain: archived work disappears from the list but is one filter away.
13. **Older apps (S8, announce loudly).** Installed apps before this release don't read the new folders:
    an archived project vanishes there and its to-dos show as plain words; an old Tidy or create could make
    a twin. Every Mac must update before the first archive. Test that a twin lands in `duplicates`.
    Plain: everyone updates Cortex before anyone archives.
14. **Brain rules and the save-location bug.** Brain-rules text for Ian: `save-locations.md` rows for
    `projects-archive/`; `clients/AGENTS.md`, `personal/AGENTS.md`, `projects/AGENTS.md` "archive and
    delete with the skill, never by hand"; and the `tools/lib/save-locations.cjs` fix adding `projects`
    and `projects-archive` to CLIENT_ROOT_ALLOWED. Command Centre's archive is noted, not changed.
    Plain: the brain's own rules learn the new folders, and the hook stops flagging project files.
15. **Help.** `help/projects.md`: archive, unarchive, delete, the Archived filter (within help-test limits).

## Contract

`shared/projects-contract.ts`: `CLIENT_PROJECTS_ARCHIVE_DIR`, `PERSONAL_PROJECTS_ARCHIVE_DIR`, the
`archive` / `unarchive` / `delete` actions, `PROJECTS_ARCHIVE_CAPABILITY`, `ProjectRemoveCheck`,
`ProjectRemoveTodo`, `ProjectRemoveRequest`, `ProjectRemoveCheckResponse`,
`ProjectRemoveResult`, `ProjectList.canArchive`. `shared/contract.ts`: `ROUTES.projectsArchive`,
`ROUTES.projectsDelete`.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Lead | (me) | contract owner | `shared/**` (contract, `archiveFolderFor`, `liveFolderFor`, `archivedFolderPath`) — landed before the builders start |
| Builder A | `builder`, opus | data integrity: folder rename and recursive delete in the shared brain | `brain-skills/tdsapp-projects/**` (script, SKILL.md, tests, brain-rules) |
| Builder B | `builder`, sonnet | default (S9: follows `move`; permission lives in the script) | `server/**` (projects.ts, projects-skill.ts, routes.ts, index.ts wiring, tests) |
| Builder C | `builder`, sonnet | default (UI) | `client/**` (api.ts, apps/projects/*, state/*, styles/projects.css, tests), `help/projects.md` |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts` | archive/unarchive round trip for client, personal, legacy, TDS; `exists` on clash (no rename); `changed` on filesExpect; walk refusals; delete permission (owner, Owner role, other refused, card-less needs Owner); delete only archived or empty; hidden-rename then remove; references listed | A |
| `shared/projects.test.ts` | archive folder mapping both ways; link remap (done) | Lead |
| `server/brain/projects.test.ts`, `server/http/projects-routes.test.ts` | walk reads the new archive folders with explicit space/archived; leftovers (B1) both kinds; twin lands in `duplicates`; route shapes through the real request gate (`checkRequest`); to-do choices applied and failures returned as ids; `canArchive` gate; `allowed` relayed | B |
| `client/src/apps/projects/ProjectsArchive.test.tsx` | buttons per state and `allowed`; archive panel to-do choices sent; delete needs the typed title; to-do defaults; Esc/Cancel; list hides archived, Archived filter, Done excludes archived, empty state count | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (delete authorisation, path handling, recursive delete), UX (panels)
- [ ] Browser check on a throwaway brain: archive, unarchive, delete (owner and non-owner), to-do choices

## Review outcomes

(to fill)
