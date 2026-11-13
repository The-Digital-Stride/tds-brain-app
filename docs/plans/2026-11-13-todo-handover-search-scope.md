# To-dos: who passed it on, new to you, TDS or personal, search and a smaller Add (2026-11-13)

Date: 2026-11-13 · Size: L · Branch: `todo-handover-search-scope` · Explainer: none

## Objective

When a to-do is passed to you, you can see who passed it on and when, and it sits at the top as
"New to you" until you've looked at it. Each to-do is either TDS (work) or personal. Personal ones live
in the brain's private `personal/todo/` folder, which never syncs, but the app lists them alongside the
rest. A search box and filters sit at the top of the drawer, and "Add a to-do" becomes a `+` icon with
a one-line quick add.

## User decisions (fixed)

- Build all five parts (handover details, New to you, TDS/personal, search and filters, compact Add).
- Personal to-dos move to the brain's `personal/todo/` (git-ignored, local to the machine). The app
  reads them as if they were in `todo/`.
- "New to you" covers to-dos passed to you and to-dos someone else created for you recently.
- Older handovers get a git-history fallback.
- No visual explainer. Base branch `main`.

## Who reads and writes to-do files (checked 2026-11-13)

| Reader/writer | Reads | Effect of this plan |
|---|---|---|
| Workbench `tools/members/command-centre/lib/todo-parser.cjs` | `todo/*.md` only, generic frontmatter | Ignores new keys. Never sees personal to-dos (by design). |
| Reminders sync `~/.plaud-reminders/todo-sync.mjs` | `todo/*.md`, generic frontmatter | Ignores new keys. **A paired to-do moved to personal disappears from `todo/`, so the sync completes its TDS reminder** ("ticked/removed"). Accepted; noted to Ian. |
| The app `server/brain/frontmatter.ts` | `todo/*.md` and now `personal/todo/*.md` | Reads the new keys. |
| The brain script `tdsapp-todo.cjs` | writes both folders from v0.4 | See decision 2. |

## Decisions (revised after the overseer's pre-review)

1. **Where a to-do lives is its scope.** `todo/*.md` = TDS; `personal/todo/*.md` = personal (done and
   deleted go to `personal/todo/done/` and `personal/todo/deleted/`). No `scope:` frontmatter key: the folder
   is the truth. A file in `personal/todo/` is listed only when it has frontmatter with `assignee:` equal to
   the current person (people keep private notes there); personal to-dos are never in Open and never counted
   in `othersCount`. A symlinked `personal/todo` is not read.
   Plain: personal to-dos are private files on your Mac; work to-dos stay shared with the team.

2. **The brain script becomes v0.4, every new field optional** (`brain-skills/tdsapp-todo/scripts/tdsapp-todo.cjs`):
   - `capabilities` (new, `{}` in) → `{"version":"0.4","features":[...]}`. `"handover"` always; `"scope"` only
     when the brain is not a git repo or `git check-ignore -q personal/todo/x.md` succeeds, and
     `personal/todo` (if present) is not a symlink. A v0.3 script answers `unknown command` (400) → the app
     treats it as v0.3.
   - `scope: "personal"` on `edit`, `due`, `delete`, `tick`, `assignee`, `move` picks `personal/todo/`
     (absent or `"tds"` = `todo/`; anything else → 400). Personal commands refuse (400) when scope isn't
     advertised (privacy guard failing).
   - `add` with `scope: "personal"`: written to `personal/todo/`, assignee = the adder (`by`, else git user);
     `open: true` or another assignee → 400. New names avoid `todo/`, `todo/done/`, `todo/deleted/` and the
     three personal folders.
   - `add` writes `created_by: <slug>` when the adder is known. `add` with an assignee who is not the adder
     also stamps the handover (no `assigned_from`).
   - `assignee` stamps the handover whenever the value actually changes: `assigned_to: <new slug or "open">`,
     `assigned_at: <ISO, UK offset>`, `assigned_by: <slug>`, `assigned_from: <old slug or "open">`,
     `assigned_via: <via>` (replacing earlier `assigned_*` lines), and appends one line to `## Handover
     history` at the end of the body (created if missing), e.g.
     `- 13 Nov 2026, 14:05 UK: Ben McAdam passed it from ben-mcadam to ian-hancock (TDS Brain App).`
     Unchanged value → nothing written. On a personal to-do → 400 "a personal to-do can't be passed on: move
     it to TDS first".
   - `move` (new): `{file, scope, to, expect?, by?, by_name?, via?}` copies the bytes unchanged to the other
     folder (create new, then unlink; undo on failure) and stamps nothing, so `version` stays the same. Both
     directions require the file's assignee to equal the actor (open or others' → 400). Name clash → `-<n>`
     suffix. Answers `{ok, file: <new name>, moved: <brain-relative path>}`.
   - `list`, `roster` unchanged. v0.3 calls to `edit`, `due`, `tick`, `delete`, `roster`, `list` give
     byte-identical results.
   Plain: the brain's own script still does every write; it now records handovers and can file things privately.

