# Tool chats in a right-hand drawer

Date: 2026-11-16 · Size: L · Branch: `run-chat-drawer` · Explainer: none (Ian: no)

## Objective

Ian (2026-11-16): "run in a tool like the example of run in ad manager, can you run the chat in a popover
draw from the right, rather than a full chat window? This could be used for the other tools too." And after
v0.48.0: "The chat is not opening in a side draw when I click run on any of the tasks."

Today Run calls `startChat(prompt, client, { open: true })`, which sets the active chat and switches the
sheet to the full chat screen, so the person loses the Ad Manager board. Instead the chat opens in a drawer
that slides in from the right over the tool, which stays on screen behind it.

## User decisions (fixed)

- Tool chats open in a right-hand drawer, not the full chat screen; the mechanism is reusable by every tool.
- No explainer. UK English in UI text. Backward compatibility first. Reuse the design system (glass drawer,
  `ResizeHandle`, `icon-btn`, `SheetBar` look) per `docs/design-system.md`.

## Facts

- `client/src/components/Chat.tsx` `ChatView` renders `activeChat` only (`useStore().activeChat`). It uses
  `send` (store, writes to `activeChat`), `composerFocus`, `closeRequest`/`requestClose`/`closeChat`,
  `useOpenPageAfterTurn` (opens the file viewer), and a `SheetBar` with crumb "Chats" and the panel toggle
  "Files and details".
- `client/src/store.tsx`: one EventSource per tab, **following `activeChat`** (`liveId`, :453). So only the
  active chat gets live events. `openChat(id)` sets `activeChat` and `setView('chat')` (:700).
  `startChat(prompt, client, { open })` (:729). `send` (:744) posts to `activeChat`.
- `client/src/App.tsx`: `SheetContent` shows a tool (`view` `tool:*`) or, as the fallback,
  `ChatView`/`Home`. `Shell` lays out rail, left dock, `<main class="sheet">`, right dock (panel) and
  `<FileViewer />` (a modal glass drawer with veil, `ViewerDrawer` + `useLayerWidth` + `ResizeHandle`).
- Shell state is in `client/src/shell/contract.ts` (`ShellState`, `ShellAction`) and
  `client/src/shell/ShellProvider.tsx` (reducer, focus rules, saved state).
- Callers: Ad Manager `Board.tsx` (cadence Run :275, standup Run :372, `RunButton` "Open chat" :110) and
  `ProposalPanel.tsx` (:52 "open chat"). No other tool starts chats.

## Decisions (proposed; overseer to confirm or change)

1. **The drawer chat is the active chat.** A tool opens a chat "in the drawer": the store sets
   `activeChat` to it (so the event stream, `send`, focus and close all work unchanged) but leaves `view`
   on the tool. Plain: the chat is fully live in the drawer, exactly as on the chat screen.
