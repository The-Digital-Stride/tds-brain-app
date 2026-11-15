# Library: delete images and documents, with a team action log

Date: 2026-11-15 · Size: L · Branch: `delete-library-files` · Explainer: https://claude.ai/artifact/K5QxGJEwjNYQwrxsmuctMq (source `docs/delete-files-explainer.html`)

## Objective

Let people delete images and documents from the library. A deleted file moves to a holding folder in
the brain, where anyone can put it back for 30 days before it is erased for good. Every delete, put-back and
erase is written to a user action log that syncs to the whole team.

Plain: a bin button on library files. The file is kept for 30 days in case it's wanted back, and
everyone can see who deleted what and when.

## User decisions (fixed, 2026-11-15)

- **Where it goes:** a brain holding folder that erases its items after 30 days. Not the Mac Bin.
- **Log:** synced to the whole team, everything in it (file names included).
- **Who can delete what:** client files (anyone on the team), templates (the owner only). Personal
  files are **not** deletable from the app in this release.
- **Explainer:** yes.

## Facts (from the code and the brain, read-only, 2026-11-15)

- **The brain has no skill or script that deletes library files, and no action log.**
  - `z-logs/` holds skill usage (`team-usage/`, synced), session markers and `app-usage/` (local). Its README promises
    "no file contents, no client data", so a log of file names doesn't belong in an existing z-logs file.
    `.gitignore` ignores `z-logs/*` except `!z-logs/team-usage/`.
  - `brain-tidy` deletes only on a yes per item during a check-up, and records nothing.