3. **The app never writes these files itself.** Every new change runs through the script. Ticking a personal
   to-do runs the script's `tick` with `scope`; the app's older direct tick (`completeTodo`) stays `todo/`-only.
   Plain: follows the rule that the brain owns its files.

4. **Gate and matching.** `TodoList.canUsePersonal` = `changes === 'on'` and the script advertises `"scope"`
   (probe cached per script real path + mtime). `changeTodo` and the complete route find the listed to-do by
   scope + id; any personal action is refused (`not-allowed`) unless `canUsePersonal`, and must carry `expect`
   (`bad-request` otherwise).
   Plain: a change to a private to-do can never land on a shared one, even with the same file name.

5. **Handover: stamp if current, else git history.** The stamp (`source: 'stamp'`) is used only when
   `assigned_to` equals the current assignee (the Workbench and hand edits change `assignee:` without
   restamping). Otherwise, for TDS to-dos in *mine*, the server runs
   `git log -n 1 -G '^assignee:' --format=%an%x00%ae%x00%aI -- todo/<file>` (spawn, no shell, `cwd` = brain,
   5s timeout, 4 at a time, cached by id + version including nulls). Author → person by roster `email`
   first, then name slug. Skipped when it resolves to the current person or for personal files. Shown as
   "From Ben (git history)" because it is usually the creating commit.
   Plain: it never names the wrong person, and older to-dos still say where they came from.

6. **New to you** = a to-do in *mine* whose handover (stamp or git) is by someone else, dated within the last
   7 days, and whose marker (`handover.at`) isn't in `prefs.todoSeen[key]`. Opening the row (chat or editor)
   marks it seen; "Mark all as seen" marks all. `todoSeen` lives in app prefs; entries whose marker is older
   than 7 days are pruned on write; at most 500. Shown as a "New to you" Fold above Overdue (rows not repeated
   below), a dot per row, and a pip + "N new" in the rail item's accessible name.
   Plain: only things other people gave you show as new, and they can't hide in the list.

7. **Search and filters, in the browser.** Row 1: Mine/Open `Seg` with the `+` icon button at the right.
   Row 2: search (`.field`; `/` focuses it while the drawer is open, Escape clears it) over title, details,
   client name and project, ignoring case and accents. Row 3 only when useful: an All · TDS · Personal `Seg`
   (Mine tab, once a personal to-do exists or `canUsePersonal`) and a client select (2+ clients in this tab).
   Nothing is remembered between visits. Every Fold is forced open while a search or filter is active. No
   matches: "No to-dos match." + "Clear filters"; if the other tab has matches: "2 in Open to anyone".
   Plain: find a to-do fast, and yesterday's filter never hides today's work.

8. **Compact Add.** `+` icon button (`Icon` `plus`, aria-label "Add a to-do") opens a one-line quick add:
   Enter adds it to you, no date. Icon toggles on the line: personal (`lock`, only when `canUsePersonal`),
   date (`calendar`), person (`person`); "More options" shows the existing `AddTodoForm` fields. Starts as TDS,
   or Personal while the Personal filter is showing. Choosing someone else or open turns personal off and
   disables it, with the reason.
   Plain: adding a to-do takes one line and one key.

