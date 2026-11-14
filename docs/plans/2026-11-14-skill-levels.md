# Skill levels: a team-wide model and effort per skill

Date: 2026-11-14 · Size: L (expected) · Branch: none yet · Explainer: none yet
**Status: parked.** Saved for later at Ian's request. Don't start building until he says so;
when he does, run the full L flow (agent-workforce) from this draft.

## Objective

Use the team's ~188 brain skills more efficiently by running each one at a suitable model and
effort, set once for the whole team and applied automatically by the app, without editing the
skills themselves. For example, a quick lookup runs on Haiku at low effort, and an ads audit
runs on Opus at high effort.

## User decisions (fixed)

- **App-level override, not a skill edit.** The app never changes a skill's own `SKILL.md`.
- **Team-wide.** One set of levels shared by the whole team, not per person.
- **A skill's own setting wins.** If a skill's frontmatter already sets `model` or `effort`, the
  app's level doesn't apply to it.
- **First use suggests a level.** When a skill with no level is used for the first time, the app
  suggests one based on the skill, and the choice is then remembered and used every time.
- Builds on v0.19.0 (model and effort in Settings, `docs/plans/2026-11-14-model-effort-settings.md`).

## Background (checked 2026-11-14)

- Claude Code skill frontmatter supports `model` ("for the rest of the current turn … the session
  model resumes when you send your next prompt") and `effort` (same scope; with `context: fork`
  they set the forked subagent's values instead). Source:
  https://code.claude.com/docs/en/skills. None of the brain's skills set `model` or `effort`
  today; 13 use `context: fork`.
- The Agent SDK (0.3.322) the app uses offers in-process hooks (`Options.hooks`, including
  `PreToolUse` / `PostToolUse` on the `Skill` tool, and `PreModelSwitch` / `PostModelSwitch`), plus
  `setModel` and `applyFlagSettings({ effortLevel })` on a live chat. v0.19.0 already uses the
  last two to switch open chats.
- The app must never write brain files itself (memory: never-write-brain-files). Shared app
  data in the brain uses the `tdsapp-` prefix (memory: tdsapp-prefix-naming) and is written
  through a brain skill, as `tdsapp-todo` does.
- Jev (TypeSafe, via `jev-proxy`) is used only for client picking. Ian wants evidence before
  sending it more data (memory: jev-client-picking).

## Proposed decisions (for the overseer to confirm)

1. **Where the levels live.** A team file in the brain, e.g. `data/tdsapp-skill-levels.json`:
   `{ "<skill-name>": { "model": "opus", "effort": "high", "setBy": "<member>", "at": "<iso>" } }`.
   Written only by a new brain skill (`tdsapp-skill-levels`) that the app calls, the way to-do
   changes go through `tdsapp-todo`. The app reads it.
   Plain: everyone's app uses the same levels, and changes reach the team with the next brain sync.
2. **When a level applies.** It applies only when the skill's own frontmatter sets neither `model`
   nor `effort`. If it sets one of them, the app leaves the whole skill alone.
   Plain: a skill author's own choice always wins.
3. **Skills the person starts** (picked from Skills or typed as `/name`). The app switches that
   reply to the skill's level before sending, and returns to the chat's own setting when the
   reply ends.
   Plain: the skill runs at its level, and the chat carries on at its usual level afterwards.
4. **Skills Claude picks partway through a reply.** An SDK hook on the `Skill` tool switches the
   rest of that reply, and the app restores the chat's setting at the end of the reply. This
   mirrors how Claude Code handles a skill's own `model` and `effort`.
   Plain: it works the same whether you start the skill or Claude does.
5. **First use of an unset skill.**
   - Person starts it: a small card before it runs, e.g. "First time this skill has been used
     here. Suggested: **Opus · High effort**, because it's a multi-step audit." Buttons: *Use
     this*, *Choose…*, *Use the chat's setting*. The answer is saved for the team.
   - Claude picks it mid-reply: no interruption. It runs on the chat's setting, and a quiet line
     afterwards offers to set a level for next time.
   Plain: you're asked once per skill, and never in the middle of a reply.
6. **Where the suggestion comes from.** The person's own Claude: one small Haiku, low-effort call
   reads the skill's name and description and returns a model, an effort and a one-line reason.
   It's cached per skill. Keyword rules are the fallback ("audit", "strategy" → Opus · High;
   "notes", "lookup" → Haiku · Low). Jev isn't used.
   Plain: suggestions cost almost nothing and send nothing to an outside service.
7. **Seeing and changing levels.** A "Skill levels" list in Settings shows each skill's level and
   who set it, with change and reset. The Skills page can show a small level chip. While a
   skill's level applies, the line under the message box says so, e.g. "Opus 5.5 · High effort ·
   for /google-ads-audit".
   Plain: anyone can see what each skill runs at and why.

## Open questions (for Ian when planning starts)

- **Who may set or change a team level?** Owners only, Owners and scouts, or anyone, with the
  change logged?
- **First use by someone who can't set levels.** Run on the chat's setting and flag the skill
  for an Owner? Or let them pick for this run only?
- **Personal override on top of the team level?** Not planned; add later only if asked.
- **Seed the file up front?** Optionally pre-fill suggestions for all 188 skills in one reviewed
  batch, so few people ever see the first-use card.

## Spike first (before the plan is finalised)

About an hour, in a worktree, against a real engine:
- A `PreToolUse` or `PostToolUse` hook on `Skill` can call `setModel` / `applyFlagSettings`, and
  the switch takes effect for the rest of that same reply.
- Precedence: with no frontmatter `model`, the app's switch holds; with one, Claude Code's wins.
  Decision 2 avoids the clash, but confirm it.
- The chat's setting is restored correctly at the end of the reply, including after an
  interrupted reply.
- Reading a skill's frontmatter `model` / `effort` from the brain's `SKILL.md` files (read-only)
  matches what Claude Code sees.

## Contract (to write at planning time)

Expected in `shared/contract.ts`: a `SkillLevel` type (`model`, `effort`, `setBy`, `at`), a
`SkillLevels` map, `SkillInfo.level` and `SkillInfo.ownLevel` (from frontmatter), routes to read
levels and to set one (through the brain skill), and a `skill-level` chat event for the line
under the message box.

## Team (expected)

Fable overseer; Opus builder for the engine hooks and the brain skill; Sonnet builder for the
UI; reviewers for correctness, security (brain write path, who may set levels) and UI; the UX
gate.

## Tests (expected)

- Applying a level only when the skill's frontmatter sets neither field.
- Switching before a skill the person starts and restoring after the reply, including on
  interrupt or error.
- The hook path for skills Claude picks.
- The suggestion's parsing and fallback rules.
- The brain skill's validation and file format.
- The Settings list, the first-use card and the chip.

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on 3878, own data folder)
- [ ] Domain gates: UX/UI; security (brain write path, roles)
- [ ] Browser check: first-use card, a skill Claude picks mid-reply, Settings list

## Review outcomes

(Filled at the end.)
