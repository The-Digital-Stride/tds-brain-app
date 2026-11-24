# Client background on projects

Date: 2026-11-24 · Size: L · Branch: `project-business-context` · Explainer: none

## Objective

A client project's Overview shows the parts of the client's `context/business.md` that help the project team
(key facts and a few relevant sections), read live from the brain so they are always up to date. The Brief moves
up to sit straight after Coming up, because it matters more to the project than the client details. This is the
first piece of the client record the app's CRM will later build on.

## User decisions (fixed)

- **business.md is never changed from the app.** Not from a project, a to-do or any other screen, and not through
  a prepared Claude chat either. It changes only in the brain (`client-setup`, `business-context-gatherer`, or by
  hand). This may change in a future feature, not now.
- The project keeps its own profile (card + brief), editable as today with Edit. The business details are pulled
  in beside it, read only. "Updated" means the pulled-in details follow the brain: every open re-reads the file.
- First-release addition: **Key facts strip** only (no freshness warning, no Gaps list, no Since-you-last-looked
  entry).
- Brief goes straight after Coming up.
- No explainer.

## Decisions

1. **New read-only endpoint `GET /api/projects/business?key=`** (`ROUTES.projectBusiness`), served by a new
   `server/brain/project-business.ts` (`createProjectBusiness({ root, index, clients })`), wired as
   `projectBusiness` in `server/brain/index.ts`, routed like `projectMeetings` in `server/http/routes.ts` and
   added to the same route list at ~line 2674.
   Plain: opening a project asks the server for the client's background; nothing is saved anywhere.
2. **Which file.** The project's card is found in the projects index by key (unknown key → `not-found`, as
   meetings). Only `space === 'client'` projects whose client is not `the-digital-stride` get a file; everything
   else returns `state: 'none'`. The client slug comes from the card, must be in `listClients(root)` (so `_archive`,
   dot-folders and unknown names never resolve), and the path is built with `join(root, 'clients', slug, ...)`.
   Archived cards also return `none` (server and page agree). Use `INTERNAL_CLIENT`, not the literal.
   Plain: only live client projects show the card, and the server can only ever open that client's own file.
3. **Safe read (security gate).** One `safeRead(root, slug, rel)` helper for BOTH business.md and profile.md:
   `lstat` must say a regular file, size ≤ `BUSINESS_MAX_BYTES`, and `realpath(file)` must equal
   `join(realpath(root), 'clients', slug, ...rel)` (as `isListableFile`, server/brain/todos.ts:152), so a linked
   client or `context/` folder never reads outside the brain. Read with `fs.open(O_RDONLY | O_NOFOLLOW)` and
   `fh.stat()` so the size cap is exact. business.md failing → `unreadable`; absent → `missing` unless profile.md
   supplies a fact or section. A bad profile.md is simply ignored.
   Plain: a strange or huge file shows a short "can't be read" note instead of breaking the page.
4. **Parser is a pure function** `parseBusiness(businessText | null, profileText | null, services)` in
   `server/brain/business-parse.ts`, returning `{ facts, sections }` exactly per the contract comments: whole-label
   matching with optional list marker, values that wrap over several lines, PLACEHOLDER_STARTS, KEY_FACTS and
   SECTION_RULES `when` by service, `##` vs `###` scoping, `### Contract…` subsections left out, all-placeholder
   sections skipped, frontmatter and HTML comments stripped, `SECTION_MAX_CHARS` cut at a line end. Also
   `profileStatus(profileText)` for `client.status`. Built test first, with fixtures copied in shape (not
   content) from real files: a wrapped value (astrum style), Contracts under Working Relationship, a non-template
   file, `**Target area:**` next to `**Target:**`.
   Plain: about half the clients' files follow the template exactly, so the reader picks out what it can and
   quietly leaves out what isn't there.
