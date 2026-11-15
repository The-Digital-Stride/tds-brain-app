# TDS Cortex: the rename, and help for every feature

Date: 2026-11-15 · Size: XL (four phases) · Branch: `tds-cortex-help` (this plan) · Explainer: declined
Mock-ups: "TDS Cortex Help" artifact, https://claude.ai/artifact/NwU5XRwfHAHx4QK2prmJjR (private to Ian).
Standard for every help file: `docs/help-standard.md`.

## Summary (read this first)

TDS Brain App becomes **TDS Cortex**. The Brain stays the agency's shared knowledge folder; Cortex is the app you use
it through. Tagline: *"The Brain knows. Cortex gets it done."*

Every part of Cortex gets a short help page written so a 16-year-old can follow it, with cropped screenshots that
point at the buttons. People reach help in five ways:

| Way in | What it is | When people use it |
|---|---|---|
| Tooltips (already there) | A name under every icon button | "What does this button do?" |
| **Help drawer** (new, `?` on the rail, key `H`) | Opens on the page for the screen you're on; search; related pages | "How do I do this here?" |
| **Cortex Guide** (new sheet) | Every page in order, as a book, starting with *Why Cortex* and *A day with Cortex*; printable | "Show me everything" / new starters |
| **First-run tour** (new) | 7 short steps pointing at the main parts; once for everyone (existing users get "Welcome to TDS Cortex") | First open, or after the rename |
| **What's new** (new card, everyone) | Plain-words notes after an update, linked to help pages | After an update |

Search (⌘K) also finds help pages.

## Architecture (simple version)

```
  help/*.md  ──(built into the app by Vite)──►  Help library in the browser  ──►  Help drawer
  one file per feature                           (no server, works offline)     ──►  Cortex Guide
  help/images/*.webp  ◄── scripts/help-shots.ts                                  ──►  ⌘K results
  (made by a script                │                                             ──►  Tour, What's new
   from the demo Brain)            ▼
                     Cortex running on the demo Brain + a scripted pretend Claude
                     (fake clients only: Acme Heating, Northwind)

  Checks (pnpm test): every screen has a page · every page follows the standard ·
  reading level · UK spelling · every picture exists, is small, has alt text, has no real client names.
```

Plain: help is part of the app's own code, ships with each update and never touches the Brain.

## User decisions (fixed)

1. Name: **TDS Cortex**, visible name only. Hidden working names stay (see decision 2). (2026-11-15)
2. Help pieces: Help drawer, full Cortex Guide, first-run tour, What's new. All four.
3. Readers: all TDS staff, many not technical. Owner and scout features get their own clearly marked pages.
4. Help lives in the app repo (`help/`), not the Brain.
5. Benefits: start with plain benefits and measured numbers where we have them; add real team stories once people use
   it. The guide should inspire: how Cortex improves your working day and keeps you organised.
6. Mark: Ian designs the Cortex mark himself. Until then Cortex keeps today's brain icon. (Three sketches in the
   mock-up were declined, 2026-11-15.)
7. Tour: everyone, once. Skippable, replayable from Help.
8. Screenshots in help, made by a script; and a written standard for all future help files.
9. All words for people: UK English, readable by a 16-year-old.
10. No visual explainer.
11. "A day with Cortex" shows: filing calls and notes, client reports, pages and content, handovers and to-dos, and
    **sharing with your team**: passing a to-do is now clearly visible, and teammates get access without anyone
    having to think about it. Sharing is a headline benefit, not a footnote.
12. Plan only for now: commit the plan and the help standard; Ian starts Phase 1 when ready.

## Facts (from the code, 2026-11-15)

