# Home: Recent cards show my things, not the team's

Date: 2026-11-25 · Size: L · Branch: `my-recents` · Follows `2026-11-25-home-recent-cards.md` (v0.88.0)

## Objective

Ian: "I would like the recents to be mine, not the team's." Every Recent card on Home lists the person's own
recent things.

## User decisions (fixed)

- **Documents and images:** files *I changed* — my name on the change in the brain's git history — newest first.
- **Recent projects:** mine too — projects I last worked on, judged by my own changes in each project's folder.
- **Recent tasks:** only tasks assigned to me (open-to-anyone ones drop off).
- **Recent chats:** already mine (each install holds only its person's chats); unchanged.

## Facts (checked in code)

- `server/brain/todo-asked.ts` `createAskedLog`: one `git log` per brain and HEAD (cached by HEAD, `rev-parse`),
  `GitLogRunner` with `maxOutput` 2 MB / `timeoutMs` 10 s, a cut log counts as unread. Author lines use
  `--format=%x1e%an%x00%ae%x00%aI`.
- `server/brain/todos.ts:359` `authorSlug(members, team, author)` and `:374` `isSelf(by, email, identity)` match a
  commit author to the person (roster email first, then name slug; email fallback when not on the roster).
- `Library.recent(kind, project?)` (`server/brain/library.ts`) sorts by file `modified` across client and shared
  scopes, personal left out, cap 20. Route `GET /api/library/recent` (`server/http/routes.ts`).
- `ProjectCard.lastChanged` is the last commit on the folder by anyone (`server/brain/projects.ts:597`);
  `recentProjects` (`client/src/state/home-pins.ts`) sorts on it.
- `recentTodos(mine, open, today, me)` in `home-pins.ts`; Home passes `todos.open` too.
- Files Claude writes in a chat are uncommitted until the brain syncs (commit), so git alone misses them for a while.

## Decisions

1. **One "my changes" reader on the server.** New `server/brain/my-changes.ts`: for the person, a map of
   brain-relative path → newest time *they* changed it. From one cached `git log` per brain and HEAD (same shape as
   `createAskedLog`): `--no-renames --name-only --diff-filter=d` with `--author=<email>` and `--author=<name>`
   (OR-ed, to cut the output), each commit then confirmed with `isSelf(authorSlug(...))`. Bounded by
   `--max-count` (proposal: 400 commits) and the 2 MB / 10 s limits; a cut or failed log gives what was parsed
   (newest first). **Plus uncommitted changes** from `git status --porcelain` (they can only be this person's,
   on this machine), timed by the file's mtime, so a file made in a chat shows before the brain syncs.
   Plain: the app works out which files you changed, including ones from your chats that haven't synced yet.
2. **Recent documents and images = files I changed.** `Library.recent` keeps only items whose path is in the map and
   sorts by *my* change time (not file time), ties by path. Personal scope stays out; project filter and cap as
   before. Same route, no new parameter: a new server always answers "mine"; a new app on an older server shows
   the team's files until the server updates (acceptable; they ship together).
   Plain: the cards show files you changed, newest first.
3. **Recent projects = projects I changed.** `ProjectCard` gains `lastMine?: string | null` (ISO): my newest change
   under the project's folder (from the same map; personal projects too, since they're mine — but see 6). Sent by
   `GET /api/projects` (filled when the list is served, not stored). `recentProjects` sorts on `lastMine` and keeps
   only projects with one; meta "You last worked on 24 Nov". Absent (older server) → falls back to today's
   `lastChanged` behaviour.
   Plain: Recent projects lists the projects you worked on, newest first.
4. **Recent tasks = assigned to me only.** Home passes `[]` for open tasks; `recentTodos` keeps TDS scope.
   Plain: tasks open to anyone no longer show there.
5. **Copy.** Empty notes: "Documents you change show here." / "Images you change show here." / "Tasks assigned to
   you show here." / Recent projects shows only when there's one (as now). Help (`help/home.md`), tour text
   ("your newest tasks, chats, documents and images, and the projects you worked on"), playbook, design system,
   What's new 0.88.1. Commit `fix(home)`.
6. **Personal things stay off Home unasked** (v0.88.0 decision 10) — overseer to confirm whether that still holds
   for projects/files that are now strictly the person's own.

