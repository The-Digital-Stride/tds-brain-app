# Context management: see it, keep what matters, stop paying twice

Date: 2026-11-14 · Size: XL (three phases, one release) · Branch: `context-management` · Explainer: https://claude.ai/artifact/UnLjuHLoxzASuCRCNQ5HRo

## Objective

Long chats in the app hit Claude's context window with no warning. Claude Code summarises them
silently, the person never knows earlier detail was condensed, and the app knows nothing about how
full a chat is. On top of that, the automatic levels can bounce a chat between models, and each
switch throws away the cached conversation, so the whole chat is paid for again. This change lets
the person see how full a chat is and when it was summarised, makes every summary keep what matters
for agency work, and stops the app paying to re-read long chats for no gain.

Plain: you'll see how full a chat is, you'll be told when Claude summarises it, the summary will keep
the client, decisions and files, and long chats will cost less.

## User decisions (fixed)

- **One plan, one release** covering all three phases.
- **In scope:** phase 1 compaction notice, phase 2 context meter, phase 3 brain-aware summaries,
  stop cache-wasting model switches, leaner chat start-up.
- **Out of scope:** a manual "Tidy up this chat" button and "hand over to a new chat" (not chosen).
- **A visual explainer** of how it works.
- The app never writes brain files. Nothing here edits the brain's CLAUDE.md, skills or settings.

## Facts (SDK 0.3.322 `sdk.d.ts`; Claude Code docs; the app's code)

SDK and Claude Code:
- `system`/`status`: `status: 'compacting' | 'requesting' | null`, with `compact_result:
  'success' | 'failed'` and `compact_error` when one ends.
- `system`/`compact_boundary`: `compact_metadata.{trigger, pre_tokens, post_tokens?, duration_ms?}`.
- `getSessionMessages` returns boundaries only with `includeSystemMessages: true` (sdk.d.ts:953).
- `query.getContextUsage({ detail })`: `totalTokens`, `rawMaxTokens`, `percentage`,
  `autoCompactThreshold?`, `isAutoCompactEnabled`, `categories[]` (stable `id`, `kind`), `mcpTools[]`,
  `memoryFiles[]`, `skills`, `agents[]`. `'summary'` makes no token-count calls.
- Hooks: `PreCompact` (input `trigger`, `custom_instructions`; no typed output), `PostCompact`
  (`compact_summary`), `SessionStart` `source: 'compact'` → `additionalContext`, `PreModelSwitch`
  (`prompt_cache_warm`, `cache_ttl`, `estimated_cache_write_usd`; output `permissionDecision`).
  Claude Code docs: "PreCompact: your stdout becomes instructions for the compaction summary"
  (command hooks).
- Prompt cache TTL: **1 hour** for a subscription's main conversation, 5 minutes for API-key /
  usage-credit sessions (code.claude.com/docs/en/prompt-caching). Each model has its own cache.
- A compaction request repeats the system prompt, tools and history, so it reads from a warm cache.
- `snapshot` (record the system prompt once) is already the default (sdk.d.ts:2485).
- `idleCompaction` defaults to true.

App:
- `mapSystem` (`event-map.ts:142`) keeps only `init` and `permission_denied`.
- Nothing reads `result` usage, `modelUsage` or cost (`session-manager.ts:1104-1119`).
- The automatic pick only ever **raises** a chat (`adoptPick`, `:1383`). Downward switches happen
  when a turn returns to the chat's level after a raised skill turn, or for a one-turn team level:
  bouncing. Switches go through `applyChoice` (`:1187`) from `sendWhenLevelled` (`:1527`), `skillRan`
  (`:1606`) and `setEngineChoice` (`:2274`). `s.turnTier` is set before `applyChoice` (`:1517`).
- Engine hooks are attached only `if (levels)` (`:1247`).
- `LevelLine` renders nothing in manual mode (`LevelLine.tsx:31`).
- The engine starts lazily on the first send (`:1330`). Idle engines close after 30 minutes (`:255`).
- Stored chat levels use `server/store/chat-levels.ts` in the app's data folder.