- The old name appears in ~104 files. Visible: `client/index.html` title, `client/public/manifest.webmanifest` name and
  short name, `client/public/offline.html`, the rail brand (`shell/Rail.tsx`), Settings "About TDS Brain on this
  computer", the update banner and notices, the gates, server messages people read (`server/install/*.ts`,
  `server/uploads/staging.ts`, `server/http/security.ts` reject messages, `server/http/routes.ts`), the Sign-in dialog
  title (`server/install/signin-app.ts`), the helper prompt (`server/engine/helpers.ts`), `brain-skills/*` wording.
- Hidden working names: `~/Library/Application Support/TDS Brain/`, `~/Library/Logs/TDS Brain`, the `tds-brain`
  command and `bin/tds-brain`, the `tds-brain-service` bundle, `TDS_BRAIN_APP_DATA` / `TDS_BRAIN_SERVICE`, the HMAC
  labels in `server/http/security.ts` (changing them signs everyone out), the service-worker cache name, the
  `tdsapp-` prefix in the Brain, `/install-brain-app` and friends, `os/tds-brain-app/` in the Brain, the repo name.
- `APP_VIA = 'TDS Brain App'` (`server/brain/todo-skill.ts`) is written into to-do done records in the Brain.
- No help, tour or guide UI exists. Tooltips: `shell/Tooltips.tsx` (from `aria-label` or `data-tip`). UI copy is inline.
- Markdown is rendered by `client/src/markdown.tsx` (marked + DOMPurify), so help pages reuse it.
- Drawers: `shell/Dock.tsx`, `ShellProvider.tsx`, `Fold.tsx`; apps (sheets) are entries in `shell/apps.ts`.
- Roles: `owner | scout | team | unknown` (`shared/contract.ts`). Owner/scout only today: skill-level edits, version
  history, "Continue in the terminal", owner-only skills.
- App prefs live in the app's own data folder (never the Brain): the right home for "tour seen" and "last what's new".
- `test/fixtures/brain` is a made-up Brain (clients `acme-heating`, `northwind`) and the engine is injected
  (`EngineFns` in `server/index.ts`), so a scripted pretend Claude can stage chats for screenshots.
- No Playwright in `package.json` yet.

## Decisions

1. **Visible rename only.** Every string a person reads says "TDS Cortex" (or "Cortex" after the first mention on a
   screen), from one brand constant in `shared/` flipped in Phase 3. Hidden working names in Facts stay as they
   are; comments may say "(was TDS Brain)". **Also kept** (overseer B1 and should-items): the sign-in helper
   `SIGNIN_APP_NAME = 'TDS Brain Sign-in'` (`shared/install-contract.ts`: it is the real
   `~/Applications/TDS Brain Sign-in.app` folder that launchd runs, and the signed-out page and doctor tell people
   to open it by that name), its bundle id, its dialog title and Login Items entry (written at install), and the
   `tds-brain-*` localStorage keys. The sign-in helper is renamed only in Phase 4, by `tds-brain install` with a
   move step. Help pages say "open **TDS Brain Sign-in**" until then.
   Plain: people see the new name everywhere, nobody is signed out, and nobody is sent looking for an app that
   isn't on their Mac.
2. **Words rule: Brain vs Cortex.** "the Brain" = the agency's shared folder of knowledge; "Cortex" = this app.
   Never "Cortex brain" or "Brain app" in new text. Goes in the glossary and the help standard.
   Plain: two names, two jobs, no muddle.
3. **Installed Dock app name.** `manifest.webmanifest` name and short name become "TDS Cortex". Current Chrome
   (144+) never applies a name or icon change silently: the person picks **Review app update** in the app
   window's ⋮ menu, and can ignore it. The What's new card and the "Adding Cortex to your Dock" page show that
   click with a picture. Try it on one Mac before launch. When the new mark arrives, it gets new icon file names,
   because Chrome only notices a changed URL.
   Plain: the Dock name changes with one click, and help shows people which one.
4. **`APP_VIA`** becomes "TDS Cortex". Nothing parses it (free text, shown only, `todos.ts` → `words.ts`); it
   stamps adds, passes, deletes and moves as well as ticks. Old records keep "TDS Brain App". Before launch, check
   Ian's reminders sync (outside this repo) once.
   Plain: to-dos changed from now on say they were changed in Cortex.
