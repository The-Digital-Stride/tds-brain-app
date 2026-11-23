# Projects R2, phase 4: meetings on the project home

Date: 2026-11-23 · Size: XL programme, phase 4 of 6 (L) · Branch: `projects-r2-meetings` · Explainer: https://claude.ai/artifact/EZs8Q3qxjV1jAHJZ39tySh (programme)

Parent plan: `docs/plans/2026-11-20-projects-system.md`, Release 2 decisions 19 and 29. Phase 3:
`docs/plans/2026-11-23-projects-r2-activity.md` (v0.67.0), follow-up `2026-11-23-project-files-library-view.md` (v0.68.0).

## Objective

A project's Overview shows this person's last and next meeting about it, from their own calendar, with a way to
file the notes for the last one. Call notes say which project they're about.

## User decisions (fixed)

- Merge and push each phase once checks and reviews pass. Brain edits are prepared in `brain-skills/` and copied
  into the brain straight after the merge (files only, never git).
- Every UI change follows `docs/design-system.md` and gets the UX/UI expert sign-off from screenshots before merge.
- Nothing from an email reaches a project without the inbox owner's approval. This phase reads calendar events only;
  it doesn't touch email.
- Parent decision 29: meetings are shown only to that person, never kept in the shared brain; filed notes are
  shared like any call note.

## Facts (from the code and the brain, 2026-11-23)

- **/gm already keeps a private meeting list on each Mac.** Step 3 of `.claude/skills/gm/SKILL.md` writes
  `briefing/meetings-cache.json` (`{generated, source, meetings: [{id, title, start, end, allDay, location,
  attendees: [{name, email}]}]}`) from the person's Google Calendar connector, or runs
  `tools/members/command-centre/lib/calendar-live.cjs` (next 14 days, primary calendar) when the connector fails.
  `briefing/` is gitignored (brain `.gitignore:177`). It's the shared /gm, so every teammate's Mac has one.
  Ian's today: 13 meetings, generated 2026-11-22.
- The cache's other readers: the Workbench Meetings view (`lib/meetings-parser.cjs`, drops anything before today)
  and `.claude/skills/time/scripts/gather.cjs` (falls back to it, filtered by date). Past entries in the cache
  harm neither.
- The Workbench matches meetings to clients by title, location and attendee names only, never emails (internal
  addresses all share the agency domain). `.team-config/email-to-client.json` is named in config but doesn't exist.
- A client's web address is in `clients/<slug>/profile.md` as a `**Website:** https://…` line (no frontmatter
  field). `server/brain/clients.ts` reads only the `client:` name today; `client-aliases.ts` adds aliases.
- Call notes: `clients/<client>/call-notes/YYYY-MM-DD-<slug>.md`, frontmatter `title, date, client,
  meeting_start` (ISO, when known), `attendees`… (meeting-notes SKILL.md, the template at line ~196). No `project:`.
  Internal meetings are filed in the project's own folder (R1 brain edit). The app doesn't read call notes yet
  except as Library items (`library-rules.ts:22`, group "Call notes").
- Activity "Coming up" is built in `server/brain/project-activity.ts:306-326` (`ComingUpItem`), shown by
  `client/src/apps/projects/ProjectActivity.tsx:320-340`.
- A new chat with a prompt: `startChat(prompt, client, {open, in})` in `client/src/store.tsx:332`; `send(...)`
  takes the project for a new chat. Phase 1 gave chats their project.
