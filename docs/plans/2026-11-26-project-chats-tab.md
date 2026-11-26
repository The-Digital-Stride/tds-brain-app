# A project's Chats tab

Date: 2026-11-26 · Size: L · Branch: `project-chats-tab` · Explainer: none (Ian: no)

Related plans: `docs/plans/2026-11-23-projects-r2-chat-project.md` (chats carry a project),
`docs/plans/2026-11-24-chat-summary-updates.md` (Save to project, "Chats not saved yet"),
`docs/plans/2026-11-26-project-chat-in-place.md` (a chat opens beside the project).

## Objective

A project page gets a fifth tab, **Chats**, that keeps every chat this person had for the project in one
place: open one beside the project to carry on, or save its summary to Updates. Today the only trace of a
project's chats on its page is the Overview's "Chats not saved yet" card (30 days, five at most), and a chat
hidden with Hide chat can only be found again in the Chats drawer among every other chat.

## User decisions (fixed)

- Ian (2026-11-26): the tab lists **my chats for this project on this Mac**. Nothing new is shared with the
  team; chats stay on the Mac as now. Sharing whole chats with the team is not part of this.
- No visual explainer.
- Merge and push once checks and reviews pass (only this chat's work).
- Standing rules: the app never writes brain files; backward compatible; UK English in the UI and "tasks" not
  "to-dos" in copy; reuse design-system components; a UX/UI expert signs off; help page, picture and What's new
  note in the same branch.

## Facts (from the code, 2026-11-26)

- Tabs: `ProjectTab = 'overview' | 'todos' | 'updates' | 'files'` (`client/src/apps/projects/ProjectPage.tsx:52`),
  drawn by `SheetTabs` at `:757`; the right end of the row holds the current tab's add button. Tab changes go
  through `chooseTab` (leave guard). `ProjectsSheet.tsx:19,46,126-128` holds the tab in its screen state.
- Every chat's project is kept per `sdkSessionId` in app data `chat-places.json` (`server/store/chat-places.ts`).
  `ChatSourcePort.placed()` (`server/engine/session-manager.ts:3706`) already answers every chat of this Mac that
  has a project, past and live, with title, last activity and `replying`.
- `ChatSummaryService.unsaved()` (`server/engine/chat-summary.ts:552`) is the Overview card's list: project keys
  (live + `movedFrom`), last 30 days, at most 5, counted by messages against `chat-summaries.json`
  (`server/store/chat-summaries.ts`, `forChat`). Its route is `ROUTES.projectUnsavedChats`
  (`server/http/routes.ts:1710`), which uses `savableCard` (`:1401`) and `ctx.brain.chatEntries` (`:1737`,
  this person's `chat` entries for one chat, newest first, each with `at`).
- New routes must be added to the project routes list at `server/http/routes.ts:2976-2996` and to `ROUTES`
  (`shared/contract.ts:2234`), and the client call to `client/src/api.ts:269`.
- Opening a chat beside the project: `openPast(sdkSessionId, { in: 'drawer' })` (`client/src/store.tsx:1326`),
  used by Updates' **Open chat** (`ProjectUpdates.tsx:325`); it already falls back to the live chat when the
  chat is open. A live chat can be opened directly with `openChat(id, { in: 'drawer' })`.
- Saving: `saveChat(req)` in `ProjectPage.tsx` (`openSaveRef`, `:649`) switches to Updates and opens the
  review form; the Overview card calls it through `onSaveChat`.
- The store's `sessions` (`SessionList`: `live` and `past`, both carrying `project`) changes when a chat
  starts, ends or is deleted.
- Row pattern to reuse: `ProjectUnsavedChats.tsx` (`.card.proj-card`, `ul.lib-list`, `.line.proj-update
  .proj-email-row`, small `.btn`), dates with `dateWords` (`apps/projects/logic.ts`).
- Help: `help/projects.md`, `help/project-chats.md`, `help/saving-chats-to-projects.md`; pictures come from
  `pnpm help:shots` (`scripts/help-shots.ts`, `help/shots.json`); the next version is 0.93.0 (`feat`).

## Decisions

1. **A fifth tab, "Chats", last in the row** (Overview, Tasks, Updates, Files, Chats). No count on the tab.
   `ProjectTab` gains `'chats'`.
   Plain: the tabs you know stay where they are, and Chats is the new one at the end.
2. **The list comes from a new read-only route, `GET ROUTES.projectChats?key=`** (`/api/projects/chats`),
   answered by a new `ChatSummaryService.forProject(input)` built on `placed()`. Contract:
   `shared/project-chats-contract.ts`. All of this Mac's chats for the project's keys (live key and
   `movedFrom`), live ones included, newest first, at most `PROJECT_CHATS_MAX` (100) with `more` when there are
   more. No age limit. `unsaved()` and its route are not changed.
   Plain: the tab shows every chat for the project, not just the last month's five.
3. **Each row says whether the chat is saved to the project**, by the contract's saved rule (the same counting
   as the Overview card): `never`, `saved`, `new` (more messages since the save), or unknown. Messages are
   counted only for a saved chat that was active after its save, so a long list stays quick.
   Plain: you can see at a glance which chats the team has a summary of and which they don't.
4. **Who may read it.** The project must be one this person can see (`list.call(ctx.brain, who)`; unknown →
   `not-found`). An archived project, or one this person can't change, still lists its chats with
   `canSave: false`. `canSave` is worked out exactly as the unsaved route does (service present, the projects
   skill allowed, `savableCard` passes).
   Plain: you can always find your own chats; the Save button only shows where saving would work.
5. **The tab is one card, `ProjectChats.tsx`, with the Chats drawer's row** (overseer blocking 2: a
   `.line.proj-update` row has no lift, so a title button in it would be bare clickable text). Heading `h3`
   "Your chats for this project"; under it the hint "Only you can see these. They stay on this Mac." Each row
   is `li.line` > `button.line-main` (`.line-text`, `.line-title`, `.line-meta`), then the small
   **Save to project** `.btn`. The row button opens the chat beside the project: a chat the store lists as
   live (`sessions.live` by `sdkSessionId`) opens with `openChat(live.id, { in: 'drawer' })`, any other with
   `openPast(chat, { in: 'drawer' })` (overseer blocking 1). The details line uses `dateWords` and " · ":
   "Open now · not saved yet", "Last active 24 Nov · saved 20 Nov", "Last active 24 Nov · new messages since you
   saved on 20 Nov". When `canSave` is false, or `saved` is null, the line says nothing about saving.
   **Save to project** shows when `canSave`, the chat isn't `busy`, and it is `never`, `new` or unknown; a
   `saved` row has none (a second save would spend a Claude draft to say "nothing new"; the chat's own header
   still offers it). A chat that can't be opened shows "That chat can't be opened on this Mac."
   Plain: chat rows look and press like the Chats drawer's; press one to pick it up with the project in view.