5. **Brain-side wording** (skill descriptions shown in the Skills drawer, `/install-brain-app` help text) is updated in
   this repo's `brain-skills/` copies only. Getting them into the Brain is a brain step for Ian through the guardian;
   the app never writes brain files. Command names stay (`/install-brain-app` keeps working).
6. **Help files**: `help/<topic-id>.md` at the repo root, one per feature, with frontmatter and fixed headings as
   `docs/help-standard.md` says. Bundled with a **relative** `import.meta.glob('../../help/**/*.md', { query: '?raw',
   eager: true })` (Vite's root is `client`, so `/help/**` would mean `client/help` in the build but the repo root
   under Vitest, and help could pass tests yet ship empty). The checks read `help/` from disk, and a build check
   asserts the topic count. Pictures are imported as assets. No server route. Help links use their own
   `help:<id>` linker, because `markdown.tsx` strips every non-web link.
   Plain: help works even when the server is busy, adds nothing anyone could misuse, and can't arrive blank.
7. **Topic ids are typed.** `client/src/help/topics.ts` exports `HELP_TOPICS` (generated check: every id has a file
   and every file has an id) and `helpForView(view)` maps the current screen, open drawer or app to a topic.
   Plain: the Help drawer always opens on the right page.
8. **"?" links** (`HelpLink` component, a quiet 28px icon-btn, the design system's in-row size, with tooltip
   "Help: <topic>") sit in a drawer or sheet header and beside tricky Settings rows. Never more than one per header.
9. **Help drawer**: a new dock drawer like Skills (same Fold, search, rows). Top: the page for this screen. Then
   search, then all pages by area, then "Open the Cortex Guide", "Take the tour again", "What's new".
   Rail item "Help" (`help` icon), single keys `H` and `?` (both free in `state/keys.ts`; the Settings text that
   lists the keys is updated), palette "Go to → Help". Only one left drawer opens at a time, so opening Help
   **records where you were** (view, chat kind, the drawer it replaced, the panel tab) and closing it puts that
   drawer back. The coverage test walks those contexts, not just `apps.ts`.
   Plain: Help knows what you were looking at, and puts you back there.