- App-data stores with queued writes and "a bad read never wipes the file": `server/store/project-seen.ts`,
  `server/store/chat-places.ts`. Identity (this person's email, from git): `server/brain/identity.ts`.

## Decisions

1. **Read the cache /gm already writes; no new way in.** The server reads `MEETINGS_CACHE_PATH` from the brain,
   read only, defensively (bad JSON or fields → treated as no cache), and **only when `gitIgnored`
   (`server/brain/library.ts:118`) says git ignores it**; not ignored or no answer → `'none'` (overseer blocker 1).
   **Departs from parent decision 29**, which planned a local route the /gm session posts to, falling back to
   `personal/`: the cache already is a private, per-Mac list filled from each person's own calendar, so a second
   channel would add a sign-in path for scripts (the gate only lets the launcher sign in) for no gain (overseer
   accepted). The app never writes the cache.
   Plain: your morning /gm already notes your meetings on your Mac; the app reads that note, and only if it's
   certain the note isn't being shared.
2. **A small private history of past meetings.** Matched meetings that **have ended** are merged into
   `project-meetings.json` in the app data folder (`KeptMeeting`: id, start, project key, how it matched, title,
   end, other people's names and count; **never emails**), keyed by id and start together (a recurring series can
   share an id). Kept 90 days, at most 500, oldest dropped first. **Next meeting comes from the cache alone**, so
   a cancelled or moved meeting never lingers (overseer blocker 2). The server merges at start-up, on each read and
   every 30 minutes (`MEETINGS_MERGE_EVERY_MS`); there's no file watcher on `briefing/` (overseer blocker 4).
   Plain: the app remembers your past meetings for projects on your Mac, for three months.
3. **Matching a meeting to a client.** All-day events are skipped. A meeting's client is, in order:
   (a) the one client with an attendee whose email domain is the client's website domain or a subdomain of it,
   leaving out this person, the agency's own domains (the team's email domains from `.team-config/roles.json` and
   the person's git email) and public mail domains (a fixed list: gmail.com, googlemail.com, outlook.com,
   hotmail.com, hotmail.co.uk, live.com, yahoo.com, yahoo.co.uk, icloud.com, me.com, aol.com, btinternet.com);
   (b) if no client, or more than one, matched by domain: the title, where the client's display name or an alias
   appears as whole words (an alias of three letters or fewer only in capitals as written). One client by title →
   it; more than one → the most words matched; tied → none. Never a guess (overseer ruling).
   Plain: a meeting belongs to a client when one of their people is invited, or the title names them.
4. **Matching a client meeting to a project.** Among the client's open projects (not done, not archived), each
   scores the number of its title words of three letters or more (so SEO and PPC count), leaving out the client's
   own name, found as whole words in the meeting title. The highest score of at least one wins (`match: 'title'`);
   tied → none. A project with no qualifying words can't match by title (overseer blocker 5). No title match and
   **exactly one** open project → that one, marked `match: 'only'`. Otherwise none: the meeting shows on no
   project page. Internal (TDS) and personal projects match by title words only.
   Plain: with one live project, a client's meetings go on it as a likely match; with several, the title has to
   say which.
5. **Where it shows (this person only).** A "Meetings" card on the Overview, after "Since you last looked" and
   before "Coming up": **Last meeting** (title, day and time, "With Jo Smith, Sam Lee +2") and **Next meeting**
   (same). The page also adds the next meeting to "Coming up" when it's within 14 days; the activity service and
   its contract stay calendar-free, so nothing private can ride into a later shared read such as the phase 6 digest
   (overseer ruling). Meetings never appear in "Since you last looked", the updates log, the Files tab or anything
   written to the brain. A teammate opening the same project sees their own meetings, from their Mac.
   Plain: you see your own meetings for the project; your teammates see theirs.
6. **Filing the notes.** When the last meeting has no matching call note (`MeetingView.notes`), it shows a quiet
   button "File the notes". It starts a new chat in this project (client and project set, as phase 1) with the
   prompt `File the notes for my meeting on <weekday d Month> at <HH:MM> with the meeting-notes skill. It's for the
   <client name> <project title> project.` With `match: 'only'` the last sentence reads `It's probably for the
   <client name> <project title> project; check that with me.` **The invite's title is never in the prompt**
   (overseer blocker 3): an outsider can write a calendar title, and it would reach Claude as the person's own
   words. The chat opens in the drawer; meeting-notes then finds or asks for the recording and asks before saving,
   as it always does. The button files nothing itself. With a matching note the card says "Notes filed" as plain
   text, with a small "Open notes" button beside it that opens the note in Documents (as file rows do, v0.68.0).
   Plain: one click starts a chat that files the notes, with the project already filled in.
