# Levels and helpers: the right model for every chat, skill and helper

Date: 2026-11-14 · Size: XL (two phases, one release) · Branch: `skill-levels-and-helpers` · Release: v0.22.0 · Explainer: https://claude.ai/artifact/DHPTdUcdhL3Xz6vRkF76nr

Supersedes the parked `docs/plans/2026-11-14-skill-levels.md`.

## Objective

Most of the team won't know which model or effort to choose, so today every chat runs on Claude
Code's default: **Opus 5.5 at high effort**, whether it's "what's my next meeting?" or a full ads
audit. The app will choose for them: quick look-ups on Haiku, everyday writing on Sonnet, audits and
strategy on Opus. For big jobs that split into parts (several clients, several sources), the chat
hands those parts to cheaper helpers and puts the results together. **No skill file in the brain
is changed** (see "What this changes in the brain" below), and the app never writes brain files
itself.

## What this changes in the brain, and what it doesn't

**Never changed.** None of the brain's existing skills: no `SKILL.md`, script, reference file or
folder of the 188 skills is edited, renamed, moved or deleted, and no `model:` or `effort:` line is
added to any of them. The app and the pre-fill script only *read* skill files (name,
description, frontmatter, the first lines); the automatic pick reads only the person's message. A skill's level lives in a separate team file, not in
the skill.

**Added, each only with Ian's yes at the time:**
1. One new skill folder, `.claude/skills/tdsapp-skill-levels/` (copied from this repo's
   `brain-skills/`, as `tdsapp-todo` was). It's the only thing that writes the team file.
2. One data file, `.claude/tdsapp-skill-levels.json`, created by that skill's script when the
   reviewed batch is imported, and changed later only through the same script.

**Where levels apply.** Only in the TDS Brain App, when it runs a chat. The same skill run from
the terminal (`claude` in the brain folder) behaves exactly as today. Claude Code doesn't read the
team file, and older app versions ignore it.

Plain: the skills stay exactly as their authors wrote them; the app just chooses how hard Claude
works when it runs them.

## User decisions (fixed)

- **One plan, one release: v0.22.0.** Planned as v0.20.0, but main reached v0.21.0 (other work) while this was built. Phase 1 (levels) and phase 2 (helpers) are
  built in this branch and merged together.
- **App-level, not skill edits.** The app never changes a skill's `SKILL.md`.
- **A skill's own frontmatter `model` / `effort` wins.** (None of the 188 brain skills set them today.)
- **Team-wide levels**, set only by **Owners and scouts**. Team members see them but can't change them.
- **When nothing is set, the app picks automatically** (instead of Opus 5.5 / high). The person can
  still choose for themselves in Settings.
- **Pre-fill all 188 skills** in one batch that Ian reviews before it reaches the team.
- **A visual explainer** of how it works.
- Copying the new brain skill into `~/agencybrain/.claude/skills/` and importing the reviewed batch
  are shared-brain changes: each needs Ian's yes at the time, as for `tdsapp-todo`.

## Spike results (2026-11-14, SDK 0.3.322, Claude Code 2.1.325, a temp folder, not the brain)

Scripts in the session scratchpad (`spike/spike.mjs`, `spike/spike2.mjs`, `spike/warm.mjs`; not committed).

1. **Mid-reply switch works**, from `PreToolUse` or `PostToolUse` on `Skill`: after `setModel('haiku')`
   every later call in that reply ran on Haiku. After `applyFlagSettings({ effortLevel: 'low' })`,
   `getSettings().applied.effort` reads `low` at once (the effect on the reply itself can't be seen
   directly; nothing depends on it).
2. **The app's switch beats a skill's own `model:`** (skill `model: haiku` + `setModel('opus')` ran
   on Opus), so the app must read the frontmatter itself and not switch for such skills.