5. **Overview order:** Since you last looked → Meetings → Coming up → **Brief** → **Client background** →
   Details → Team → Old checklist. (Activity and meetings stay inside `ProjectActivity`; Brief and the new card
   follow it in `ProjectPage.tsx`'s `Overview`.)
   Plain: the brief is the first thing after what's happening, then who the client is, then the admin fields.
6. **The card** (`client/src/apps/projects/ProjectBusiness.tsx`): heading "About <client name>", a key facts
   strip (a `dl.kv`, as Details uses), then each section in the shell's `Fold` (`client/src/shell/Fold.tsx`),
   `defaultOpen={section.open}` (only "Where they stand" opens), body through the existing sanitised `Markdown`
   component; `cut` adds "Shortened here. Open the business file for the rest." `ok` with nothing picked out:
   "<client>'s business file isn't laid out in the usual way, so nothing is picked out here." plus the Open
   button. Fix the stale comment at `client/src/markdown.tsx:114` (brain text goes through it too). A footer line: "From the client's business file in
   the brain. It's changed there, not here." with an "Open the business file" button that reuses the Overview's
   file-opening path (fallback message as `ProjectActivity`'s `openFile`). No edit or update control anywhere.
   `missing`: "There's no business file for <client> yet. It's made in the brain with client-setup." `unreadable`:
   "The business file for <client> can't be read." `none`: no card. Loading: no layout jump (same pattern as the
   Meetings card); a failed request shows one quiet line, never blocks the page.
   Plain: people see the useful client facts at a glance and can open the full file, but can't change it here.
7. **Fetched once per project open**, like `useProjectMeetings`; not for archived projects (they show no
   activity either), so an archived project also shows no card.
   Plain: no polling and no extra load; reopening the project shows the latest file.
8. **Help:** `help/projects.md` gains a short "About the client" paragraph (UK English) saying where it comes
   from and that it's changed in the brain. Commit as `feat(projects): …` (something new → minor).
   No tour step: it is a card on an existing page, not a new app, rail item or Home feature.
   Plain: the help explains why there's no edit button.

## Contract

`shared/project-business-contract.ts`: constants, `KEY_FACTS`, `SECTION_RULES`, `ProjectBusinessResponse`.
`ROUTES.projectBusiness` added to `shared/contract.ts` by Builder A.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off (domain: product UX + safe reads of shared brain data) | (read-only) |
| Builder A (server) | `builder`, sonnet | default | `server/brain/business-parse.ts`, `server/brain/business-parse.test.ts`, `server/brain/project-business.ts`, `server/brain/project-business.test.ts`, `server/brain/index.ts`, `server/http/routes.ts`, `server/http/projects-routes.test.ts` (new cases only), `shared/contract.ts` |
| Builder B (client) | `builder`, sonnet | default | `client/src/apps/projects/ProjectBusiness.tsx`, `client/src/apps/projects/ProjectBusiness.test.tsx`, `client/src/apps/projects/ProjectPage.tsx`, `client/src/api.ts`, `client/src/apps/projects/testing.ts`, `client/src/styles/projects.css`, `help/projects.md`, `client/src/markdown.tsx` (comment only) |
| Security expert | `expert`, opus | gate: reads brain files by client slug | (read-only) |
| UX/UI expert | `expert`, sonnet | gate: UI change (design-system.md) | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/brain/business-parse.test.ts` | template file → all facts; wrapped value joined; `**Target area:**` doesn't match Target; `- **Main contact:**` matches; `{…}`, "Not provided yet", "N/A" dropped, "Unknown" mid-value kept; profile.md fallback for Main contact; `###` own body, `##` to next `##`; `### Contracts` left out of Working with them; all-placeholder section skipped; Budget section and fact only for ppc; frontmatter/comments stripped; long section cut with `cut: true`; non-template file → no facts, no sections; `profileStatus` | A |
| `server/brain/project-business.test.ts` | personal / TDS / legacy / archived → `none`; client not in `listClients` → `none`; symlinked business.md → `unreadable`; symlinked `context/` folder → `unreadable`; oversize business.md → `unreadable`; oversize profile.md ignored; no file → `missing`; never writes (root unchanged after read) | A |
| `server/http/projects-routes.test.ts` | bad key → 400, non-GET → 405, goes through `checkRequest` | A |
| `client/src/apps/projects/ProjectBusiness.test.tsx` | Overview order Brief after Coming up and before Details; facts strip shows only present facts; `none` shows no card; `missing` words; thin `ok` words; only "Where they stand" open; no edit/update button | B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (port 3646; demo-mode browser check on its own data folder)
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (file reads by client slug), UX/UI
- [ ] Browser check: a client project Overview (PPC and SEO), a TDS project, a personal project, narrow sheet

## Pre-review (overseer + security), applied

Blocking B1-B4 (wrapped values, Contracts under Working Relationship, fees in the strip, thin files) and the
should items (Marketing strategy, whole-label match, more placeholders, Fold with Where they stand open, realpath
check for both files, archived → none, INTERNAL_CLIENT) are in the decisions and contract above. CRM nice items
taken because they cost nothing: `client { slug, name, status }` and `heading` on each section. `updated` time
left out: file mtime isn't a reliable "last changed" after a git sync.

## Review outcomes

- Correctness (opus): 1 confirmed, fixed. A `####` inside `### Contracts` switched the skip off, so fees showed
  under "Working with them" (rubber4roofs, homebrands). `business-parse.ts` now keeps deeper headings skipped;
  the fixture has a `#### Retainer` fee row. Noted, not changed: the Budget section and fact show fees on PPC
  projects, as decided (B3 limits them to PPC).
- Security (opus): 1 confirmed, fixed. The size cap was checked on the stat, not on the bytes read; `safeRead` now
  reads into a fixed `BUSINESS_MAX_BYTES + 1` buffer.
- UX/UI (sonnet): 4 confirmed, fixed. `Fold` takes `level` (section headings are h4 under the card's h3); a failed
  read shows "Try again"; "Open the business file" sits in the card head; the open-failed message names
  Documents. Left: a small layout shift while loading, the same as the other cards.
- Browser check (demo brain, 1280 and 700 px): order Coming up → Brief → About <client> → Details → Team; Open
  the business file opens it in Documents; no contract text in the API answer.
