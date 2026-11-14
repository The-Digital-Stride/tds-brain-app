# Chats: delete an earlier chat (to the Bin)

Date: 2026-11-14 · Size: L · Branch: `delete-earlier-chats` · Explainer: none (declined)

## Objective

Let the person delete chats they no longer want from the Chats drawer's Earlier list. A delete moves
the chat's history to the macOS Bin, so it can be put back from Finder.

## User decisions (fixed)

- Delete for real, by moving files to the Bin rather than erasing them. Not an app-only "hide".
- No visual explainer.

## Facts (from the code, 2026-11-14)

- Earlier chats are Claude Code's own history, read with the Agent SDK's `listSessions({ dir: brainRoot })`
  (`listPast()` in `server/engine/session-manager.ts`). Each chat is `<projects>/<project>/<id>.jsonl`, plus an
  optional `<id>/` folder of helper-agent transcripts. `<projects>` is `$CLAUDE_CONFIG_DIR/projects`, else
  `~/.claude/projects`. `<project>` is the brain's real path with every character other than `[A-Za-z0-9]`
  replaced by `-` (for example `/Users/ianhancock/agencybrain` → `-Users-ianhancock-agencybrain`).
  These files are outside the brain folder.
- The SDK's `deleteSession` erases those same files, but there's no "to the Bin" option, so we don't use it.
- macOS has `/usr/bin/trash` (checked on this Mac, macOS 27). `trash <paths…>` moves files to the Bin with no
  prompt, and exits non-zero on failure.
- Personal marks live in `chat-kinds.json` (`server/store/chat-kinds.ts`). `set(id, 'tds')` removes one.
- The To-dos drawer deletes with a held change and Undo (`TODO_UNDO_MS`, `TodosDrawer.tsx` ~line 570). Open chat
  rows have a trailing `icon-btn` (Close). `Icon.tsx` has no bin icon yet.

## Decisions

1. **Route.** `DELETE /api/sessions/past/:id` (`ROUTES.pastSession`, see the contract comment for replies).
   Only earlier chats can be deleted: an open one has to be closed first.
   Plain: you delete a chat from the Earlier list, and an open chat must be closed first.
2. **Which files.** `SessionManager.deletePast(id)` checks the id strictly (a UUID only, so a crafted id can
   never point outside the history folder) and that it's in `listPast()`. It refuses if the chat is live. It
   then hands the id to an injected `trashSession(id, { dir })` in `EngineFns`. The real version
   (`server/engine/trash-session.ts`) works out the `.jsonl` path as described in Facts, checks the file
   exists (else `not-found`), and runs `/usr/bin/trash` via `execFile` (no shell) on the `.jsonl` and, if
   present, the `<id>/` folder. If `trash` is missing or fails, it throws, and the error is a plain message.
   Nothing is ever erased.
   Plain: the chat's history goes to the Bin, and nothing else on the Mac can be touched.
3. **Tidy-up.** After a successful move, the chat's Personal mark is cleared (`chatKinds.set(id, 'tds')`) and
   `notifyChanged()` runs, so every tab's list updates.
   Plain: a deleted chat leaves nothing behind in the app.
4. **UI.** Each Earlier row gets a trailing `icon-btn` with a new `bin` icon, labelled "Delete chat: <title>",
   the same place and size as the Close button on Open rows. *Overseer to decide how to confirm:*
   (a) the To-dos pattern: the row goes at once, with a notice "Chat moved to the Bin." and Undo for
   `TODO_UNDO_MS` before it's sent; or (b) an inline "Delete? / Keep" in the row.
   Plain: a bin button on each earlier chat, with a safety step before anything goes.
5. **Copy (UK English).** The notice and the confirm say the chat also leaves the terminal's
   `claude --resume` list and can be put back from the Bin. Overseer/UX settle the exact words.
6. **Backward compatibility.** This is a new route and a new optional engine function: test fakes without
   `trashSession` make `deletePast` throw `internal` ("Deleting chats isn't available here."). Nothing
   existing changes.

## Contract

`shared/contract.ts`: `ROUTES.pastSession`. Server-side (built by Builder A):

```ts
// server/engine/session-manager.ts
export interface EngineFns { …; trashSession?(sessionId: string, opts: { dir: string }): Promise<void>; }
export interface SessionManager { …; /** Throws SessionError: bad-request | not-found | already-open | internal. */ deletePast(sdkSessionId: string): Promise<void>; }
// server/engine/trash-session.ts
export function createTrashSession(deps?: { run?: (file: string, args: string[]) => Promise<void>; configDir?: string; exists?: (p: string) => Promise<boolean> }): (id: string, opts: { dir: string }) => Promise<void>;
export function projectDirName(realBrainPath: string): string;
```

Client (built by Builder B): `api.deletePastChat(id)`, and a store action `deletePastChat(id)` with the
confirm/undo behaviour the overseer picks.

## Team and file ownership

| Role | Agent and model | Why | Owns |
|---|---|---|---|
| Lead | main session | contract, plan | `shared/contract.ts`, this plan |
| Overseer | `overseer`, fable | plan critique, sign-off | read-only |
| Builder A (server) | `builder`, sonnet | default | `server/engine/trash-session.ts` (+test), `server/engine/session-manager.ts` (+test), `server/http/routes.ts` (+test), `server/index.ts`, `server/setup-mode.ts` |
| Builder B (client) | `builder`, sonnet | default | `client/src/shell/ChatsDrawer.tsx`, `client/src/shell/Icon.tsx`, `client/src/store.tsx`, `client/src/api.ts`, `client/src/shell/drawers.test.tsx`, a new `client/src/store.deletePast.test.tsx`, CSS only if needed |
| Reviewers | `reviewer`: correctness opus, security opus | | read-only |
| Gate: UX | `expert`, opus | | read-only |

