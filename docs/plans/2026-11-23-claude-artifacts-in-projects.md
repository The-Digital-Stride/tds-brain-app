# claude.ai artifacts in projects

Date: 2026-11-23 · Size: L · Branch: `claude-artifacts-in-projects` · Explainer: no (Ian) · Status: planned,
overseer pre-review folded in (revision 2), not built

## Objective

Let a claude.ai artifact be added to a project and shown in the app exactly like a document or image: listed in the
project's Files tab, opened in the same viewer, with a way back to the original on claude.ai.

## User decisions (fixed)

- Scope: Phase 0 checks + Phase 1 (copies show like docs with "Open on claude.ai"; artifacts that can't be copied
  show as link cards; paste a link in the project's Files tab). "Refresh copy" is a later phase (Ian, 2026-11-23).
- No explainer (Ian, 2026-11-23).
- The app never writes brain files itself: every write goes through a brain skill (memory "Never write brain files").
- Backward compatibility first: old files, callers and app versions keep working.
- UK English in the UI; every UI change follows `docs/design-system.md` and gets a UX/UI expert sign-off.
- Base branch `main`. No new paid services or infrastructure.

## Facts (checked 2026-11-23)

- **claude.ai can't be framed.** `curl -D -` on `https://claude.ai/artifact/<id>` and
  `https://claude.ai/code/artifact/<id>`: `content-security-policy: frame-ancestors 'self' chrome-extension://…`
  (two Anthropic extensions). The page's content host `https://<id>.frame.claudeusercontent.com` sends
  `frame-ancestors <itself> https://claude.ai https://*.claude.ai chrome-extension://…`. The old public embed
  `https://claude.site/public/artifacts/<id>/embed` sends `x-frame-options: SAMEORIGIN` and `frame-ancestors 'self'
  *.anthropic.com anthropic.com *.claude.com claude.com *.ant.dev`. `frame-ancestors` also governs `<embed>` and
  `<object>`. Artifacts are private and need the person's claude.ai login, which browsers withhold from third-party
  frames anyway. The app's own policy (`server/http/security.ts:21`, `default-src 'self'`, no wider `frame-src`)
  would also refuse the frame.
- **HTML already shows like a doc.** `server/brain/library-rules.ts:70-71`: `html`/`htm` are `kind: 'document'`,
  `format: 'doc'`, `view: 'page'`. A successful `GET /api/library/page/<id>` is served under `PAGE_PREVIEW_CSP`
  (`server/http/security.ts:60`): `sandbox allow-scripts allow-popups`, scripts only from claude.ai's own allowed CDN
  hosts, no fetches. Links open in a new tab through the served link script and `usePageLinks`
  (plan `2026-11-15-pages-hardening`, decision 1). `PAGE_MAX_BYTES` is 5 MB (`server/brain/library.ts:49`).
- **Projects list a folder's own files and linked files** (`server/brain/library.ts:1200-1233` `projectFiles`), by
  kind, so an `.html` file in the project folder or linked to the card already appears under Documents in the
  Files tab.
- **claude.ai addresses are already validated** by `isArtifactUrl` (`shared/pages.ts:14-19`,
  `^https://claude\.ai/(?:code/)?artifact/[A-Za-z0-9-]{1,64}/?$`, tested in `shared/pages.test.ts`). The links
  `Artifact` `list` gives today are `https://claude.ai/artifact/<22 letters and digits>`, which pass.
- **"Open on claude.ai" and the "only works on claude.ai" note already exist** for chat pages
  (`client/src/shell/PageStage.tsx:303`, `:343`): an `<a class="btn" target="_blank" rel="noopener noreferrer">` with
  a hidden "(opens in a new tab)".
- **Where the UI lives** (overseer B2): the viewer's header and buttons are in `client/src/shell/FileViewer.tsx`
  (`Viewer.tsx` is only the stage); "Add files" is in `client/src/apps/projects/ProjectPage.tsx:690`; the Files list's
  place headings come from `placeIn` (`client/src/apps/projects/ProjectFiles.tsx:383`); archived and no-card projects
  hide change actions (`ProjectPage.tsx:321`).
- **The app's chats can't read claude.ai artifacts.** The Agent SDK sessions have no Artifact tool (plan
  `2026-11-14-artifacts-in-app`, Revision 2; memory "SDK has no Artifact tool"). The terminal Claude Code has
  `Artifact` `read`.
- **Adding files to the brain** goes through `brain-skills/tdsapp-files` (`SCRIPT_VERSION` 0.3). Its `add` allows only
  `clients/<c>/files|images/` and `personal/files|images/` and refuses `.html` (`addTargetOf`,
  `scripts/tdsapp-files.cjs:768`). The app reaches the script through `server/brain/files-skill.ts` (fixed `COMMAND`
  list, `FILES_ADD_CAPABILITY`).

## Options considered

| Option | Verdict |
|---|---|
| iframe the claude.ai link | Impossible: claude.ai's `frame-ancestors` refuses every site but its own. |
| `<embed>` / `<object>`, or the old claude.site embed | Impossible: same rule; the embed route is also locked and public-only. |
| Server fetch or proxy using a stored claude.ai login | Rejected: stores a claude.ai session in the app, fights Cloudflare bot checks, breaks on any claude.ai change. |
| Browser extension or wrapper that strips the header | Rejected: fragile, per machine, works around another site's security rule. |
| **Copy in, link out** | **Chosen**: works offline and without a login, survives claude.ai changes and deletion, reuses the reviewed viewer and sandbox, adds no file type. |

## Phase 0: checks (lead, 2026-11-23)

- **P1. Headless `claude -p` and `Artifact` `read`:** not checked. Only Phase 2 ("Refresh copy" in the app) needs it.
- **P2. Multi-file and typed artifacts:** checked on one of Ian's own. `Artifact` `read` on a plain web page returns
  one full page and says "no runtime capabilities declared". `list` `scope: "files"` on a Sheets artifact shows a type
  ("Sheets"), 38 files (fonts, wasm, scripts) and declared capabilities (assets, comments, mcp, room, user…). Under
  `PAGE_PREVIEW_CSP` a copy can load none of those. **Rule (overseer ruling b): copy only a page whose read says no
  runtime capabilities, no type, and no published files besides the page itself; everything else is a link card.**
  This replaces the `window.claude` text search (overseer N1: a text search under-reports).
- **P3. HTML download from claude.ai:** not confirmed. Following the overseer's B3, **Phase 1 drops the form's file
  field and the staged-upload path**; copies come in through Claude Code only. Revisit in Phase 2.
- **P4. Full page or fragment:** a full page. The stored HTML starts with claude.ai's own skeleton
  (`<!doctype html><html><head><meta charset=utf8>…</head><body><title>…`), so the doctype is always there and
  `pageTitle` still finds the `<title>` (it searches the whole first `TITLE_SCAN_BYTES`).

## Decisions

1. **An artifact in a project is an ordinary `.html` file** in `<project folder>/files/` (overseer ruling a): exactly
   `clients/<client>/projects/<slug>/files/<name>.html` or `personal/projects/<slug>/files/<name>.html`, one level
   deep. The project folder must exist; `files/` is made if missing. No new extension, no new `FileClass`.
   `placeIn` shows a project's `files/` and `images/` under "In the project folder", not under a heading "Files".
   Plain: it lists, filters, searches and opens exactly like any other document in the project.

2. **The source travels inside the file.** Tags in the exact form
   `<meta name="tds-artifact-source" content="…">`, `<meta name="tds-artifact-copied" content="YYYY-MM-DD">`,
   `<meta name="tds-artifact-kind" content="copy|link">` and, only when asked, `<meta name="tds-artifact-live"
   content="partial">`, written as one block at `linkScriptOffset(html)` (`shared/page-links.ts`): after a leading
   doctype, else at the start (overseer ruling c). The HTML parser puts a leading `<meta>` in the head, so no head is
   found or made, and no existing tag is rewritten: the reader takes the first match, so the skill's block always
   wins. The exact block text is in the contract (`artifactMetaBlock`), shared by writer and reader. No sidecar file.
   Plain: the copy remembers where it came from and when, and moving or renaming it can't lose that.

3. **Reading the source (pure, `shared/pages.ts`).** `artifactSource(head: string): ArtifactSource | null` reads only
   the first `ARTIFACT_HEAD_BYTES` (64 KB), matches only the exact written form (never parses a DOM), accepts the
   address only when `isArtifactUrl` passes, the date only when it is a real calendar `YYYY-MM-DD`, the kind only when
   it is `copy` or `link`. Anything else gives `null` or drops that field. Table tests.
   Plain: a page can't fake a link to some other website by putting odd tags in its head.

4. **The library carries it.** `LibraryItem` gains an optional `artifact?: ArtifactSource` (absent, never `null`, so
   older clients ignore it), filled for `html`/`htm` files up to `PAGE_MAX_BYTES`, read once per file version
   (`versionOf`) and cached with the listing. A read error leaves it off.
   Plain: the Files tab and the viewer know which documents are claude.ai artifacts without opening each one.

5. **The viewer shows where it came from** (overseer ruling e, `docs/design-system.md`):
   - Header (`FileViewer.tsx`): the place line (`.viewer-place`) adds "Copied from claude.ai on 23 November 2026", or
     "Link to a claude.ai page, added 23 November 2026" for a link card. The actions gain "Open on claude.ai", the
     same `<a class="btn" target="_blank" rel="noopener noreferrer">` with the hidden "(opens in a new tab)" as
     `PageStage.tsx:303`, rendered only when the client's own `isArtifactUrl` check passes. No `window.open`.
   - Documents details panel (`DocumentsPanel.tsx`): one `.kv` row "Source" with the same wording ("Copied from claude.ai on …").
   - Tiles and rows: words in the meta line, "Web page, 840 KB, from claude.ai". No new mark or logo.
   - When `partial` is set, the existing note "Some parts of this page only work on claude.ai." shows.
   Plain: you see the artifact in the app and are one click from the live version, using the app's existing parts.

6. **Link cards for artifacts that can't be copied.** By the P2 rule: typed artifacts (Sheets, Slides, Dashboard,
   Docs…), pages with runtime capabilities, multi-file pages, and anything pasted in the app (decision 8). A link card
   is a small self-contained `.html`: title, optional one-line description, an "Open on claude.ai" link, TDS styling
   inline, no scripts, passing `PAGE_PREVIEW_CSP`, `tds-artifact-kind` = `link`. Its link opens through the existing
   link script. A copy of a multi-file page is allowed only when whoever files it has inlined every file as `data:`.
   Claude Docs documents may also be exported to PDF or Markdown with the Docs connector, which already show as docs.
   Plain: every artifact can go in a project; the ones that only work live show a card that takes you there.