2. **API**: `startChat(prompt, client, { open: true, in: 'drawer' })` and `openChat(id, { in: 'drawer' })`.
   `in` defaults to `'sheet'` (today's behaviour), so every other caller is unchanged.
   Shell state gains `chatDrawer: boolean` (open/closed) with actions `open-chat-drawer` / `close-chat-drawer`.
   Plain: any tool can ask for its chat in the drawer with one option.
3. **`ChatDrawer`** (new, `client/src/shell/ChatDrawer.tsx`) renders `<ChatView placement="drawer" />` in a
   glass drawer on the right, resizable (own width setting, default ~560px, `ResizeHandle`), full width at
   ≤640px. **Non-modal**: no veil; the tool behind stays usable, so the person can read the board while
   Claude works. `role="complementary"`/region with a label "Chat: {title}".
4. **`ChatView` gets `placement: 'sheet' | 'drawer'`.** In the drawer, the bar shows the chat title, the
   client chip, **Open full screen** (`icon-btn`, goes to the chat screen and closes the drawer) and
   **Close** (hides the drawer; the chat keeps running and stays in the Chats list). Ending the chat stays
   available from the full screen. No "Files and details" toggle in the drawer.
5. **When the drawer closes on its own**: opening the chat screen, starting a new chat, opening another
   chat on the sheet, or the active chat going away. Esc inside the drawer closes it (unless a confirm or
   card handles Esc first). Changing tool keeps it open. Not restored after a reload.
6. **Focus**: opening moves focus to the message box (or a waiting card); closing returns it to the
   button that opened it if still there, else `#main`.
7. **Ad Manager** uses the drawer for Run, standup Run, Open chat and the proposal panel's chat link.
8. **The file viewer** still floats over everything, the drawer included (it is modal).

### Overseer pre-review (applied; overrides the decisions above where they differ)

- **Blocking 1:** the drawer state lives in the store, not the shell (`StoreProvider` wraps `ShellProvider`).
  - The store holds `chatDrawer: string | null` (a session id).
  - The drawer shows when that id is the live `activeChat` and `view` starts with `tool:`.
  - Every non-tool `setView` clears it, so two `ChatView`s never mount together.
- **Blocking 2:** no `SheetBar` in the drawer. Use an `h2` header like the viewer's. The drawer body gives `.chat` `flex: 1; min-height: 0`.
- **Files:** a file link inside the drawer goes full screen first, then shows the file. Pages still open the viewer.
- **Placement:** the drawer is anchored inside `<main class="sheet">`, so a pushing panel stays beside it and the existing `inert` rules apply.
- **Esc:** handled in `keyAction`. Order: palette, viewer, to-do panel, floating panel, chat drawer, left drawer.
  - `KeyContext.chatDrawer` is false while a modal layer is above.
  - Esc is swallowed while a message box holds text.
- **Width:** its own setting, `chatDrawerWidth` (default 520, min 380). `useLayerWidth` and `ResizeHandle` are parametrised; the viewer's defaults are unchanged.
- **Focus:**
  - Opening calls `requestComposerFocus()`.
  - Hiding returns focus to the opener, or else `#main`; `/clear` in the drawer does the same.
  - ProposalPanel closes a floating panel first.
- **Bar:** the X is labelled "Hide chat"; "Open full screen" uses the `wide` icon. Ending the chat isn't in the drawer.
- **Closes on:** Hide, Esc, Open full screen, any non-tool view, a new chat, another chat opened on the sheet, or the chat ending. Moving from tool to tool keeps it.
- **Reload:** `saveChat` is left as it is; the drawer isn't restored.
- **Tests to update:** `AdManager.test.tsx` exact-argument expectations; `sections-contract.ts:84`.

## Contract

```ts
// store
startChat(prompt: string, client: string | null, opts: { open: boolean; in?: 'sheet' | 'drawer' }): Promise<string | null>;
openChat(sessionId: string, opts?: { in?: 'sheet' | 'drawer' }): void;
// shell/contract.ts
ShellState.chatDrawer: boolean;
ShellAction |= { type: 'open-chat-drawer' } | { type: 'close-chat-drawer' };
// components/Chat.tsx
export function ChatView(props?: { placement?: 'sheet' | 'drawer' }): JSX.Element | null;
```

## Team and file ownership

| Role | Agent and model | Owns |
|---|---|---|
| Overseer | `overseer`, fable | (read-only) |
| Lead | me | store, shell contract and provider, `App.tsx`, `ChatView`, `ChatDrawer`, CSS, Ad Manager callers, help, tests |
| Correctness reviewer | `reviewer`, opus | (read-only) |
| UI and accessibility reviewer | `reviewer`, sonnet | (read-only) |

No separate builder: the work is one tightly coupled thread through the store, shell and `ChatView`;
splitting it would cost more in briefing than it saves.

## Tests

- Store: `openChat(id, { in: 'drawer' })` sets the active chat and keeps the view; default unchanged.
- Shell reducer: open/close drawer; closes on opening the chat screen / new chat.
- Ad Manager: Run opens the drawer and the board stays; Open chat opens the drawer.
- ChatDrawer: Close hides it and the chat stays live; Open full screen moves to the chat screen; Esc closes;
  focus goes to the message box.

## Gates

- [x] Type-check · [x] Tests · [x] Lint · [x] Build · [x] No unintended large deletions
- [x] UX/UI gate; browser check of Run → drawer on the Ad Manager board (preview, practice brain, chat start faked)

## Review outcomes

- **Overseer (Fable):** the pre-review gave 2 blocking and 7 should; all were applied. Sign-off: no blockers.
  - Two CSS fixes, made: no line under the header, and the viewer's heading font.
  - The attached-files hold is now tested, and its note clears.
- **Correctness (Opus):** 2 should, 1 consider; all fixed.
  - Esc under a floating left drawer.
  - The draft was lost on Open full screen; it's now handed over, and attached files hold the move.
  - Width limits now come from the sheet.
- **UI (Sonnet):** 5 nice. Taken: the 12px gap and the help lines. Dropped: an open announcement (focus already moves into the labelled region).
- **Browser:**
  - The drawer opens at 520px beside the board, with one `h1` and focus in the message box.
  - Esc hides it and focus returns to Run; Open full screen moves focus to the chat screen's message box.
  - Not checked in the browser: the Esc-with-text rule (the fake chat's box was read-only). A test covers it.