9. **Changing scope later.** The editor gets a TDS / Personal switch (own to-dos only, when `canUsePersonal`).
   Choosing Personal shows: "Personal to-dos stay on this Mac. They aren't backed up, and the Workbench,
   Reminders and teammates stop seeing them." Save order: edit → due → move → assignee. Choosing another person
   on a personal to-do switches the editor back to TDS ("Passing it on makes it a TDS to-do so they can see
   it"), so `move` (to TDS) runs before `assignee`. The change route's reply carries `moved: {from, to}` keys
   so the next step uses the new id.
   Plain: you decide what's personal, and anything you hand on becomes visible to the teammate.

10. **Automatic classification = the default only.** Everything starts as TDS, with no guessing; nothing is
    ever moved without the person choosing it. (Meetings, Plaud and Slack already write into `todo/`.)
    Plain: nothing becomes personal unless you choose it.

11. **Rows.** Meta gains "from Ben, yesterday" (stamp) or "from Ben (git history)" for a handover by someone
    else in the last 14 days, and a lock icon + "Personal" on personal rows when the scope filter is All. The
    editor shows "Passed to you by Ben McAdam, 12 Nov (TDS Brain App)" or "From Ben McAdam (git history),
    12 Nov". The full history is in the details text.

12. **Ids.** `key` = bare id for TDS, `personal/<id>` for personal; `path` = `todo/<id>` or
    `personal/todo/<id>`. Every client map (held, seen, React keys, chat links) uses `key`; chat drafts use
    `path`. Sessions store `todoId` = `key` (bare id for TDS, so stored sessions keep matching);
    `session-manager.ts` resolves it by `key`.

## Contract

- `shared/contract.ts`: `TodoScope`, `TODO_PERSONAL_DIR`, `TodoHandover`, new `TodoItem` fields (`scope`,
  `key`, `path`, `handover`, `createdBy`), `TodoList.canUsePersonal` and `moved?`, `TodoAction` additions (`scope?` on
  existing kinds, new `move`), complete-route `scope?`/`expect?`, `AppPrefs.todoSeen`, script
  agreement v0.4 doc comment.
- `client/src/shell/contract.ts`: `TodoFilter`, `FilterTodos`, `NewToYou`, `todoMarker`.
- The lead writes both after the overseer's review; builders build against them and don't edit them.

## Backward compatibility (Ian's rule)

- **Old files → new code:** no `assigned_*`/`created_by` → handover from git or null, New-to-you by `created`.
  No `personal/todo/` folder → nothing extra listed.
- **New files → old readers:** new keys are plain one-line `key: value` frontmatter that every parser skips;
  `## Handover history` is ordinary body text. Personal files are invisible to the Workbench and the Reminders
  sync by design.
- **Old app → new script:** sends none of the new fields → v0.3 behaviour plus handover stamps from the git
  user. No breaking change.
- **New app → old script (v0.3):** `capabilities` fails → `canUsePersonal` false; no stamps (git fallback still shows).
- **Behaviour change to announce:** moving a to-do that's linked to a "TDS Reminders" item into personal makes
  the Reminders sync complete that reminder. Personal to-dos aren't backed up (the folder never syncs).
- `personal/todo/` doesn't follow the `tdsapp-` prefix: it's the brain's existing personal folder, chosen by Ian.
- Sessions stored with `todoId` = bare id keep matching TDS to-dos; personal ones use `key` (`personal/<id>`).

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable | (read-only) |
| Lead | me | `shared/contract.ts`, `client/src/shell/contract.ts`, this plan |
| Builder A (brain script) | `builder`, opus | `brain-skills/tdsapp-todo/scripts/tdsapp-todo.cjs`, `brain-skills/tdsapp-todo/scripts/tdsapp-todo.test.ts`, `brain-skills/tdsapp-todo/SKILL.md` |
| Builder B (server) | `builder`, sonnet | `server/brain/todos.ts`, `server/brain/todo-skill.ts`, `server/brain/todo-history.ts` (new), `server/http/routes.ts`, `server/store/app-store.ts`, `server/brain/index.ts`, `server/engine/session-manager.ts` and their `*.test.ts` |
| Builder C (client) | `builder`, sonnet | `client/src/shell/TodosDrawer.tsx`, `TodoForms.tsx`, `Icon.tsx`, `Rail.tsx`, `Home.tsx`, `words.ts`, `client/src/state/todo-groups.ts`, `todo-new.ts` (new), `todo-filter.ts` (new), `attention.ts`, `keys.ts`, `client/src/store.tsx`, `client/src/api.ts`, `client/src/styles/drawers.css` and their tests |

## Tests (written first for logic)

| Test file | Proves | Owner |
|---|---|---|
| `tdsapp-todo.test.ts` | `capabilities`; personal add/edit/due/tick/delete land in `personal/todo/…`; `move` both ways, clash suffix, refuses others'/open; `assignee` stamps + history line only on change, refuses personal; `add` created_by and handover; capabilities privacy guard; v0.3 edit/due/tick/delete/roster/list byte-identical | A |
| `todos.test.ts`, `todo-history.test.ts`, `todo-skill.test.ts`, `routes.test.ts`, `app-store.test.ts` | personal listed with `scope`/`key`/`path`; personal listed only with own assignee; scope+id matching; personal refused without gate or expect; stamp ignored when `assigned_to` ≠ assignee; git author by email; null on failure; capability probe + cache; gate; new actions validated; prefs `todoSeen` capped and pruned by age | B |
| `todo-new.test.ts`, `todo-filter.test.ts`, `todo-groups.test.ts`, drawer tests | New-to-you rules (handover by someone else, 7 days, seen marker; own Reminders items never new); filter by text/accents/scope/client; quick add; scope switch; rail pip | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint (biome) · [ ] Build (no dev server on 3000–3002)
- [ ] Domain gates: security (git spawn, new script paths, personal folder privacy), UX/UI
- [ ] Browser check: to-dos drawer in the dev app with a test brain

## Review outcomes (2026-11-13)

Overseer pre-review: 6 blocking + 8 should items, all taken (decisions above are the revised ones).

Confirmed and fixed:
1. Security (reproduced): the privacy guard checked only `personal/todo/x.md`; a committed symlink
   `personal/todo/done -> ../../todo/done`, a force-added tracked file, or a narrow ignore rule could put
   personal to-dos into synced places. Now every personal read-for-write/write checks `check-ignore` on the
   real path, refuses tracked content (`git ls-files`), refuses symlinks on all four folders and checks
   realpaths. `GIT_*` env scrubbed in the script and the server.
2. Correctness (two reviewers, reproduced against the real script): the app sent no `by`/`by_name` on `add`
   and no actor/`via` on `assignee`, so stamps named the git user and personal add could fail. Now sent.
3. UX + client correctness (two reviewers, reproduced): Edit on a "New to you" undated to-do marked it seen
   and the editor mounted inside the closed "No date" Fold. Rows seen this visit now stay in the group.
4. Search matched raw slugs, not the words shown on the row; fixed via `todoPlaces`.
5. Handover copy could say "passed to you" on an open to-do; now only shown when assigned to you.
6. Personal rows offered edit/tick/delete when `canUsePersonal` was false; now hidden.
7. Stale stamps after a Workbench round trip: the git lookup now checks whether the last `assignee:` commit
   also wrote `assigned_at`; a stamp newer than that commit is kept.
8. Git history lookups capped at 30 uncached per list load.
9. Accessibility: focus kept when controls remove themselves, search results announced, personal warning
   linked by `aria-describedby`, toggle semantics fixed, "Mark all as seen" made a proper small button,
   disabled lock reason reachable, label "Where it's kept".
10. `move` keeps the file mode; SKILL.md matches the script.
11. Browser check (lead): "Open to anyone, N" was cut off by the `+` on row 1; the `+` moved to the search row.

Dropped: none. Accepted gap: a Workbench reassignment not yet committed can't be seen by the git lookup.

Browser check on a throwaway git brain: New to you with "From Ben, yesterday"; personal quick add wrote
`personal/todo/…` with `created_by`, invisible to `git status`; editor switch TDS → Personal moved the file
byte-identical; search "website rebuild" found the project; rail name "To-dos, 4 of yours, 1 new".

Gates: tsc clean; 1,587 tests pass (twice); biome 5 warnings (unchanged from main); build OK.
