# Projects R2, phase 1: chats know their project

Date: 2026-11-23 · Size: XL programme, phase 1 of 6 (L) · Branch: `projects-r2-chat-project` · Explainer: (added after pre-review)

Parent plan: `docs/plans/2026-11-20-projects-system.md`, Release 2 decisions 18, 20 and 22.

## Objective

When Ian works in a chat opened for a project (Working on, or a to-do in a project), every document,
page or file Claude makes is saved in that project's folder, so it shows on the project's Files tab.
Today a chat remembers only its client, and Claude is told to offer `clients/<client>/reports/` first.

## User decisions (fixed)

- Build phase 1 now, then the rest of Release 2 in phases; merge and push each phase once its checks
  and reviews pass (Ian, 2026-11-23).
- Brain changes are prepared in `brain-skills/` and copied into the brain only after Ian says yes, files
  only, never git in the brain.
- Visual explainer: yes.

## Facts (from the code, 2026-11-23)

- `Session` has `client`, `todoId`, `kind` (`server/engine/session-manager.ts:703`). `appendLine` is built
  once in `newSession` (`:1111`) from `clientLine(slug)` (`:610`), `FILES_LINE`, `HELPERS_LINE`.
- `clientLine` says "offer `clients/<slug>/reports/` first" and SAVE_LINE (`:627`) asks before saving.
  The attachment filing line (`:424`) uses "this chat's client".
- Resume ignores `req.client` and starts with client null (`:2933`); only the chat's kind is saved, in
  `chat-kinds.json` (`server/store/chat-kinds.ts`), set when the sdkSessionId arrives (`:1487`).
- Home's Working on (`client/src/shell/Home.tsx:57`) stores a ProjectKey in `projectChoice` and only
  presets Chat for to its client; `send()` (`client/src/store.tsx:1017`) sends `{prompt, client, todoId}`.
- `ProjectsIndex.byKey` resolves moved keys (`server/brain/projects.ts:688`); `ProjectCard` has `folder`,
  `archived`, `status`, `space`, `client`, `title`.
- The brain's save rules (`.claude/rules/save-locations.md` rows 31–35) already say project files go in
  `clients/<client>/projects/<project>/`, and reserve `project.md`, `updates/`, `months/`, `reports/`
  inside a project folder for their own use.
- Files under a project folder are already the project's (`keysForPath`), so the Files tab needs no change.

## Decisions

(Revised after the overseer pre-review, 2026-11-23: blockers B1–B4 and the Should items folded in.)

1. **A chat carries `project` as well as `client`.** `StartSessionRequest.project`, `LiveSession.project`,
   `PastSession.client/project` (all optional; contract `shared/chat-places-contract.ts`).
   `parseStartRequest` (`server/http/routes.ts:544`) copies `project` like `client` (B1), tested through the
   real HTTP gate. The session manager checks the key against the projects index: unknown or archived →
   `bad-request`; a client project with a different `client` → `bad-request`; `client` omitted → filled from
   the project; personal project → client null, kind 'personal'; legacy project → the card's client when it
   is in `Bootstrap.clients`, else null, kind 'tds'. The folder always comes from the index, never the request.
   Plain: the app knows which project a chat is for, and can't be tricked into another folder.
2. **Every place a chat starts passes the project (B3).** `newChat` gains `project?: ProjectKey | null`
   (kept on `NewChat` like `client`) and `send()` sends it. Sources, first match wins:
   (a) a to-do chat (`TodoChatButton`, `TodoPanel`): the to-do's project when `matchedKey(projectMatch)` is a
   live card, and only while the to-do link is kept (`store.tsx:1036`); (b) the project page: a new
   **"New chat for this project"** button (`btn`, small, in the page header) and the existing checklist button
   pass `card.key` and its client; (c) Home: Working on's project, when Chat for still equals that project's
   client (for a personal project, No client). Hand-picking another client in Chat for drops it. Home's scope
   row shows a preset project (a or b) as "Project: <title>" text beside Chat for, so the person can see it.
   Ad Manager's `startChat` calls are unchanged (no project).
   Plain: start a chat from a project, one of its to-dos, or with Working on set, and the chat is for that project.
