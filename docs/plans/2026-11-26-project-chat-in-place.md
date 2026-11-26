# A chat started in a project stays in the project

Date: 2026-11-26 · Size: L · Branch: `project-chat-in-place` · Explainer: none (Ian said no)

## Objective

Pressing "New chat for this project" (or a chat button on the project's Tasks tab) no longer sends the person
to Home. The message box opens in the chat drawer beside the project page, with the project and client pickers
already filled in, and the chat stays there once sent. The loose "Project: …" text on Home goes for good.

## User decisions (fixed)

- Use the selectors that exist and pre-fill them; no stray text (Ian, 2026-11-26).
- The person must feel they stay inside the project (Ian, 2026-11-26).
- Plan first: nothing is built until Ian has read this plan and said go. He said go on 2026-11-26.
- The first picker for a project's chat is the per-chat "Project" picker of decision 3, with 3a (Ian,
  2026-11-26: "go with your recommendations"). The section below is kept as the record of the choice.
- Visual explainer: no.

## Open decision for Ian (one)

**What the first picker is called and what it changes when a chat is started for a project.** Both experts, the
overseer and the lead recommend decision 3 below: it reads "Project", is filled in, and belongs to that chat
only. The other reading of "use the existing selector" is to set Home's app-wide "Working on" to the project.
That would also narrow Home's cards, the Tasks drawer, Images, Documents and search until the page is reloaded,
from a button that only says "new chat". The overseer ruled for decision 3 on 2026-11-26, on the condition in
decision 3a. Ian has the last word because "Working on" in the message box was his call on 2026-11-21.

The strongest case against, for the record: one slot with two labels ("Working on" on Home's own chat,
"Project" on a project's chat) is a hidden mode. A single always-per-chat "Project" picker, with "Working on"
moved to its own line on Home, would remove it, but that undoes the 2026-11-21 placement and is a later choice.

## Facts (from the code, 2026-11-26)

- `ProjectPage.tsx:685` (header button) and `:522` (checklist button) call `newChat(projectChatPlace(…))`.
  `ProjectTodos.tsx:197` uses `TodoChatButton`, which calls `newChat` too (`TodoChatButton.tsx:49`).
- `store.tsx:904` `newChat` always runs `leave('chat', …)` and `setView('chat')`; `App.tsx:155` shows `<Home />`
  for a new chat. `NewChat` (`store.tsx:259`) already carries `client?` and `project?`.
- `Home.tsx:96-124` `ProjectPicker` ("Working on") is bound to the app-wide `projectChoice`
  (`state/client-choice.ts`). A chat's preset project never reaches it; it is printed as text
  (`Home.tsx:708-712`, `data-testid="home-project"`).
- A project is sent only while Chat for equals the project's own client (`projectIfClientMatches`,
  `state/chat-project.ts`); picking another client drops it silently.
- The chat drawer (`shell/ChatDrawer.tsx`, design system "Chat drawer (tool chats)") is non-modal, 380–520px+,
  and on Projects the page makes way for it when the sheet is about 992px or wider (`CONTENT_MIN` 600,
  `useLayerWidth.ts:102`; `viewer.css:345`). It shows only a live chat: `store.tsx:1131-1140` clears it for
  anything else. `ChatView` is "a live chat only" (`Chat.tsx:59`).
- "File the notes" already starts a project chat in the drawer (`ProjectMeetings.tsx:138`), so the server needs
  no change: `api.startSession` takes `project` today.
- Home's send does more than send: with Chat for on Auto it guesses the client and may ask (`Home.tsx:715-796`,
  `ClientAsk.tsx`).
- Esc never hides the drawer while its message box holds text (`state/keys.ts:44`). `useSheetHold` is the
  shared "you have unsaved work" hold for forms on the sheet.
- "Project" is already the label of the per-app project filter (`apps/shared/parts.tsx:39`).
- `docs/design-system.md:513-516` is stale: it describes a 180px "Client" picker; the code has "Chat for" in a
  200–300px `.scope-field`.

## Decisions