6. **States, with `StateNote`.** Loading: "Loading chats…". Empty: "No chats for this project on this Mac
   yet." plus, when the project isn't archived (`canStart`), "Press **New chat for this project** to start
   one." (the button already sits in the page's head; none is added). Failed: "The chats couldn't be read."
   with Try again. `more`: "Showing the newest 100 chats. Older ones are in the Chats drawer." On a re-read
   the rows stay on screen and an out-of-date answer is ignored. No chat service answers an error, not an
   empty list.
   Plain: the tab always says what it is showing, and never flickers or shows "no chats" for a fault.
7. **It keeps itself up to date.** The tab reads again when the project's chats in the store's `sessions`
   change (their ids, titles and live state, for the project's keys), and coming back from Updates after a
   save remounts it. "Open now" comes from the store. Once `sessions` has loaded, a row the store no longer
   lists (a chat being deleted) is not shown.
   Plain: start or delete a chat and the list is right when you look.
8. **No delete, star or rename in the tab.** Those stay in the Chats drawer. The Overview's "Chats not saved
   yet" card stays as it is.
   Plain: the tab finds and opens chats; managing them stays where it already lives.
9. **Help in the same branch.** `help/project-chats.md` gains the tab (and a picture, `project-chats-tab`),
   `help/projects.md` and `help/saving-chats-to-projects.md` name it, `help/whats-new/0.93.0.md` is added and
   `client/src/help/whats-new.test.ts` updated. No tour step: it is a tab inside an existing app
   (`docs/help-standard.md` section 6, step 4). `docs/design-system.md` gets a short note on the tab.
   Plain: the help pages and What's new say the tab exists.

10. **One read for saved entries** (overseer should 1). `ProjectUpdatesService.myChatEntries(key, identity)`
    answers this person's `chat` entries on a project as chat id → newest `at`, from one listing; the route
    hands it to `forProject` as `entries`, which calls it only when some chat has no record.
    Plain: the tab stays quick on a project with many chats and updates.

Overseer rulings (pre-review, 2026-11-26): the tab is last with no count (`.count` means "waiting"); `saved`
rows offer no second save; the Overview card gets no link to the tab (risk accepted: a sixth unsaved chat is
only found in the tab).

## Contract

`shared/project-chats-contract.ts`: the row and response types, the saved rule, `PROJECT_CHATS_MAX`, the
service's input and result, and the tab's props.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (server) | `builder`, sonnet | default | `server/engine/chat-summary.ts`, `server/engine/chat-summary.test.ts`, `server/http/routes.ts`, `server/http/chat-summary-routes.test.ts`, `server/brain/project-updates.ts`, `server/brain/project-updates.test.ts`, `server/brain/index.ts`, `shared/contract.ts` (the `ROUTES` line only) |
| Builder B (app) | `builder`, sonnet | default | `client/src/apps/projects/ProjectChats.tsx`, `client/src/apps/projects/ProjectChats.test.tsx`, `client/src/apps/projects/ProjectPage.tsx`, `client/src/apps/projects/ProjectsSheet.tsx`, `client/src/apps/projects/testing.ts`, `client/src/api.ts`, `client/src/styles/projects.css`, and any existing projects test that pins the tab list |
| Lead | this session | already in context | the plan, the contract, `help/**`, `scripts/help-shots.ts`, `help/shots.json`, `client/src/help/**`, `docs/design-system.md` |
| Reviewers | `reviewer` opus (correctness, with security of the new route folded in), `reviewer` sonnet (UI and accessibility), `expert` opus (UX/UI sign-off against `docs/design-system.md`, with screenshots) | | (read-only) |

No file appears in two rows. Builder B calls `ROUTES.projectChats`, which Builder A adds: B uses the name from
the contract and type-checks once A's line is in.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/chat-summary.test.ts` | `forProject`: only the project's keys (a `movedFrom` key counts, another project's chat doesn't); newest first; capped at `PROJECT_CHATS_MAX` with `more`; a live replying chat is listed with `busy`; each saved state (`never`, `saved` without counting when not active since, `new` when the count grew, `saved` when the count can't be read, `saved` from an entry with no record, `null` when `entries` rejects); `entries` is called at most once and not at all when every chat has a record; the newest record wins across keys | Builder A |
| `server/brain/project-updates.test.ts` | `myChatEntries`: only this person's `chat` entries, newest `at` per chat, empty for an unknown project | Builder A |
| `server/http/chat-summary-routes.test.ts` | the route through the real request gate: 200 with rows; `bad-request` without a key; `not-found` for an unknown project; an archived project answers its chats with `canSave: false`; no chat service answers an error; non-GET refused | Builder A |
| `client/src/apps/projects/ProjectChats.test.tsx` | rows and their details words for each saved state (nothing about saving when `canSave` is false); the row is `li.line` > `button.line-main`; Save to project shown only when `canSave`, not `busy`, not `saved`; pressing it calls `onSave` with key, chat, title; a row press opens a live chat with `openChat(live.id)` (the live session's `id`, not `chat`) and a past one with `openPast(chat)`, both in the drawer; a row the store no longer lists is hidden; the empty text names the button only when `canStart`; rows stay during a re-read; the can't-open words; empty, failed (Try again reads again) and `more` states; reads again when the project's chats in `sessions` change | Builder B |
| an existing projects app test (or `ProjectsApp.test.tsx`) | the Chats tab is in the row, last, and shows the card | Builder B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert sign-off; the new route checked through the request gate (in the route test)
- [ ] Browser check: demo mode, a project with chats: the tab, open a chat beside the project, Save to
      project from a row, empty state, narrow window
- [ ] Help: page, picture, `help/whats-new/0.93.0.md` (check the version before landing)

## Review outcomes

(Filled at the end.)
