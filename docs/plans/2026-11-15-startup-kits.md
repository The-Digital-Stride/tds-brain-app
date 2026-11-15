# Start-up kits (shadow mode) and the token savings ledger

Date: 2026-11-15 · Size: XL (spike + three build parts, one release) · Branch: `startup-kits` · Explainer: https://claude.ai/artifact/9vCVzSQ3a3TaefRC5Rm9Xt

Background and Ian's earlier decisions: `docs/plans/2026-11-14-context-management.md`, section
"Next release: start-up kits". This plan builds that section, cut to what Ian chose on 2026-11-15.

## Objective

Every new chat loads all of a person's skills, plugins and connectors before they type: about 49k
tokens in a brain-like spike. Most chats need a fraction. This release proves how much a
few fixed "start-up kits" would save, by watching real chats without switching anything off
(shadow mode), and adds one central, measured count of the tokens the app's tools save.

Plain: the app starts keeping score of the tokens it saves, and quietly works out which kit each chat
would have needed, so the kits can be switched on later from real numbers rather than guesses.

## User decisions (fixed)

- **Shadow mode + ledger only.** The app picks and logs a kit for each chat and switches nothing off.
  No `skillOverrides`, no `enabledPlugins`, no `toggleMcpServer` in this release. Switching on is a
  later release, after about two weeks of shadow data.
- **Brain pieces are built here**, in `brain-skills/`, tested, and copied into the brain only with
  Ian's yes at the time. The app never writes brain files itself.
- **Team view later.** Unlocking the team's Observe lines needs the Command Centre's
  `lib/observe.cjs`, which isn't in the brain or on Ian's Mac. Everything else ships now. Each person
  sees their own figure; the plan keeps a slot for the team figure.
- **Explainer: yes.**
- Fixed from the earlier plan: tokens only, measured only (no cost, no estimates in the ledger); one
  ledger every tool feeds; names and counts only, never chat content; personal chats count with no
  detail; counting starts at this release, no back-fill; a few fixed kits, never a per-chat mix.

## Facts

App (worktree at `main` 1aa5fb0, v0.35.0):
- `startEngine` (`server/engine/session-manager.ts:1891`) sets `settingSources: ['user','project','local']`,
  `options.settings = engineSettings` (permission settings only), hooks for SessionStart and
  PreModelSwitch always, Skill PostToolUse and Agent PreToolUse only `if (levels)`.
- `observeContext` (`:1493`) sees every main-chat engine message: assistant `usage` (incl.
  `cache_read_input_tokens`), `result.modelUsage`, `compact_boundary` with `compact_metadata.pre_tokens`
  / `post_tokens`. Helpers are skipped via `parent_tool_use_id`.
- `readContext` (`:1584`) does a `summary` read at turn end; the Context panel does a `full` read
  (`:3141`), rate-limited by `CONTEXT_DETAIL_MIN_INTERVAL_MS` (30 s).
- `server/engine/context-policy.ts` already turns a `full` reading into items grouped as `skills`,
  `connectors` (per server), `memory`, `system` (incl. plugin/hook start-up text), `tools`, `agents`.
- The one-shot level picker (`server/engine/level-picker.ts`) is Haiku, low effort, no tools, strict
  JSON `{tier, helpers, reason}`, prewarmed from the composer, run only when `pickNeed` says so.
- Stores in the app's data folder follow one pattern (`server/store/chat-kinds.ts`): queued writes,
  only a missing file reads as empty, capped entries.
- Brain scripts are run the way `server/brain/skill-levels.ts` runs
  `.claude/skills/tdsapp-skill-levels/scripts/tdsapp-skill-levels.cjs`.
- Live app data: `context-readings.json` holds two readings (totals only). So there are no real
  start-up breakdowns yet: this release collects them.

Brain (read only):
- `.claude/hooks/log-team-usage.cjs` writes `z-logs/own-usage/<name>.jsonl` (local, git-ignored) and,
  only with Observe on, `z-logs/team-usage/<name>.jsonl` (the only synced part of `z-logs`), each line
  sealed with X25519 + HKDF (`observe-v1`) + AES-256-GCM to `.team-config/observe.json`'s public key.
  Lines hold `{who, date, event, name, folder, setup}`; events `skill` and `command` only.
