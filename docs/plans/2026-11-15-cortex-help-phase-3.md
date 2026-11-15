# TDS Cortex, Phase 3: the launch (visible rename, first-run tour, What's new)

Date: 2026-11-15 · Size: L · Branch: `cortex-help-phase-3` · Explainer: declined (programme decision)
Parent plan: `docs/plans/2026-11-15-tds-cortex-help.md`, decisions 1–5, 14, 15 and 17 (read them; they still hold).
Phase 2: `docs/plans/2026-11-15-cortex-help-phase-2.md`. Standard: `docs/help-standard.md`.
Mock-ups (tour, What's new card): `/private/tmp/claude-501/-Users-ianhancock-My-Repos-tds-brain-app/e6c33c44-0d40-4890-a5b1-691366cbffca/scratchpad/tds-cortex-help.html`.

## Objective

Everyone meets TDS Cortex in one update: every visible name says TDS Cortex, a short tour welcomes each person
once, and a What's new card explains the change. Help is already open to everyone (v0.39.0).

## Facts (2026-11-15, v0.39.0)

- "TDS Brain" appears in 18 client files (UI strings, `index.html`, `manifest.webmanifest`, `offline.html`,
  `sw.js`, `icons/brain.svg` title) and about 19 server/shared files (CLI output, doctor, signed-out page, setup,
  security pages, `APP_VIA = 'TDS Brain App'` in `server/brain/todo-skill.ts`), plus 23 test files.
- `brain-skills/` copies mention "TDS Brain" / "brain app" in 10 files (skill descriptions shown in the Skills
  drawer). The app never writes the Brain; these are repo copies only (parent decision 5).
- Ian's reminders sync (`~/.plaud-reminders/`) never reads the via stamp: renaming `APP_VIA` is safe (checked).
- `boot.appVersion` is the running version. Earlier chats come from the store (`earlier`), so "existing user"
  = has at least one earlier chat.
- **Already done by the lead (the contract):** `shared/brand.ts` (`BRAND`, `BRAND_SHORT`, `BRAND_FORMER`);
  `AppPrefs.tourSeen: number | null` and `AppPrefs.whatsNewSeen: string | null` with `VERSION_PATTERN`, in
  `shared/contract.ts`, sanitised in `server/store/app-store.ts`, with tests. Old prefs files read as null.

## Decisions

1. **Rename from one place.** Every string a person reads uses `BRAND` / `BRAND_SHORT` (first mention on a screen
   "TDS Cortex", then "Cortex"). **Kept exactly as they are** (parent decision 1): the install folder, the
   `tds-brain` command and its name in instructions, sign-in HMAC labels, `SIGNIN_APP_NAME` ('TDS Brain Sign-in')
   and every instruction to open it, its bundle id, Login Items entry, `tdsapp-` names, `/install-brain-app` and
   other command names, `tds-brain-*` localStorage keys, service-worker cache names, file and folder names,
   env var names (`TDS_BRAIN_*`), log prefixes read by tools. When in doubt, it stays.
   Plain: people see the new name everywhere; nothing that sign-in or updates rely on changes.
2. **Manifest and page title** say "TDS Cortex" (name and short name). Chrome asks the person to accept the Dock
   name change (**Review app update** in the app window's ⋮ menu); the What's new note and `dock-app` page say so.
3. **`APP_VIA = 'TDS Cortex'`**. Old to-do records keep "TDS Brain App"; the words that show it accept both.
4. **First-run tour** (`client/src/tour/`): 7 steps: Welcome (no spotlight, centred card), Home message box, the
   client picker, Chats, To-dos, Search or jump to, Help. A spotlight plus a small card with **Back**, **Next**
   (**Done** on the last) and **Skip tour**; Esc skips; focus moves into the card and returns afterwards;
   reduced motion: no movement, the spotlight just appears. `role="dialog"`, labelled by its title.
   **Anchors are existing selectors** in one map (`tour/steps.ts`), not new attributes:
   `.home-composer .composer-input`, `.home-composer .client-select`, `button.rail-item[data-dock-label="Chats"]`,
   the same for To-dos and Help, and the sheet bar's "Search or jump to" button. A step whose anchor is missing or
   hidden is skipped. **When**: only on Home, with no drawer, palette, viewer or dialog open, after boot, when
   `prefs.tourSeen` is below `TOUR_VERSION` (1). Finishing or skipping saves `tourSeen: 1`; if saving fails, a
   localStorage fallback (`tds-brain-tour-seen`) stops it repeating. **Existing users** (at least one earlier
   chat) get a first step titled "Welcome to TDS Cortex" ("TDS Brain is now TDS Cortex…"); new users get
   "Welcome to TDS Cortex" with the new-user words. **Replay**: "Take the tour" in the Help drawer.
   Plain: everyone gets a one-minute walk round, once, and can take it again from Help.
5. **What's new** (`help/whats-new/<version>.md`, frontmatter `version`, `title`, `pages: [ids]`, body ≤ 120 words,
   same reading rules): the first note is `0.40.0.md`, "TDS Brain is now TDS Cortex", linking `welcome`,
   `getting-help`, `cortex-guide` and `dock-app`. A dismissible card on Home (under the greeting, above the box)
   shows the newest note whose version is ≤ `appVersion` and newer than `prefs.whatsNewSeen`. **Close** saves
   `whatsNewSeen` = that note's version. The card waits while the tour shows. A brand-new person (no earlier chats)
   never sees notes from before they started: finishing or skipping the tour also saves `whatsNewSeen` = the newest
   note ≤ `appVersion`. "What's new" in the Help drawer opens the newest note as a Help page (`whats-new` topic
   rendering the notes newest first).
   Plain: after an update, a short note on Home says what changed and where to read more.
6. **Help drawer** gets two quiet buttons under "Open the Cortex Guide": **Take the tour** and **What's new**.
7. **Help pages** updated for the new labels (e.g. "About TDS Cortex on this computer"), the tour (getting-help,
   welcome), the What's new card (updates, now allowed) and Chrome's **Review app update** (dock-app). The
   "this-chat-panel" note that the picture leaves out rows stays unless the shot changes.
8. **Every screenshot is retaken** after the rename (`pnpm help:shots`, one run), so pictures show "TDS Cortex".
9. **Brain-side wording**: `brain-skills/` copies say TDS Cortex where they name the app; command and skill names
   stay. Getting them into the Brain is Ian's step through the guardian.
10. **Version**: this lands as a `feat`, so the next version is 0.40.0, matching the first note.

## Builders (files each owns)

| Builder | Owns | Model |
|---|---|---|
| **R, rename** | Every non-test file under `client/src` (except `tour/`, `shell/Home.tsx`, `shell/HelpDrawer.tsx`, `help/`), `client/index.html`, `client/public/**`, `server/**`, `shared/**` (except `brand.ts` and the prefs block), and the tests that assert renamed strings | Sonnet, medium. Not on the hard list (string swaps), but brief carries the keep-list; a security reviewer checks sign-in and installs |
| **T, tour** (tests first) | `client/src/tour/**` (new), `client/src/styles/tour.css`, `client/src/main.tsx` (import only), `client/src/App.tsx` (mount the tour) | Sonnet, medium |
| **W, What's new + Help drawer** (tests first) | `help/whats-new/**`, `client/src/help/whats-new.ts` (+test), `client/src/shell/WhatsNewCard.tsx` (+test), `client/src/shell/Home.tsx` (card only), `client/src/shell/HelpDrawer.tsx` (+test; two buttons, calling T's exported `startTour`), `client/src/help/{contract,topics,context,library,checks}.ts` only if the `whats-new` topic needs it, `client/src/styles/help.css` | Sonnet, medium |
| **G, copy** | `help/*.md` (label and feature updates per decision 7), `brain-skills/**` wording | Sonnet, medium, after R lands (needs the new labels) |

