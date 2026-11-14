# Model and effort in Settings

Date: 2026-11-14 · Size: L · Branch: `model-effort-settings` · Explainer: none

## Objective

Let each person choose the model and effort their chats use, in Settings, without editing Claude
Code's settings files. The chat stays clean: the existing quiet line under the message box
("Opus 5.5 · High effort", added in v0.18.0) gets a small **Change** button that opens Settings.

## User decisions (fixed)

- The controls live in Settings, not in the chat.
- A small "Change" button sits next to the model and effort line under the message box and takes
  the person to Settings.
- No visual explainer.
- Base: `origin/main` (v0.18.0).

## Facts checked

- Chats start in `startEngine` (`server/engine/session-manager.ts` ~891) with no `model`/`effort`;
  they inherit Claude Code settings through `settingSources: ['user','project','local']`.
- `readSettings` (~798) reads `q.getSettings().applied.{model,effort}` and emits `engine-settings`;
  the client reducer stores `chat.model`/`chat.effort`; `Chat.tsx` ~213 renders `.engine-line`
  using `engineLine()` from `client/src/format.ts`.
- Agent SDK 0.3.322: `Options.model`, `Options.effort`, `Options.settings` (flag layer, accepts
  `effortLevel` incl. `'max'`), and on a live Query `setModel(model?)`,
  `applyFlagSettings({...})`, `supportedModels(): ModelInfo[]` (`value`, `displayName`,
  `supportedEffortLevels`). Clearing `model`/`effortLevel` via these goes to Claude Code's
  *built-in* default, not to `settings.json`'s value.
- Prefs live in the app's data folder (`server/store/app-store.ts`, `prefs.json`), validated by
  `validatePrefsPatch` (`server/http/routes.ts` ~241). Never a brain file.
- `resolvePermissionMode` (`server/engine/permission-mode.ts`) already reads the three settings
  files in order; the same pattern fits reading `model`/`effortLevel`.

## Decisions

1. **Two new prefs, `model: string | null` and `effort: EffortLevel | null`, default null.**
   null = "Same as Claude Code": the app passes nothing, exactly today's behaviour. Older
   `prefs.json` files without the keys read as null.
   Plain: nothing changes for anyone until they pick something in Settings.
2. **New chats use the choice.** In `startEngine`, a set `model` goes in `options.model` and a set
   `effort` in `options.effort` (which takes `'max'`). `options.settings` is left exactly as it is:
   it carries the app's read-deny rules, and `Settings.effortLevel` doesn't accept `'max'`
   (overseer, blocking 1). Resumed chats get the same.
   Plain: every chat you start after choosing uses your choice.
3. **Open chats switch too, from their next reply.** `SessionManager.setEngineChoice(choice)` stores
   the choice and, for every live session with a running engine, compares it with that session's
   own `s.appliedChoice` (what it started with or was last given) and calls `setModel` /
   `applyFlagSettings({ effortLevel })` only for the part that differs. Calls per session are
   queued (one after another) so two quick changes land in order. Then it re-runs `readSettings`
   so the line under the message box updates at once. Sent immediately, even mid-turn.
   Reverting to null:
   - Model: the settings-file `model` (decision 5), else `setModel(undefined)`.
   - Effort: re-apply the effort this engine reported (in `readSettings`) while the app's effort
     was unset, if that was reported for the model now in use; else `effortLevel: null`.
   Failures are logged as a short line (no model text) and never break the chat; the line keeps
   showing what Claude Code reports. The new `EngineQuery` methods are optional and guarded, like
   `getSettings?`.
   Plain: if you press Change in a chat and pick Sonnet, that chat's next reply uses Sonnet.
4. **The server keeps the current choice in memory.** `server/index.ts` reads prefs at start and
   calls `sessions.setEngineChoice`; `PUT /api/prefs` calls it again after saving when the patch has
   `model` or `effort`, without awaiting it (Settings never waits on an engine; errors are caught).
   `startEngine` reads the stored choice (sync).
5. **`GET /api/engine/choices` → `EngineChoices`.** `models` comes from `supportedModels()` on the
   most recent engine (cached in memory, refreshed when an engine starts; the `'default'` row is
   dropped because "Same as Claude Code" covers it). Before any engine has run: fallback
   `opus` / `sonnet` / `haiku` with labels Opus / Sonnet / Haiku and `efforts: null`. The saved
   pref is always in the list (labelled with the same id-to-name rule as `modelName()`).
   `claudeCode.model` is read by a new `resolveEngineDefaults(brainPath, homeDir)` in
   `server/engine/engine-defaults.ts` (same file order as approvals; reads only top-level `model`;
   never logs contents). No effort is read: Claude Code keeps effort per model under
   `modelSettings`, so a top-level `effortLevel` can be stale (overseer, blocking 2).
   Plain: Settings lists the models your account can use, and says what "Same as Claude Code" is.
6. **Validation.** `model`: null or a string ≤ `MODEL_PREF_MAX` matching `MODEL_PREF_PATTERN`;
   `effort`: null or one of `EFFORT_LEVELS`. Anything else → 400 with a plain message. The model is
   never put in a shell command; it only goes to the SDK.
   Plain: a broken or odd value can't be saved.