- **Patterns to copy:**
  - `tdsapp-todo` `delete`: the app runs the brain script and never writes the file itself. The script moves the
    to-do into `todo/deleted/` and stamps `deleted_by`, `deleted_at` and `deleted_via: TDS Brain App`. App side:
    `server/brain/todo-skill.ts` (fixed command map, `spawn` with no shell, one-line JSON reply, error
    codes `bad-request | not-found | not-allowed | changed | internal`, a `capabilities` probe cached by
    script path and mtime, and a roles check against the skill's `roles:`).
  - `tdsapp-kits/scripts/tdsapp-usage.cjs`: plain Node, no dependencies. It treats the app as untrusted, caps each line
    and writes one JSON line per event. Its per-member file locking is copied from `.claude/hooks/log-team-usage.cjs`.
- **Library** (`server/brain/library.ts`): scopes are `personal`, `shared:templates` (`templates/`)
  and `client:<slug>` (`clients/<slug>/`). `libraryFile(id)` resolves an id to the file. `versionOf(bytes, mtimeMs)`
  gives a version string. `isNeverListed()` (`library-rules.ts`) hides dot-folders, `node_modules`, `clients/_*`,
  `clients/<slug>/config` and `crm/data`.
- **Roles:** `Role = 'owner' | 'scout' | 'team' | 'unknown'` (`shared/contract.ts:44`), from
  `.team-config/roles.json` (`server/brain/identity.ts`).
- **Starred files:** `favouriteFiles` in `server/store/app-store.ts` (also Home pinned cards).
- **Undo pattern:** the To-dos and Chats drawers hold a change for `TODO_UNDO_MS` with an Undo notice before sending.
- **Known trap:** every non-GET request must be JSON with a `{}` body, or `checkRequest` refuses it with
  415 (memory: test-new-requests-through-gate).

## Decisions

1. **A new brain skill, `tdsapp-files`.** Built in `brain-skills/tdsapp-files/` (`SKILL.md`,
   `scripts/tdsapp-files.cjs`, `scripts/tdsapp-files.test.ts`). It's plain Node with no dependencies. Actions: `delete`, `restore`,
   `purge`, `list-deleted` and `capabilities`. It's the only thing that moves, restores or erases these files and the only
   thing that writes the log. People can also use it from a chat ("put back the logo I deleted yesterday").
   Plain: one small brain tool does all the deleting, so the app never writes brain files itself.

2. **Holding folder: `tdsapp-deleted/` at the brain root** (synced). Each delete makes
   `tdsapp-deleted/<YYYYMMDD-HHMMSS>-<6 hex>/` holding the file under its original relative path, plus
   `record.json` with `{ v: 1, path, scope, deleted_at, deleted_by, deleted_by_name, deleted_via, purge_after, bytes }`.
   It sits outside every library scope, so the library and search never list it. **Overseer: confirmed.** Per-scope
   `deleted/` folders would sit inside `clients/` and `templates/`, where older apps and brain skills would list them as live.
   The script writes `tdsapp-deleted/README.md` once ("Deleted files, not sources. Don't quote them."), so Claude's searches don't
   treat them as current.
   Plain: deleted files wait in one clearly named folder with a note saying where they came from.

3. **Erase after 30 days.** `purge` erases each holding entry whose `purge_after` has passed (deleted plus 30
   days, `PURGE_AFTER_DAYS`) and logs one `purge` line per file. The app runs it when it starts and once a day after that
   (an in-process timer, not a new launchd job). The timer is `unref`'d, queued through the runner and skipped in setup mode.
   **Overseer: keep the daily timer.** The app runs for weeks under launchd, so purging only at start-up would rarely happen.
   It's safe when several team Macs run it: an entry that's already gone is skipped.
   **It fails closed.** It erases only when the holding id matches `HOLDING_ID_PATTERN`, `record.json` parses, and both
   `purge_after` and the date in the folder name are 30 days past. It logs `purge` only when a file was really erased. It skips
   the whole run while `.git/MERGE_HEAD`, a rebase folder or `.claude/sync.lockdir` exists. It never touches `log/` or `README.md`.
   Erasing removes the file from the brain folder. Git history still has it, which is fine for recovery but means this is not erasure in
   the GDPR sense (out of scope).
   Plain: after 30 days the file is gone for good, whichever team member's app gets there first.

4. **The action log: `tdsapp-deleted/log/<member-slug>.<machine-id>.jsonl`, synced.** **Overseer: changed from
   `z-logs/tdsapp-actions/`.** The `z-logs/` README promises a local log free of client data that's safe to delete, and if the
   `.gitignore` line were ever missing the log would quietly stop syncing. This location needs no brain `.gitignore` change.
   It uses one file per person per Mac: someone on two Macs appending to one file would get a rebase conflict and stall their own sync,
   which the overseer reproduced. `machine-id` is kept outside the brain (see the contract). Each line is added, never edited:
   `{ v: 1, ts, action, by, by_name, via, scope, path, bytes, holding }`, where `action` is `delete | restore | purge`. Readers skip actions
   they don't know, so later actions can join. The `member-slug` follows `log-team-usage.sh`'s rule exactly. The log is
   plain text: don't copy that hook's "locking", which is sealing with a key, not a file lock.
   Plain: one running list per person, shared with the team, saying what was deleted, by whom and when.

5. **Who can do what. The script checks this itself and doesn't trust the app.**
   - `clients/<slug>/…` files: owner, scout and team.
   - `templates/…` files: owner only. The bin isn't shown to anyone else, and the script refuses with `not-allowed`.
   - Anything else, including `personal/`, `todo/`, `tdsapp-deleted/` and never-listed paths, is refused with `not-allowed`.
   - Only a regular file. Not a folder, and not a symlink or a path that resolves outside its scope (`realpath` is checked after resolving).
     Only extensions the library lists as an image or document (the allow-list is mirrored, and a test checks the two match).
   - `expect` (the library version) must match, or the reply is `changed`.
   - **Blocking fix: git-ignored files are refused.** Some files are kept on each Mac only, for example `clients/*/data/semrush-rankings.csv`,
     `clients/*/auction-insights/*.html` and `blueprint/research-inputs/raw/`. Those `.gitignore` rules are anchored to the root, so a copy
     moved under `tdsapp-deleted/` would be committed on the next sync. The overseer proved this in a scratch repo. The script runs
     `git check-ignore` on the source and refuses with `not-allowed` when it matches, or when git can't answer (fail closed, using
     tdsapp-todo's `gitInBrain` pattern).
   - Protected names are refused: `CLAUDE.md`, `AGENTS.md` and `README.md` anywhere, and `clients/<slug>/profile.md` (`PROTECTED_*` in the contract).
   - The role comes from this Mac's git identity checked against `.team-config/roles.json`, never from stdin `by`.
   - Case variants of never-listed folders (`Clients/x/Config/`) are refused like the lower-case ones.
   - `restore`: the same rules as delete for the original path. It never reads `bytes` (a teammate's later edit can arrive in holding
     through git's rename tracking). It recreates a missing parent folder. If something now exists at that path, the reply is `exists` and
     nothing is overwritten. If the move fails, it stops: there's no copy fallback. `list-deleted` flags an entry whose file no longer matches
     its `bytes` as "changed after deletion".
   Plain: anyone can tidy client files, only the owner can remove templates, and nothing outside those
   folders can be touched.

6. **App route: `DELETE /api/library/items/:id`** with a JSON `{ expect }` body. The library now sends `version` and
   `canDelete` on each `LibraryItem` (optional fields, landed by the lead in `shared/contract.ts`). `canDelete` covers capability, scope,
   role, ignored files and protected names, so the client never works this out itself. The server resolves the id with `libraryFile`,
   refuses scopes the role can't use (early, for a clear message), then runs the script with the relative path. On success it
   removes the id from `favouriteFiles` and calls `notifyChanged()`. The script runner reuses `todo-skill.ts`'s runner
   (the shared parts are moved out into `server/brain/skill-runner.ts`, which `todo-skill.ts` then imports).
   Plain: the app asks the brain tool to do the delete, then tidies its own stars and cards.

7. **UI.** There's a trailing `icon-btn` bin (labelled "Delete <title>") on library tiles and rows, and in the `ViewerDrawer` header.
   It's shown only when `item.canDelete` is true. Delete is held for `TODO_UNDO_MS` with Undo, and nothing is sent until the time
   is up. The notice doesn't name a "Deleted" place, because the app doesn't have one. Draft wording: "File deleted. It's kept for 30 days:
   ask Claude to put it back." A send when the page closes uses the same JSON request, and a refresh during the hold doesn't
   bring the row back. If it fails, the file comes back with a plain message. The
   viewer closes and focus moves to the next file. *UX gate settles the exact words and focus.*
   Plain: a bin button with a few seconds to change your mind.

8. **Put back (in-app list): overseer: left out of this release.** Undo covers mistakes in the moment, and the `tdsapp-files`
   skill covers "put it back" from a chat. That holds only if `restore` and `list-deleted` ship tested and the notice and help page
   both say "ask Claude to put it back". The risk to watch is whether people find that out. A "Recently deleted" list can follow later.
   Plain: in this release, getting a file back after the Undo has gone means asking Claude.

9. **Backward compatibility.**
   - A new app with an old brain (no `tdsapp-files`): the bin is hidden.
   - An old app with a new brain: nothing changes.
   - The new route and the optional `BrainFns` members don't affect test fakes without them.
   - The log and record lines are versioned (`v: 1`), and readers skip fields they don't know.
   - The `todo-skill.ts` refactor keeps its exports and behaviour (its tests are unchanged and must pass).
   Plain: older copies of the app and the brain keep working.

## Contract

`shared/files-contract.ts` (in this branch). The script's command line:
`node tdsapp-files.cjs <action>` with one JSON object on stdin, and one JSON line on stdout:
`{ ok: true, … }` or `{ ok: false, code, error }`. Exit 0 means ok, exit 2 means refused, anything else means internal.

## Team and file ownership

| Role | Agent and model | Why | Owns |
|---|---|---|---|
| Lead | main session | plan, contract; lands every shared type before building | this plan, `shared/files-contract.ts`, `shared/contract.ts` (all lines for this feature) |
| Overseer | `overseer`, fable, high | plan critique, sign-off | read-only |
| Builder A (brain script) | `builder`, **opus** | Hard list: data integrity. The script moves and permanently erases shared files and decides who's allowed | `brain-skills/tdsapp-files/**`, `brain-skills/README.md` |
| Builder B (server) | `builder`, sonnet | default | `server/brain/skill-runner.ts` (new, +test), `server/brain/files-skill.ts` (new, +test), `server/brain/todo-skill.ts` (import only), `server/http/routes.ts` (+test), `server/brain/library.ts` (+test: `version`, `canDelete`), `server/index.ts` (purge timer), `server/setup-mode.ts` |
| Builder C (client) | `builder`, sonnet | default | `client/src/api.ts` (+`api.test.ts`), `client/src/store.tsx`, the library tile/row components, `client/src/shell/ViewerDrawer.tsx`, `client/src/shell/Icon.tsx` (reuses `bin`), their tests, a new `help/deleting-files.md` and the what's-new line (`docs/help-standard.md` §6) |
| Reviewers | `reviewer`: correctness opus high, security opus high, UI/a11y sonnet medium | | read-only |
| Gates | Security `expert` opus high (deleting files on request, path traversal, roles); UX `expert` opus high | | read-only |

## Tests (tests first for the script and the runner)

| Test | Proves | Owner |
|---|---|---|
| `tdsapp-files.test.ts` | moves to holding with a correct `record.json`; logs one line; templates refused for a non-owner; personal, todo, holding and never-listed paths refused; symlink or `..` escape refused; folder refused; `changed` on version mismatch; two deletes of one file → second `not-found`; `purge` erases only past `purge_after` and logs it; second purge is a no-op; `restore` puts it back and logs, `exists` when occupied; extension allow-list matches the library's; **git-ignored source refused, and git unable to answer → refused**; protected names refused; `Clients/x/Config/` case variants refused; holding-id and tampered `record.path` escapes refused; restore when the parent folder has gone; malformed `record.json` never purged; purge skipped during a merge, rebase or sync lock; log file named per Mac | A |
| `library.test.ts` | `version` equals `versionOf` for the same file (parity with the script's `expect`); `canDelete` false for templates unless owner, for ignored files, for protected names, and without the capability | B |
| purge timer test | runs at start-up and daily under fake clocks; skipped in setup mode; never overlaps itself | B |
| `skill-runner.test.ts`, `files-skill.test.ts` | fixed command map; no shell; output cap; timeout → internal; codes mapped to UK messages; capability probe cached | B |
| `routes.test.ts` | DELETE through the real `checkRequest`; codes → statuses; stars cleared on success only | B |
| client tests | bin shown only when `canDelete`; Undo cancels with no request; failure brings it back; focus moves on; a refresh during the hold doesn't bring the row back | C |
| `api.test.ts` | the real `checkRequest` accepts the client's DELETE, including the send when the page closes (last time's 415 came from the client) | C |

## Brain steps (each needs Ian's yes at the time)

1. Copy `brain-skills/tdsapp-files/` into `~/agencybrain/.claude/skills/` (without its test), with `roles: owner, scout` and
   `maturity: draft` until Pete releases it.
2. ~~Add `!z-logs/tdsapp-actions/` to the brain's `.gitignore`.~~ Dropped: the log now lives in `tdsapp-deleted/log/`.
3. Tell `brain-tidy` (Pete) that `tdsapp-deleted/` is managed, so it isn't offered as dead weight.

## Risks

- Big files keep syncing to everyone for up to 30 days (accepted with the choice of a holding folder).
- Git history keeps every deleted file. That's good for recovery, but it isn't erasure.
- Two people delete or restore the same file at once: the script's move is the lock, because a rename fails if the source has gone.
- If A deletes a file while B edits it, git follows the move and B's edit lands in holding with no conflict. It's recoverable, and
  `list-deleted` flags it.

## Gates

- [ ] `pnpm check` · [ ] numstat deletion scan
- [ ] Security gate, UX gate
- [ ] Browser check on port 3180 against a **scratch copy** of a brain (never the live brain)

## Overseer pre-review (2026-11-15, Fable)

Folded into the decisions above. The lead checked the blocking items in the code: the `.gitignore` lines (212–235) and the
library rules don't hide `clients/*/data/`, and `LibraryItem` had no version.
- **Blocking:**
  1. Deleting a git-ignored file would publish it. Fixed in decision 5.
  2. The contract had gaps (`version`, `canDelete`), and `library.ts`, the help page and what's new had no owner. Fixed in decision 6
     and the team table.
- **Should, all taken:**
  - one log file per Mac;
  - purge and restore fail closed, with the role taken from git identity;
  - edit-versus-delete flagged;
  - protected names;
  - keep the daily timer;
  - extra tests.
- **Nice, taken:**
  - a README in the holding folder;
  - don't copy the hook's "locking";
  - keep Opus for builder A;
  - the notice doesn't name a place the app doesn't have.
- **Verdicts:** decision 2 confirmed; decision 4 changed to `tdsapp-deleted/log/`; decision 8 leaves the in-app list out.

## Review outcomes

- **Build.** Three builders worked in parallel:
  - Script: Opus, 46 tests.
  - Server: Sonnet. It moved the shared runner into `skill-runner.ts` and added `purge-timer.ts`.
  - Client and help: Sonnet.

  The lead moved the Undo line into `SheetNotices`, so a delete started from Home or a chat's viewer also offers Undo.
- **Correctness review (Opus).** Two confirmed findings, both fixed by the lead with tests that fail without the fix:
  1. The listing read mtime with a plain stat. A time stamp of x.999999999 s rounded up a millisecond, so the bin always answered "changed". The walk now uses a bigint stat, as `file()` and the script do.
  2. `canDelete` was only set on full listings, so the viewer opened from Home or a chat never showed the bin. `deletableItem()` now sets it in `file()` (before `check()`, because `readChecked` trusts only that object) and in `itemForPath()`.
- **Security gate (Opus).** Nothing blocking. One gap, fixed by the lead with a test: a file inside a separate git project (a `.git` folder or file in any folder between the brain root and the file) is now refused, failing closed. Until the brain's next sync, git called such files not ignored, and moving one into holding would have published it.
- **UX gate (Opus).** Two blocking findings and six should-fix findings, fixed by a Sonnet fix agent:
  - an always-mounted status line, with the hold pausing while you point at or focus the Undo line;
  - `aria-disabled` on the bin;
  - the bin on the picture's corner;
  - the shown name used everywhere, with the label "Delete file: <name>";
  - a row placeholder so rows line up;
  - the help wording;
  - a design-system entry.
  The lead rewrote the error and notice copy in `shared/files-contract.ts` (`filesDeletedNotice(name)`).
- **Browser check** (preview on 3878, a throwaway brain with a test identity):
  - bins show on the audits and Keywords, but not on the git-ignored Semrush file or `profile.md`;
  - a delete moved the file to `tdsapp-deleted/<id>/`, wrote `record.json` and one log line in `ian-hancock.<machine>.jsonl`;
  - Undo kept the file and sent nothing;
  - the status line read "Keywords deleted. Undo is at the top of the page.";
  - the bin shows in the viewer.

  It caught one regression the tests missed: the fix agent's new tile wrapper reused the existing class `.lib-pic` (the viewer's picture box, `.tray .lib-pic { display: grid; place-items: center }`), which squashed tile thumbnails to 1×0 px. The lead renamed it `.lib-tile-pic`.
- **Correctness re-review of the fix round (Opus).** Two should-fix findings, both confirmed and fixed by the lead, with tests that
  fail without them:
  1. The pointer and focus shared one pause, so a mouse leaving restarted the clock while focus sat on Undo.
     Each held line now tracks the two on their own (`HeldLine`).
  2. Closing or binning a chat replaced the shared notice timer and left `fileNotice` set, so it could be spoken again later.
     It's now cleared in both chat paths.

  On its "consider" point, the deletable ids are now cached per listing (`deletableIds`), so a gallery's thumbnail requests cost a
  Set lookup each. A new test checks that a deletable `file()` still reads through `readChecked`. Not tested: the
  script failing closed on an lstat error other than ENOENT/ENOTDIR, because any setup that triggers it also blocks the file
  earlier.
- **Overseer sign-off (Fable).** Signed off, with no blockers. It read the script in full and ran the feature's 141 tests. Its verdicts and
  follow-ups, all built by the lead:
  - (a) For `FILE_DELETE_GUARD_MS` (600 ms) after a delete, further bin presses are ignored, by pointer or keyboard, with a test: a
    delete slides the next row's bin under the pointer, and a held Enter would otherwise delete row after row.
  - (b) The tile keyboard order (select, Delete, name, Open) is accepted: focus follows what the eye sees.
  - `mayDeleteIn` gives no bin to an `unknown` role (with a test).
  - Stale contract comments were fixed (`by` is never read; the log path; `logged` and `changed_after_deletion` added to `FilesReply`).
  - The explainer said Undo lasts 5 seconds; it's 10 (`TODO_UNDO_MS`) and pauses while you point at or focus the Undo line.
    The explainer is now corrected and republished.
- **Gates.** `pnpm check` is green (3443 tests) apart from the known `Shell.test.tsx` load flake, which passes alone (38/38). The numstat scan shows only `todo-skill.ts` (−143), the runner moved out on purpose, with its tests unchanged.