7. **Calendar not set up, or stale.** No cache: "Your meetings show here after /gm has checked your calendar."
   Cache older than 3 days: the card still shows what it has, with a hint "Calendar last checked 19 Nov." No
   match either way: "No meetings found for this project in your calendar." Archived projects show no card.
   Plain: it says plainly when it hasn't got your calendar, rather than looking empty.
8. **Call notes say their project (parent decision 19).** Brain edit to meeting-notes: the project is settled at
   step 2 (beside the client: the open project the meeting was about, or none) and written at step 8 as
   `project: <project slug>` (the folder name, e.g. `website-rebuild`) below `client:`; step 9 (d) runs after the
   file is written. Old notes without it keep working. The app reads it for decision 6 only. A note whose
   `meeting_start` is within 30 minutes of the meeting counts as filed with or without the tag. **The Files-tab
   "Call notes" group is a follow-up** (overseer ruling: project membership is defined once, in
   `server/brain/projects.ts:695`, and feeds `item.projects` and activity's new-file rows, so it's its own change).
   Plain: filed call notes are tagged with their project, and the app can tell a meeting's notes are filed.
9. **/gm writes the next 14 days (brain edit).** Step 3 says to pull the next 14 days from the connector when
   writing the cache, as `calendar-live.cjs` already does (the connector path may write only today's events). No
   look-back and no change to `calendar-live.cjs` (the Workbench's file; overseer ruling). "Last meeting" fills in
   from the first meeting that ends after this release. Prepared in
   `brain-skills/tdsapp-projects/brain-rules/r2-meetings.md` and copied on merge.
   Plain: the morning check notes the next two weeks of your calendar, so the app knows your next meeting.
10. **Privacy guards.** Emails are used only in memory for matching; a test checks the response and the history
    file hold no "@". The route answers only for this Mac's session, behind `checkRequest` like every route. The
    prompt holds a time, a client and a project only. The help page says meetings come from your own calendar and
    stay on your Mac. Declined meetings can't be skipped yet (the cache doesn't record a response); noted for later.
    Plain: your calendar never leaves your Mac through the app.

## Contract

`shared/project-meetings-contract.ts`: the cache shape, the history, `MeetingView`, `ProjectMeetingsResponse`, the
limits, and the `ComingUpItem` and ROUTES additions.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable (resumed, a144af492a5c2363c) | plan critique and sign-off | (read-only) |
| Builder A (server) | `builder`, sonnet | default; matching is one pure function, table test first | `server/brain/meeting-match.ts` (+test), `server/brain/project-meetings.ts` (+test), `server/store/meeting-history.ts` (+test), `server/brain/call-notes.ts` (+test), `server/http/routes.ts`, `server/http/projects-routes.test.ts`, `server/http/server.ts` wiring, `server/brain/index.ts`, `server/index.ts`, `shared/contract.ts` |
| Builder B (client) | `builder`, sonnet | default (UI) | `client/src/apps/projects/ProjectMeetings.tsx` (+test), `client/src/apps/projects/ProjectActivity.tsx` (+test; merges the next meeting into Coming up), `client/src/apps/projects/ProjectPage.tsx` (placing the card), `client/src/api.ts`, `client/src/styles/projects.css`, `help/projects.md` |
| Lead | me | | this plan, the contract, `brain-skills/tdsapp-projects/brain-rules/r2-meetings.md` (+README row), `docs/design-system.md`, explainer |
| Correctness reviewer | `reviewer`, opus high | | |
| UX/UI expert | `expert`, opus high, `design:design-critique` | merge gate | |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/brain/meeting-match.test.ts` (first) | table: domain match incl. subdomain; agency, self and public domains ignored; two domain clients → title; whole-word title and alias match, short alias only in capitals; ties → none; project score with SEO/PPC, client name left out; no qualifying words → no title match; one open project → `only`; several, no title → none; done/archived never; all-day skipped | A |
| `server/brain/project-meetings.test.ts` | cache not git-ignored or git can't say → 'none'; bad cache → 'none'; stale; last = ended (cache or history), next = from the cache only, in progress counts; a cancelled future meeting is gone next read; recurring instances with one id kept apart; response holds no "@" | A |
| `server/store/meeting-history.test.ts` | only ended meetings kept; keyed by id + start; 90 days and 500 cap; file holds no "@"; bad file never wiped | A |
| `server/brain/call-notes.test.ts` | `meeting_start` within 30 min matches with or without `project:`; `date` + `project:` fallback; wrong project no match; internal note in the project folder; returns the library id | A |
| `server/http/projects-routes.test.ts` | route through the real `checkRequest`; bad key → 400 | A |
| `client/src/apps/projects/ProjectMeetings.test.tsx` | no cache / stale / none / last+next; "File the notes" starts a project chat with the exact prompt (never the title; the `only` wording); "Open notes" opens Documents | B |
| `client/src/apps/projects/ProjectActivity.test.tsx` | the next meeting joins Coming up within 14 days, in date order; not beyond | B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on 3878 from `/tmp/tba-preview-projects-r2-meetings`)
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert sign-off (merge gate); privacy folded into the correctness review
- [ ] Browser check: Overview with a throwaway brain holding a meetings cache (no cache, stale, last + next, filed)

## Pre-review outcomes (overseer, 2026-11-23)

Build after five blocking changes, all taken: (1) read the cache only when git ignores it; (2) history keeps ended
meetings only, keyed by id and start, next from the cache alone; (3) no invite title in the prompt; (4) no watcher,
merge at start-up, per read and every 30 minutes; (5) a project with no qualifying words can't title-match. Should,
all taken: `match: 'only'` prompt wording; `meeting_start` match without the tag, `notes` returns the library id;
project settled at meeting-notes step 2, written at step 8; "Notes filed" as text plus an "Open notes" button; a
no-"@" test. Rulings: decision 1 accepted; two domain clients fall to the title; Files-tab call notes and the 7-day
look-back dropped; Coming up merged on the page. Nice, deferred: skip declined meetings (the cache has no response).

## Review outcomes

- **Lead's browser check:** domain matching never worked on real brains: client profiles write
  `- **Website:** https://…` as a bullet and `websiteDomain` wanted the bare form. Fixed, tested with the real format;
  28 of 35 real profiles now give a domain. Added `COMMON_WORDS` (the, and, call, meeting, weekly…) so a project can't
  match on filler words.
- **Correctness reviewer (opus), confirmed and fixed:** (1) an outside guest whose client couldn't be pinned fell into
  the internal/personal pool and could land a client's call on a TDS project → `matchMeeting` returns null when an
  outside, non-public domain is invited and no client matched; (2) a call note tagged for another project within 30
  minutes counted as filed (back-to-back calls), and exactly 30 minutes counted → skipped, strict `<`; (3) no test that
  `startChat` passes `project` → added. Not taken: a test that the merge timer is cleared (nit).
- **Lead:** "File the notes" moved from `api.startSession` to `store.startChat` (now takes `project`) so the Chats list
  refreshes and failures show as elsewhere.
- **UX expert (opus):** signed off after one fix: the phone-width squeeze → `.proj-meeting > .line-text` so the action
  wraps under the text (checked at 390px). `docs/design-system.md` Actions rule 1 gained the Meetings card. Nits left:
  the double colon in "Meeting: Website rebuild: page templates"; quiet "Open notes".
- **Overseer sign-off:** signed off, no blockers. Its help-page catch fixed: Builder B had cut three lines (two of them
  warnings) to stay under 350 words; restored, other wording trimmed.
- **Follow-ups (not blocking):** a guest on public mail with no client can still title-match an internal project
  (consider personal only); history keeps the old project key, so a moved project loses its Last meeting; the Files-tab
  "Call notes" group (decision 8); skipping declined meetings once the cache records a response.
- **Shell.test.tsx:** the End chat confirm test missed its 1s wait in two full runs (as in the v0.68.0 merge, before
  this branch); main and branch passed 8/8 side by side. Its wait is now 5s.