3. **`setModel` sticks** after the reply.
4. **Helpers from `options.agents` run on their own model** (`tdsapp-scout` on Haiku under a Sonnet chat).
5. **The Agent hook can rewrite the call.** `PreToolUse` `updatedInput` with `model` and
   `run_in_background: false` held: the helper ran on the forced model and the reply waited for it.
   A call's `model` beats the agent definition's own model (also in `sdk-tools.d.ts`).
6. **Helpers run in the background by default** (an un-rewritten call let the reply end first).
7. **Two foreground helpers started in one message run at the same time** and the reply ends after both.
8. **A helper's tool approval reaches `canUseTool` with `ctx.agentID`** (a different id per helper),
   so its card can be labelled. Under `acceptEdits`, `touch` didn't ask (same as the main chat).
   The `Agent` call itself didn't reach `canUseTool` in `default` mode here.
9. **Hook input carries `agent_id` when a hook fires inside a helper** (`sdk.d.ts`).
10. **Picker:** fresh one-shot Haiku, no tools, `settingSources: []`, `persistSession: false`, cwd
    outside the brain: 20/20 valid JSON with sensible tiers; median 2.3 s, p90 5.0 s, max 5.2 s. A
    kept-warm process was only ~1.6 s and drifted into answering the request, so it's not used.