T exports from `client/src/tour/index.ts`: `startTour(): void` and `useTourOpen(): boolean` (so W's card waits).
R, T and W start together; G starts when R reports. Then the lead retakes every shot and runs the gates.

## Tests (first, for logic)

- Prefs (done): the two markers, old file reads null, bad values kept out.
- Tour: when it starts (Home only, nothing open, `tourSeen` below 1); existing vs new first step; missing anchor
  skipped; Esc and **Skip tour** save; save failure uses the fallback; focus moves in and back; replay.
- What's new: picks the newest note ≤ `appVersion` and newer than `whatsNewSeen`; none for a new person after the
  tour; **Close** saves; waits for the tour; note files pass the reading checks.
- Rename: a test that fails if a visible string in `client/src` (outside tests and the keep-list) still says
  "TDS Brain"; `APP_VIA` is "TDS Cortex" and old "TDS Brain App" records still show.

## Gates

Security reviewer (sign-in, install, doctor, signed-out page untouched in behaviour; keep-list held). UX/UI
expert (tour, card, consistency, accessibility). Copy truth (pages, the note, every timing claim). Correctness.
Browser check on the demo app: new person (tour, no card), existing person (welcome step, card after the tour),
replay from Help, Dock manifest name. Ian tries **Review app update** on one Mac before pushing.

## Pre-review changes (overseer, 2026-11-15; these override the decisions above)

- **B1, when the tour starts**: on any view, once nothing modal is open (palette, viewer, a floating drawer or
  panel, the setup or sign-in gates), checked again every time those conditions change, not once at boot. When it
  starts it closes a pushing drawer and shows Home itself (a saved drawer and the last chat are restored on load,
  so "only on Home" would miss many people). While it shows, single keys (`C`, `T`, `S`, `H`, `?`, `/`) do nothing.
- **Keep-list additions**: `SUPPORT_DIR_NAME`, `LAUNCH_AGENT_LABEL`, `SIGNIN_APP_BUNDLE_ID`, `SESSION_COOKIE`, the
  doctor's closing "Everything looks fine." (the Brain's update skill matches it), and the data-folder path line in
  `offline.html`. Uninstall wording says "TDS Cortex (or TDS Brain)".