10. **Cortex Guide**: a sheet view `guide` beside Settings and Profile (not an `apps.ts` entry: those sit in the
    rail's Apps group and carry search and panel slots; not inside the drawer: no room for contents plus page, and
    it can't print). No rail item: open it from Help, ⌘K and Settings. Contents on the left, reading pane on the
    right; ⌘P prints **every** page as a clean booklet. Order: Welcome → Why Cortex → A day with Cortex → each area
    in rail order → Owners and scouts → Keyboard → Fixing problems → Glossary.
11. **Owner and scout pages**: `roles: [owner, scout]` in frontmatter. Shown to everyone, with a "For owners and
    scouts" chip, so team members know the feature exists and who to ask.
12. **Screenshots by script**: `pnpm help:shots` runs `scripts/help-shots.ts`, which uses **`playwright-core` with
    the installed Chrome** (no browser download; every Mac's update runs `pnpm install`, dev tools included) and
    `sharp` (already a dependency) for WebP. It runs Cortex on a **separate demo seed** (`scripts/help-demo/brain/`,
    not `test/fixtures/brain`, which eight test files rely on), copied and `git init`-ed into a git-ignored
    `.help-demo/` folder in the worktree (the Brain check refuses a folder without `.git`), with a scripted pretend
    Claude (`server/engine/demo-engine.ts`). The clock is frozen so dates match from run to run, and a picture is
    rewritten only when its pixels change. `help/shots.json` lists each shot: scene, element to crop, padding,
    numbered callouts. Output: `help/images/<id>.webp`, 2× pixel density, ≤ 150 KB.
    **Demo mode fails closed** (overseer B3): it starts only when `TDS_CORTEX_DEMO=1` **and** it is not under the
    service **and** an explicit, non-default data folder and port are given **and** the Brain holds a
    `.cortex-demo` marker file. If any is missing it exits with a message; it never falls back to the real Brain
    or data folder.
    **Private details** are checked at capture time, on the text of each captured element: no username, no home
    path, no real client or person name (read from the live Brain's client folders when present). This keeps
    `pnpm test` independent of the live Brain.
    Plain: one command updates every picture, and it refuses to run unless it is certain it's looking at made-up data.
13. **Checks** (`client/src/help/help.test.ts`, run by `pnpm test`, no new dependencies): frontmatter valid; required
    headings in order; `summary` ≤ 90 characters; sentences 25 words or fewer; feature pages 120–350 words;
    reading level (Flesch–Kincaid grade ≤ 9 on prose only, glossary terms left out, syllable counter pinned by
    fixtures; about 40 lines); UK spelling list; banned jargon and "Brain app"; every **bold** button label exists
    in `client/src`; `related` ids exist; every image exists, has alt text, is listed in `shots.json`, is ≤ 150 KB
    and has at most 4 callouts; every view and drawer context has a topic.
    Plain: the computer catches a renamed button or a hard sentence before a reader does.
14. **First-run tour**: 7 steps (Welcome, Home box, Client, Chats, To-dos, Search, Help). Spotlight plus a small card
    with Back / Next / Skip; Esc skips; focus moves into the card; reduced motion: no slide, the spotlight just
    appears. Anchors: `data-tour="<step>"`. It starts only on Home with nothing else open, and skips a step whose
    anchor is missing. Prefs: `tourSeenVersion` (number), with a local fallback if saving prefs fails so it never
    repeats. **Existing user** = has earlier chats (new and existing users both start with no value); they get
    the "Welcome to TDS Cortex" first step. Replay from Help.
15. **What's new for everyone**: `help/whats-new/<version>.md` written in plain words (not the changelog). After an
    update, a dismissible card on Home links to the pages it names. Prefs: `whatsNewSeen` (version). The owner/scout
    version history stays as it is.
16. **Mark**: Cortex keeps today's brain icon (`client/public/icons/brain.*`) until Ian supplies his own design.
    Then it lands as new file names (`cortex-*.svg/png`, so Chrome notices), the old files stay for old caches, and
    the service-worker cache becomes `tds-brain-offline-v4` with the new files in its list. Not a launch blocker.
17. **Release shape**: updates ship from main, so anything merged reaches everyone. Phases 1–2 therefore show the
    Help rail item, `H`/`?` and the palette entry to **owners only** until Phase 3. Phase 3 is the launch: rename,
    tour and the "TDS Brain is now TDS Cortex" What's new, all in one update, with every screenshot re-taken
    (budgeted: one script run).
    Plain: the team meets Cortex once, fully explained, not in dribs and drabs.

## Phases

| Phase | What ships | Rough size |
|---|---|---|
| 0 (this) | Plan, help standard, mock-ups, interview | done |
| 1 | Help engine (loader, topics, checks), Help drawer, `HelpLink`, screenshot script + demo Brain, the first 8 pages (Home, Chats, A chat, Approvals and questions, To-dos, Skills, Documents, Images) | L |
| 2 | The other ~30 pages, Cortex Guide sheet, glossary, ⌘K help results, "?" links in Settings | L |
| 3 | Launch: visible rename, tour, What's new card, "Welcome to TDS Cortex" (new mark if Ian's is ready) | L |
| 4 (later) | Real team stories, measured time and token savings from the planned savings ledger, Ian's mark if not yet in, renaming the sign-in helper with a move step, optional `tds-cortex` command alias | M |

## Page list (first pass, ~38)

- **Getting started**: Welcome to TDS Cortex · Why Cortex · A day with Cortex · The tour · Brain and Cortex
- **Home**: Home · Starting a chat · Picking the client (Auto) · Pinned to-dos, chats and files
- **Chats**: The Chats drawer · Talking to Claude · Attaching files · Approvals and questions · What Claude did ·
  Helpers · Levels (Quick, Standard, Deep) · How full a chat is · The "This chat" panel · Chat files · Pages Claude
  makes · TDS or Personal chats · Deleting a chat · Continuing in the terminal (owners and scouts)
- **To-dos**: To-dos · Adding and editing · Passing a to-do on · Letting Cortex change to-dos
- **Working as a team**: Sharing with your team (what teammates see straight away: passed to-dos, filed notes,
  shared files; access comes with the Brain, nobody has to set it up)
- **Skills**: Skills · Favourites
- **Files**: Documents · Images · Viewing a file
- **Getting around**: Search or jump to (⌘K) · Keyboard shortcuts
- **Settings**: Settings · How Cortex is running (health) · Choosing your Brain folder · Updates and what's new ·
  Your profile · Adding Cortex to your Dock · Skill levels (owners and scouts) · Version history (owners and scouts)
- **Help**: Fixing problems · Glossary

## Team (per phase)

| Role | Model / effort | Why |
|---|---|---|
| Overseer (UX and help-content domain) | Fable, high | Plan critique, decisions, sign-off |
| UX/UI expert gate | Opus, high | Every phase changes what people see |
| Builder: help engine + checks (pure logic, tests first) | Sonnet, medium | Not on the hard list |
| Builder: Help drawer, Guide sheet, tour UI | Sonnet, medium | UI |
| Builder: screenshot script + demo engine | Sonnet, medium | Scripts |
| Writer: help pages from the standard | Sonnet, medium | Copy; checked by the reading-level test and a copy reviewer |
| Reviewers | Opus high (correctness), Sonnet medium (UI and a11y, copy truth) | Copy truth checks every page against the code |
| Security expert gate (Phase 1 only) | Opus, high | The demo-engine switch must never be reachable in a real install |

## Tests (first, for logic)

- `help/library`: parses frontmatter, rejects missing fields, orders by `order`, groups by area, filters nothing by
  role (decision 11), search ranks title > summary > body.
- `helpForView`: every view and drawer maps to an existing topic; unknown view falls back to "Welcome".
- Standard checks in decision 13, each with a failing fixture page.
- Prefs: `tourSeenVersion`, `whatsNewSeen` validated and saved like the other prefs.
- Demo engine: refused unless `TDS_CORTEX_DEMO=1`, and always refused under the service.

## Risks

- **Screenshots go stale** when a screen changes. Mitigation: one command re-takes them all; the help standard says a
  UI change that alters a shot re-runs the script in the same branch.
- **Reading level vs accuracy.** Simple words must still be true. Copy-truth reviewer checks each page against code.
- **Help drift.** A new feature without a page fails the coverage test.
- **Chrome Dock name lag** (decision 3).

## Overseer pre-review (2026-11-15, Fable)

All three blocking items are fixed in the decisions above: B1 sign-in helper name kept (decision 1), B2 Chrome's
**Review app update** click (decision 3), B3 demo mode fails closed on a separate seed (decision 12). Should-items
taken: Help restores the drawer it replaced (9), owners-only until launch (17), relative glob and `help:` linker (6),
`playwright-core` + `sharp` with a frozen clock (12), capture-time privacy checks (12), extra cheap checks (13), tour
guards (14), service-worker cache bump (16). Nice-items taken: 28px `HelpLink`, `?` as a second key, one brand
constant, print every page. Open questions answered: `H` is free; `APP_VIA` is display-only; the Guide is a sheet
view beside Settings. Ian's 2026-11-15 answers (own mark, sharing as a headline benefit, plan only) added as user
decisions 6, 11 and 12.
