# App change guards and the merge-and-push card

Date: 2026-11-25 · Size: L · Branch: `app-change-guards` · Explainer: none (Ian said no)

## Objective

Only owners and scouts can change TDS Cortex's own code from a Cortex chat, and nothing is merged or
pushed from a Cortex chat until the person presses a button on a dedicated confirm card. Claude never asks
"shall I merge and push?" in the chat.

## User decisions (fixed, Ian, 2026-11-25)

- Scope: the guard covers Cortex chats **and** GitHub (protect `main` on `The-Digital-Stride/tds-brain-app`).
- Every merge or push from a Cortex chat, in **any** repo, needs the confirm card. App releases get a fuller card.
- When a team member's change to the app is refused, Claude offers a **Feature Request** task in the
  **TDS Cortex Feedback** project (`the-digital-stride/tds-cortex-feedback`), assigned to that project's
  Account Owner (the card's `owner:`, Ian today).
- `tdsapp-todo` opens to the team: `roles: owner, scout, team` (brain copy and `brain-skills/` copy).
- No visual explainer.

## Facts established (spike 2026-11-25, `/tmp/acg-spike/spike.mjs`, SDK 0.3.322)

- A `PreToolUse` hook answering `permissionDecision: 'ask'` makes the engine call `canUseTool` in `auto`,
  `default` and `acceptEdits` modes, **and** when an allow rule (`allowedTools: ['Bash']`) already covers the
  call. So "ask" cannot be skipped by auto mode or by an earlier "Allow for this chat".
- `/update-cortex` and `/install-cortex` run, in the installed app folder: `git -C "$APP" status|fetch|log|show`,
  `git pull --ff-only`, `git clone <official url> "$APP"`, `npx --yes pnpm@10 install --frozen-lockfile`,
  `npx --yes pnpm@10 build`, `"$APP/bin/tds-brain" restart|doctor|install`. Team members run these.
- GitHub today: repo public, `main` unprotected; collaborators `thedigitalstride` (admin), two read-only.

## Decisions

1. **Who may change app code.** Allowed: `role` `owner` or `scout` from `opts.brain.identity()`, read when the
   tool call happens (not at chat start, so a role change applies at once). `team` and `unknown` are refused
   (fail closed).
   Plain: a team member's Claude in Cortex can't edit, commit or push the app's code, even if asked.
2. **What is app code.** Any path inside: (a) `config.appRoot` (the running copy), (b)
   `~/Library/Application Support/TDS Brain/app`, (c) any git repo or worktree whose `remote.origin.url`
   names `The-Digital-Stride/tds-brain-app` (case-insensitive, https or ssh, with or without `.git`). Repo
   lookups are cached per repo root for the life of the server. Paths are compared after `realpath`
   (falling back to `resolve` for paths that don't exist yet).
   Plain: the installed app and any copy of its code on the Mac count.
3. **What a team member may still do there.** Read, Grep and Glob are never refused. Write, Edit, MultiEdit
   and NotebookEdit into app code are refused. A Bash command that touches app code (decision 4) is allowed
   only if **every** segment is on the update allowlist (overseer B1: no free pass for segments without an
   app path, so `cd "$APP" && sed -i …` is refused). Backslash-newlines are joined first, then the command
   is tokenised respecting quotes and split on `&&`, `||`, `;`, `|`, `&`, newlines. Allowlist:
   `cd <path>`, `NAME=value` assignments, `export NAME=…`, `git [-C p] fetch [--quiet]`,
   `git [-C p] log|show|rev-parse|ls-remote|status` (read forms), `git [-C p] pull --ff-only` (no URL or
   refspec), `git clone https://github.com/The-Digital-Stride/tds-brain-app.git <path>`,
   `[npx --yes] pnpm[@10] install --frozen-lockfile`, `[npx --yes] pnpm[@10] build`, `<app root>/bin/tds-brain
   <subcommand…>` (only under an app root), `test`, `[ … ]`, `ls`, `cat`, `head`, `tail`, `echo`, `printf`,
   `printenv`, `mkdir -p`, `stat`, `node --version`, `node -v`, and exactly
   `node -p 'require(process.argv[1]).version' <path>`. Any git segment with `-c`, `--config-env`,
   `--upload-pack`, `--exec`, `--output` or `--receive-pack` is refused. Output redirection other than to
   `/dev/null` or `2>&1`, `tee`, and command substitution (`$(…)`, backticks) are refused. The literal blocks
   in update-cortex, install-cortex and doctor-cortex `SKILL.md` are test vectors and must all pass.
   Plain: team members can still install, update and check Cortex; they just can't change it.
4. **When a Bash command "touches app code".** After stripping quotes and backslash escapes: the hook
   input's `cwd` is inside app code, or any path-like token (after `~`, `$HOME`, `${HOME}` expansion) is
   inside app code by `isAppCodePath`, or the text contains `TDS Brain/app`, `$APP`/`${APP}`, or
   `The-Digital-Stride/tds-brain-app` (case-insensitive). The bare word `tds-brain-app` is **not** a marker:
   the brain has a project folder of that name (overseer B3).
5. **The refusal.** The hook denies with `TEAM_APP_REFUSAL` (contract) as the reason, and emits a warning
   notice to the person: "Only owners and scouts can change TDS Cortex. Claude can add your idea as a feature
   request instead." The reason tells Claude to offer, and only on a yes with the wording approved, run
   `tdsapp-todo add` with `client: the-digital-stride`, `project: the-digital-stride/tds-cortex-feedback`,
   `stage: Feature Request`, `assignee:` the `owner:` from
   `clients/the-digital-stride/projects/tds-cortex-feedback/project.md`, `via: TDS Cortex`.
   Plain: a refused request turns into a feature request for the Feedback project, if the person wants.
6. **What counts as merge or push (every role, every repo).** Heredoc bodies are stripped first (a commit
   message that mentions "git push" isn't a push), then the command is tokenised respecting quotes. Any
   segment, wherever `git` appears in it (after `then`, `do`, `(`, `env …`, `command`, `/usr/bin/git`, `&`), that is:
   `git [global opts] push …` except `push --dry-run`/`-n`; `git [global opts] merge …` except
   `merge --abort` and `merge --quit` (`merge-base`, `merge-file`, `merge-tree` don't count); `gh pr merge …`;
   `gh api …/merges` or `…/merge`; `wt-finish` (any path) with `--merge` or `--push`. Text inside `sh -c`,
   `bash -c`, `zsh -c` and `eval` arguments is checked the same way. `git pull` is **not** a merge here: it
   brings others' work down and `/update-cortex` relies on it. Git aliases are not resolved (cut, overseer).
   MCP tools matching `/^mcp__.*github.*__.*(merge|push|create_or_update_file|delete_file)/i` also count.
   **Brain sync exemption (Ian, 2026-11-25):** a plain `git push` (no force, no `--delete`, no `--mirror`)
   whose repo (decision 8's repo rule) is the brain folder (`realpath` equal to `opts.brainRoot`) and whose
   branch is the brain's `main` goes through with no card. Merges and force pushes in the brain still get one.
   Plain: any merge or push from a Cortex chat stops and shows the card, except the brain's own daily sync.
7. **How the card is forced, failing closed.** A new `PreToolUse` hook, `changeGuardHook(s)`, registered first
   on both hook lists (with and without levels). Spike 2026-11-25 proved a **thrown hook fails open** (the
   command ran with no card), so the hook's whole body is in try/catch: pure detection runs first; any error
   after a publish was detected still answers `ask` (facts then just the command); any error in the team
   check answers `deny`. For a publish call it answers `permissionDecision: 'ask'` and stores the card facts in
   `s.publishFacts` keyed by tool use id. `canUseToolFor` takes the entry (deleting it) by `ctx.toolUseID`,
   recomputing detection from the input if missing, and emits `permission-request` with `publish` set. Entries
   left over are cleared at turn end. Team refusals (decision 3) run before publish detection.
8. **Card facts, hardened.** Repo folder: the segment's `git -C <p>`, else the last `cd <p>` before it in the
   command, else the hook's `cwd`. Read-only git via `execFile` (never a shell), 3 s each, as
   `git --no-pager -c log.showSignature=false -c core.fsmonitor=false …` with env `GIT_TERMINAL_PROMPT=0
   GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0`; only `rev-parse`, `symbolic-ref`, `rev-list`, `config --get` and
   `log --no-show-signature`; never `status` or `diff` (they can run repo-controlled code). Range per kind:
   push `@{upstream}..HEAD` (or `origin/<named branch>..HEAD`); `git merge X` `HEAD..X`; wt-finish
   `origin/<default>..HEAD` (default from `refs/remotes/origin/HEAD`, else `main`). Up to 20 one-line commits
   plus `rev-list --count`. Repo `owner/name` from the origin URL. Version from `package.json` when the repo is
   the app. For decision 2c, `.git/config` is parsed in Node (following a worktree's `gitdir:` and
   `commondir`), with no git process. A force push (`-f`, `--force`, `--force-with-lease`, `+refspec`) or
   `--delete` sets the card's `warning`. Anything unreadable is null and the card says so; the card is never
   skipped for missing facts.
   Plain: the card shows the right repo's commits, and showing it can't run code hidden in a repo.
9. **No "Allow for this chat" on a publish card.** `kept` is emptied, `sessionAllowLabel` is null, and
   `replyPermission` answers `allow-session` on a publish request with `bad-request`. Each merge or push is
   confirmed on its own.
10. **The card.** When `item.publish` is set, `PermissionCard` renders `PublishCard`: tag "Merge and push",
    title from `publishTitle(kind)` (contract), facts as a short list (repo, branch → target, version, commits
    with a "and N more" line), the command in the existing scrolling detail block, the optional "tell Claude
    why" note, and two buttons: **Yes, merge and push** (wording per kind) and **No, not now**. Focus lands
    on the card, never on the Yes button. Older pages ignore `publish` and show the ordinary card, which then
    has no "Allow for this chat" (decision 9).
    Plain: you see exactly what will go out and press one button to send it.
11. **Standing instruction for every chat.** `PUBLISH_LINE` and `APP_CODE_LINE` (contract) join `appendLine`.
    `PUBLISH_LINE` starts "At the point you would ask whether to merge or push, don't ask in the chat, in text
    or with AskUserQuestion: …" so it never invites a push nobody asked for (overseer S10). And only owners and
    scouts change Cortex's code, with the feature-request offer for team members.
15. **Role reading.** `identity()` is called only once a call is known to touch app code. When it answers
    `unknown`, the last known role from the last 10 minutes is reused; with none, the call is denied with
    `UNKNOWN_ROLE_NOTICE` ("Cortex couldn't tell who you are, so it didn't change the app. Run /doctor-cortex.").
    Plain: an owner isn't refused because of a passing hiccup.
12. **Helpers.** The hook runs for helper tool calls too (no `agent_id` filter). Their card title uses the
    helper's name, as today.
13. **GitHub (lead, after merge).** Protect `main`: require a pull request (0 approvals), block force pushes
    and deletion, `enforce_admins: false` so the admin account's `wt-finish --push` still lands.
14. **Help.** `help/approvals-and-questions.md` gains a short "Merge and push" section; no screenshot retake.

## Out of scope

Terminal and IDE sessions (Cortex can't see them; GitHub protection is the backstop there). Detecting
assistant text that asks anyway (the instruction plus the card make it unnecessary; nothing ships without
the button). Git aliases. Accepted limits (a guard, not a sandbox): a script written elsewhere and then
run; role spoofing through `CLAUDE.local.md` or `git user.name`. Backstops: `/update-cortex` stops on local
changes in the installed copy, and team GitHub access is read-only.

## Build order

Builder A commits the `shared/contract.ts` additions (types, `publishTitle`, `publishYesLabel`) first and
says so; Builder B starts after that.

## Contract

`docs/plans/2026-11-25-app-change-guards-contract.ts`

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, opus | permissions rules (hard list: auth/permissions) | `server/engine/change-guards.ts`, `server/engine/change-guards.test.ts`, `server/engine/session-manager.ts`, `server/engine/session-manager.test.ts` (new tests only), `shared/contract.ts` |
| Builder B | `builder`, sonnet | default (UI) | `client/src/components/Cards.tsx`, `client/src/components/Cards.test.tsx`, `client/src/state/chat-reducer.ts`, `client/src/state/chat-reducer.test.ts`, client CSS for the card, `help/approvals-and-questions.md` |
| Lead | | | `brain-skills/tdsapp-todo/SKILL.md`, `brain-skills/README.md`, the brain's `.claude/skills/tdsapp-todo/SKILL.md`, GitHub protection, CHANGELOG |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/change-guards.test.ts` | publish detection (push, merge, `gh pr merge`, `wt-finish --merge/--push`, `-C`, `-c`, env prefixes, `sh -c`, aliases, chained commands; not `pull`, `merge-base`, `merge --abort`, plain `wt-finish`); team allowlist (update-cortex and install-cortex commands pass; edits, `sed -i`, redirects, commits, pushes in app code are refused); app-code path detection incl. worktrees and symlinks | Builder A |
| `server/engine/session-manager.test.ts` | hook answers `ask` with facts for a publish call; team edit to app code is denied with `TEAM_APP_REFUSAL`; owner edit isn't; `allow-session` on a publish request is refused; `publish` reaches the `permission-request` event with `sessionAllowLabel: null` | Builder A |
| `client/src/components/Cards.test.tsx` | publish card renders facts and the two buttons, no "Allow for this chat", Yes sends `allow`, No sends `deny` with the note | Builder B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (port 3331)
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (permissions), UX (the card)
- [ ] Browser check: the card in the help demo engine, or a headless screenshot

## Review outcomes

- **Overseer pre-review:** 5 blocking (free pass for app-path-less segments, allowlist broke update-cortex,
  bare `tds-brain-app` marker hit the brain's project folder, card facts from the wrong repo, hook failing
  open) and 8 should items, all folded into decisions 3, 4, 6, 7, 8, 11, 15 before building. Spike confirmed a
  thrown hook fails open.
- **Correctness:** brain-sync exemption bypassed by `GIT_DIR=`/`env`/`pushd` (fixed: bare `git push` only,
  no global options, no `GIT_*`, no `pushd`); heredoc apostrophe inside `$(…)` made commits look like a
  publish (fixed in `scanParen`); exempt path untested (test added).
- **Security:** team could delete or overwrite the app from its parent folder, via a bare `cd`, or a glob
  (fixed: containing folders count, cd/pushd targets and glob prefixes checked, `~/` expanded for edits);
  `gh api` writes, `git -c alias.*=push` and `git subtree push` missed (fixed); card named origin for another
  remote (fixed).
- **UI and copy:** tag now "Needs your approval"; warning moved above the facts; commits in a capped scroll
  box with a label; short repo names; notices tell team members to ask an owner or scout; help folded into
  the standard headings (help tests).
- **Lead:** push range for a named branch that isn't the current one (fixed, test); re-check probe of
  ordinary team and brain commands after the fix round (no regressions; `du ~/Library` and `open <app file>`
  are refused for team, accepted as strict). Builder B's first report claimed tests and help it hadn't
  written; caught by checking the files.
- **Accepted limits:** see "Out of scope".