- **The rename guard** `shared/brand.test.ts` (lead, written first; builders don't edit it): pins each kept
  constant and scans `client/src`, `client/index.html`, `client/public`, `server` and `shared` for a visible
  "TDS Brain" outside the allow-list. It fails with 96 lines before R starts.
- **R's scope**: change only "TDS Brain" (and "Brain app" in visible text). Leave "the app" and lower-case "the
  brain" wording alone. Delete the unused `APP_NAME` in `shared/contract.ts`. Bump the service-worker cache to
  `tds-brain-offline-v4` (prefix kept) so the cached starting-up page gets the new name.
- **Anchor test**: T adds a test that renders Home, the rail and the sheet bar and fails if any tour anchor is
  missing (a silent skip would hide a broken tour).
- **`startTour()` only requests** (sets a flag); T's mounted component then closes the drawer, shows Home and starts.
- **What's new**: compare versions as numbers (0.40.0 > 0.9.0). Hide the card while `tourSeen` is null. The note
  carries the **Review app update** step in words (Chrome's own menu can't be photographed by the script, so
  `dock-app` describes it in words too).
- **G starts after R, T and W**, so **Take the tour**, **Skip tour** and the new labels exist for the label check.

## Review outcomes (2026-11-15)

- **Security** (1, fixed): `validatePrefsPatch` refused `tourSeen` and `whatsNewSeen`, so the tour would have
  shown on every load. Both now pass validation (bad values get a 400), with a test through the real route. The
  sign-in, install, doctor and signed-out page behave as before; the keep-list holds (the guard pins it).
- **Correctness** (3, fixed by the lead, each with a test): a brand-new person now also gets `whatsNewSeen` saved
  when the tour ends, so they never see old notes; a tour interrupted by the palette asks again instead of being
  lost; the tour moves to Home when it starts from Settings.
- **UX/UI** (9, fixed): **Back** uses `aria-disabled` on the first step; a live region reads "Step N of M: title";
  the dialog has `aria-modal`; focus falls back to `#main` if its starting point has gone; `[` is blocked while the
  tour shows; the spotlight follows its anchor when the layout changes; the focus ring uses `--focus`; the step
  words say ⌘K; the card offers "Stuck? Open Help" and "It only takes a moment".
- **Copy** (4 plus the brain-skills wording, fixed): page wording matched to the new labels and timings.
- **Label check**: **Review app update** is Chrome's own menu, not the app's, so it is allowed (`BROWSER_ALLOW`).
- **Browser checks** (demo app): tour 7 steps, focus and announcements right, no repeat after **Done** and reload,
  replay from Help, Esc closes; the What's new card shows at 0.40.0, **Close** moves focus to the message box and
  it stays closed after reload; no page errors.
- **Overseer**: signed off. Still Ian's step before pushing: try **Review app update** on one Mac.
- **Known small gaps (Phase 4)**: if the chat list fails to load, an existing person is treated as new (they get
  the new-person welcome); blocking by a floating drawer is untested in the browser.
