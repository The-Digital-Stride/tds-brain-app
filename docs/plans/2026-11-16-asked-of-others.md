# Asked of others and to-do history (to-do programme, release 2)

Date: 2026-11-16 · Size: L · Branch: `asked-of-others` · Explainer: none (Ian: no)

## Objective

Ian passes to-dos on to the team and loses sight of them: once a to-do is someone else's, the app shows
only "N more belong to other people". This release adds an "Asked of others" list (what he passed on,
who has it, and who finished it and when) and a History section in the to-do panel built from the
brain's git record, so he can see how any to-do got to where it is.

## User decisions (fixed)

- Release 2 of 3 in the to-do programme (release 1, the panel, is v0.42.0, pushed). Merge before
  release 3 (attachments) starts.
- History may read the brain's git record, read only (Ian, 2026-11-16). The app still never writes a
  brain file or runs a git command that changes the brain.
- No visual explainer.
- Standing rules: UK English in UI text; never copy real to-do bodies into the repo; never save or
  tick to-dos in the real, shared brain from a preview; keep old files, callers and app versions working.

## Facts (live brain, read only, 2026-11-16)

- 182 open, 202 done and 4 deleted to-dos. Stamps are new and sparse: 4 open and 1 done carry
  `assigned_by`; 13 open carry `created_by`; 80 done carry `completed_by` (slugs) and `completed_at`.
- Every change reaches git through each Mac's auto-sync (`auto-sync: <date time>`), authored by that
  Mac's git user. 550 commits touch `todo/`. Pete's Mac authored 364, so a change made in a shared
  Workbench may be credited to the Mac that synced it, not the person: git authorship is a hint, the
  stamps are the truth.
- `git log -G '^assignee:' --no-renames --name-status --format=… -- todo` is one run, ~0.3 s, ~73 KB.
  Moving to `done/` shows as D `todo/x` + A `todo/done/x` (auto-sync commits both at once).
- `git log --follow -p -U0 -n 40 -- todo/done/<id>` for one to-do: ~0.35–0.7 s, a few KB.
- A rough count with git authorship alone finds 9 waiting and 5 done to-dos Ian passed on.
- `server/brain/todo-history.ts` already has a safe git runner (no shell, scrubbed env without GIT_*,
  `GIT_OPTIONAL_LOCKS=0`, 5 s timeout, 64 KB output cap, 4 at a time) used for "Passed to you by".

## Decisions

