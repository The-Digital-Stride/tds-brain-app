# Home: recent tasks, chats, documents and images

Date: 2026-11-25 · Size: L · Branch: `home-latest-cards` · Explainer: none

## Objective

Add four Home cards that show what is newest without anyone pinning it: Recent tasks, Recent chats, Recent
documents and Recent images. They sit beside the existing Pinned cards and the existing Recent projects card.

## User decisions (fixed)

- "Latest projects" is already covered: keep the existing **Recent projects** card as it is.
- "Latest files" means **images**: one card for the newest library documents, one for the newest library images.
- No visual explainer.
- Base branch: `main`.

## Facts (checked in code)

- Cards are drawn in `client/src/shell/Home.tsx` through `order.place([...])`; the list of cards a person can hide
  is `client/src/shell/home-items.ts` and `HOME_ITEM_IDS` in `shared/contract.ts:1159`. `HOME_CARDS` in `Home.tsx`
  is the default order. A saved card order that lacks a new id puts it at the end (`state/card-order.ts`).
- Ids in `homeHidden` are checked by pattern on the server (`HOME_ITEM_ID_PATTERN`), so new ids need no server
  change to be hidden; an older server keeps them.
- Pinned files are looked up with `api.libraryItems` and opened with `dispatch({ type: 'open-viewer', … })`
  (`Home.tsx`). A hidden Pinned files card skips its fetch.
- Library search (`server/brain/library.ts:1094`) gathers every scope's cached listing (stale is fine, refreshed
  behind), builds cold scopes three at a time within a 1.5 s budget, then answers with `partial`. Items carry
  `modified` (ISO). `projectKeysFor()` maps a path to its project keys. Route: `server/http/routes.ts:2250`.
- Tasks: `TodoItem.created` is frontmatter `created` as written (in the brain: `YYYY-MM-DD`), `surfaceDate` is the
  file name's date. Home lists `todos.mine` and `todos.open`.
- Chats: `LiveSession.lastActivityAt`, `PastSession.lastModified`; a chat open and earlier at once shows once
  (`pinnedChats` in `state/home-pins.ts`). Both carry `project` (absent from older servers).
- Working on (`useProjectChoice`) narrows Home's cards: tasks by `todoProjectKey`, files by `item.projects`.
- Tour: `TOUR_VERSION = 3`; the `cards` step covers Home's cards. Ian's rule: a new Home feature updates the tour
  and shows it again (memory "tour keeps up with features").

## Decisions

Overseer pre-review (2026-11-25) confirmed 2, 7 and 9, changed 4, 5, 6 and 7, and added 10-13; noted inline.

1. **Four cards, named "Recent …"** to match Recent projects: Recent tasks (`recent-todos`), Recent chats
   (`recent-chats`), Recent documents (`recent-documents`), Recent images (`recent-images`). Each gets a row in
   `home-items.ts` and an id in `HOME_ITEM_IDS`.
   Plain: four new cards, worded like the projects card already there.
2. **Shown by default**, like every other card (plan 2026-11-25-home-card-library decision 4). Anyone can hide
   them in Customise Home. *(Overseer: confirmed; no new pref key, which an older server would refuse. What's new says how to hide them.)*
   Plain: everyone sees the new cards after the update and can switch off the ones they don't want.
3. **Default order: each Recent card after its Pinned twin.** `meetings, ads, todos, recent-todos, projects,
   chats, recent-chats, files, recent-documents, recent-images, skills`. Someone who has dragged their cards gets
   the new ones at the end.
   Plain: pinned and recent versions of the same thing sit side by side.
4. **Recent tasks:** open tasks Home already has (yours plus ones open to anyone), **TDS scope only** (personal
   tasks left out, rule of decision 10), newest first by the task's "arrived" date: the handover date when it was
   passed to you after it was made, else `created` (first 10 characters, when a `YYYY-MM-DD` date), else
   `surfaceDate` only when it is today or earlier; undated last; ties by title. Meta: "Added 24 Nov" or "Passed to
   you 24 Nov", then the client or project, joined with ", ". *(Overseer S1, S2, S4.)* Narrowed by Working on. Row opens the task as
   Pinned tasks does. Star shows on or off. Head button "All tasks". Empty: "No tasks yet." / in a project:
   "No tasks in this project."
   Plain: the newest tasks, including ones you didn't pin.
5. **Recent chats:** open and earlier chats together, newest activity first (`lastActivityAt` /
   `lastModified`), one row per chat. Open chats keep their state dot and words; earlier ones show when.
   **Not narrowed by Working on**, as Pinned chats and the Chats drawer aren't *(Overseer S3)*. Star shows its real
   state; a chat without a lasting id gets none *(S5)*. Head button "All chats". Empty: "No chats yet."
   Plain: pick up where you left off without opening the Chats drawer.
6. **Recent documents and images: one new read-only route.**
   `GET /api/library/recent?kind=doc|image[&project=<key>]` → `LibraryRecentResponse` (contract). The library
   gets `recent(kind, project?)`, sharing search's listing-gathering (same budget, stale-and-refresh,
   `partial`), sorted by `modified` newest first, ties by path, at most `LIBRARY_RECENT_MAX` (20). The project
   filter runs before the cap, using `projectKeysFor`. Only scopes the person can see; never the file's real
   location. **Personal-scope files are left out on the server** *(Overseer B1)*. **With `project` and no project
   index (`projectKeysFor()` null), the answer is no files**, never the unfiltered list *(B3)*. Bad `kind` or a `project` that fails the project-key pattern → 400.
   Plain: the app asks for the 20 newest files of one kind, across every folder you can see.
