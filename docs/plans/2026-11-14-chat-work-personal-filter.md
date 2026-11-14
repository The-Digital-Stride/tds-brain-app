# Chats: TDS / Personal filter

Date: 2026-11-14 · Size: L · Branch: `chat-work-personal-filter` · Explainer: none (declined)

## Objective

Give the Chats drawer the same "which kind" filter the To-dos drawer has (All / TDS / Personal), so
personal chats can be kept apart from work ones. Chats don't know their kind today, so each chat gets one.

## User decisions (fixed)

- A chat's kind is **worked out by the app and can be changed** by the person. The app saves it in its
  own data folder so Earlier chats keep it.
- No visual explainer.

## Facts (from the code, 2026-11-14)

- To-dos know their kind from where they live (`TodoItem.scope`: `'tds' | 'personal'`). The drawer's filter is
  `client/src/state/todo-filter.ts` plus a `Seg` labelled "Which kind of to-do" (All / TDS / Personal) in
  `client/src/shell/TodosDrawer.tsx`. It shows only on Mine, and only when `todos.canUsePersonal` or a personal
  to-do exists. With the filter on All, a personal row shows "Personal" with the `lock` icon.
- Chats: `LiveSession` has `client` and `todoId` (a personal to-do's key is `personal/<id>`). `PastSession` is
  read from Claude Code's own history and has only id, title and date. The app keeps nothing per chat.
- `sdkSessionId` is null for a new chat until the engine's `system/init` message (`handleMessage` in
  `server/engine/session-manager.ts`). A reopened chat has it from the start.
- The app's own small stores live in `server/store/` (`app-store.ts`, `client-pick-tally.ts`): JSON in the data
  folder, written to a temp file and then renamed into place, one write at a time.

## Decisions

1. **Kind values reuse the to-do scope.** `ChatKind = TodoScope` (`'tds' | 'personal'`). Labels match the
   To-dos drawer exactly: All / TDS / Personal. (The user's message said "Work / Personal". The To-dos drawer
   says TDS, so we say TDS too, so the two read the same.)
   Plain: the Chats filter uses the same three words as the To-dos filter.
2. **How the kind is worked out.** A new chat started on a personal to-do (the listed to-do's `scope` is `'personal'`, read where
   `start()` already finds it) is `'personal'`. A reopened chat takes what the store saved for its `sdkSessionId`. Everything else is `'tds'`.
   There's no guessing from the message text.
   Plain: chats are TDS unless they came from a personal to-do or you marked them Personal.
3. **Changing it.** `POST /api/sessions/:id/kind` `{ kind }` (`ROUTES.sessionKind`), for live chats only. It
   updates the chat, saves it if `sdkSessionId` is known, and calls `notifyChanged()` so every tab's list
   updates. If the id isn't known yet, the kind is saved the moment `system/init` brings it.
   Plain: you can switch a chat between TDS and Personal while it's open, and the change sticks.
4. **The store.** New `server/store/chat-kinds.ts`, file `chat-kinds.json` in the data folder:
   `{ version: 1, personal: { [sdkSessionId]: savedAtIso } }`. Only personal chats are listed, because TDS is
   the default. Setting `'tds'` removes the entry. It keeps at most 2,000 entries and drops the oldest
   `savedAt` first. Only a *missing* file reads as empty. Any other read error isn't cached and skips the write (one log line), so a
   bad read never wipes the saved marks. Unparseable JSON is copied to `chat-kinds.json.broken` first, and bad
   entries are dropped one by one. `personal()` waits for queued writes. Writes are queued, and a failed write is logged
   as one short line and never stops the chat (the live chat still holds its kind in memory). Data folder
   null (tests): memory only.
   Plain: a tiny file in the app's own folder remembers which chats are personal. Nothing is written in the
   brain.
5. **Session manager.** `SessionManagerOptions.chatKinds?: ChatKindStore` (optional, so existing tests and
   callers still work, falling back to memory only). `Session.kind`, `snapshot()` adds `kind`, and `list()`
   sets `PastSession.kind` from the store. New method `setKind(id, kind): Promise<LiveSession>`, with the
   same `not-found` / `session-closed` refusals as the other per-chat calls. `setKind` sets memory synchronously.
   The saved kind for a reopened chat is read in the awaited part of `start()` (beside `listPast()`), never
   between the synchronous re-check and `live.set`. In `handleMessage`, whenever `sid !== s.sdkSessionId`, a
   personal chat is saved under the new id (the old entry is left).
   Plain: the server tells the page each chat's kind, open or earlier.
6. **Chats drawer filter.** Under the Open / Earlier switch, a `Seg` labelled "Which kind of chat" with
   All / TDS / Personal, the same component and layout as the to-dos (`drawer-tools`). It shows when any
   chat (open or earlier) is personal, or the filter isn't on All (overseer: `canUsePersonal` is a to-do matter).
   When hidden, the filter counts as All. It filters both tabs, and the state is held
   in the drawer (`useState`, the same as the to-dos). Counts on Open / Earlier stay unfiltered, the same as
   "Mine, N". With All on, a personal row's meta line ends ", personal" (no lock: see Review outcomes). Pure filter:
   `client/src/state/chat-filter.ts`. Empty results say so: "No personal chats open." /
   "No earlier personal chats." (and "TDS" the same way).
   Plain: the Chats drawer gets the same All / TDS / Personal switch, and personal chats are marked.