## Phase 0: spike (lead; a throwaway folder, never the brain; Haiku)

Scripts in the session scratchpad, not committed. Results are recorded here before builders start.

- **S1.** `status: 'compacting'`, `compact_result` and `compact_boundary` arrive through streaming
  input, for `/compact` and for auto-compaction (forced with a small `autoCompactWindow`).
- **S2.** `getContextUsage({ detail: 'summary' })` between turns: works, how long it takes, and what
  happens if called during a reply.
- **S3.** `getSessionMessages(..., { includeSystemMessages: true })` for a compacted chat: the
  boundary is returned, messages from before it still come back, and how the summary message is flagged.
- **S4.** Which route steers the summary, tried in order: (a) the SDK `PreCompact` callback's return
  (`systemMessage`, `additionalContext`, `reason`); (b) a **command-type** `PreCompact` hook in the
  app's flag-layer `options.settings` (`:1238`) whose stdout is the instructions; (c) one line in the
  system prompt `append`. Judge by whether a planted fact ("the budget is £4,321, from `x.md`") survives.
- **S5.** `SessionStart` `source: 'compact'` fires in SDK hook callbacks and its `additionalContext`
  reaches the model.
- **S6.** `PreModelSwitch` fires for `setModel` (`source: 'sdk'`); `deny` keeps the old model with
  `setModel` resolving normally; the reported `estimated_cache_write_usd` and `prompt_cache_warm`.
- **S7.** Cache reads vs writes (`cache_read_input_tokens` vs `cache_creation_input_tokens`) on the
  next response after: a switch down; a switch back within the hour; an effort-only change; an app
  restart (resume). And `idleCompaction`: does it fire before the 30-minute close, with a warm cache,
  and does it honour the S4 instructions (including a precomputed summary)?
- **Start-up baseline.** `getContextUsage({ detail: 'full' })` for a fresh app chat in the brain:
  the top 10 items by tokens.

Each decision marked *(S#)* is confirmed or changed by the spike.

### Spike results (2026-11-15, SDK 0.3.322, Claude Code 2.1.325, Haiku 5.5, a scratchpad folder)

Scripts: session scratchpad `spike/` (`s1.mjs`, `sauto.mjs`, `s6.mjs`, `sidle.mjs`, `sbase.mjs`); not committed.

- **S1 confirmed.** Manual and auto both send, in order: `status: 'compacting'` → `status: null,
  compact_result: 'success'` → `compact_boundary` (`trigger`, `pre_tokens`, `post_tokens`,
  `duration_ms`). Then a synthetic user message (`isSynthetic: true`). **So `status: null` with
  `compact_result: 'success'` must not map to `ended`; only a status change with no `compact_result`
  does.** Auto-compaction fired at the start of a turn, before the request, not mid-reply.
- **S2 confirmed.** `getContextUsage({ detail: 'summary' })` answers in 8–25 ms. Haiku 5.5 and Sonnet
  5.5 report a 1,000,000-token window with `autoCompactThreshold` 967,000 (a 33,000 buffer). With
  `autoCompactWindow: 100000` the threshold is 67,000. The meter must measure against the threshold.
- **S3: two surprises.** (1) `getSessionMessages` returns **only the messages since the last
  compaction**: everything before the boundary is gone from the list, with or without
  `includeSystemMessages`. (2) The summary comes back as a `user` message flagged `isCompactSummary`,
  and a typed `/compact` as `user` messages flagged `isCompletedLocalCommand`. **Today's
  `replayHistory` would show both as the person's words**: an existing bug this plan fixes.
- **S4: route (c) wins.** The SDK `PreCompact` callback's return (`systemMessage`, `reason`,
  `additionalContext`) is ignored. A command `PreCompact` hook in flag settings works (its stdout
  steers the summary) but leaves a `local-command-stdout` line in history. **One line in the system
  prompt `append` steers both manual and auto summaries** (marker kept in all 5 summaries), and the
  planted facts (£4,321 / £7,654, codenames) survived every compaction.
