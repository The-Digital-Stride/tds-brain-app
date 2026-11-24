# Chat summaries as project updates

Date: 2026-11-24 · Size: L (Projects R2, phase 5b) · Branch: `chat-summary-updates` · Explainer: none (Ian: no)

Parent plans: `docs/plans/2026-11-20-projects-system.md` (Release 2), `docs/plans/2026-11-23-projects-r2-updates-log.md`
(the updates log this extends), `docs/plans/2026-11-24-projects-r2-email-entries.md` (the approve-before-save pattern).

## Objective

Project chats live only on the Mac of the person who ran them, so the team loses what was done. A person can
now press **Save to project** in a chat: Claude drafts a summary (objective, outcome, key figures, links to the
key documents, next steps), the person checks and edits it, and it is saved as a `chat` entry in the project's
updates log, which syncs to everyone. After saving, the next steps can be turned into project to-dos. The
entries feed the weekly digest (phase 6), the close-out summary (R4) and client reporting later.

## User decisions (fixed)

- Ian (2026-11-24) agreed every step of the proposal: new `chat` kind in `tdsapp-projects` 0.7, draft from a side
  copy of the chat, review sheet before saving, email rule kept, one chat many entries (only what's new), nudges,
  catch-up on older chats, Updates tab polish. Key figures as structured data: later, not now.
- **Only the person who ran the chat can save its summary.**
- **Next steps are an option after the summary is saved**: they can be built out as to-dos for the project.
- Never save automatically. Client-safe is off by default.
- Merge and push once checks and reviews pass; copy the 0.7 skill and brain wording into the brain after the
  merge (files only, never git), then tell Ian. No explainer.
- Standing rules: the app never writes brain files itself ([[never-write-brain-files]]); nothing from an email
  reaches a project without the inbox owner's approval of exactly what is saved; backward compatible both ways;
  UK English in the UI; reuse design-system components; UX/UI expert sign-off.

## Facts (from the code, 2026-11-24)

- Entries: `brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs` `update()` (~:2308), `writeEntry()` (~:2260,
  flat frontmatter `v, kind, by, at, client_safe` + extra keys), `checkSummary()` (UPDATE_SUMMARY_MAX 5,000),
  `updateRemove()` (~:2325, note/call: author, Owner or scout). `MANUAL_UPDATE_KINDS` ~:182. Capabilities ~:2868.
  SCRIPT_VERSION 0.6.0. Script tests: `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts`.
- Contract for the log: `shared/project-updates-contract.ts`; reader `server/brain/project-updates.ts`; Updates tab
  `client/src/apps/projects/ProjectUpdates.tsx` (`kindWords`, `Markdown`, Seg kind on the add form).
- Chats: one Agent SDK `query()` each (`server/engine/session-manager.ts`, options built ~:2454, `resume` there).
  Places per sdkSessionId in app data (`server/store/chat-places.ts`). Past chats: `listSessions({dir: brainRoot})`
  (`PastInfo.lastModified`). Chat files: `server/engine/chat-files.ts` (`ChatFilesSnapshot`: files, attachments,
  links, pages), built live or from stored history.
- **Spike (2026-11-24, scratchpad):** `query({resume: id, forkSession: true, persistSession: false, maxTurns: 1,
  canUseTool: deny})` answered from the chat's full context ("PELICAN"), `listSessions` showed no new session,
  and `getSessionMessages` on the original showed it unchanged. So a draft never adds a chat to Earlier chats
  and never touches the chat it summarises.
- Side queries already exist: `server/engine/level-picker.ts` (one message, read `result`, timer, `q.close()`).
- To-dos: `TodoAction` `add` with `TodoAddProjectFields` (`shared/contract.ts:569`, `shared/projects-contract.ts:544`).
- The approve-then-save screen to mirror: `client/src/apps/projects/EmailApproval.tsx`. Forms use `useSheetHold`.
- Chat header: `client/src/components/Chat.tsx` (`SheetBar` full screen ~:226, `drawerHead` ~:193).
- `EMAIL_LINE` / `projectLine()` in session-manager tell every chat how updates may be written.

## Decisions

1. **A `chat` entry kind in `tdsapp-projects` 0.7.0.** `update` accepts `entry.kind: 'chat'` with `chat` (a
   session UUID, CHAT_ID_PATTERN) and `title` (one line, ≤ CHAT_TITLE_MAX). It is written like a note
   (same checks, `by`/`at` from the script) with two extra flat keys, `chat:` and `chat_title:` (quoted by
   `yamlText`). Removable like a note (`update-remove`: author, Owner, scout). Capability
   `projects-chat-summary-v1`. SKILL.md documents it and says **Claude never writes a `chat` entry itself**: when
   someone asks to log or summarise the chat on the project, Claude tells them to press Save to project (the
   review step is the point). Older scripts refuse `chat` with `bad-request`, so the app shows Save only with the
   capability.
   Plain: a chat summary is a new kind of project update that syncs to the team like every other entry.
2. **A fixed body layout** (`composeChatSummary` / `readChatSummary` in `shared/chat-summary.ts`, layout in the
   contract): Objective, Outcome, Key figures, Documents (markdown links to brain paths or https), Next steps,
   empty sections left out. Plain markdown, so older apps and Claude (digest, close-out) read it without changes;
   the new Updates tab reads it back for a short card. Names and refs are escaped so a name can't become a link.
   Link and image syntax is escaped in every text field, not only names and refs (overseer should 2: the text
   comes from chat content, and the renderer allows `src`). On save the route re-reads the body with
   `readChatSummary` and refuses a body that isn't the layout, a ref that isn't https or a brain path the
   library resolves, or a `personal/` ref on a shared project (overseer should 3).
   Plain: every summary reads the same way, so a year of them is easy to scan and report on.
3. **Only the chat's creator can save.** The `projectsChange` route refuses a `chat` entry unless
   `sessions.ownsChat(chat)` (live in this app with that sdkSessionId, or in `listSessions` for this brain).
   Chats are never shared between Macs, so this is the person who ran it; `by` is always this Mac's identity
   (the script's). The draft route checks the same. Save shows only in the creator's own app.
   Plain: nobody can save a summary of a chat they didn't have.
4. **The draft comes from a side copy of the chat** (`server/engine/chat-summary.ts`). `POST
   ROUTES.chatSummaryDraft {chat, project}`: refuse unless owned (3), the project is live with a card and the
   capability is present and this person may change projects, and the chat isn't replying or waiting (`busy`).
   One draft per chat at a time (`busy`); a chat that is closing counts as busy. It runs `engine.query` with
   `resume: chat, forkSession: true, persistSession: false, maxTurns: 1, tools: [], settingSources: []`, no MCP
   servers, cwd the brain, the chat's model, env and Claude Code path, timeout CHAT_DRAFT_TIMEOUT_MS, `q.close()`
   in `finally`, and fails if any `tool_use` appears (overseer blocking 1-2: `canUseTool` doesn't stop
   allowed tools, and loading settings would run the brain's own hooks, `sync.sh` and the usage log, on every
   draft). **Spike 2 (2026-11-24):** a fork with `tools: []` of a chat that had used Read answered from its
   history (`{"budget":"4200 GBP"}`), no tool call, no new session; the prompt cache was not reused (9.6k
   tokens written for a tiny chat), accepted. A chat too long to fork gets its own message. The fork keeps
   the chat's recorded system prompt (EMAIL_LINE included, overseer blocking 3), so the draft message itself
   says: this is a draft the person reviews before anything is saved, nothing is saved by you, you may
   include what came from their own email because they approve it on the review screen. The prompt (one user message) gives the
   project's title, the candidate documents (from the chat's files snapshot: made or changed files, attachments
   filed in the brain, pages, web links; at most CHAT_DOCUMENTS_CANDIDATES, each with a number), and, when this
   person saved this chat here before (all their `chat` entries for it scanned, not one page), the newest
   earlier summary's text with "write only what is new since then". It asks for one JSON object `{objective,
   outcome, figures[], documents: [numbers], nextSteps[], fromEmail, nothingNew}` and tells Claude to use only facts from the chat, give figures with their units, and not use
   tools. `parseChatDraft` (pure, tested) takes the first JSON object in the reply, cuts every field to its
   limit, keeps only document numbers from the list, and fails as `internal` ("Claude couldn't write a summary
   this time. Try again.") on anything else. Demo mode answers a fixed draft.
   Plain: Claude writes the first draft from everything in the chat, without changing the chat or adding a new one.
5. **Documents are never invented.** The draft only ticks or unticks candidates from the chat's own files list;
   the review sheet shows all candidates (Claude's picks ticked) and the person can untick any. Brain files must
   still resolve through the library (`chat-files.ts` already only reports files the person can open). A file
   under `personal/` can't be linked from a shared project (shown unticked and disabled, "Only on your Mac"), as
   the project-chat rules already say.
   Plain: the links in a summary always point at real files from that chat.
6. **The email rule.** If the chat used email (Claude's `fromEmail`, OR an email tool, such as a Gmail MCP
   tool, in the chat's history: overseer should 4), `fromEmail` is true; the review sheet then says "Some of this
   came from your email. Saving it here is your OK for exactly this text." Only the chat's creator can save (3),
   and their chat could only read their own inbox, so the inbox owner approves exactly what is saved. `EMAIL_LINE`
   gains one sentence: a chat summary saved through Save to project is the owner's approval route. If the
   draft says nothing about email the sheet adds nothing. The draft prompt also says to name people, never
   email addresses.
   Plain: summaries of email work still need the email owner's yes, and they give it on the review screen.
7. **One chat, several entries, never rewritten.** Earlier summaries of a chat are found by the entries' `chat:`
   key in the project's updates, by this person. The draft covers only what's new since the newest; the sheet
   says "You saved this chat on 24 Nov. This summary covers what's happened since." Nothing is edited; a wrong
   entry is deleted and saved again (existing Delete).
   Plain: a long chat becomes a clear diary, and old entries stay as they were.
8. **The review form** (`client/src/apps/projects/SaveToProject.tsx`, mirrors EmailApproval) **lives on the
   project's Updates tab, with the chat open in the chat drawer beside it** (overseer ruling: where
   EmailApproval and `useSheetHold` already live, Projects already opens chats in the drawer, and the person
   lands where the entry appears). A **Save to project** button in the chat header (full screen bar and drawer
   head) shows only when `ProjectList.canSaveChat`. It picks the project first when the chat has none (live
   projects this person can change, the existing picker), then sets `saveChatRequest`, opens the project's page
   and keeps the chat in the drawer. The Overview's "Chats not saved yet" opens the form directly. Form flow:
   "Claude is writing a summary…" (Cancel), then every section editable (objective, outcome, key figures one per line, documents as
   checkboxes, next steps one per line), "Fine to share with the client" off, Save / Cancel. Uses
   `useSheetHold`, Fold/btn/notice from `docs/design-system.md`. Save sends `projectsChange` with the composed
   body. A disabled Save says why (objective or outcome empty, too long).
   Plain: you see and can change every word before it goes on the project.
9. **Next steps → to-dos, after saving.** The sheet turns into "Saved to <project>'s updates." plus, when there
   are next steps and to-do adds are possible, "Make to-dos from the next steps?": each step a row with a tick
   (off), its title editable, and an assignee (me by default, the project team listed first). "Add to-dos" adds
   the ticked ones one at a time through the existing to-do `add` with the project set and details "From the chat
   summary saved on <date>." It reports how many were added and names any that failed; "Done" closes. 
   Plain: the next steps can become real to-dos on the project with one click, and only the ones you tick.
10. **Nudge.** The project Overview gets a "Chats not saved yet" card (ROUTES.projectUnsavedChats): this
    person's chats for this project with new messages since their last summary (counted, not timed: see the
    contract), up to 5, each with Save to project. Hidden when empty or `canSave` false. **Cut (overseer
    blocking 4): an End chat prompt.** The confirm only shows while a chat is replying, exactly when a draft
    can't run; idle chats end with no confirm.
    Plain: the app reminds you about project chats you haven't logged, without saving anything for you.
11. **Older chats.** Anything in Earlier chats that is on this Mac can be saved: the draft forks a past chat just
    like a live one, so the Overview card and a reopened chat both work. Chats with no saved place show Save to
    project with the project picker.
    Plain: last month's chats can still be logged.
12. **Updates tab.** `kind: 'chat'` shows as "Chat summary"; its card shows Objective and Outcome, with the rest
    in a Fold ("More"); Documents links open in the viewer drawer (brain paths) or a new tab (https). "Open chat"
    shows when `chatOpenable` (reopens it). A body that isn't the layout falls back to plain markdown. `chat`
    joins `MANUAL_KINDS` in `server/brain/project-updates.ts` for `canRemove`, only with the capability.
    **Cut (overseer): a Kind filter.** The list pages at 50, so a client-side filter would wrongly say "none";
    a server-side filter belongs with phase 6.
    Plain: a project's diary shows what each chat was for and how it ended, at a glance.
13. **Help and What's new.** Update the Projects updates help page and the chat help page (350-word cap),
    and reword the existing `projects` tour step to mention saving chats (no new step, no TOUR_VERSION bump:
    the chat header isn't on screen during the tour, overseer). Commit type `feat`.
    Plain: people can find out how it works.

## Backward compatibility

- Old files → new code: entries without `chat:` read as before. New reader ignores unknown keys as before.
- New files → old readers: an older app shows a `chat` entry as kind "Chat" with the markdown body (kind is
  plain text since 0.4). The Workbench and the Reminders sync don't read updates. The brain's digest/meeting
  skills read bodies as text.
- Old/new app ↔ old/new script: the app offers Save only with `projects-chat-summary-v1`; an older app never
  sends `chat`; the 0.7 script still accepts every 0.6 call. To-dos use the existing `add` unchanged.
- Stricter checks: the route's ownership check (3) only applies to the new kind.

## Contract

`shared/chat-summary-contract.ts`. Additions to `ProjectUpdateItem` are `ChatUpdateFields`; ROUTES additions are
listed at its foot. `ProjectUpdateAction.entry` gains `ChatSummaryEntryInput` (Builder B edits
`shared/project-updates-contract.ts`).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, sonnet | default (about 40 lines following `emailLines`, tests named) | `brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs`, `brain-skills/tdsapp-projects/SKILL.md`, `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts`, `brain-skills/tdsapp-projects/brain-rules/r2-chat-summaries.md` (new), `brain-skills/tdsapp-projects/brain-rules/README.md` |
| Builder B1 | `builder`, opus | engine with tricky rules + safety: the side copy of a chat must never run tools or hooks; route ownership and save validation | `server/engine/chat-summary.ts` (new) + test, `server/engine/session-manager.ts` (`ownsChat`, draft hook, busy/closing state, EMAIL_LINE sentence) + its test, `server/engine/demo-engine.ts`, `server/store/chat-summaries.ts` (new) + test, `server/http/routes.ts` + `routes.test.ts`, `server/http/security.ts` only if needed, `shared/contract.ts` (ROUTES only) |
| Builder B2 | `builder`, sonnet | default (pure logic tests first) | `shared/chat-summary.ts` (new) + test, `shared/project-updates-contract.ts`, `shared/projects-contract.ts` (`canSaveChat`), `server/brain/project-updates.ts` + test, `server/brain/projects.ts` + test, `server/brain/projects-skill.ts` |
| Builder C | `builder`, sonnet | default | `client/src/components/Chat.tsx` (header button + project picker), `client/src/state/save-chat-request.ts` (new) + test, `client/src/api.ts` + `api.test.ts`, `client/src/styles/chat.css` |
| Builder D | `builder`, sonnet | default | `client/src/apps/projects/SaveToProject.tsx` (new) + test, `client/src/apps/projects/ProjectUpdates.tsx` + test, `client/src/apps/projects/ProjectUnsavedChats.tsx` (new) + test, `client/src/apps/projects/ProjectPage.tsx`, `client/src/apps/projects/ProjectsSheet.tsx`, `client/src/styles/projects.css`, `help/*.md`, `client/src/tour/steps.ts` (wording only) |

No file appears in two rows. D imports C's api functions and `takeSaveChatRequest` by the contract's names;
B1 imports B2's `readChatSummary`. Order: B2 and A first (small), B1, C, D in parallel against the contract.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts` | `chat` entry written with `chat`/`chat_title`; bad id, empty/long/multi-line title refused; quoting of a title with `:` or `"`; removable by author only (+Owner/scout); capability listed; 0.6 calls unchanged | A |
| `shared/chat-summary.test.ts` | compose layout and order, empty sections dropped, link/markdown escaping, round trip through `readChatSummary`, non-layout body → null, result ≤ UPDATE_SUMMARY_MAX for maximal fields | B |
| `server/engine/chat-summary.test.ts` | `parseChatDraft` limits, invented document numbers dropped, junk → error, nothingNew; draft query options (`resume`, `forkSession`, `persistSession:false`, `tools: []`, `settingSources: []`, no mcpServers, maxTurns 1); a `tool_use` in the stream fails the draft; busy while working/waiting/closing; one draft per chat; timeout closes the query; earlier summary text sent; email tool in history sets fromEmail | B1 |
| `server/http/routes.test.ts` + a `checkRequest` test for the new POST | chat entry refused when `ownsChat` is false; save refused for a non-layout body, a bad ref, a `personal/` ref on a shared project; draft route errors; unsaved chats (count rule, "save then end → not listed", moved_from keys, days) | B1 |
| `server/store/chat-summaries.test.ts` | record per chat+project, bad read never wipes, queued writes | B1 |
| `server/brain/project-updates.test.ts`, `server/brain/projects.test.ts` | `chatId`/`chatTitle`/`chatOpenable` read; `chat` removable only with the capability; `canSaveChat` | B2 |
| `client/src/api.test.ts` | new POST passes the real `checkRequest` headers | C |
| `client/src/state/save-chat-request.test.ts`, Chat header test | request set/take/clear; button only with `canSaveChat`; picker when the chat has no project | C |
| `client/src/apps/projects/SaveToProject.test.tsx` | loading/cancel; edit + Save sends composed body; client-safe off by default; fromEmail notice; earlier/nothingNew notice; to-dos step only ticked steps, assignee, failures named | D |
| `client/src/apps/projects/ProjectUpdates.test.tsx`, `ProjectUnsavedChats.test.tsx` | chat card + Fold, fallback, Open chat only when openable; unsaved card hidden when empty | D |

## Gates

- [x] Type-check · [x] Tests (306 files, 6,123 tests) · [x] Lint · [x] Build (preview on port 3878, own data folder, demo mode)
- [x] No unintended large deletions (none over 40 lines): `git diff origin/main --numstat | awk '$2 > 40'`
- [x] Domain gates: security (new route, ownership, fork safety, email rule), UX/UI expert sign-off
- [x] Browser check (demo mode, 1440 and 1100): Save to project from a chat (with and without a project), review, save, to-dos step; Updates
      tab card; Overview "Chats not saved yet"
- [x] Real-engine check (not demo): a draft of a real project chat writes no usage-log line and runs no brain
      sync (overseer blocking 2); a chat that read email gives a draft, not a refusal (blocking 3)

## Review outcomes

**Overseer pre-review (Fable):** 5 blocking, all taken before building: the fork bans tools with `tools: []`
(not `canUseTool`) and loads no settings (`settingSources: []`, else the brain's `sync.sh` and usage hooks run
per draft); the draft message itself says it is a reviewed draft (the fork keeps the chat's recorded system
prompt, EMAIL_LINE included); the End chat prompt was cut (the confirm only shows while a chat replies);
`ProjectList.canSaveChat` added. Rulings: review form on the Updates tab with the chat in the drawer; Kind filter
and tour step cut; script checks shape only; team re-split (B1 Opus, Builder A Sonnet).

**Spikes:** fork with `persistSession:false` sees the whole chat, adds no session, leaves the original unchanged;
a `tools: []` fork of a chat that used tools answers from history.

**Real-engine check (2026-11-24, Sonnet, throwaway folder with SessionStart/UserPromptSubmit/Stop/SessionEnd
hooks):** the chat fired 4 hooks, the draft fired none; session count unchanged; a chat carrying EMAIL_LINE drafted
the email's facts (£5,000, 10 December) with `fromEmail: true`, no refusal. The prompt cache isn't reused by the
fork (one uncached read at the chat's model per draft), accepted.

**Correctness review (Opus):** 3 confirmed, fixed with tests: a title holding both `"` and `'` could never be
saved (`writableChatTitle`); Save recorded the message count at Save, not at draft, so messages sent while
reviewing counted as saved (count kept per chat+project at draft); a second save request replaced a form being
edited without asking (now through the page's leave guard).

**Security review (Opus):** 1 confirmed (consider), fixed with a test: a web address glued to a word
(`foo_https://…`) still autolinked in the escaped body for older apps; `\b` dropped from the escapes. Fork,
ownership, frontmatter, refs, email route and request gate found sound.

**Lead's browser check (demo mode, 1440 and 1100):** whole flow works (Overview card → chat → draft → review →
save → to-dos → card). Fixed: the list didn't show the new entry until Done (`onSaved`); the chat drawer had to
be allowed beside Projects (`drawerView`, store.tsx), which `store.tsx` cleared on every non-tool view.

**UX/UI expert (Opus):** signed off once blocking fixed. B1 drawer hid the right of the form and the assignee
picker → Projects reserves the drawer's room when both fit, the drawer opens narrower from Save without saving
that width, a container query wraps the to-do row; B2 busy button `aria-disabled`. Should S1–S7 and nice N1, N3
fixed in the same round; N2 (form card tray alignment, older pattern) and N4 ("Not for a project" on the Overview
card) left for later.