## Overseer rulings (pre-review, 2026-11-25)

(a)–(c), (e) approved; (d) personal stays off. These win over the decisions above where they differ.

- **B1 Paths:** `-z` on `git log` and `git status`; status is `--porcelain=v1 -z --untracked-files=all`; skip
  deleted and unmerged entries; a rename carries two paths (keep the new one); compare paths lower-cased.
- **B2 Caching:** the log cached by HEAD **and identity**; status has its own ~5 s cache with shared in-flight reads.
  All git through `runGit` (`todo-history.ts`, `GIT_OPTIONAL_LOCKS=0`, so status never writes the index).
- **B3 Bound by folder:** `git log --no-merges ... -- clients templates projects`, `--max-count=400`; a cut log
  keeps whole records only.
- **B4 Author filter:** `-i -F` with `--author=` for the identity email, the roster email for my slug, and the
  name (OR-ed), then each commit confirmed with `isSelf(authorSlug(...))`.
- **S1** Unreadable history → `recent` answers `partial: true` (the client retries, then shows the failed note);
  never the team's files. Projects: omit `lastMine` (client falls back as on an older server).
- **S2** `lastMine` in one pass: walk each changed path's parent folders against a lower-cased map of project
  folders; `lastChanged` unchanged. `libraryRecent` gains an identity argument.
- **S3** Personal stays off (and `personal/*` is gitignored in the brain). Decision 3 drops "personal projects too".
- **S4** Demo brain: check it has git history; a brain that isn't the repo's top folder counts as unreadable.
- **S5** Tour: text only, no version bump (a third replay in a day).
- Nice: drop `recentTodos`' `open` parameter; `home-items.ts` hint "Shows once you've worked on a project.";
  playbook known gap: gitignored client folders never show.

## Team

| Role | Agent | Owns |
|---|---|---|
| Overseer | `overseer`, fable (resumed from v0.88.0) | read-only |
| Builder A | `builder`, sonnet | new `server/brain/my-changes.ts` (+test), `server/brain/library.ts` (+recent tests), `server/brain/index.ts`, `server/http/routes.ts` (+tests), projects route `lastMine`, `shared/contract.ts`, `shared/projects-contract.ts` |
| Lead | — | `client/src/state/home-pins.ts` (+test), `client/src/shell/Home.tsx` (+test), help, tour, docs |

## Tests

- my-changes: only my commits (email match, name match, someone else's same-name-different-email per `authorSlug`
  rules), newest time per path, deletions skipped, uncommitted files included with mtime, cached per HEAD, cut/failed
  log never throws.
- library recent: only my paths, sorted by my time; project filter; personal excluded.
- projects route: `lastMine` set from my newest change under the folder; null when none.
- home-pins: `recentProjects` with and without `lastMine`; `recentTodos` mine only.

## Review outcomes

Build: Builder A (Sonnet) server (`my-changes.ts` written before its tests; covered by the Opus correctness
review); lead did the client, copy, help, What's new 0.88.1, docs.

- **Security (Opus):** no findings (author values are single argv entries with `-F`, no shell; `GIT_OPTIONAL_LOCKS=0`;
  caps; status paths only stat'ed; personal stays off; failures never throw).
- **Correctness (Opus):** 2 confirmed + 1 edge, all fixed by the lead with tests seen failing first. A failed log was
  cached until HEAD moved (now dropped, as `createAskedLog`); project change/move/archive answers lacked `lastMine`,
  so Home fell back to the team's projects after an edit (now on every list served); mid-merge, staged files of a
  teammate counted as mine (no uncommitted files while `MERGE_HEAD` exists).
- **Browser check (lead, demo brain with a teammate's and Sam's commits plus an unsynced file):** Recent documents
  showed only the unsynced draft and Sam's edited plan, Recent images only Sam's image, Recent projects only the
  project Sam changed ("You last worked on 25 Nov"), Recent tasks only Sam's; no console errors.
- **Gates:** `pnpm check` lint/typecheck/build green; tests green except 5 s time-outs in untouched files at load
  ~270 (rehome-legacy-projects, tdsapp-todo, Shell, change-guards), which pass alone (538/538).