11. Cost on a trivial skill: Haiku run $0.07, Opus run $0.30.
12. **`mcp__*` in `AgentDefinition.tools` is NOT honoured** (`spike/spike3.mjs`, in-process MCP
    server `probe`): with `['Read', 'mcp__*']` the helper had only Read. A server prefix
    (`mcp__probe`) or a full tool name (`mcp__probe__ping`) does work. The app can't know each
    person's connector names when the chat starts, so the worker uses the decision 10 fallback:
    `tools: null` (inherits the chat's tools) plus the disallow list.
13. **First pick after the app starts can miss the 4 s limit** (browser check): the first chat fell
    back to Standard and the late Quick pick applied from its next message; later chats picked in
    time. Measured directly, the picker took about 2 s per pick. Accepted: the fallback is safe.

## Decisions

### Phase 1: levels

1. **Three tiers, one table.** `LEVEL_TIERS` in `shared/levels-contract.ts`: **Quick** = Haiku · Medium,
   **Standard** = Sonnet · Medium, **Deep** = Opus · High. Team levels, the pick, the chat menu and
   helpers all use tiers. Quick is Haiku at medium, not low: Haiku is already ~20× cheaper than
   Sonnet, and low effort risks missing the brain's own rules.
   Plain: people choose by how hard the job is, not by model names, and new models are a one-line change.

2. **Automatic becomes the default.** New `AppPrefs.levelMode: 'auto' | 'manual'`. Settings' Model
   section gets "Automatic (recommended)" first, then "Choose myself", which shows the v0.19.0 Model
   and Effort controls unchanged. A prefs file without `levelMode` reads as `'manual'` if `model` or
   `effort` is set (keep their choice), else `'auto'`. Manual mode ignores team levels, the pick and
   the forced helper models: people who chose get exactly what they chose.
   Plain: anyone who picked a model keeps it; everyone else moves from always-Opus to automatic.
   "What's new" for v0.22.0 says so plainly (it comes from the feat commit subject).

3. **Which level a reply runs at**, one pure function `resolveLevel()` in `server/engine/levels.ts`:
   1. `manual` mode: the Settings choice (as v0.19.0).
   2. The skill being run sets its own `model` or `effort` (`ownLevel`): the app applies the chat's
      base level (rows 3 to 6, ignoring any team level) at turn start, then leaves the skill's own
      setting to sit on top, with no further app switch in that reply. Builder A first tests that a
      turn-start `setModel` doesn't defeat a skill's `model:` (not yet verified).
   3. The person changed the level for this chat (decision 7): that tier.
   4. A team level for the skill being run: that tier.
   5. The chat's automatic pick.
   6. No pick (failed, timed out or backing off): `FALLBACK_TIER` (Standard).
   `ownLevel` is looked up by skill name for **any** skill on disk, including ones hidden from the
   Skills list, by reading just that one `SKILL.md` (cached by mtime).
   Plain: a skill author's choice wins, then yours, then the team's, then the app's pick.

4. **Applying a level: at every turn start, never "restore" afterwards.** In `send`/`start`, the
   app resolves the level and applies it (`setModel` + `applyFlagSettings`, the v0.19.0
   `applyChoice` path), and only then pushes the message, all chained on `s.choiceChain` so nothing
   can slip in between. There is no end-of-turn restore: the next turn simply applies its own level.
   Settings changes and the chat menu go through the same resolver and take effect from the next
   message.
   Plain: a stopped or failed reply can never leave a chat stuck on the wrong level.

5. **Mid-reply skills.** On `PostToolUse(Skill)` (after the brain's own role gate has let the skill
   through), if the hook input has **no `agent_id`** (the main chat, not a helper), the mode is auto,
   the person hasn't picked a level for this chat (decision 3, row 3) and the skill has no
   `ownLevel`: if its team level is **higher** than the current one, switch for
   the rest of the reply and record it in `s.appliedChoice`. Never lower mid-reply.
   Plain: a big skill gets its level straight away; a small skill inside a big job can't drop the
   whole reply to the cheapest model, and a helper's skill never changes the main chat.

6. **The automatic pick (`server/engine/level-picker.ts`).**
   - Rules first: a `/name` skill with a team level needs no pick.
   - Otherwise one fresh one-shot query: Haiku · Low, no tools, `maxTurns: 1`, `settingSources: []`,
     `persistSession: false`, cwd outside the brain (no ghost chats in the past-chats list), a fixed
     system prompt, the message wrapped as data (`<request>…</request>`), first `LEVEL_PICK.maxChars`
     only, no attachments. JSON `{tier, helpers, reason}`; anything else is a failure.
   - **It runs server-side, in `start` and `send`**, for every new chat however it began (typed, a
     skill, a chosen client, a to-do, an attachment-only message). The engine starts at once; the
     first message waits for the pick (timeout `LEVEL_PICK.timeoutMs` = 4 s, then Standard). A
     **timeout doesn't start the back-off**: the late pick, when it arrives, becomes the chat's pick
     from its next message. Only a hard failure (engine missing, bad reply, error) skips the pick for
     `backoffMs`. The client-guess request may **pre-warm** a pick cache keyed by the message text.
     Chats started with a chosen client get no pre-warm and simply wait for the pick, which overlaps
     the engine starting (no typing-pause pre-warm: it would spend several Haiku calls per message
     and rarely match the final text). The browser check measures the added wait; revisit if the
     median is over 1 s.
   - **A chat with no pick yet** (started with a levelled `/skill`, or with no text) picks on the
     first later message that needs one, rather than sitting on the fallback.
   - **Resumed chats keep their level.** Chats close after 30 idle minutes, so reopening is routine.
     The app stores each chat's tier and its source (the pick, or the person's own choice) by
     `sdkSessionId` in the app's own data folder (never the brain), capped at `CHAT_LEVELS_MAX` and
     pruned oldest first (`ChatLevelRecord`). A resumed chat with a record uses it; with none, it
     starts on Standard and re-picks upward only.
   - Follow-ups keep the chat's tier. A chat on Quick re-picks (upward only) when a follow-up is
     `QUICK_REPICK_MIN_CHARS`+ long, has attachments, or names a skill with no level.
   - It runs on the person's own Claude login. Jev isn't used.
   Plain: a two-second look at the first message decides how hard Claude works for that chat, and
   it's usually done while you're still typing.

