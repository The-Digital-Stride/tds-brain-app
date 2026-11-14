# Helpers in the Chats drawer

Date: 2026-11-14 · Size: L · Branch: `helpers-in-chats-drawer` · Explainer: https://claude.ai/artifact/6UfdzSPomwdTm7rUaggDds

## Objective

When a chat hands parts of a job to helpers, the Chats drawer shows, under each open chat, which helpers
are working, what each was asked to do, which level and model it runs on, how long it has been going and
what it is doing now. Today you can only see helpers as steps nested inside one chat's transcript, with no
model for most of them and nothing across chats.

## User decisions (fixed)

- The detail lives in the **Chats drawer** (Open tab), under each open chat's row.
- Helpers stay in the foreground (no background helpers). Closing a chat still stops its helpers.
- Closing a chat whose helpers are working says so in the existing "Close anyway?" question.
- Base branch `main`. Local merge with `wt-finish` once Ian approves.

## Decisions

1. **The data rides on `LiveSession` as an optional `helpers` list.** `LiveSession.helpers?: LiveHelper[]`
   (`shared/contract.ts`), in start order (oldest first). Absent from older servers and empty when there
   are none, so an older page or server keeps working. No new route and no new stream event: the page
   already reloads the chat list on `sessions-changed`.
   Plain: the drawer gets the helper details the same way it already gets each chat's state.

2. **A pure tracker builds the list from what Claude Code already sends.** New
   `server/engine/helper-tracker.ts` (`createHelperTracker()`). All inputs are keyed by the Agent/Task
   step's tool use id, merge in either order (a hook call and a stream message for the same id make one
   row), and status only moves forward (`working` → `done` | `failed` | `stopped`; never back).
   - **Start, hook:** `agentHook` (PreToolUse), only on its allow path and only when the id came from
     `toolUseID` or `input.tool_use_id` (never the `randomUUID()` fallback), calls
     `tracker.started(id, d.input)` with the call as it will run (after `rewriteAgentInput`): this gives
     `subagent_type`, `description` and the model the app set.
   - **Start, stream fallback:** `system/task_started` adds or fills a row only when `task_type ===
     'local_agent'`, `spawn_depth` is absent or ≤ 1, `parent_task_id` is absent, and it is not `ambient` /
     `skip_transcript`. Every other task kind (shell commands, monitors, MCP tasks) is ignored.
   - **Progress:** an `assistant` message whose `parent_tool_use_id` is a known helper id gives the real
     model (`message.model`, which replaces an alias), and each new `tool_use` block in it counts one step
     (unique ids) and sets `lastStep` from `toolLabel(name, input)` (`server/engine/event-map.ts`).
     `system/task_progress` for a known id raises `steps` to `usage.tool_uses` if higher and, when
     `last_tool_name` is given and no label is set, uses `toolLabel(last_tool_name, {})`. Progress for
     unknown ids is ignored.
   - **End:** `agentEndHook` calls `tracker.ended(id, 'done')` on PostToolUse and `'failed'` on
     PostToolUseFailure, or `'stopped'` when the failure input has `is_interrupt: true`. A top-level user
     `tool_result` for a known id ends it too (`is_error` → failed, else done). `task_notification` for a
     known id with a failed / stopped status is a fallback.
   - **Never started:** `tracker.dropped(id)` removes a row wherever `helpersRunning.delete` runs outside
     the end hook: the card-denied path (`session-manager.ts` ~974) and `permission_denied` (~1064).
   - **Reply ends / engine dies / chat closes:** `tracker.stopAll()` on `result`, in `pump`'s `finally`,
     and in `closeEngine`.
   Plain: no guessing; every detail comes from Claude Code's own messages or the app's own helper rules,
   and a helper that was never allowed to start is never listed.

3. **Only the main chat's helpers are listed.** A helper started by another helper (nested) is left out.
   Plain: the drawer lists the helpers your chat asked for, not helpers' helpers.

4. **Finished helpers stay listed until the next message is sent.** `tracker.clear()` runs beside the
   `helpersStarted = 0` reset in the turn start (~1273).
   Plain: after a reply you can still see which helpers did the work.