- The app itself reads `z-logs/team-usage/*.jsonl` for "used often" (`server/brain/usage.ts`,
  `shared/contract.ts:523`): it counts only plain lines with `event` `skill`/`command` or `{skill, ts}`.
  A sealed line (`{v, k, e, n, c}`) has none of these, so older app versions ignore sealed `app` lines.
  `server/brain/watch.ts` watches that folder, so each new line triggers a refresh (harmless).
- Observe is on, readers `owner+scouts`, one wrapped reader key (Pete). The reader code is not here, so
  **how the Command Centre treats an unknown `event` (or reads `own-usage`) is unknown.**

## Phase 0: spike (lead; scratchpad folder, never the brain; Haiku)

- **K1 start-up breakdown in a brain-like setup.** Copy the brain's `.claude/skills/` and `CLAUDE.md`
  (read only) into a scratch folder; one `full` read after the first reply. Record each group's
  tokens, per-connector and per-plugin rows, and how long the `full` read takes and what it costs.
- **K2 what a turn reveals about use.** Confirm the item names a turn exposes: `Skill` tool input
  (`plugin:skill` for plugin skills), `mcp__<server>__<tool>` tool names, and how a claude.ai connector
  is named, so a miss can be matched to a kit item.
- **K3 (for the switch-on release, recorded only).** With `skillOverrides: 'name-only'` and
  `enabledPlugins` false in flag settings, two brand-new chats with the same kit: do they share the
  start-up cache? Not built on in this release.

### Spike results (2026-11-15, SDK 0.3.322, Haiku 5.5, scratch copy of the brain's `.claude/skills`, `rules`, `agents`, `CLAUDE.md`, `.mcp.json`; no brain hooks)

Script: session scratchpad `kspike/scripts/k1.mjs`; not committed.

- **Start-up: 49.0k tokens** before anything is typed (first reply wrote 49k to the 1-hour cache, $0.0099
  on Haiku). `full` read took 678 ms, `summary` 46 ms; neither shows in `total_cost_usd`.
- Categories: messages 20.6k (all start-up attachments: `prompt_snapshot` 13.8k, `skill_listing` 11.0k,
  `instructions` 7.5k, `deferred_tools_delta` 5.5k, `agent_listing_delta` 2.2k, `hook_success` 1.6k,
  `mcp_instructions_delta` 1.5k, `hook_additional_context` 1.2k), memory files 10.8k (brain rules
  9.2k, Ian's CLAUDE.md 1.6k), skills 9.9k (327 skills: brain 3.9k, built-in 2.3k, plugins 2.0k, user
  1.4k, synced 0.2k), connector instructions 3.0k, built-in tools 2.4k, agents 1.9k, slash commands 0.9k.
- **Connector schemas are deferred** (523k tokens held out of the window; only `savvy-progress` loaded,
  247). What connectors cost at start is the deferred **name list** (5.5k, 683 tool names, not split
  per server by the engine) plus each server's instructions (measured per server: SEMRush 773, Claude
  Docs 644, Vercel 629, context7 244, wispr-flow 237, …).
- Plugin skill text by plugin: superpowers 965, vercel 492, design 232, then under 100 each.
- **What a kit can trim** (first guess 12–15k; see K3 for the measured figure): connector names and
  instructions, plugin skills, plugin agents and plugin start-up hook text. The brain's own skills,
  rules and CLAUDE.md (~14k) are never a kit's to trim.
- 56 MCP servers at start, 27 plugins. Names seen: claude.ai connectors as `claude.ai <Name>` (tool
  prefix `mcp__claude_ai_<Name>__`), plugin servers as `plugin:<plugin>:<server>` (prefix
  `mcp__plugin_<plugin>_<server>__`), plugin skills and agents as `<plugin>:<name>`, plugin ids as
  `init.plugins[].source` (`name@marketplace`, also `@synced`, `@inline`, `@skills-dir`, `@builtin`).
  **K2 answered.**