7. **Switching a chat's kind.** In the This chat panel's Details (`Inspector.tsx`), a "Kind" row with a
   `Seg` TDS / Personal, after Client. It calls a new store action `setChatKind(sessionId, kind)` →
   `api.setChatKind`. It patches `sessions.live` from the reply at once (the updater pattern near
   `client/src/store.tsx:441`) and reloads sessions on failure, with the app's usual error notice. Overseer
   decided: the row label is "Kind" and the Seg's accessible label is "Kind of chat". A chat with a client may be
   Personal, because kind is the person's own filing label. Also fixes `Inspector.tsx:31`, which matches `t.id`
   where chats store the to-do's `key`, so personal to-dos never showed.
   Plain: open a chat's details to mark it Personal or TDS.
8. **Backward compatibility.** New fields only. Old `prefs.json` is untouched and `chat-kinds.json` is new.
   An old page ignores `kind`. The new page treats a missing `kind` as `'tds'` (in case the server is older
   during an update).
   Plain: nothing existing breaks, and earlier chats all start as TDS.

## Contract

`shared/contract.ts`: `ChatKind`, `LiveSession.kind`, `PastSession.kind`, `SetChatKindRequest`,
`ROUTES.sessionKind`. Server-side store interface, defined in `server/store/chat-kinds.ts`:

```ts
export const CHAT_KINDS_FILE = 'chat-kinds.json';
export interface ChatKindStore {
  /** The sdkSessionIds of every saved personal chat (a fresh copy). */
  personal(): Promise<Set<string>>;
  kindOf(sdkSessionId: string): Promise<ChatKind>;
  /** Queued; never rejects (a failed write is logged). */
  set(sdkSessionId: string, kind: ChatKind): Promise<void>;
}
export function createChatKindStore(dataDir: string | null, log?: (line: string) => void, now?: () => Date): ChatKindStore;
```

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Lead | main session | contract, plan, wiring check | `shared/contract.ts`, this plan |
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (server) | `builder`, sonnet | default | `server/store/chat-kinds.ts`, `server/store/chat-kinds.test.ts`, `server/engine/session-manager.ts`, `server/engine/session-manager.test.ts`, `server/http/routes.ts`, `server/http/routes.test.ts`, `server/index.ts` |
| Builder B (client) | `builder`, sonnet | default | `client/src/state/chat-filter.ts`, `client/src/state/chat-filter.test.ts`, `client/src/shell/ChatsDrawer.tsx`, `client/src/shell/Inspector.tsx`, `client/src/shell/Inspector.test.tsx`, `client/src/shell/drawers.test.tsx`, `client/src/store.tsx`, `client/src/api.ts`, `client/src/shell/contract.ts`, CSS only if needed, test fixtures that build `LiveSession` / `PastSession` on the client |
| Gate: UX | `expert`, opus | domain gate | (read-only) |
| Reviewers | `reviewer`: correctness opus; UI sonnet | | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/store/chat-kinds.test.ts` | saves and reads personal; `'tds'` removes; broken file reads empty; cap drops oldest; memory-only with null dir | A |
| `server/engine/session-manager.test.ts` | a chat on a personal to-do is personal; it's saved when `system/init` brings the id; a reopened chat keeps its saved kind; `setKind` updates, saves and notifies; `list()` past kinds; unknown id `not-found` | A |
| `server/http/routes.test.ts` | `POST /kind` accepts tds/personal, refuses anything else with `bad-request` | A |
| `client/src/state/chat-filter.test.ts` | All returns the list itself; TDS/Personal filter; a missing kind counts as TDS | B |
| `client/src/shell/drawers.test.tsx` / `Inspector.test.tsx` | switch shows only when it should; filters both tabs; Personal marker; Kind switch calls the action | B |

## Gates

- [ ] `pnpm check` (type-check, tests, lint) · [ ] build
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX (security: no new input reaches the brain or the file system beyond a fixed file name; folded into the correctness review)
- [ ] Browser check: Chats drawer (both tabs, the filter), This chat → Details → Kind, on the preview port 3878 with its own data folder

## Review outcomes

- **Overseer pre-review.** One blocking item: a failed read must never wipe the saved marks. Built as only-ENOENT-is-empty, with a `.broken` copy. Four "should" items, all built: the kind is read in the awaited part of `start()`; it comes from the to-do's `scope`; a new id is handled on `system/init`; the list is patched from the reply. The "nice" fix to the Inspector to-do lookup (`t.key`) is done.
- **Correctness review (Opus).** Confirmed: overlapping first reads in `chat-kinds.ts` could replace a just-changed copy and lose a Personal mark. Reproduced 80 in 300. Fixed with one shared in-flight read, plus a test that fails without it. Confirmed: `setChatKind` had no store test, so `store.chatKind.test.tsx` was added. The re-review is clean.
- **UI review (Sonnet).** Confirmed: the kind Seg sat in `drawer-tools` inside the padded drawer body, so it was 20px narrower than the tabs. The wrapper was dropped.
- **UX gate (Opus).** Three changes from this review:
  - Chats show ", personal" with no lock. A personal chat isn't private, but the lock suggested it was. To-dos keep their lock.
  - A note under the Kind switch: "Only sorts your Chats list. The chat still uses the shared brain."
  - The switch moves at once and reloads on failure.
- **Gates.** `pnpm check` is green. No large deletions. The browser check on a private preview passed.
- **Not done (later).** Marking an earlier chat without reopening it.