5. **Names, levels and models.** `name` is the app helper's label ("Scout", "Worker", "Expert") or, for any
   other type, "Helper" plus the type in brackets when there is one ("Helper (Explore)"). `tier` is the
   app's level for it when known (an app helper's own tier; a built-in helper given the other-helper tier
   by `rewriteAgentInput`), else null. `model` is the id from the helper's own assistant messages once
   seen, else the alias the call ran with, else null. The page shows "Quick · Haiku 5.5" (tier label, then
   `modelName` for an id or `aliasName` for an alias), just the model with no tier, or nothing.
   Plain: each helper row says how heavy a model it uses, in the same words as the level picker.

6. **The brief is short.** `brief` is the step's `description`, trimmed to one line and at most 120
   characters with an ellipsis. Never the full prompt.
   Plain: you see what the helper was asked in a few words; the full brief stays in the chat.

7. **Updates are rate-limited.** Start, end, drop and stop notify at once. Progress notifies at most once
   every 5 seconds per server (one shared timer, `unref`'d, cleared on `closeAll`), and only if some
   helper's `steps` or `lastStep` changed since the last notify. Each notify makes the page re-list chats.
   Plain: the drawer stays current without heavy disk work on every helper step.

8. **Drawer layout.** Under an open chat's `.line` row, when `helpers` is non-empty, its own `<li>` holds a
   `Fold` (title "Helpers", count = number listed) with compact, scoped styling. It is open while any
   helper is working and shut once all have ended (remount by key on that change). Each helper is a
   `.line` row:
   - title: name and brief, e.g. "Scout: find Acme's last three reports"
   - meta while working: last step, level, model, time, e.g. "Reading files · Quick · Haiku 5.5 · 1 min
     20 s"; when ended: "Done · Quick · Haiku 5.5 · 2 min 5 s" (or "Failed", "Stopped"). No step count.
   - the attention `dot` shows working while working and nothing when ended; failed uses the error look.
   Clicking a helper row opens its chat, like the chat row. The chat row's meta adds ", 2 helpers working"
   while any are. No `aria-live` on the ticking time.
   Plain: open the Chats drawer and see each chat's helpers, what they're on and which model.

9. **Live time without server traffic.** The page works out elapsed time from `startedAt` / `endedAt`,
   ticking once a second only while the drawer shows a working helper.
   Plain: the timer moves on its own; the server isn't asked every second.

10. **Close question names helpers.** `closeConfirmText(state, helpersWorking?)` with one or more working:
    "Claude and 2 helpers are still working. Closing stops them all. Close anyway?" (singular "1 helper");
    when waiting: "Claude is waiting for your answer and 2 helpers are still working. Closing stops them
    all. Close anyway?" Otherwise unchanged.
    Plain: you're told that closing will stop the helpers too, and the question comes last.

11. **No progress summaries.** `agentProgressSummaries` stays off: it makes extra model calls for text
    `toolLabel` already gives.
    Plain: no extra cost.

12. **History has none.** Reopened chats start with no helpers listed. Past chats never show helpers.

## Contract

- `shared/contract.ts`: `LiveHelper`, `LiveHelperStatus`, `LiveSession.helpers?`.
- `server/engine/helper-tracker.ts` (Builder A writes it to this shape):

```ts
export interface HelperTracker {
  /** Agent PreToolUse hook, allow path only, with the call as it will run. */
  started(toolUseId: string, input: Record<string, unknown>, now?: Date): void;
  /** Agent end hooks. Unknown ids are ignored; an ended helper never changes again. */
  ended(toolUseId: string, how: 'done' | 'failed' | 'stopped', now?: Date): void;
  /** The call was refused before it ran: remove its row. */
  dropped(toolUseId: string): void;
  /** Every raw engine message, in order. 'now': notify at once; 'soon': progress changed; null: nothing. */
  observe(raw: unknown, now?: Date): 'now' | 'soon' | null;
  /** The reply ended, the engine died or the chat closed: working ones become 'stopped'. True if any changed. */
  stopAll(now?: Date): boolean;
  /** A new message was sent: forget the last reply's helpers. */
  clear(): void;
  /** Start order, oldest first; fresh copies. */
  list(): LiveHelper[];
  workingCount(): number;
}
export function createHelperTracker(): HelperTracker;
```

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable, high | plan critique, design decisions, sign-off | (read-only) |
| Builder A | `builder`, sonnet, medium | default | `server/engine/helper-tracker.ts`, `server/engine/helper-tracker.test.ts`, `server/engine/session-manager.ts`, `server/engine/session-manager.test.ts` |
| Builder B | `builder`, sonnet, medium | default (UI) | `client/src/shell/ChatsDrawer.tsx`, `client/src/shell/HelperRows.tsx` (new), `client/src/shell/HelperRows.test.tsx` (new), `client/src/state/close.ts`, `client/src/state/close.test.ts`, `client/src/components/Chat.tsx`, `client/src/shell/words.ts`, `client/src/styles/drawers.css`, `client/src/format.ts`, `client/src/format.test.ts` |
| Lead | me | | `shared/contract.ts`, this plan, README, explainer |
| UX gate | `expert`, sonnet, medium | UI critique incl. consistency | (read-only) |
| Reviewers | `reviewer`: correctness opus high; UI sonnet medium | | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/helper-tracker.test.ts` | hook start carries model + tier; task_started (local_agent) alone adds a helper; task_started for other task types, nested, ambient ignored; hook + task_started for one id make one row in either order; helper assistant messages set model id, steps (unique) and lastStep; progress for unknown ids ignored; ended done/failed/stopped; status never moves back; dropped removes; stopAll; clear; brief trimmed; name rules | A (tests first) |
| `server/engine/session-manager.test.ts` | snapshot carries helpers during a reply; still listed after `result` and cleared on next send; card-denied helper not listed; interrupted reply leaves them `stopped`; progress notifies are coalesced | A (tests first) |
| `client/src/state/close.test.ts` | close text with 0, 1, 2 helpers working, working and waiting | B (tests first) |
| `client/src/format.test.ts` | elapsed-time words ("40 s", "1 min 20 s", "1 h 3 min") | B (tests first) |
| `client/src/shell/HelperRows.test.tsx` | renders name, brief, meta; uses `.fold` + `svg.icon` (no `<details>`); click opens the chat; nothing for empty / absent helpers | B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on port 3878, own data folder)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX (consistency with Fold, line rows, dot); security: none (no new input or route)
- [ ] Browser check: Chats drawer with a chat running two helpers; close question

## Review outcomes

- **Overseer pre-review:** two blocking items (refused calls leaving rows; `task_started` for non-agent
  tasks) and the should items were folded into decisions 2, 4, 7, 8, 10 and 11 before building.
- **Correctness reviewer (opus):** no blockers. Fixed: the waiting close question said "1 helper are"
  (now "is"); a built-in helper got an app level whenever its model alias matched one (now only when the
  app set its model: `started(…, appSetModel)`, with a session test).
- **UX reviewer (sonnet):** fixed: "Working" is said in words when there is no last step; the indent rule
  uses `--line-strong` like the app's other nested content; no one-off font size. `Fold` gained optional
  controlled `open` / `onToggle` so the helper list shuts itself without remounting (focus is kept; test).
  Kept by choice: a failed helper has the plain grey dot (chats with an error have no coloured dot either);
  "Failed" in the meta says it. Not done (nice): a lower heading level for the nested fold.
- **Drawer builder:** time is joined with non-breaking spaces so "1 min 29 s" never splits (seen in the
  browser).
- **Browser check (preview, port 3878):** rows, meta, ticking time, fold and the close question seen with
  example helpers injected into the page. A live run could not start helpers: Claude Code's auto-mode
  safety check refused both scout calls ("Classifier unavailable"), and no rows appeared for them, as
  intended. The refusal is outside this change (the hook's reply is untouched); to look into separately.
- **Gates:** typecheck, lint, build and 2,393 tests pass, except `Shell.test.tsx` "opening a left drawer
  does not collapse the rail", which fails only in the full run and passes alone (known flaky under load).