7. **Client fetch:** one request per card, skipped while that card is hidden, redone when the library changes
   (`libraryVersion`) or Working on changes. Old rows stay while a new request runs. Loading, empty and failed are
   three states. **A `partial` answer is asked again every second, up to five more times** (the palette's rule,
   `state/palette.ts:11`), and the loading note stays until rows arrive *(Overseer B2)*. A reply for an older
   kind/project is dropped. An older server answers 404: the card shows its failed note ("Couldn't load recent documents.").
   Rows show the title and "<scope>, changed 24 Nov" *(S4)*, open the file viewer as Pinned files does, and carry the file star.
   Head buttons "All documents" / "All images" open those apps.
   Plain: the cards only ask for files when they're on show, and update when files change.
8. **Five rows, then "Show N more"**, as the Pinned cards; a Recent card never holds more than 20 rows.
   Plain: Home stays compact, with more one click away.
10. **Private things stay off Home unasked.** Recent documents, images and tasks never list personal-scope items
    (the app's rule: "private titles are never on screen unasked", `apps/shared/library.ts:9`). Pinned cards still
    show personal things the person pinned.
    Plain: your private file and task names don't appear on Home unless you pinned them.
11. **No de-duping against Pinned cards.** A pinned thing can also be recent; its star shows on. Cards hide
    independently, so a de-duped list would have holes.
    Plain: each card is complete on its own.
12. **Tour v4 replays the tour for everyone**, including people who saw v3 today. Tell Ian in the hand-off.
13. **Nice, if cheap:** a small thumbnail on Recent images rows (`apps/shared/Thumb.tsx`). *(Overseer N1.)*
9. **Tour, help, What's new, docs.** The `cards` tour step mentions the recent cards; `TOUR_VERSION` 3 → 4 with a
   fourth `TOUR_HISTORY` line. Update `help/home.md` and `help/customise-home.md`, add a What's new line, and add
   the route recipe to `docs/customising-home.md`. Commit type `feat`.
   Plain: the help and tour say the new cards exist.

## Contract

`docs/plans/2026-11-25-home-recent-cards-contract.ts`

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, sonnet | default; a listing sort, no tricky rules | `shared/contract.ts`, `server/brain/library.ts` (+`library-search.test.ts` or new `library-recent.test.ts`), `server/brain/index.ts`, `server/http/routes.ts` (+`routes.test.ts`), new `server/http/library-recent-routes.test.ts`, any brain test fakes needing the new optional method |
| Builder B | `builder`, sonnet | default (UI) | `client/src/api.ts`, `client/src/state/home-pins.ts` (+test), `client/src/shell/home-items.ts`, `client/src/shell/Home.tsx` (+`Home.test.tsx`), `client/src/styles/home.css` if needed, client test kit fakes |
| Lead | — | small text changes | `client/src/tour/steps.ts` (+tests), `help/*.md`, What's new, `docs/customising-home.md`, `docs/design-system.md` |

A owns `shared/contract.ts` and adds exactly the contract's names first; B builds against the contract.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| library recent test | newest first across scopes; kind filter; project filter before the cap; cap 20; cold scopes past budget → `partial` | A |
| `routes.test.ts` / route test through `createAppServer` | 400 on bad kind and bad project; 200 shape; missing brain method → empty | A |
| `home-pins.test.ts` | `recentTodos` order (created, surfaceDate, undated last, title tie); `recentChats` order, dedupe, project narrowing | B |
| `Home.test.tsx` | each card's rows, empty and failed states; hidden card makes no request; Working on narrows; Show more | B |
| `steps.test.ts` | version 4 and history line | Lead |

## Gates

- [ ] `pnpm check` (typecheck, tests, lint, build)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Security light-touch on the new route (input from the browser; lists files)
- [ ] UX/UI expert against `docs/design-system.md`
- [ ] Browser check in demo mode on 3878: Home wide and narrow, each card, hide one, Working on

## Review outcomes

Build: Builder A (Sonnet) server, `gatherListings` shared with search; Builder B (Sonnet) cards and list logic; lead
added the shared names, tour v4, help, What's new 0.88.0, playbook. One Sonnet fix agent for the review round.

- **Security (Opus):** no findings. Side note fixed by the lead: `recent` filtered personal scopes only after
  gathering, so a slow personal folder could still make the answer partial; `gatherListings(include)` now leaves it
  out before any build (test seen failing first).
- **Correctness (Opus):** 2 confirmed, both fixed with tests seen failing first. A failed request after switching
  Working on kept the previous project's files under the new one; "Passed to you" showed for tasks opened to
  anyone and ones the person took themselves (now only assignee = me and passed by someone else). Untested retry
  rules (stop after 6 calls, timer cleared when hidden, library change re-asks) now have tests.
- **UX/UI expert (Opus):** no must-fix. Fixed: starring a Recent row could push it down when its Pinned twin grew
  (scroll held in place); an empty card after a failed or unfinished answer said "No documents yet." (now the
  failed note); file meta now date first ("Changed 24 Nov, Acme Heating"); Recent tasks shows due/overdue like
  Pinned tasks; tour says "the newest tasks". Not built: image thumbnails (decision 13; the thumb style lives in the
  lazy-loaded library CSS). Advice noted for Ian: 9-11 cards by default is busy.
- **Browser check (lead, demo mode, 1440 and 900 px):** all four cards fill with real rows beside their Pinned
  twins; a star press pins the file into Pinned files, the row stays and focus stays on the star; no sideways
  scroll; no console errors.