7. **What people see.**
   - The line under the message box becomes "**Standard** · picked for this chat", with "Why?"
     showing the reason, the model and the effort. A small menu offers Quick / Standard / Deep for
     this chat, or back to Automatic (`ROUTES.chatLevel`). For a team level: "**Deep** · for
     /google-ads-audit · team level". In manual mode it stays as v0.19.0 ("Opus 5.5 · High effort").
   - Settings → **Skill levels**: each skill's tier, who set it and when. Owners and scouts can
     change or clear it; everyone else sees it read-only.
   - The Skills drawer shows a small tier chip.
   - After a skill with no team level runs, Owners and scouts see a quiet line: "Set a team level
     for /x? This chat used Standard." No card before a skill runs, ever.
   - New `ChatEvent { type: 'level' }`, sent only on streams opened with `levels=1` (an older page's
     reducer resets on unknown events, as with `files=1`); only the newest one is kept for replay.
   Plain: you can always see what level Claude is working at and why, and change it for one chat.

8. **Team levels file and brain skill.** `.claude/tdsapp-skill-levels.json` (`SkillLevelsFile`).
   It's in `.claude/` because the brain's `.team-config/README.md` lets only the owner write in
   `.team-config/`, while scouts may write in `.claude/`. Written only by a new brain skill
   `brain-skills/tdsapp-skill-levels/` (script `tdsapp-skill-levels.cjs`: `set`, `clear`, `import`,
   `capabilities`; `roles: owner, scout`, `maturity: draft`, `members: false`, `agency: true`), run
   by the app the way it runs `tdsapp-todo`. The script works out the person's role itself (from the
   brain's identity, never from what it's sent), validates skill names and tiers, and writes
   atomically with sorted keys and one entry per line, so git merges cleanly. Its temporary file is
   removed if a write fails, because the brain sync (`git add -A`) would otherwise share the leftover.
   The app reads the file
   fresh; junk rows and unknown tiers are skipped, a missing file means no team levels, and
   `SkillLevels.writable` is false until the skill is in the brain.
   Plain: everyone's app uses the same levels, changes reach the team with the next brain sync, and
   older apps simply ignore the file.