7. **Settings UI.** A new section "Claude in chats" (after Preferences) with two labelled `<select>`s:
   **Model** (`id="set-model"`) and **Effort** (`id="set-effort"`). First option for Model: "Same
   as Claude Code (Opus 5.5)", or "Same as Claude Code" when unknown. First option for Effort:
   always plain "Same as Claude Code". Effort options: when the picked model's `efforts` is known,
   list those, plus the saved effort if it isn't among them; otherwise all five. Help text: "Used by
   new chats, and by open chats from their next reply." Saved on change through `updatePrefs`.
   Selects use the `.field` styling (`docs/design-system.md` ~65) inside `.setting` rows.
8. **Change button.** Next to the `.engine-line` text: a quiet small button (`btn`,
   `data-variant="quiet"`, `data-size="small"`), text "Change", `aria-label="Change model and
   effort"`. It calls `openView('settings')` and moves focus to `#set-model` once Settings has
   rendered (scrolling it into view). Shown only when the line is shown.
   Plain: one click from the chat to the two settings, and the cursor lands on Model.

## Contract

`shared/contract.ts`: `AppPrefs.model`, `AppPrefs.effort`, `DEFAULT_PREFS`, `MODEL_PREF_MAX`,
`MODEL_PREF_PATTERN`, `ModelChoice`, `EngineChoices`, `EngineChoice`, `ROUTES.engineChoices`.
Builders don't edit it; ask the lead.

`SessionManager` gains (Builder A defines, Builder B doesn't call it):

```ts
setEngineChoice(choice: EngineChoice): Promise<void>;
engineChoices(): Promise<EngineChoices>;
```

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable | (read-only) |
| Builder A (server) | `builder`, sonnet | `server/engine/session-manager.ts`, `server/engine/session-manager.test.ts`, `server/engine/engine-defaults.ts` (+ `.test.ts`), `server/store/app-store.ts` (+ test), `server/http/routes.ts` (+ route tests), `server/index.ts` |
| Builder B (client) | `builder`, sonnet | `client/src/components/SettingsView.tsx` (+ test), `client/src/components/Chat.tsx` (+ test), `client/src/format.ts` (+ test), `client/src/api.ts` (+ test), `client/src/store.tsx`, `client/src/styles/*.css` |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/store/app-store.test.ts` | old prefs file → model/effort null; bad stored values fall back | A |
| route tests for `PUT /api/prefs` | valid model/effort saved; bad pattern, too long, unknown effort → 400; triggers `setEngineChoice` | A |
| `server/engine/engine-defaults.test.ts` | file order, last wins, junk ignored, missing files → nulls | A |
| `server/engine/session-manager.test.ts` | new engine gets `options.model` and `options.effort` only when set, `options.settings` untouched; null passes nothing; `setEngineChoice` calls `setModel`/`applyFlagSettings` on live engines only for changed parts, falls back to settings-file values on null, survives a rejecting engine; `engineChoices` fallback list, cached list, saved pref kept, `'default'` dropped | A |
| `client/src/components/SettingsView.test.tsx` | both selects render with "Same as Claude Code (…)"; change saves `{model}`/`{effort}`; effort list follows model | B |
| `client/src/components/Chat.test.tsx` | Change button shows with the line, opens Settings | B |

## Gates

- [x] Type-check · [x] Tests · [x] Lint (warnings only, same 7 as main) · [x] Build (to `/tmp/tba-preview`)
- [x] Domain gates: UX/UI expert; security light folded into the correctness reviewer
- [x] Browser check (preview on 3878): Change from a live chat mid-reply opens Settings with focus on
  Model; picking Sonnet switched the open chat's line to "Sonnet 5.5 · Medium effort" at once; back
  to "Same as Claude Code" → "Opus 5.5 · High effort"; effort Max → "Max effort" and back; a bad
  model name → 400 "That model name was not understood."

## Review outcomes

- **Overseer pre-review (2 blocking, applied):** effort at start goes in `options.effort`, never the
  `options.settings` overlay (it carries the read-deny rules, and its `effortLevel` type has no
  `'max'`); no effort is read from settings files, because Claude Code keeps effort per model under
  `modelSettings`. SHOULD items applied: per-session `appliedChoice` and queue, PUT doesn't await
  engines, saved effort kept in the list.
- **Correctness and security (1 confirmed, fixed):** the effort revert compared "model unchanged in
  this save" instead of "same model as when reported", and a restarted engine kept the old
  remembered effort. Fixed with `s.reportedModel`, reset in `startEngine`, 3 tests.
- **Requirement drift and copy:** no findings (one stale plan line corrected).
- **UX/UI gate (3 confirmed, fixed):** help text linked with `aria-describedby` plus a labelled
  group; client fallback model list while loading or on failure; fixed 220px select width.
- **Overseer sign-off:** signed off. Follow-ups fixed before merge: "(opus)" alias in the first
  Model option now shows the row label; empty list (setup mode) uses the fallback; a re-applied
  effort is unpinned when the model changes. Left for later: `modelLabel` (server) duplicates
  `modelName` (client); move to `shared/`.
- **Process note:** the server builder's edit to `server/setup-mode.ts` (two no-op stubs) was
  blocked by the auto-mode check because it was outside its files; the user approved the lead
  making it.