1. **"Asked of others" is a third tab in the To-dos drawer.** The three tab labels become
   "Mine, 61" / "Open, 4" / "Asked, 9" (overseer: each button has ~78 px of text, so the long labels
   would be cut; the count is waiting only). The full phrase "Asked of others" leads the tab as a quiet
   first line and in its empty state. Two folds: "Waiting" (oldest ask first, so the longest-waiting shows first) and "Done" (most recent
   finish first, last ASKED_DONE_DAYS = 60 days). Each row: title, who has it or who finished it, and
   when. The asked list loads with the drawer, as its own request that never blocks or fails the main list
   (overseer S3), and again whenever the drawer reloads its to-dos; `GET /api/todos` is unchanged. No
   "new" dot on finished items in this release (overseer: can be added client-only later).
   If Ian passed it to Ben and Ben passed it on, only the latest hand-over counts, so it leaves Ian's
   list (8 chains in a year, none Ian's); the help page says so.
   Plain: a new tab lists what you've passed on and shows at a glance what's still waiting and what's done.
2. **Who asked: the stamp first, then git, then `created_by`.** For each file in `todo/` and
   `todo/done/` whose `assignee:` is a team member other than the person:
   a. stamp: `assigned_to` equals that assignee → asked by `assigned_by` (source 'stamp', `at` = `assigned_at`);
   b. else git: the newest commit with status A or M (never D) on the top-level path `todo/<id>` whose
      diff changes an `assignee:` line → its author, matched to the team by email then by name
      (the existing `historyHandover` matching), source 'history';
   c. else, only when the file has no `assigned_to` line and git has no assignee commit for it,
      `created_by` → that person, `at` = `created` (source 'stamp') (overseer S4).
   The stamp is used even if a later round trip outside the app made it stale (overseer N3: none is today).
   Git authorship stays as a labelled fallback: where both exist, the author matched the stamp 102/102.
   It is "asked of others" when that person is the current person. Done files use the history of their
   top-level path, so the tick itself never counts as an ask. Personal to-dos, open-to-anyone to-dos and
   to-dos now assigned to the person are never listed.
   Plain: the app trusts what the app and skill wrote in the file, and falls back to the sync record only
   when there's nothing written.
3. **Who finished: `completed_by`/`completed_at`, else git.** The done actor is the stamp when present
   (slug → roster name, source 'stamp'); else the author and date of the commit that added
   `todo/done/<id>` (source 'history'); else the file's `completed` date with no name.
   Plain: "Done by Simon, 14 Nov" comes from the tick record where there is one.
4. **One git run for the whole list, cached.** `askedTodos` runs the single `-G '^assignee:'
   --name-status` log over `todo/` (and one `--diff-filter=A --name-only` log over `todo/done/` for
   finish dates when stamps are missing, or folds it into the same run), with its own output cap
   (2 MB) and timeout (10 s), only the parsed git log is cached, by the brain's HEAD commit (`git rev-parse HEAD`, read only);
   the files are re-read on every call, so a to-do passed on a moment ago shows before the next sync
   (overseer S1). The runner reports when it cut the output; a cut or failed log means stamps only and
   `historyRead: false`, never a silently short list (overseer S2).
   Plain: opening the tab costs well under a second and doesn't slow the rest of the app.
5. **History is one git run per to-do, on demand, without rename following.** `GET /api/todos/history?key=`
   checks the key names a real file (`todo/<id>`, `todo/done/<id>` or, for asked keys, the folder named),
   then runs `git log --no-renames -p -U0 --no-ext-diff --no-textconv -n TODO_HISTORY_MAX+1 --format=…
   -- todo/<id> todo/done/<id> todo/deleted/<id>` and turns each commit's frontmatter and body hunks into
   TodoEvents. Overseer B1: `--follow` lost the record at the tick for 33 of 203 done to-dos (the tick
   adds more text than a short to-do keeps), showing the tick as "created". So a D and an A of the same
   id in one commit is a move: done or deleted by destination, no `details` event for the move itself,
   and done → `todo/` (un-tick) is `changed`, never `created`. History has its own 512 KB cap; cut
   output means `more: true` and only whole commits are parsed, never a half hunk. The actor for an event is the
   stamp the same commit added (`+assigned_by:` for passed-on, `+completed_by:` for done, `+deleted_by:`
   for deleted, `+created_by:` for created), else the commit author (source 'history'). Cached by
   path + HEAD (overseer N2). Personal keys answer `status: 'personal'` without running git.
   Plain: opening History shows who created it, passed it on, renamed it, changed the date or details,
   and ticked it, newest first.
6. **Keys are checked, never trusted.** The history key must match `^(personal/)?<SAFE_ID>$` or
   `^asked:todo/(done/)?<SAFE_ID>$` (SAFE_ID as in `todos.ts`), the file must be a real file (lstat, not
   a link), and git always gets `--` before the path. Bad shape → 400; no file → 404.
   Plain: the history route can only ever read a to-do's own record.
7. **The panel opens asked to-dos read only.** An AskedTodo opens in the same slide-out panel: title,
   "With Ben McAdam since 13 Nov" or "Done by Ben McAdam, 14 Nov", due date, formatted details (no tick
   boxes to tick), and History. No Edit, Tick, Pass on, Delete or chat-start: it's someone else's.
   Previous/next walk the asked tab's order like the other tabs.
   Plain: you can read anything you've passed on in full, but you can't change someone else's to-do.
8. **History is a closed fold at the bottom of the panel's read view, for every TDS to-do.** It loads
   when first opened (not on every panel open), shows a short loading line, then a list:
   "13 Nov, 14:05 · Ian Hancock passed it to Ben McAdam". A 'history' actor's line ends "(git history)", the
   wording "Passed to you by" already uses (overseer N1); the narrow drawer row leaves the label out. 'personal' says
   "Personal to-dos aren't synced, so there's no history." 'unavailable' says "History isn't available
   in this brain." `more` adds "Older changes aren't shown."
   Plain: the panel can tell you how a to-do got here without cluttering it.
9. **Everything new is additive.** New routes, new reader methods and new types; `TodoList`,
   `GET /api/todos` and the to-do skill are unchanged, so an older app and the Workbench are unaffected.
   Plain: nothing that already works changes.

## Contract

`shared/contract.ts`: `TodoFactSource`, `TodoActor`, `AskedTodo`, `ASKED_DONE_DAYS`, `AskedTodoList`,
`TodoEventKind`, `TodoEvent`, `TODO_HISTORY_MAX`, `TodoHistoryResponse`, `BrainReaders.askedTodos`,
`BrainReaders.todoHistory`, `ROUTES.askedTodos`, `ROUTES.todoHistory`.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (server) | `builder`, opus | hard list: an engine with tricky rules (git log parsing, attribution precedence, rename following) and data integrity of who-did-what | `server/brain/todo-asked.ts` (new), `server/brain/todo-timeline.ts` (new), their tests, `server/brain/todo-history.ts` (runner options for cap/timeout only), `server/brain/todos.ts` (export `SAFE_ID`/team helpers only), `server/brain/index.ts`, `server/http/routes.ts` and its tests, every test fake that implements `BrainReaders` |
| Builder B (client) | `builder`, sonnet | default (UI) | `client/src/api.ts`, `client/src/store.tsx`, `client/src/shell/TodosDrawer.tsx`, `client/src/shell/AskedList.tsx` (new), `client/src/shell/TodoHistory.tsx` (new), `client/src/shell/TodoPanel.tsx`, `client/src/shell/words.ts`, `client/src/styles/todo-panel.css`, `client/src/styles/drawers.css`, client tests for these, help pages (`help/todos.md`, `help/passing-todos-on.md`, new `help/asked-of-others.md` if the help index takes it) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/brain/todo-asked.test.ts` | stamp beats git beats `created_by`; a stamp by someone else means not asked by me; a D entry and the done/ A entry never count as the ask; open, personal and my-own to-dos are left out; done older than 60 days left out; git failure → stamps only, `historyRead: false`; cache reused for the same HEAD | A (tests first) |
| `server/brain/todo-timeline.test.ts` | one commit → created/passed-on/retitled/due/details/done/deleted events from a fixture `git log --no-renames -p -U0` output; actor from the same commit's stamp beats the author; a tick as D `todo/x` + A `todo/done/x` in one commit is one `done` event (no created, no details); an un-tick is `changed`; cut output → `more` with no half-parsed commit; `more` when 41 commits; personal → no git run; bad keys refused before any git run | A (tests first) |
| `server/http/routes.test.ts` (or the existing to-do route test) | 400 for bad key, 404 for missing, `no-store` | A |
| `client/src/shell/AskedList.test.tsx` | rows show who has it / who finished it; empty and `historyRead: false` lines; opening a row opens the panel read only | B |
| `client/src/shell/TodoHistory.test.tsx` | loads only when opened; event wording; personal/unavailable/more lines | B |
| `client/src/shell/TodoPanel.test.tsx` | an asked key shows no Edit/Tick/Pass on; prev/next walks the asked order | B |

## Gates

- [x] Type-check · [x] Tests (3,736) · [x] Lint (0 errors) · [x] Build
- [x] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'` (none)
- [x] Domain gates: security (runs git with a request-derived path), UX (new tab, panel fold)
- [x] Browser check: drawer tab at desktop and phone width, panel read-only asked to-do, History fold
      (preview on port 3878 with its own data folder; never save or tick in the real brain)

## Review outcomes

- **Overseer pre-review** (Fable): blocking B1 — `--follow` lost the record at the tick for 33/203 done
  to-dos; confirmed by a sample (4/60) and fixed in decision 5 (`--no-renames` over the three paths, D+A
  pairing). Shoulds S1–S4 and nices N1–N2 folded into decisions 1, 2, 4, 5, 8. N3 accepted.
- **Security** (Opus): no findings (key shape, `--`, env scrub, caps, timeouts, cache bounds, personal
  to-dos never reach git).
- **Correctness** (Opus): (1) a request sharing an in-flight asked-log read got its failure as a throw, so
  the drawer showed an empty list instead of stamps only — fixed (`hit.log.catch(() => 'unread')`) with a
  test that fails without it; (2) three client behaviours untested (reload re-fetch, stale-response guard,
  History reset on prev/next) — tests added. Real-brain checks: 9 waiting / 5 done; all 381 histories start
  with `created`, every done to-do has its `done` event.
- **UX** (Opus expert): History load not announced (status line added); "Try again" showed no progress
  (loading reset + `role="status"`); two names for the git record (now "git history" everywhere, footnote
  explains the sync record); "passed on by you" wrong for to-dos added for someone (dropped); rows and panel
  worded differently (aligned, first names, no due on done rows); no reason given for the missing buttons
  (read-only note); History shown on personal to-dos (hidden); vague loading text; help wording; prev/next
  into a closed fold lost focus on close (fold now opens for the panel's to-do).
- **Lead browser check**: desktop and phone width, asked rows, read-only panel (waiting and done), History
  with stamped and git names, prev/next across folds with focus returning to the row. No console errors.