7. **One brain-skill action files both.** `tdsapp-files` **0.4** (0.3 is taken; overseer S1) adds `add-artifact`, with
   its **own** target rule (decision 1's two folder shapes, `.html` only), reusing `readSource`, `existingFolder`, the
   git rule and the hard-link no-overwrite. This is the one deliberate exception to "no HTML adds"; `add` is unchanged.
   Inputs: `url` (trimmed; query and fragment dropped; then the same pattern as `isArtifactUrl`), `path`, optional
   `source` (an `.html` or `.htm` file outside the brain, at most 5 MB, checked before reading, a UTF-16 byte-order
   mark refused), `title` (1-200 characters, no control characters; required only without `source`), optional
   `description` (at most 300 characters), optional `partial` (boolean), optional `copied` (defaults to today),
   `via`, `by_name`. With `source`, it writes the tag block (decision 2) and copies; without, it writes the link card
   with title and description HTML-escaped. Never overwrites (a number is added, as `add`); logs client adds as action
   `add`. `capabilities` gains `files-artifact-v1` (and the stale "0.2" example in `SKILL.md` is corrected).
   `SKILL.md` gains "From Claude Code": `Artifact` `read` the artifact (or use the local file it was published from);
   apply the P2 rule; run `add-artifact` with `source` for a plain page, without it otherwise.
   `server/brain/files-skill.ts` gains `COMMAND['add-artifact']`, `FILES_ARTIFACT_CAPABILITY` and an `addArtifact`
   call, like `add`.
   Plain: Claude (or the app) files an artifact into a project with one command, the same way every time.

8. **Paste a link in the project's Files tab.** "Add a claude.ai page" beside "Add files" (`ProjectPage.tsx`), shown
   only when `capabilities` reports `files-artifact-v1` and the project has a card that isn't archived or legacy
   (`projects/<slug>`). A small form (design-system form rules, `useSheetHold`): address and title, both required, no
   file field (P3). `POST ROUTES.projectArtifact(key)` (JSON) refuses archived, no-card and legacy projects, trims the
   address and drops its query and fragment, checks it with `isArtifactUrl`, checks the title, builds the target
   `<card folder>/files/<slug from the title>.html` on the server only, and runs `add-artifact` (a link card). A bad
   address gets a plain message: "That isn't a link to a claude.ai page. Open the page on claude.ai, press Share and copy its link." The
   server never fetches claude.ai.
   Plain: paste the link and give it a name, and it's in the project straight away; Claude can add a copy later.

9. **Backward compatibility.** The files are plain HTML: older app versions and anyone browsing the brain see a normal
   page or card. `artifact` on `LibraryItem` is optional. An older `tdsapp-files` answers `add-artifact` with
   `unknown action`, so the app hides the action unless the capability is there. `add`, `delete`, `restore`, `purge`
   and `list-deleted` are unchanged.
   Plain: nothing that works today changes, and a mixed team on different versions still sees the files.

10. **Security.** The address is checked at all three layers (skill, server, client) against one pattern, fed by one
    shared table test. Tags are read with fixed patterns from a bounded head and never rendered as HTML. The page
    sandbox and `PAGE_PREVIEW_CSP` are unchanged; link cards carry no scripts. The route takes no path from the
    browser. No new outbound request from the server. `add-artifact`'s HTML target is the one new write the skill
    allows, limited to the `files/` folder of a project folder that has its `project.md` card (the skill checks it; the route also refuses archived, card-less and legacy projects). Security gate.
    Plain: a file in a project can't use this feature to send you anywhere but claude.ai, or to reach into the app.

## Phase 2 (later, not in scope)

"Refresh copy" (needs P1, or a terminal action), adding the HTML file in the app's form (needs P3), and filing a
chat's claude.ai pages into its project in one step.

## Contract

`docs/plans/2026-11-23-claude-artifacts-contract.ts`

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, sonnet | default | `shared/pages.ts`, `shared/pages.test.ts`, `shared/contract.ts`, `server/brain/library.ts` and its tests, `server/brain/files-skill.ts` and its test, `server/http/routes.ts` (the new route) and its tests |
| Builder B | `builder`, sonnet | default | `brain-skills/tdsapp-files/**` |
| Builder C | `builder`, sonnet | default | `client/src/shell/FileViewer.tsx`, `client/src/apps/documents/DocumentsPanel.tsx`, `client/src/apps/documents/kind.tsx`, `client/src/apps/projects/ProjectPage.tsx`, `client/src/apps/projects/ProjectFiles.tsx`, `client/src/api.ts`, their tests, the CSS they need |

No file appears in two rows. A starts first on the contract's real declarations in `shared/`; B and C build against
the contract file meanwhile.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `shared/pages.test.ts` | `artifactSource`: the contract's block read back; a non-claude.ai address, `javascript:`, a look-alike host, a bad date (`2026-02-30`), an unknown kind, tags past 64 KB, a second later block all handled as the plan says. One address table shared with the skill's copy of the pattern | A |
| `server/brain/library.test.ts` | an `.html` with tags gets `artifact`; one without, or over `PAGE_MAX_BYTES`, doesn't; re-read only when the version changes. **Runs the real `add-artifact` script and feeds its output to `artifactSource`** (overseer S5) | A |
| route tests, through `checkRequest` (memory "Test new requests through the gate") | bad address, address with `?…`/`#…` accepted after trimming, empty title gives 400; archived, no-card and legacy projects refused; missing capability gives the existing refusal; good input runs `add-artifact` with the server-built target | A |
| `brain-skills/tdsapp-files` tests | `add-artifact` with `source` writes the block once after a doctype, at the start without one, after a BOM; `.htm` source to `.html` target works; UTF-16 and over-5 MB sources refused; without `source` writes an escaped card with no `<script>`; target rule allows only the two `files/` shapes; never overwrites; `capabilities` lists `files-artifact-v1`; `add` unchanged | B |
| client tests | the viewer shows "Open on claude.ai" only for items with a valid `artifact`; the action is hidden without the capability and on archived projects | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on the project's port 3878 rule, own data folder)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security expert (decisions 3, 7, 8, 10); UX/UI expert from screenshots (decisions 5, 6, 8)
- [ ] Browser check: a copied artifact and a link card in a project's Files tab, opened in the viewer, "Open on
      claude.ai" opening a new tab; the Add form, including a bad link

## Overseer pre-review (2026-11-23)

Blocking B1 (skill path rule), B2 (wrong file owners), B3 (Phase 0 unanswered, P4 missing): fixed above (decisions 1,
7, team table, Phase 0). Should S1 (version 0.4), S2 (trim pasted links), S3 (source edge cases), S4 (archived and
legacy guards), S5 (writer-reader test): folded into decisions 7, 8 and Tests. Nice N1 (title only for cards,
`partial` input): folded into decision 7. Rulings a-e adopted as written.

## Review outcomes

<Filled at step 10.>