1. **A new chat can open in the chat drawer, not sent yet.** `newChat` gains `in?: ChatPlace`. With
   `in: 'drawer'` on a view the drawer may sit beside (`drawerView`), the store sets the new chat as active
   without changing the view; anywhere else it falls back to Home as today. The store exposes
   `newChatDrawer: number | null` (the new chat's key) beside the unchanged `chatDrawer: string | null`, and the
   clearing rule keeps a drawer whose active chat is that new chat. `send()` sets the drawer to the new session
   when the chat was in the drawer, so the first reply streams in the same place.
   Plain: you press the button, a message box slides in beside the project, and you never leave the page.
2. **One message box for a new chat, used in both places.** Home's composer, scope row, "Working out the
   client…" note, `ClientAsk` and send logic (`Home.tsx:648-798`) move into `client/src/components/NewChatBox.tsx`,
   unchanged in behaviour. Home renders it; the drawer renders the same component. No second message box is
   built, and none goes on the project page itself.
   Plain: the box in the drawer is the box you know from Home, not a copy.
3. **The first picker shows the chat's project (the open decision above).** The rule lives in one pure function,
   `chatScope` in `state/chat-project.ts`:
   - Home's own new chat (no preset project): "Working on", app-wide, exactly as today.
   - A chat opened for a project (project page, a task in a project, or in the drawer): the same
     `scope-field` + `SearchSelect`, labelled **"Project"**, filled with that project, bound to this chat only.
     Options: "No project", then every live project under its client (`filterOptions`). "Working on" is neither
     shown nor changed for that chat.
   The binding is fixed when the chat is made (`freshNewChat`, `store.tsx:554`), not worked out again later.
   Plain: the picker itself says which project the chat is for, and starting a chat never quietly filters the
   rest of the app.
   3a. **Home never hides a live filter (overseer's condition).** When a chat-bound row is on Home and
   "Working on" is set, Home shows the existing `.home-scope` line with the "Working on" picker
   (`Home.tsx:804-807`), so the person can see why the cards are narrowed and undo it.
   Plain: if Home is filtered, you can see why and switch it off.
4. **The two pickers keep each other honest, in view.** In a chat-bound row: picking a project moves Chat for
   to that project's client (No client for a personal project); picking a client that isn't the project's own
   sets Project to "No project" where the person can see it (today it is dropped silently). What is sent is
   exactly what the pickers show. Home's app-wide row behaves as today. Two rules from the pre-review:
   - A chat opened with a client that isn't the project's own (a personal task on a client project,
     `client-choice.ts:146`) starts on that client with Project on "No project", as today.
   - **Amends R2 phase 1, decision 2(a).** Today `send()` drops the project when the first message no longer
     names the task (`store.tsx:1254`, pinned by `store.send.test.tsx:400`), while the picker still shows it.
     From now on only the task link (`todoId`) is dropped; the project the picker shows is sent.
   Plain: what you see in the two boxes is what the chat gets, even if you reword a task chat's first line.
5. **The loose "Project: …" text is deleted** (`Home.tsx:708-712`, `showPreset`, and its test id). The scope row
   is pickers only, in every place.
   Plain: no stray grey line beside Chat for.
6. **What the unsent drawer looks like.** The live drawer's header, extracted so both states share it: `h2`
   "New chat", one `.chip` with the project's title (ellipsis, `min-width: 0`, `data-tip` with
   "Client · Project"), Open full screen, Hide chat. Middle: the existing `.thread-empty` block with an `h3`
   and the line "Nothing is sent until you press Send." Bottom: `NewChatBox` in the usual `.floater`, focus in
   the message box. No pressed look on the button that opened it; pressing it again puts focus back in the box.
   Plain: it looks like a fresh chat with the cursor waiting, not an empty panel.
7. **Pickers stack in a narrow box.** A container query on `.composer`: under 560px `.composer-scope` becomes a
   two-column grid (labels in one column, selects filling the rest, 8px gaps, no 300px cap). Home's wide box
   keeps them side by side.
   Plain: in the drawer the two boxes sit one above the other and long project names fit.
8. **Only Send or Discard removes what you typed.** The unsent drawer gets a hold of its own in
   `ShellProvider` (a sibling of the panel and sheet holds, chained in `guardLeave`), asked inside the drawer
   with the shared inline `Confirm` ("Keep writing" / "Discard message", safe option focused). It can't reuse
   `useSheetHold`: that is one slot shared by the project form, updates, Save to project and email approval
   (`useSheetHold.ts:14-17`), and the project page's tab switch reads it (`ProjectPage.tsx:627`). Everything
   that would replace or close an unsent chat with text goes through the drawer hold:
   - Hide chat, and Esc from anywhere in the drawer (today Esc only counts a focused textarea,
     `ShellProvider.tsx:177-183`, so Esc from a closed picker would discard the text);
   - leaving Projects;
   - another chat taking the drawer: `openChat`/`openPast` with `in: 'drawer'` (File the notes, a past chat from
     Updates, Save to project; `store.tsx:1100` skips the guard today) and a second `newChat({ in: 'drawer' })`.
   As built: Esc with text asks the same question (it never closes silently and never does nothing); Discard
   always drops the unsent chat before anything else runs; and the unsent chat belongs to the view it opened on,
   so it never rides from Projects onto a tool's page. Between Send and the chat starting the message has
   already gone, so the hold doesn't ask about that chat (`newChatStarting` holds its key), a chat the person has
   since left or hidden never pulls them back, no start replaces a different unsent drawer chat, and Open full
   screen waits ("Your message is sending. Try again in a moment.").
   Changing tab or project page inside Projects does not ask: the drawer stays. With an empty box, Hide and Esc
   close the drawer and focus returns to the opening button. Open full screen moves the text, the two picks, the
   task link and the skill to Home's box (held while files are attached, as for a live chat).
   Plain: a half-typed message and a half-filled project form can't wipe each other out, and nothing but Send
   or Discard removes your text.
9. **After Send nothing jumps.** The chat stays in the drawer as a normal live chat; the scope row is gone
   (client and project are fixed for the life of a chat); the message box stays at the bottom with focus in it.
   `ChatDrawer` keeps one frame mounted across unsent → live and swaps its inside (today it is keyed on the chat,
   `ChatDrawer.tsx:16`, so the slide-in would replay and the return-focus timer could pull focus to the page).
   The live chat's header chip is unchanged (the client), so the drawer and full screen keep agreeing
   (`Chat.tsx:264` and `:303`); the unsent header's chip names the project.
   Plain: you send, the reply appears above, and the box hasn't moved.
10. **Which buttons use the drawer.** On the Projects view: "New chat for this project", "Ask Claude about the
    checklist" (its draft already in the box), the Tasks tab's chat buttons (`ProjectTodos.tsx:197`, via a new
    `in` prop on `TodoChatButton`, passed to both its `newChat` and its `openChat` for a task that already has
    a chat) and the task panel when it was opened from the project's Tasks tab (`TodoPanel.tsx:410-414`). The
    Tasks drawer in the dock, the palette, Images and Documents keep opening Home, now with the filled-in
    Project picker of decision 3.
    Plain: anything you start from the project page stays on the project page.