## Tests

| Test | Proves | Owner |
|---|---|---|
| `trash-session.test.ts` | the folder name rule; runs `trash` with exactly the `.jsonl` (and the folder when present); missing file → not-found; `trash` failure → throws; never erases | A |
| `session-manager.test.ts` | non-UUID → bad-request; not in past → not-found; live → already-open; success clears the Personal mark and notifies; no `trashSession` → internal | A |
| `routes.test.ts` | DELETE maps codes; other methods refused | A |
| drawer/store tests | bin button per Earlier row; the confirm or undo flow; failure shows the error and the row comes back | B |

## Gates

- [ ] `pnpm check` · [ ] numstat deletion scan
- [ ] Security review (file deletion from a request), UX gate
- [ ] Browser check on a private preview with a **copy** of the history folder (`CLAUDE_CONFIG_DIR` pointed at a
      scratch copy), so no real chat is deleted while testing

## Review outcomes

- **Overseer pre-review.** One blocking item: the race with a reopen or a still-closing chat. It's built with `deleting` and `closingSessions` sets, with tests. All "should" items were built. Put Back was confirmed by the user in Finder for a file moved by `/usr/bin/trash`.
- **Security review (Opus).** One blocking item, confirmed in code and in the browser. The client sent DELETE without `Content-Type: application/json`, so the server's request check refused every delete with 415 "wrong format". Fixed: every non-GET request is JSON with a `{}` body. `api.test.ts` runs the real `checkRequest` on what `request()` builds, and fails without the fix. Ids, symlinks, the env-driven paths, argument injection, leaks and erasing were all checked and clean.
- **Correctness review (Opus).**
  - It found the same 415 independently.
  - Confirmed: focus after a delete used the row's index within its group against every bin button in the drawer, so it could land on the wrong row or a hidden one. Now it uses the next row's id in the list as shown, skipping folded rows.
  - Confirmed: other bins worked during a delete, and Esc reached the shell while busy. Bins are now disabled while busy, and Esc always stays in the question.
  - Tests were added for both.
- **UX gate (Opus).**
  - The same focus bug and the same Esc issue.
  - Added `aria-describedby` so the question is read out.
  - The confirm wrapper is now a `div`, not a `span`.
  - The copy is now "It also leaves Claude Code in the terminal."
  - Not done (pre-existing, nice to have): the `role="status"` notice in `SheetNotices.tsx` mounts together with its text, so screen readers may not announce it. The same was already true of the close notice.
- **Gates.** `pnpm check` is green apart from the known flaky `Shell.test.tsx`, which passes on its own. No large deletions.
- **Browser check.** The preview used `CLAUDE_CONFIG_DIR` pointed at a scratch copy of three chats. The question shows with the title kept, a real delete moved the scratch `.jsonl` to the Bin, the notice showed, and the list updated. The real history was untouched.

## Overseer pre-review (2026-11-14): amendments that override the decisions above

- **Blocking, race.** `deletePast` re-checks `live` synchronously after its last await, then claims the id in a
  `deleting` set until the move ends (released in `finally`). `start`'s synchronous re-check refuses an id in
  `deleting` (`already-open`-style refusal: "That chat is being deleted."). A chat that is still closing (engine
  still writing within `closeTimeoutMs`) counts as open (409). This changes `start`: decision 6's "nothing
  existing changes" no longer holds. Tests for both cases.
- **Old macOS.** `/usr/bin/trash` appeared in macOS 15. A missing binary has its own message. Never fall back to erasing.
- **One path at a time.** Run `trash` once per path, `.jsonl` first. Confirm the `.jsonl` has gone before clearing the
  Personal mark and reporting success. If only the `<id>/` folder fails, log it and still succeed. Never send
  `trash` stderr to the client (it holds full paths).
- **Folder rule.** realpath → NFC normalise → replace `[^a-zA-Z0-9]` with `-`. A name over 200 characters → refuse
  (404). When `CLAUDE_CONFIG_DIR` is set, honour `CLAUDE_CODE_PROJECT_DIR_NAME` if it matches `[A-Za-z0-9_-]{1,64}`,
  else refuse. `lstat` both paths: the `.jsonl` must be a regular file and the folder a real directory, never a
  symlink. Match the new route before the generic `/api/sessions/:id/…` routes.
- **Confirm pattern: inline (b).** Modelled on `fieldset.close-confirm` in `client/src/components/Chat.tsx`: small
  danger button, the safe button focused, Esc keeps. The title stays visible. The Bin is the undo.
- **Copy.**
  - Bin button: `aria-label` "Delete chat: {title}"
  - Question: "Move this chat to the Bin? It also leaves Claude Code in the terminal." (wording from the UX gate)
  - Buttons: "Delete chat" (danger) and "Keep chat" (focused)
  - Success (the existing 6-second notice): "Chat moved to the Bin. You can put it back from there."
  - 409: "That chat is open. Close it first, then delete it."
  - 404: "That chat's files couldn't be found, so nothing was deleted."
  - 500: "That chat couldn't be moved to the Bin, so it hasn't been deleted. Try again."
  - No `trash`: "Deleting chats needs macOS 15 or later. Nothing was deleted."
- **Browser gate.** Check that Finder offers Put Back for a file moved by `/usr/bin/trash`. If it doesn't, change the copy.