9. **Pre-fill.** `scripts/suggest-skill-levels.ts` (dev-only, not shipped) reads every brain
   `SKILL.md` read-only (name, description, first 60 lines) and asks Sonnet · Medium for a tier and
   a one-line reason per skill. Rule: a skill that files, sends or changes accounts is Standard or
   higher. Output: a review table for Ian (published as an artifact) and a JSON file in the
   worktree's own data folder. On Ian's yes, it's imported in one go through `tdsapp-skill-levels
   import` with `setBy: 'prefill'`.
   Plain: all 188 skills start with a sensible level that Ian has checked.

### Phase 2: helpers

10. **Three app helpers** via `options.agents`, models from the tier table, never `permissionMode`
    or `background` in the definition:
    - `tdsapp-scout` (Quick): finds files, facts and figures. Read, Glob, Grep, WebSearch, WebFetch.
    - `tdsapp-worker` (Standard): does one part of a job. The scout's tools plus Bash and the
      person's connectors. No Skill tool (deprecated in `tools`): its brief names the
      `SKILL.md` to read and follow. Bash is needed because 142 of 188 skills run scripts.
      The SDK documents `mcp__*` patterns only for `disallowedTools`, not `tools`, so Builder A
      tests first whether `tools: [..., 'mcp__*']` gives the worker the connectors. If it doesn't,
      the worker omits `tools` (inheriting everything) and disallows Write, Edit, MultiEdit,
      NotebookEdit, Agent, Task and Skill instead (`HelperSpec.tools` is `string[] | null`).
    - `tdsapp-expert` (Deep): checks and judgement. Read-only tools plus web.
    All three disallow Write, Edit, MultiEdit, NotebookEdit and Agent. Their prompts say: work only
    on your brief, never file anything into the brain, return a short report. `maxTurns` 15 / 30 / 20.
    Named `tdsapp-` so they can't clash with a person's own agents.
    Plain: three kinds of helper, each on the cheapest model that does its job well. The scout and
    expert can't change anything; the worker's commands and connectors still ask, as in the main chat.
    Built: the worker also disallows Workflow, CronCreate, ScheduleWakeup, RemoteTrigger and
    EnterWorktree. It inherits every other tool, so **on each Claude Agent SDK upgrade, re-check its
    disallow list** against the SDK's tool list (`sdk-tools.d.ts`): a new tool arrives allowed.

11. **When Claude uses helpers.** A short instruction added to the chat's existing system-prompt
    line (`appendLine`), distilled from agent-workforce: most requests need no helpers; use them
    only when the job splits into two or more independent parts (several clients, channels or
    sources); give each a self-contained brief; check and combine their reports; the main chat does
    any filing. When the pick says `helpers: true`, the first message carries a one-line nudge and
    the chat is at least Standard. No nudge on Quick chats.
    Plain: Claude only brings in helpers when it actually saves time and money.

12. **One Agent hook keeps helpers in line** (`PreToolUse` on `Agent`/`Task`, main chat only):
    - always sets `run_in_background: false`, so helpers finish inside the reply you're watching
      (the app ends a turn on `result`, which would deny a background helper's open cards);
    - caps helpers at `HELPERS_AT_ONCE_MAX` at once and `HELPERS_PER_REPLY_MAX` per reply (denies
      the extra call with a plain reason Claude can act on);
    - in auto mode only, when the chat is on Deep and the call names no model and its
      `subagent_type` is absent or built-in (general-purpose, Explore, Plan), sets `model` from
      `OTHER_HELPER_TIER` (Standard). Agents with their own model (brain or personal agent files,
      e.g. `newsletter-idea-extractor` on Haiku) keep it.
    If an Agent call does reach `canUseTool`, the app applies the same rewrite to the `updatedInput`
    it returns, so a card can't undo it.
    Plain: no helper silently runs on the most expensive model or outlives the reply, and helpers
    can't multiply without limit.
    Built: with levels on, the three helpers, foreground-only, the caps and dropping `isolation`
    apply in both modes; the built-in model rule and the nudge are automatic mode only. App helpers
    always run on their own tier's model, whatever model the call names. In "Choose myself" mode a
    Settings change still reaches open chats at once, as in v0.19.0.

13. **Approvals.** Starting one of the three app helpers needs no card. Any command or connector a
    helper uses still asks, labelled with the helper ("Worker wants to run …", from `ctx.agentID`).
    Starting any other helper keeps today's "Claude wants to start a helper".
    Plain: no extra clicks for the app's own helpers, same safety for everything else. (Security gate.)

14. **Showing helpers.** The chat's tool row says "Asking the scout · Quick" instead of "Asking a
    helper"; nested helper text already shows under its tool (`parentToolUseId`).
    Plain: you can see who's working on what.

15. **Ian's own setup.** Ian's `~/.claude` hook `require-agent-model.sh` (agent-workforce) blocks
    Agent calls with no `model`, which would block the app's helpers in his app only. The fix is in
    his own config: exempt `tdsapp-*` in that hook (Ian's skills repo, his yes; not part of this
    app's change).
    Plain: the app's helpers work for Ian too, without weakening his own rule elsewhere.

## Contract

`shared/levels-contract.ts` (new): tiers, team levels, `TurnLevel`, the pick, helpers, limits.

Additive edits in `shared/contract.ts` (Builder B makes them first; everyone builds against them):

- `AppPrefs.levelMode: LevelMode`, `DEFAULT_PREFS.levelMode = 'auto'`, plus the read rule in decision 2.
- `SkillInfo.ownLevel: OwnLevel | null` (from frontmatter; null when neither is set).
- `Bootstrap.skillLevels: SkillLevels`.
- `ChatEvent` gains `{ type: 'level'; level: TurnLevel }` (stream flag `levels=1`).
- `ROUTES.skillLevels = '/api/skill-levels'` (GET, POST `SetSkillLevelRequest`) and
  `ROUTES.chatLevel` for `POST /api/sessions/:id/level` (`ChatLevelRequest`).
- `ClientGuessRequest` gains nothing; the guess route only pre-warms the pick cache server-side.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable, high | plan critique, product decisions, sign-off | (read-only) |
| Builder A: engine | `builder`, opus, high | engine with tricky rules (precedence, turn-start apply chained with input, hook rules), permissions (helper approvals) | `server/engine/levels.ts`, `server/engine/level-picker.ts`, `server/engine/helpers.ts` (+ tests), `server/engine/session-manager.ts` (+ test), `server/engine/permissions.ts` (+ test), `server/engine/event-map.ts` (+ test) |
| Builder B: brain and server | `builder`, sonnet, medium | default | `shared/contract.ts` edits, `brain-skills/tdsapp-skill-levels/**`, `brain-skills/README.md`, `server/brain/skill-levels.ts` (+ test), `server/brain/skills.ts` (+ test), `server/store/app-store.ts` (+ test), `server/store/chat-levels.ts` (+ test), `server/http/routes.ts` (+ tests), `server/index.ts`, `scripts/suggest-skill-levels.ts` |
| Builder C: screens | `builder`, sonnet, medium | default | `client/src/components/SettingsView.tsx`, `client/src/components/Composer.tsx`, `client/src/components/Chat.tsx`, `client/src/shell/SkillsDrawer.tsx`, client api/reducer files for the new event and routes (+ tests), `CHANGELOG.md` "What's new" text |

Phase 1 runs A, B, C in parallel; phase 2 is mostly A, with small follow-ups for C.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/levels.test.ts` | every row of decision 3; `ownLevel` with only one field set still skips; manual ignores team levels | A |
| `server/engine/level-picker.test.ts` | JSON parsing; junk and wrong tiers rejected; timeout → Standard; backoff; message wrapped and cut; pre-warm cache hit; Quick re-pick rule (length, attachments, unlevelled skill; upward only) | A |
| `server/engine/session-manager.test.ts` | level applied before the message is pushed, on the choice chain; no end-of-turn restore, next turn re-applies after interrupt and error; pick runs for skill-only, chosen-client, to-do and attachment-only starts; PostToolUse(Skill) raises only, never for `agent_id`, `ownLevel` or a chat the person set; a skill-own turn starts from the chat's base level, not the last raised one; timeout doesn't back off and the late pick is used next message; no-pick chat picks on its next message; resumed chat uses its stored `ChatLevelRecord`, else Standard and upward-only; `level` event only on `levels=1` | A |
| `server/store/chat-levels.test.ts` | records by `sdkSessionId`, cap and prune oldest, junk file ignored, app data folder only | B |
| `server/engine/helpers.test.ts` | three definitions from the tier table, no write tools, no Skill, no permissionMode/background; the worker really gets connectors (or the disallow-list fallback); Agent hook: background off, caps, model only for built-in types on Deep in auto | A |
| `server/engine/permissions.test.ts` | app helpers start without a card; other helpers still ask; helper tool cards carry the helper label; card `updatedInput` keeps the rewrite | A |
| `brain-skills/tdsapp-skill-levels/scripts/*.test.ts` | set, clear, import, capabilities; role from identity, not input; name and tier validation; sorted atomic writes | B |
| `server/brain/skill-levels.test.ts` | reader skips junk, missing file, unknown tiers; set route runs the script, 403 for team | B |
| `server/store/app-store.test.ts` | `levelMode` read rule for old prefs files | B |
| client tests | Settings Automatic / Choose myself; Skill levels list read-only for team; level line, "Why?" and chat menu; drawer chip | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview from /tmp on 3878 with its own data folder, per repo memory)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert; security expert (brain write path, roles, helper approvals and tools)
- [ ] Browser check: automatic pick on a new chat, "Why?" and the chat menu, Skill levels list as Owner and as team, a skill Claude picks mid-reply, a request that uses helpers
- [ ] Pre-fill table reviewed by Ian; brain skill copy and import each approved by Ian

## Overseer pre-review (2026-11-14)

Seven blocking items, all taken into the decisions above: the pick runs server-side for every chat
(B1, decision 6); apply at turn start instead of restoring (B2, decision 4); ignore skills inside
helpers and only raise mid-reply (B3, decision 5); don't override agents with their own model (B4,
decision 12); helpers in the foreground (B5, decision 12); worker tools and honest safety wording
(B6, decision 10); file in `.claude/` (B7, decision 8). Should items taken: Standard fallback with a
4 s timeout, picker without session files, PostToolUse switch, own-level lookup for any skill,
helper caps, script hardening and the pre-fill rule, Ian's hook exemption. Nice items taken: shorter
level line, newest `level` event only. The five spikes it asked for were run (results 1, 5, 7, 8, 10).

## Overseer second review (2026-11-14)

All seven blocking items confirmed fixed and consistent with the contract. "What this changes in
the brain" confirmed by reading only: no existing skill file is touched; the brain's
`skills-manifest.json`, `featured-skills.json` and `originals.json` don't list `tdsapp-todo`, so a new
skill needs no manifest edit; `.claude/tdsapp-skill-levels.json` isn't git-ignored, so it syncs.
One new blocking item, fixed: resumed chats keep their level (decision 6). Should items taken:
timeouts don't back off, a no-pick chat picks later, skill-own turns start from the base level,
worker connectors tested first with a fallback. Nice items taken: temp-file clean-up, the pick
reads only the message. Decisions: accept the pick wait for chosen-client chats (measure it);
persist chat levels. Verdict: ready to build.

## Review outcomes

**Phase 1 (levels).**
- Correctness (Opus): the chat-level route answered a bare `TurnLevel` while the client expected
  `{ level }`, which blanked the page (blocking, fixed in the route, test and a store guard); the
  offer showed before the skill ran (now `pendingOffer`, sent at `result`, never for a message
  stopped before it was sent); the line didn't update after a raised turn (`levelAfterTurn`).
- Recheck: a team-level `/name` stopped before it was sent left the line on the team level (fixed,
  with a test).
- Security (Opus): no findings. UX expert: S1–S10 and N1–N4 applied ("an Owner", not a name).
- Browser check: skills with their own model were offered a team level in Settings; they now read
  "Set by the skill itself, so a team level doesn't apply" and don't count as missing. The first
  pick after the app starts can miss 4 s (spike result 13), accepted.

**Phase 2 (helpers).**
- Spike result 12: the worker inherits the chat's tools with a disallow list.
- Correctness (Opus): the nudge leaked into a `/skill`'s arguments (no nudge on a `/skill` now); an
  app helper called with its own model escaped its tier (app helpers always run on their tier, in
  both modes); a helper call stopped by another rule kept its slot until the reply ended (freed on
  `permission_denied`).
- Security (Opus): `isolation` (remote, worktree) passed through the rewrite (now dropped); the
  worker could reach Workflow, CronCreate, ScheduleWakeup, RemoteTrigger and EnterWorktree (now
  disallowed). Recheck of the fixes: no findings.
- Builder's choice: in manual mode with levels on, helpers, foreground-only and the caps still
  apply; the built-in model rule and the nudge are automatic mode only.
- Browser check: two `tdsapp-scout` helpers ran together on Haiku, shown as "Asking the scout ·
  Quick". Ian's own `require-agent-model.sh` blocked the first call (it sees the call before the
  app's rewrite) and Claude retried with a model: decision 15, still to do in his skills repo.

**Gates:** type-check clean; 2,275 of 2,275 tests; lint no errors; build OK; no large deletions.

**Overseer sign-off (2026-11-14):** signed off, no blockers. Should items taken: "Choose myself"
reaches open chats at once again (restored v0.19.0 behaviour, with tests); the manual-mode choice and
the SDK-upgrade check of the worker's disallow list are recorded under decisions 10 and 12. Nice item
left: a stop pressed while the pick is running can take up to about 4 s to show.