3. **The scope is saved per chat in the app's data folder** (`chat-places.json`, new
   `server/store/chat-places.ts`, same queue/clean/trim pattern as `chat-kinds.ts`), written when the
   sdkSessionId is known (beside `chatKinds.set`, `session-manager.ts:1487`), removed by `deletePast`. On resume
   the saved client and project are restored and the instructions rebuilt; a moved project resolves through
   `byKey`; an archived or gone project is dropped and the client kept. **Resume never refuses because of the
   scope (B4):** a store or index failure, or a client no longer in the brain, gives today's behaviour. All
   reads happen in the awaited part of `start()`, before the synchronous re-check. Restoring the client on
   resume is a behaviour change the overseer ruled right: today a reopened chat silently loses its client.
   Plain: reopen a chat from History and it still knows its client and project, and reopening never breaks.
4. **What Claude is told in a project chat (B2).** `projectLine` replaces `clientLine`'s reports-first
   sentence; the rest of `clientLine` (read the client's context, keep to that client) stays for client
   projects. Verbatim, with `<title>` cleaned (newlines and backticks removed, cut to `PROMPT_TITLE_MAX`):

   > This chat is for the project "<title>", whose folder is `<folder>/`. Save the documents, pages, decks,
   > images and other files you make for this work in that folder or a subfolder of it, without asking, even
   > where a skill or the brain's save rules would put a client document in `reports/`. Only save somewhere
   > else if the user names another place or says a file is only for them. Never create or use `project.md`,
   > `retainer.md`, `summary.md`, `updates/`, `months/` or `reports/` inside the project folder. These still go
   > where the brain's save rules say: anything with names, emails, phone numbers or addresses
   > (`clients/<client>/crm/data/`), call notes (through the meeting-notes skill), to-dos (through the
   > tdsapp-todo skill, with this project set), dated data pulls (`data/`) and files for an ad platform
   > (`clients/<client>/created/`). When you save a call note, data pull or ad-platform file for this work,
   > link it to the project with the tdsapp-projects skill's `link` action, but never link a file from
   > `crm/data/` or `personal/` to a shared project. Tell the user where each file went.

   For a personal project the `crm/data`/shared-project sentences are left out (its folder never syncs).
   Plain: in a project chat, what Claude makes lands in the project; private data still stays private.
5. **SAVE_LINE and the attachment line learn the project case.** SAVE_LINE's don't-ask list gains "or when
   this chat is for a project (save in its folder as told above)". The attachment filing line (`:424`)
   becomes "…using .claude/rules/save-locations.md and this chat's project folder or client (if set)…".
   Plain: Claude stops asking where to save in a project chat, and still asks everywhere else.
6. **"Which project?" in a client chat with no project.** When the chat has a client and that client has
   live projects not `done`, a `whichProjectLine` lists up to `WHICH_PROJECT_MAX` (title + folder, cleaned
   titles), verbatim:

   > This client has these open projects: <- "<title>" (`<folder>/`) …>. If the user names one of them, treat
   > this work as for that project: save its files in that project's folder by the same rules as a project
   > chat. Otherwise, before saving a new document, page or file the user will keep, ask with AskUserQuestion
   > which project it's for, offering these project folders first and the client's usual folder from the
   > save rules after. When you add a to-do for one of these projects, set its project.

   It says nothing when the client has no open projects. The brain-side rule wording (save-locations.md and
   tds-doc's "Client documents go in…" line) is prepared in `brain-skills/tdsapp-projects/brain-rules/r2-*.md`
   for Ian's yes; not copied in this phase without it.
   Plain: in a client chat, Claude uses the project you name or asks which one.
7. **Mid-chat changes: none.** Client and project stay fixed for the life of the chat, as client is today.
   Plain: to switch project, start a new chat.
8. **Chats drawer: show, don't narrow (overseer ruling c).** Rows show the place as "<Client> · <Project>"
   (via `projectLabel` / `placeName`), for live and past chats. Narrowing by Working on is deferred to a later
   phase: no chat has a saved scope yet, so narrowing would show an empty list and could hide a chat waiting
   for an answer. Help says Chats isn't narrowed by Working on yet.
   Plain: you can see which chats belong to which project.
9. **No new client-guess call (overseer ruling a).** This departs from parent decision 18's "guess both":
   a wrong project guess would file silently, while Claude in the chat can ask (decision 6). The guess
   still runs only with Chat for on Auto. Revisit if Ian finds Claude asks too often.
   Plain: no silent wrong-project filing; Claude asks instead.

## Contract

`shared/chat-places-contract.ts`: the store (`ChatScope`, `ChatScopeStore`), the facts the session manager
needs, reserved names, and the optional fields added to `StartSessionRequest`, `LiveSession` and
`PastSession` in `shared/contract.ts`.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (server) | `builder`, opus | data integrity: request → folder trust boundary, per-chat store, ordering in a 3,000-line `start()` | `server/store/chat-places.ts` (+test), `server/engine/session-manager.ts` (+test), `server/index.ts`, `server/http/routes.ts` (+test), `shared/contract.ts` |
| Builder B (client) | `builder`, sonnet | default | `client/src/store.tsx`, `client/src/shell/Home.tsx`, `client/src/shell/ChatsDrawer.tsx`, `client/src/shell/TodoChatButton.tsx`, `client/src/shell/TodoPanel.tsx`, `client/src/apps/projects/ProjectPage.tsx`, their tests, `help/` text |
| Lead | me | small | `brain-skills/tdsapp-projects/brain-rules/r2-*.md`, plan, explainer |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/store/chat-places.test.ts` | save/read/remove; a bad file is never wiped; trim at max; empty scope removed | A |
| `server/http/routes.test.ts` (or the existing start-route test) | `project` survives `parseStartRequest`; wrong type → 400 | A |
| `server/engine/session-manager.test.ts` | project validated (unknown, archived, client mismatch, personal, legacy); client filled from project; project line present and reports-first gone; personal variant; which-project list (and none when no open projects); resume restores scope; moved key follows; archived dropped; store/index failure on resume still opens the chat | A |
| `client/src/store.send.test.tsx` | Working on project sent when Chat for matches; dropped when hand-picked away; to-do project wins; dropped with the to-do link; project page passes its key | B |
| `client/src/shell/ChatsDrawer` test | project shown on live and past rows | B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (request → folder path; brain text inside Claude's instructions), UX (Home scope row, project page button, Chats rows)
- [ ] Browser check: Working on chat → a short doc lands in the project folder and on its Files tab; a
  tds-doc document goes to the project, not `reports/`; an attachment is filed in the project; a client chat
  with two open projects asks which; a personal project chat; reopen from History keeps the scope.

## Review outcomes

- **Overseer pre-review:** 4 blockers, all fixed in the plan before building: `parseStartRequest` dropped
  `project` (B1); "save everything there" clashed with the brain's skill paths and private data (B2, verbatim
  wording fixed in decision 4); project page and to-do panel entry points were missing (B3); resume must never
  refuse (B4). Rulings: decision 9 upheld (no client-guess extension), restoring the client on resume is right,
  Chats drawer narrowing deferred, Builder A on Opus justified.
- **Builder gaps closed by the lead:** the projects index wasn't exposed to the session manager
  (`BrainReaders.projectsIndex`); to-do chats from the project's own To-dos tab carried no project.
- **Merge with main (v0.64.3, wake-ended-chat):** a woken chat now sends its project too; the saved place wins,
  else the page's client/project are kept when valid and dropped (never refused) when not.
- **Correctness review:** 1 should-fix confirmed and fixed: an older chat woken with a place never saved it (the
  session id doesn't change on resume, so the save on `init` didn't run). 1 consider fixed: Chats labels didn't
  follow a moved project. Test gaps closed for the wake path and moved labels; the project page buttons and the
  to-do-wins-over-Working-on path are covered by the browser check only.
- **Security review:** no findings (folder always from the index; titles cleaned everywhere they enter
  Claude's instructions; private-data sentences present for shared projects; store bounded and never wiped).
- **UX review:** 3 findings fixed (help `reviewed` dates, Projects help names the new button, New chat and Edit
  sit together at the end of the header).
- **Browser check (throwaway copy of the demo brain, real Claude):** New chat for this project → Home shows
  "Project: Winter boiler campaign"; Claude saved the brief in `clients/acme-heating/projects/boiler-campaign/`
  without asking; it shows on the project's Files tab; Chats rows read "Acme Heating · Winter boiler campaign";
  a plain Acme Heating chat asked "Which project is this note of next steps for?" with both projects first;
  a chat ended and reopened from Earlier kept its client and project.
- **Not done here:** the brain-side wording (`brain-skills/tdsapp-projects/brain-rules/r2-chat-project.md`)
  waits for Ian's yes.