- **K3 calibration** (`kspike/scripts/k3.mjs`): flag settings `enabledPlugins: { id: false }` work
  (synced plugins too); `toggleMcpServer(name, false)` before the first message works for every
  non-plugin server (a disabled plugin's servers are simply gone). Two working kits measured:
  `core` 49.0k → 42.2k (**6.8k saved**: name list −2.4k, plugin skills −1.1k, agents −1.0k, hook text
  −2.7k, instructions −0.6k); `web` 49.0k → 42.8k (6.2k, **mostly noise**: many servers were still
  `pending` when the first message went, so their names never joined the start-up in either run).
  The apportioned estimate came within −13% for `core` (the gap is the hook text it leaves out) and
  was useless for `web`. **So: a chat's start-up depends on how fast its connectors connect, and
  "would save" is shown as a range.** Cache sharing within a kit was not tested (switch-on release).

## Decisions

1. **One ledger module.** `server/usage/savings.ts`: `record(entry)` and `summary()`; no tool keeps its
   own tally. `server/store/token-savings.ts` stores per-day (UTC) totals by `source` and `measure` in
   the app's data folder (`token-savings.json`), plus the persisted `uuid`s of counted summaries
   (capped). Record only on the live stream path, never from `replayHistory`.
   Plain: one place keeps the count, so every tool's saving adds up the same way.
2. **What counts now.** `summary` / `compacted`: `pre_tokens − post_tokens` per main-chat
   `compact_boundary`; skipped when `post_tokens` is missing or `pre ≤ post`; once per boundary `uuid`.
   `cache` / `reused`: `cache_read_input_tokens` from `type === 'assistant'` frames only (never
   `stream_event`), main chat only, the max per `message.id` (one API message arrives as several
   frames sharing id and usage), deduped in a per-session in-memory set. Shown as its own line, never
   added into "saved". `kits`: nothing in shadow mode.
   Plain: only savings Claude itself reports are counted, each exactly once.
3. **Own figure route.** `GET /api/usage/savings` through `checkRequest`: the person's own totals
   (today, last 7 and 30 days, since counting began) by source, and `team: null` for everyone.
   Plain: everyone can see their own count; the team count can slot in later.
4. **"Tokens saved" in Settings.** A section in `SettingsView` reusing `Fold` and banners per
   `docs/design-system.md`: tokens saved by summarising long chats; a separate line for tokens reused
   from Claude's cache; "Start-up kits: watching, nothing switched off yet". **Nothing about a team
   figure** (overseer: an undated promise). No Inspector line: shadow stays invisible in chats. UK
   English; exact copy after the UX gate.
   Plain: a small Settings panel shows what the app has saved you.
5. **A few fixed kits, as data.** `shared/kits-contract.ts` holds `BUILT_IN_KITS`: `core` (brain work:
   mail, calendar, Drive and Docs, Slack, monday.com, notes), `ads` (core plus search, ads and
   analytics connectors and the marketing plugin), `web` (core plus sites, code and design
   connectors and plugins), and `full` (everything, the fallback). Each lists what **stays on**:
   connector name patterns and plugin names. Always kept, never a kit's to trim: the brain's own
   project servers (names read from the brain's `.mcp.json`), skills, agents and rules, and
   `@builtin` plugins. The brain file `.claude/tdsapp-kits.json` (written only by the `tdsapp-kits`
   script) can change a kit's contents; ids and blurbs stay fixed in the contract. No file or a bad
   one: the built-in kits, silently.
   Plain: there are a handful of kits, and the agency can tune what's in them without an app update.
6. **The pick rides on the level pick.** The Haiku picker's reply gains `kit`; its prompt lists only the
   contract's fixed ids and blurbs. A missing or unknown `kit` is `full` and never a failure, so the
   old reply shape still parses. The tier wording is pinned by a test, and tiers are compared before
   and after on a fixed sample, since level picks are live behaviour. Rules first: a typed `/name`
   picks the kit holding that skill's plugin, else `full`. A chat with no pick (manual mode, a set
   tier, a levelled skill) is `full` with `how: 'fallback'`. The kit lives in its own session field,
   set once (a late pick included), never through `adoptPick`.
   Plain: the same quick check that sets how hard Claude works also guesses the kit, at no extra cost.
7. **Read the start-up once per new chat.** After the first reply of a brand-new chat (never resumed,
   never during a reply), one `getContextUsage({ detail: 'full' })` with a timeout, sharing the Context
   panel's rate limit. `startupReading(res)` in `server/engine/kits.ts` builds it from the raw reply:
   `messageBreakdown.attachmentsByType`, `mcpInstructions`, `skills.skillFrontmatter[]` (plugin by
   name prefix), `agents[]` (plugin by `agentType` prefix). Deferred and loaded schemas are never
   counted. "Would save" is a range: `sure` = the engine's per-item figures for what the kit drops
   (instructions, plugin skills, plugin agents); `approx` adds the kit's share of the tool-name list,
   apportioned by tool-name characters. Hook text stays unattributed and out of both. Shadow data
   only, never the ledger.
   Plain: the app reads what each chat loaded at the start, and shows the saving a kit would make as a range.
8. **What a chat used.** Read `tool_use` blocks from assistant frames in the message handler, helpers
   included (a helper needs the connector too), plus a typed `/name`: skills (`Skill` input),
   connectors (`mcp__` prefix). One name normaliser (`normName`) for kit patterns, reading rows,
   `mcpInstructions[].serverName` and tool names, tested on every form the spike saw. `fits` = every
   kit that covered everything used; a miss = the picked kit isn't in `fits`. The ledger still skips
   helpers.
   Plain: the app notes which connectors and skills each chat really used, so it can tell whether the kit would have been enough.
9. **Shadow record per chat.** `server/store/kit-shadow.ts` (app data folder, keyed by `sdkSessionId`,
   re-keyed if the id changes at init, capped, trimmed after 35 days), updated at turn end: day (UTC),
   kind, kit, how, `fits`, level tier, start-up by group, would-save range, skills and connectors
   used, turns, peak percent, summaries, and the chat's own `compacted` and `cacheRead` totals, plus
   `seq` and `handedOffSeq`. Personal chats: kind, day, turns, `compacted` and `cacheRead` only. Never
   anything typed, and never `LevelPick.reason` (it is drawn from the message).
   Plain: for each chat the app notes which kit it would have used and whether that would have been enough.
10. **Hand-off to the brain: cumulative and retried.** At chat end (close, idle close) and at app start
    (anything not yet handed off), the app runs `tdsapp-kits/scripts/tdsapp-usage.cjs` with one `app`
    event per chat on stdin: the shadow record as it stands, `chat` = a salted hash of the session id
    (salt kept in the app's data folder; never the raw id) and `seq`. Readers keep the highest `seq`
    per `chat`, so a reopened chat sends again without double-counting. `handedOffSeq` is set only
    after the script succeeds, so data waits (up to 35 days) for the skill to be copied. Never
    awaited in `closeSession` or `closeAll`. Script missing: one log line per app run.
    The script writes a plain line to `z-logs/app-usage/<name>.jsonl` (local, git-ignored, a file no
    existing reader knows) and, only when Observe is on **and** its `SYNC_APP_EVENTS` switch is on, a
    sealed line starting `{"v":1,` to `z-logs/team-usage/<name>.jsonl`. The switch ships **off**
    until Pete confirms the Command Centre skips unknown events. Older app versions ignore sealed
    lines (Facts). `log-team-usage.cjs` is not changed.
    Plain: the brain gets each person's kit data safely, ready for the team view later, and nothing is lost if the skill isn't copied yet.
11. **The script distrusts the app.** It whitelists keys, cleans names by the tracker's `cleanSkill`
    rule, caps arrays and line size, trims its file like `trimOwn`, carries `v: 1`, and offers a
    `capabilities` command the app checks first. `usage` needs no role; `set` checks `roles.json`.
    Plain: even a faulty app can't put anything unexpected into the brain's logs.
12. **One brain skill: `tdsapp-kits`.** `brain-skills/tdsapp-kits/`: `SKILL.md` (`roles: owner, scout`,
    `maturity: draft`, `members: false`, `agency: true`; its `USE WHEN` never mentions usage),
    `scripts/tdsapp-kits.cjs` (`show`, `set` kit contents in `.claude/tdsapp-kits.json`, `review`:
    hit rate by `how`, misses, heavy unused items, would-save range per kit, from
    `z-logs/app-usage/`), `scripts/tdsapp-usage.cjs` (decisions 10–11), tests, a README row. Review
    covers the person's own data this release.
    Plain: one brain command shows how the kits are doing and lets Owners adjust them.
13. **Shadow is hard-wired.** `KITS_MODE = 'shadow'`; engine options are unchanged by this release, and
    a test pins that. No measuring engines are ever started in the real brain (they would fire its hooks).
    Plain: nobody's chats change in this release.

## Contract

`shared/kits-contract.ts` (lead): kit types and `BUILT_IN_KITS`, `KITS_MODE`, `KitPick`, `StartupReading`,
`WouldSave`, `KitShadowRecord`, `AppUsageEvent`, `SavingsEntry`, `SavingsSummary`, `KitTracker` (the
facade), the route path, fixed texts. `shared/levels-contract.ts`: `LevelPick.kit?: KitId` (lead).

## Team and file ownership

Order: C first (it lands the facade A calls); B and D in parallel with C; A after C.

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Lead | me | spike, contracts, plan, explainer | `shared/kits-contract.ts`, `shared/levels-contract.ts`, this plan |
| Overseer | `overseer`, fable, high | plan critique and sign-off | (read-only) |
| Builder C | `builder`, sonnet, medium | default (pure logic, tests first) | `server/engine/kits.ts` (new: `normName`, rule pick, `startupReading`, would-save, `fits`, the `KitTracker` facade), `server/usage/savings.ts` (new), `server/store/token-savings.ts` (new), `server/store/kit-shadow.ts` (new), `server/brain/app-usage.ts` (new), `server/engine/level-picker.ts`, `server/http/routes.ts`, and their tests |
| Builder A | `builder`, opus, high | engine ordering: turn end, reads only between replies, close and idle close in a 3,168-line file | `server/engine/session-manager.ts`, `server/index.ts`, and their tests (call sites only) |
| Builder B | `builder`, sonnet, medium | default (UI) | `client/src/components/SettingsView.tsx`, `client/src/api.ts`, `client/src/format.ts`, client styles it needs, `docs/design-system.md`, and their tests |
| Builder D | `builder`, sonnet, medium | default (scripts) | `brain-skills/tdsapp-kits/**`, `brain-skills/README.md` |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/kits.test.ts` | `normName` on every spike form; rule pick; unknown → `full`; `startupReading` ignores deferred schemas; would-save `sure` ≤ `approx`, hook text in neither; `fits` and misses; personal records stripped; `LevelPick.reason` never stored | C |
| `server/usage/savings.test.ts`, `server/store/token-savings.test.ts` | a boundary counts once by `uuid`; no `post_tokens` or `pre ≤ post` skipped; cache per `message.id` max, never into saved; UTC days; ranges; bad file ignored | C |
| `server/store/kit-shadow.test.ts` | round trip; re-key; cap; 35-day trim; `seq` rises; `handedOff` only after success | C |
| `server/brain/app-usage.test.ts` | event on stdin; salted hash, never the raw id; missing script logs once; failure leaves `handedOff` false; flush at start | C |
| `server/engine/level-picker.test.ts` | reply with and without `kit`; bad kit → `full`; tier wording pinned | C |
| `server/http/routes.test.ts` | savings route through `checkRequest`; `team` null | C |
| `server/engine/session-manager.test.ts` | engine options unchanged; one `full` read per new chat after the first reply, none on resume or mid-reply; boundary → ledger once, replay never records; cache from `assistant` frames only; helpers never in the ledger but in "used"; kit set once incl. late pick; hand-off on close and idle close, never awaited | A |
| `client/src/components/SettingsView.test.tsx` | own lines, cache line separate, shadow line, no team text, empty state | B |
| `brain-skills/tdsapp-kits/scripts/*.test.ts` | plain line to `app-usage`; sealed line only when Observe on and switch on, starts `{"v":1,`, opens with a test key; whitelist, caps, cleaning; `capabilities`; `set` checks roles; `review` keeps highest `seq` per `chat` | D |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview `/tmp/tba-preview-startup-kits/`, port 3878, own `TDS_BRAIN_APP_DATA`)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Level picks: tiers on a fixed sample before and after the prompt change.
- [ ] Domain gates: **security** (brain script writes and sealing, salted hash, no content in any
      event or log, route through `checkRequest`); **UX/UI** (Settings panel, copy).
- [ ] Browser check: Settings panel empty and with figures; a chat that summarises adds to it once;
      reopening it doesn't add again.

## Overseer pre-review (2026-11-15)

Four blocking items, all taken: the hand-off could lose or double-count data (now cumulative with
`seq`, retried, never awaited); "would save" pointed at the wrong part of the reading (now
`startupReading` from the raw reply, as a range); where "used" came from was unspecified (now
`tool_use` blocks, helpers included); the ledger's shape contradicted itself (per-chat counts now in
the shadow record). Should items 5–10 and the nice items are folded into decisions 1–13. Open points
decided: one skill; no team text; no Inspector line; K3 as calibration; Builder A narrowed to call
sites with C landing a facade first; dedupe keys kept with the frame rules above.

## Review outcomes

Reviewed 2026-11-15 after the build (dc2d85c, 2203a8b). Fixes in 000346b.

**Correctness (Opus): no runtime faults; 2 test gaps confirmed and fixed.** The guard that stops a
crashed-and-restarted chat counting as new (`kitStart`) and the two guards for a chat reopened while
its close is still handing off (`onStart` queue hand-over, `onClose` state delete) had no test that
failed without them. Tests added; each now fails with its guard removed.

**Security (Opus): 3 confirmed, all fixed.**
- A typed `/word` was stored as a skill used (seen live too: `/compact`). Typed names now count only
  when the engine's `init` lists them as a real skill; nothing typed counts before `init`.
- A damaged salt file gave a new salt every run (one chat counted twice). It is now replaced atomically.
- `tdsapp-usage.cjs` read stdin without a limit. Capped at 64 KB (exit 2).
- Checked and clean: the seal matches the brain tracker byte for byte; sealed writes impossible while
  `SYNC_APP_EVENTS` is false; whitelist and caps; no shell in the spawn; route through `checkRequest`.

**UI, accessibility and copy (Sonnet): 4 confirmed, all fixed.** The review's "Compactions" line now
names tokens saved by summaries and says the cache figure isn't a saving; "never used" lists now say
"may not be connected/installed"; the loading line says what is loading and is announced; one
sentence explains tokens. The browser check added: spacing between the three sub-blocks.

**Rule change by the lead:** `rulePick` returns null for a non-plugin skill (it fits every kit), so the
picker decides instead of sending every typed brain skill to `full`.

**Gates:** tsc clean; lint 0 errors (15 warnings, none new in owned files); 3,066 tests pass; build
works; no file loses more than 40 lines against the merge base.

**Browser (preview on 3878, own data folder, real brain):** the Tokens saved panel in its empty and
filled states; `/compact` counted 55.6k once; reopening the chat added nothing; the shadow record
held kit `core` (auto), start-up 76k, would-save 4.0k–12.4k; closing with the skill not yet copied
kept the record waiting (logged once) and the next app start kept it waiting; a later chat starting
`/not-a-real-skill.pdf` recorded no skill; cache reuse counted 16.7k. Start-ups measured 76k and
44.9k in two real chats: the connector timing the spike found.

**App to brain:** the app's hand-off ran the real script in a throwaway brain: one plain line in
`z-logs/app-usage/`, salted chat hash, no raw id; `review` read it back.