11. **Edge cases.** Archived project: no header button (as today); the checklist button passes the client and
    no project. Personal project, or a client not in the list: No client, project still sent. A live chat
    already in the drawer: it keeps running and stays in Chats; the new one takes the drawer. Moving to another
    project's page or tab: the drawer and its chosen project stay; the header chip names the project. A chat
    that can't start (four already running, or any other refusal): the message shows today in the sheet's
    notices (`SheetNotices.tsx:48`), which an overlaying drawer can cover, so the drawer's box repeats it in
    its own status line. The "Which client is this for?" card works in the drawer and its answer keeps the
    chat in the drawer.
    Plain: the odd cases behave the way the normal one does.
12. **No server, brain or tour change.** `startSession` already takes `project`. No new rail place or Home
    card, so no tour step and no `TOUR_VERSION` bump. Help pages that describe the old jump or the
    "Project:" text are rewritten (`help/projects.md`, `help/picking-the-client.md`, `help/drafting-emails.md`,
    `help/home.md`), and `docs/design-system.md` gains the unsent drawer state, the scope-row rule ("pickers
    only; Working on is app-wide and only on Home's own chat; Project is per chat; stacked under 560px") and
    the fix for the stale lines 513-516.
    Plain: nothing changes in the brain; the guides say what the app now does.

## Out of scope

- Narrowing Chats by project, or changing what "Working on" filters.
- Changing a chat's client or project after it has started.
- A message box on the project page itself (rejected: it would be a second look-alike box and would still
  have to jump into a thread).

## Contract

`docs/plans/2026-11-26-project-chat-in-place-contract.ts`: the store additions, `chatScope` and the
`NewChatBox` props every builder builds against.

## Team and file ownership

A strict order, not three builders at once (overseer): the drawer can't be tested without the shared box, and
the box needs the scope rule.

| Step | Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|---|
| – | Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| 1 (parallel) | Builder A | `builder`, sonnet | default; tests first | `client/src/store.tsx`, `client/src/state/keys.ts`, `client/src/state/chat-project.ts`, `client/src/shell/ShellProvider.tsx`, `client/src/shell/contract.ts`, their tests (incl. `store.send.test.tsx`) |
| 1 (parallel) | Builder B | `builder`, sonnet | default (UI) | `client/src/components/NewChatBox.tsx` (new), `client/src/shell/Home.tsx`: a pure move, with `Home.test.tsx` and the tour anchor `.home-composer #pick-project` (`tour/steps.ts:74`) untouched and passing |
| 2 | Builder C | `builder`, sonnet | default (UI) | wires `chatScope` into `NewChatBox.tsx` and `Home.tsx` (after B has finished), then `client/src/shell/ChatDrawer.tsx`, `client/src/components/Chat.tsx` (header extraction), `client/src/shell/NewChatDrawer.tsx` (new), `client/src/styles/home.css`, `chat.css` (scope row only), `viewer.css`, `client/src/apps/projects/ProjectPage.tsx`, `ProjectTodos.tsx`, `client/src/shell/TodoChatButton.tsx`, `TodoPanel.tsx`, their tests |
| 3 | Lead | this session | docs are a few clear lines each | `docs/design-system.md`, `help/*.md`, the plan |
| 3 | UX/UI expert | `expert`, opus | Ian's standing sign-off gate, with screenshots | (read-only) |
| 3 | Reviewers | `reviewer`: correctness opus; UI and accessibility sonnet | per the workforce table | (read-only) |

No file is owned by two builders at the same step. No Opus builder. `client/src/components/Composer.tsx` is not
changed: the drawer reads the box's text from the DOM, as the live drawer already does (`Chat.tsx:155-156`).

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `client/src/state/chat-project.test.ts` | `chatScope`: label and binding per case; project → client; other client → "No project"; what is sent equals what is shown | A (tests first) |
| `client/src/store.newChatDrawer.test.tsx` | `newChat({ in: 'drawer' })` keeps the view on Projects; falls back to Home on a non-drawer view; `send` leaves the live chat in the drawer; leaving Projects clears it | A (tests first) |
| `client/src/shell/ShellProvider.*.test.tsx` | the drawer hold: a form and the drawer both dirty each keep their own question; a tab change with text doesn't ask; Esc from a picker with text asks; File the notes over a typed message asks | A (tests first) |
| `client/src/store.send.test.tsx` | the project the picker shows is kept when the task link drops (rewrites the test at `:400`) | A |
| `client/src/shell/Home.test.tsx` | a chat with a preset project shows a filled "Project" picker and no loose text; with Working on set, the `.home-scope` line shows; Home's own chat still shows "Working on" in the box | C |
| `client/src/shell/NewChatDrawer.test.tsx` | header, chip, empty lines; Hide with text asks; Open full screen carries text and both picks; focus is in the box after Send and on the opening button after Hide; `ClientAsk` answered in the drawer stays in the drawer | C |
| `client/src/apps/projects/ProjectsApp.test.tsx` | the header, checklist, Tasks tab and task panel buttons open the drawer and the page stays | C |

## Gates

- [x] Type-check · [x] Tests · [x] Lint · [x] Build (`pnpm check`; preview on 3878 in demo mode, or the wt-start port if taken)
- [x] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'` (Home.tsx will lose about 150 lines to `NewChatBox.tsx` on purpose)
- [x] Domain gates: UX/UI expert sign-off against `docs/design-system.md` with screenshots; `scripts/wording.test.ts`
- [x] Browser check: project page → New chat (wide sheet, sheet under 992px, 380px drawer); send; Hide with text; Open full screen; a task chat from the Tasks tab; Home with a task chat's preset project; Home's own new chat

## Pre-review (Fable overseer, 2026-11-26): approve with changes

All folded in above after each was checked in the code. Blocking: the drawer needs its own hold, not
`useSheetHold` (decision 8); three routes that would still drop a typed message (decision 8); `send()` against
"what you see is what is sent" (decision 4). Should: the task panel and a task's existing chat (decision 10);
one drawer frame across Send (decision 9); `chatScope` gaps (decisions 3 and 4, contract); Home must not hide a
live filter (decision 3a); a strict build order; the four-chat message (decision 11). Dropped from the first
draft: the live chip change and the route-level test (no new request shape).

## Review outcomes

Built 2026-11-26 by a Sonnet builder for the store and shell hold (A), a Sonnet builder for the pure move of
the message box (B), then a Sonnet builder for the drawer state and wiring (C); fix rounds by the lead.

- **Browser check (lead, demo mode on 3878).** Found what no test or reviewer could: a native `input` listener
  in `NewChatDrawer` set React state before React's own handler, so the first two keys typed were lost (not
  reproducible in jsdom). Fixed with React's `onInput` and a deferred `MutationObserver`. Otherwise passed: the
  drawer beside the project with both pickers filled; page makes way on a wide sheet and the drawer overlays at
  1100px; 380px drawer with no overflow; Esc, Hide and leaving all ask; Keep writing keeps the text; Send keeps
  one frame and focus; Open full screen lands on Home with "Project" and "Chat for" filled and no loose text;
  Home's own chat and the full-screen live chat unchanged. Not checked by hand: the Tasks tab's chat button (the
  demo project has no open tasks; covered by `ProjectsApp.test.tsx` and `TodoPanel.test.tsx`).