- **S5 confirmed.** `SessionStart` with `source: 'compact'` fires in the SDK callback, and its
  `additionalContext` reached the model (it quoted the to-do note back). `SessionStart` did **not**
  fire on resume in our callback, so stored readings (decision 7) are the right call.
- **S6: works, with two details.** `PreModelSwitch` fires for `setModel` (`source: 'sdk'`,
  `cache_ttl: '1h'`, `prompt_cache_warm: true`). Haiku → Sonnet at 79k tokens was estimated at
  $0.32; the actual first Sonnet reply cost $0.39. **`deny` makes `setModel` throw** ("Model switch
  blocked by a PreModelSwitch hook: …") and the old model stays. **Each model keeps its own cache:**
  going back to Haiku within the hour read 88k from cache and wrote only 9k, yet the hook estimated
  a full re-write ($0.02 at Haiku prices; for a return to Opus that overestimate would be large).
- **S7 partial.** An effort-only change is free (44 tokens written). Closing and resuming within the
  hour read the whole chat from cache. **Idle compaction did not fire**: a chat at 90k tokens (above
  its 67k threshold) sat idle for 45 minutes with no compaction. The next message then tried an auto
  compaction, which **failed** (`compact_result: 'failed'`, `compact_error: 'too_few_groups'`: one huge
  message can't be split), and the reply still went through, reading 90k from cache after 45 minutes
  (the 1-hour TTL in action). So the `failed` path is real and must not block the reply.
- **Start-up baseline** (Ian's user settings, scratchpad folder, so without the brain's own 188
  skills and CLAUDE.md): **about 39k tokens before anyone types.** System prompt about 14k; skill
  listing 9.3k (151 personal skills); start-up hook output 7.2k (`hook_success` 6.0k +
  `hook_additional_context` 1.2k, most likely a plugin's session-start text); connector instructions
  3.3k plus the deferred tool-name list 3.4k (Vercel and monday.com connectors hold 194k and 127k
  tokens of deferred schemas, which stay out of the window); agents 1.8k; memory files 1.6k. In the
  brain the skill listing will be larger.

## Decisions

### Phase 1: compaction notice

1. **Map compaction to one event, main chat only.** `mapSystem` maps `status: 'compacting'` →
   `compaction started`; `compact_boundary` → `done` (with `id: 'c:<uuid>'`, trigger, before and after
   tokens); `status` with `compact_result: 'failed'` → `failed`; `status` with `compact_result:
   'success'` → nothing (the boundary follows); any other status while compacting with no
   `compact_result` → `ended`. Status from helpers is ignored. *(S1 confirmed this order.)*
   Plain: the app finally hears when Claude summarises a chat, and the message can never get stuck.
2. **Show it in the conversation.** While compacting, the state line says "Summarising the earlier
   conversation to make room…". It is cleared on `done`, `failed`, `ended`, turn end and any state
   change. On `done`, a divider in the transcript reads: "Earlier messages were summarised to make
   room. Claude keeps the key points but may have lost some detail." (Token figures only in the
   Inspector.) On `failed`, a warning once until a compaction succeeds: "Claude couldn't summarise
   this chat. If replies start failing, start a new chat." The divider reuses `notice` styling with
   its own `data-kind`.
   Plain: you see exactly where Claude's memory of the chat was condensed, in plain words.
3. **Replay starts at the divider and hides the summary.** `replayHistory` reads with
   `includeSystemMessages: true` (widen `EngineFns.getSessionMessages` opts, `:139`) and emits `done`
   for the boundary. It skips `user` messages flagged `isCompactSummary` or `isCompletedLocalCommand`,
   so neither the summary nor a `/compact` ever shows as the person's words (fixes today's bug).
   Claude Code returns only the messages since the last summary (S3), so a reopened summarised chat
   opens with the divider worded for replay: "Earlier messages in this chat were summarised to make
   room, so they aren't shown here." Showing the older messages would mean reading Claude Code's own
   transcript files, whose format isn't public: out of scope. Live and replayed dividers share the id,
   so none doubles.
   Plain: a reopened long chat starts at the summary marker and never shows the summary as if you'd typed it.

### Phase 2: context meter

4. **The server reads usage after every turn, for free.** At each main-chat `result`, and after each
   `compact_boundary`, the server calls `getContextUsage({ detail: 'summary' })` off the turn-end
   path (it never delays `turn-end`; guarded, optional on `EngineQuery`, `CONTEXT_READ_TIMEOUT_MS`,
   never during a reply) and emits `context`. Fallback when missing or failed: the last main-thread
   assistant `usage` (input + cache read + cache creation + output) against
   `modelUsage[model].contextWindow`. Helpers' usage never counts. *(S2)*
   Plain: the app knows how full each chat is without spending anything extra.
5. **The meter measures how close the chat is to being summarised.** `percent` is used tokens against
   `autoCompactThreshold` (else the window when auto-summarising is off), so a 1M-window model doesn't
   read 15% when nearly full. `ContextMeter` sits in the composer footer row in `Chat.tsx`, beside the
   level line and **in manual mode too**: a thin bar and "Chat 42% full". Amber from 60%, red from
   85% with the text "Nearly full: Claude will summarise the earlier messages soon". Accessible name
   "Chat 42% full before Claude summarises it"; never colour alone. Hidden until the first reading.
   Added to `docs/design-system.md`.
   Plain: a glance tells you whether the chat has room left.
6. **Details on demand in the Inspector.** A "Context" fold shows used / window, the point at which it
   will summarise, the biggest items (messages, tools, connectors, skills, memory files, agents) and
   the last compaction with its before and after figures. Opening it calls `GET ROUTES.chatContext`,
   which asks the engine for `detail: 'full'` at most once per 30 s and never during a reply.
   Plain: if a chat feels heavy you can see what's taking the room.
7. **Remembered per chat.** The newest reading per chat is stored in the app's data folder
   (`server/store/context-readings.ts`, the same pattern as `chat-levels.ts`) and replayed on reopen
   with `source: 'stored'`. The newest `context` event also joins the live replay log (newest only).
   Plain: the meter is right as soon as you reopen a chat.

### Phase 3: efficient compaction and context

8. **Re-anchor the brain after every compaction.** A `SessionStart` hook (`source: 'compact'`)
   returns `additionalContext` from `reanchorText`: the linked to-do (title and path), the newest brain
   paths this chat read or produced (from `s.files`), helpers still working, then
   `REANCHOR_CLOSING_LINE`. Capped at 2,000 characters, to-do first. (The client line returns anyway:
   the system prompt is re-rendered at compaction.) *(S5)*
   Plain: after a summary, Claude still knows which to-do and which files the chat is about.
9. **Brain-aware summaries, quietly.** `BRAIN_COMPACT_INSTRUCTIONS` is one more line in
   `s.appendLine` (built in `newSession`, `:894`). S4 showed it steers manual and auto summaries alike
   and leaves nothing in the history. A chat started before this release has its prompt recorded
   already, so it gets the line only after its first summary: acceptable, nothing breaks. No hook
   script is shipped. **The app never sends `/compact` itself** in this release.
   *(S4: the SDK callback's return is ignored; a command hook works but leaves a line in history.)*
   Plain: summaries keep what agency work needs, without the app typing commands into your chat.
10. **Stop bouncing between models.** Upward switches always go ahead, and so does any level the
    person chose themselves. An **automatic downward** switch is denied in a `PreModelSwitch` hook
    when the cache is warm (`prompt_cache_warm`) and re-reading is estimated at $0.10 or more
    (`estimated_cache_write_usd`), unless the lower level has been wanted three turns running. This
    follows the real TTL and prices, so a cheap re-read (for example to Haiku) still switches. **A
    return to a model that served this chat within the hook's `cache_ttl` is always allowed**: its own
    cache is still warm (S6 read 88k from cache, wrote 9k), and the hook's estimate assumes a full
    re-write. The session records when each model last answered. **`deny` makes `setModel` throw**
    ("Model switch blocked by a PreModelSwitch hook"): `applyChoice` treats a denial our own hook
    made as "kept" (a flag set by the hook, never by matching the message text), not as the logged
    failure. The rule is one pure function, `shouldKeepModel`. The app-side fallback (warm = 60
    minutes, floor 20k) is kept only for engines without the hook.
    After a denied switch, `s.turnTier` and `appliedChoice` stay on the applied (higher) tier, so a
    later skill in the same reply can never "raise" the chat downwards. The level line says, once per
    kept stretch: "Staying on Deep for now: switching down would mean re-reading the whole chat."
    `TurnLevel` gains `kept?: { wanted: LevelTier }`. Switch estimates are logged as numbers only.
    Hooks for decisions 8–10 attach **always**, not only `if (levels)` (decision 10's logic no-ops
    without levels). *(S6, S7)*
    Plain: the app stays on the current model for short dips and moves down only when it clearly pays.
11. **Pin the prompt record.** `systemPrompt` sets `snapshot: true` explicitly. It is already the
    default, so this changes nothing today; it pins the behaviour. Note: it doesn't cover tool or
    helper-agent definitions, and a reworded `FILES_LINE`/`HELPERS_LINE` won't reach an open chat
    until it is summarised.
    Plain: a safety pin, not a saving.
12. **Leaner start-up: measure, trim what the app owns, advise on the rest.** The Inspector's Context
    fold lists the heaviest connectors, skills and memory files a chat carries before anyone types.
    The app trims only what it controls (its own agents and appended lines, guided by the start-up
    baseline). It never turns off a person's connectors, plugins or settings, and never writes the
    brain. Heavy person-owned items get plain advice, for example "Start-up text from your plugins:
    about 6k tokens in every chat. If you don't need a plugin here, turn it off in Claude's
    settings." Advice appears only for items above 2k tokens. From the baseline, the useful groups are:
    skill listing, start-up hook text (`hook_success` + `hook_additional_context` from
    `messageBreakdown.attachmentsByType`, so the detail route reads `detail: 'full'`), connector
    instructions and tool names, memory files. Deferred connector schemas are listed as "not loaded
    until used" and never get advice. The app's own additions (agents 1.8k across 12, mostly not the
    app's) stay as they are: nothing worth trimming.
    Plain: you can see what every chat carries and what's worth switching off; the app never changes your setup.
13. **Leave `idleCompaction` alone.** S7 saw no idle compaction in an SDK session in 45 minutes, so the
    app sets nothing; if Claude Code starts doing it, the summary still gets the brain line (it lives in
    the system prompt). A failed compaction (for example `too_few_groups`) shows the once-only warning
    from decision 2 and never stops the reply.
    Plain: nothing to change; if Claude can't summarise, you're told once and the chat carries on.
14. **Never in the logs.** Status lines say only "Summarised a chat (auto)." or "Kept the model:
    re-reading would cost about $0.40." Never summaries, instructions, prompts or chat content.
    Plain: nothing private ends up in the app's log.

## Next release: start-up kits (not built here)

Asked 2026-11-15; Ian's decisions, fixed for the follow-up plan:

- **Ships in the release after this one**, planned from real numbers the Context panel (decision 6)
  collects, so the saving is proven first.
- **The app may switch off a person's own plugins and connectors inside app chats only**, through the
  engine's flag-layer settings. Their settings files are never changed; terminal Claude Code is
  unchanged. This replaces decision 12's "never turns off a person's connectors" for that release.
- **Kits are chosen automatically, with manual overrides**: the app works out which kit a chat needs,
  and Owners and scouts (and the person, per chat) can override.

Facts gathered so far (SDK 0.3.322):
- Levers: `skillOverrides` (`'name-only'` keeps a skill usable but drops its description; never use
  `'off'`), `enabledPlugins` false in flag settings, `toggleMcpServer` (live, so a connector can be
  turned back on mid-chat), `disableClaudeAiConnectors`, `reloadSkills`/`reloadPlugins`.
- The engine starts on the first send (`:1330`), so the existing one-shot level pick can choose the kit
  from the first message at no extra cost.
- **Use a few fixed kits, not a per-chat mix.** The spike's brand-new sessions read 12.9k tokens from
  cache on their first reply: chats with an identical start-up share the cache. A unique mix per chat
  would lose that and could cost more than it saves.
- Rough saving: 15–20k fewer start-up tokens per chat, about 6–8 cents less cache writing per new
  Sonnet chat (double on Opus), a little per reply, and more room before summarising.
- To spike then: skill overrides and plugin switches through flag settings; turning a claude.ai
  connector back on mid-chat and what it does to the cache; cache sharing within a kit.

**Learning from use (recommended 2026-11-15, for the kits release):**
- **Use the brain's existing Observe pipeline, not a new shared file.** `.claude/hooks/log-team-usage.cjs`
  already writes per-person `z-logs/team-usage/<name>.jsonl` (the only synced part of `z-logs`, per
  `.gitignore`), synced only while the Owner has Observe on, each line locked with the agency's
  Observe key (`.team-config/observe.json`), readable only by the Owner (and scouts if allowed) in
  the Command Centre. Lines hold the day, names and setup, never anything typed.
- **The app never writes it.** The brain's tracker gains an `app` event type (brain change, Ian's yes
  at the time); the app hands it events through the brain's own script, as with skill levels.
- **Events (names and counts only):** chat start (kit, auto or overridden, level, start-up tokens by
  group); during (skills and connectors used, items turned back on mid-chat = kit miss, overrides);
  end (peak fullness, summaries, kept switches and estimated saving, estimated cost, turns). Personal
  chats: a count only.
- **Shadow mode first:** for two weeks the app logs the kit it *would* pick and switches nothing off,
  giving a real hit rate before anyone is affected.
- **Review skill** (`tdsapp-` prefix, brain change with Ian's yes): reads Observe data, reports kit
  misses, unused heavy items, cost per kit and suggested changes; Owners or scouts approve, and
  approved changes feed the automatic pick (through a brain script, as skill levels do).

## Contract

- `shared/context-contract.ts`: events, Inspector detail, route path, thresholds, policy signatures,
  fixed texts.
- `shared/contract.ts`: `CompactionEvent | ContextEvent` joined to `ChatEvent`; `ROUTES.chatContext`
  (lead).
- `shared/levels-contract.ts`: `TurnLevel.kept?: { wanted: LevelTier }` (lead).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Lead | me | spike, contracts, plan | `shared/context-contract.ts`, `shared/contract.ts`, `shared/levels-contract.ts`, this plan |
| Overseer | `overseer`, fable, high | plan critique and sign-off | (read-only) |
| Builder A | `builder`, opus, high | engine with tricky rules and concurrency: turn state, the choice chain, hook wiring, replay | `server/engine/event-map.ts`, `server/engine/session-manager.ts`, `server/engine/context-policy.ts` (new), `server/store/context-readings.ts` (new), `server/http/routes.ts`, `server/index.ts`, and their tests |
| Builder B | `builder`, sonnet, medium | default (UI) | `client/src/components/ContextMeter.tsx` (new), `client/src/components/Chat.tsx`, `client/src/components/LevelLine.tsx`, `client/src/components/Transcript.tsx`, `client/src/shell/Inspector.tsx`, `client/src/state/chat-reducer.ts`, `client/src/store.tsx`, `client/src/api.ts`, `client/src/format.ts`, `client/src/styles/chat.css`, `docs/design-system.md`, and their tests |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/context-policy.test.ts` | `shouldKeepModel`: upward and explicit always switch; warm + ≥ $0.10 keeps; cheap re-read switches; three turns running switches; fallback rule. `reanchorText`: to-do first, cap, closing line. `meterBand` bands | A |
| `server/engine/event-map.test.ts` | status/boundary → `started`/`done`/`failed`/`ended`; helper status ignored | A |
| `server/engine/session-manager.test.ts` | `context` after a turn with and without `getContextUsage`; a slow read never delays `turn-end`; helpers' usage never counted; a denied switch leaves `turnTier`/`appliedChoice` on the higher tier and a later skill never moves the model down; an explicit downward choice always switches; hooks wired in manual mode; replay emits dividers by id with no doubles and hides the summary | A |
| `server/store/context-readings.test.ts` | a stored reading round-trips; a bad file is ignored | A |
| `server/http/routes.test.ts` | the detail route through `checkRequest`; rate limit; never during a reply | A |
| `client/src/state/chat-reducer` tests | `compaction` sets and clears the state line (done, failed, ended, turn end, state); `context` newest wins; failed warning once | B |
| `client/src/components/ContextMeter.test.tsx` | bands, accessible name, hidden before the first reading, shown in manual mode | B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (worktree port 3382; preview per the repo's worktree rule)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert (meter, divider, Inspector fold, kept-level line). Security: the
      correctness reviewer checks the new route goes through `checkRequest` and that no log line
      carries chat content.
- [ ] Browser check: a chat that compacts, the meter bands, a reopened compacted chat, the Inspector fold, manual mode.

## Overseer pre-review (2026-11-14)

Five blocking items, all taken: the 5-minute warm test was wrong for subscription accounts (1-hour
cache); the switch rule guarded size, not bouncing; the policy couldn't tell a person's choice from an
automatic one and `turnTier` could undo a kept switch mid-reply; app-led `/compact` broke turn state
and replay, so it is dropped; file ownership had holes and the resume reading had no data, so readings
are now stored by the app. Should items 6–12 and nice items 13–15 are folded into the decisions above.

## Review outcomes

Reviewed 2026-11-15 after the build (b4706a1) and main's v0.31.0 merge. Fixes are in c771ff8 and 14c2411.

**UI and accessibility (Sonnet): 3 confirmed, all fixed.**
- The meter row's wrapper reused `composer-foot`, which already styles the attach/send row. It is now `context-foot`.
- The compacting line had a second `role="status"`. The app's Announcer now says "Claude is summarising the earlier conversation to make room".
- The meter's `aria-label` is "How full this chat is". Its value text is the same words people see.

**UX expert: 8 findings, 7 confirmed (1 duplicate of the class clash), all fixed. The copy changed from the plan:**
- Panel headline: "Chat N% full", then "X of Y tokens before Claude summarises" (or "... used. Auto-summarising is off."), then "Most this model can hold: Z tokens".
- Approximate note: "From Claude's last reply. Open this again in a minute for the full list."
- Items: free space and buffer rows are left out. The rest are largest first, capped at 12, with the "not loaded until used" rows after them.
- Kept line (decision 10): "Staying on {Tier} for now: it costs less than switching down and re-reading the whole chat."
- Red meter: "Chat N% full: Claude will summarise the earlier messages soon". The Announcer says the same when a reply finishes in the red band.
- `tokenWords` rounds to millions first, so it never shows "1000k".

**Correctness (Opus): 3 confirmed, all fixed. The fix round was re-checked with no new faults, and one more test was added.**
- The Context panel cancelled its own request when the full read's reading came down the stream, so a fresh list always showed as approximate. It now asks once per opening, and asks again only for a newer reading.
- Ruling on decision 4: a summary boundary that arrives during a reply no longer calls `getContextUsage`. It shows the usage estimate from `post_tokens`, and the turn-end read follows. "Never read during a reply" wins over "read after every boundary".
- The event mapper forgets an unfinished summary when the reply ends (`result`), so a summary that is stopped part-way can't hide later ones.

**Gates:** tsc clean. Lint has 11 warnings, all on main already. 2,800 tests pass. The build works. No file loses more than 40 lines against the merge base.

**Browser (preview on port 3382):**
- The meter sits under the message box, and the attach/send row is intact.
- The Context panel shows the headline, the items in order, and the connector rows that load only when used.
- `/compact` showed the summarising line, then the divider. The meter went from 8% to 7%.

Plain: the reviews found one layout clash, some unclear wording and three small logic slips. All are fixed and covered by tests.

**Overseer sign-off (2026-11-15): approved, no blockers.** Watch after release:
- Returning to a recently used model rests on one spike measurement. Log the next reply's cache-write tokens, so the real cost of a return can be checked against the estimate.
- A `status` message that isn't about the summary, arriving mid-summary, would clear "Summarising…" early. This only affects what's shown.
- Confirm `/compact` on a genuinely long chat. The browser check used a small one (8% to 7%).