- **Correctness (Opus), three passes.** Pass 1: two confirmed, one cause (after Discard the unsent box could stay
  on screen, on the way to a tool or while a chat was starting, and later text went unasked); fixed by making
  Discard always drop the chat and tying the chat to its view; two untested paths given tests. Pass 2 on that fix
  round: the four fixes sound; one more confirmed (Discard offered for a message Send had already handed over,
  and the chat then popped up where the person had gone). Pass 3 on that fix: two confirmed (one app-wide flag
  let a second unsent chat lose its question; Open full screen mid-send left the sent text looking unsent), fixed
  by keying the flag to the chat and holding Open full screen. Pass 4: sound, one small point taken (the
  "sending" note cleared when its start ends). Every fix has a test that fails without it.
- **UI and accessibility (Sonnet).** No faults. One wording point taken: the button reads "Discard message".
- **UX/UI expert (Opus), five screenshots: sign-off, no blockers.** Taken: the Discard strip is inset like the
  task panel's (`.chat-drawer .confirm`). Left for Ian: keeping the project's name in the header chip after Send
  (decision 9 keeps the client so the drawer and full screen agree).
- **Overseer (Fable): sign-off** against all three blocking and six should points from the pre-review.
- **Gates.** `pnpm typecheck`, `pnpm lint`, `vitest run` (329 files, 6,776 tests) and `pnpm build` pass. Large
  deletions: only `Home.tsx` (263 lines, the planned move to `NewChatBox.tsx`).
- **One small visible change outside the drawer.** Home's two pickers now stack as a tidy two-column grid when
  the message box is under 560px wide (a narrow window); before, they wrapped.
