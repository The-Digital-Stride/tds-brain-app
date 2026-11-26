# Changelog

Written automatically. When a `feat`, `fix`, `perf` or `refactor` commit lands on `main` (committed there or merged in), a git hook bumps the version in `package.json` and adds an entry here. See `scripts/bump-version.ts`.

## v0.91.0 — 2026-11-26

- **feat**: a new chat from a project opens beside it, not on Home

## v0.90.1 — 2026-11-25

- **fix**: every drawer over the sheet is as tall as the file viewer

## v0.90.0 — 2026-11-25

- **feat**: an email Claude drafts in a project chat opens in the Gmail window
- **fix**: review fixes for the email card
- **fix**: the subject always reaches Gmail, and three small parsing points

## v0.89.1 — 2026-11-25

- **fix**: an owner or a scout can give every project a code

## v0.89.0 — 2026-11-25

- **feat**: pick who an email goes to; Gmail opens in a small window
- **fix**: safer contact names, quick reads of hostile client files, review wording
- **fix**: pair a name with the address beside it; one-pass heading key
- **fix**: one rule for which name goes with an address
- **fix**: a lone word or a company is not a contact's name

## v0.88.1 — 2026-11-25

- **fix**: Recent cards show my own things, not the team's

## v0.88.0 — 2026-11-25

- **feat**: Recent tasks, chats, documents and images cards

## v0.87.1 — 2026-11-25

- **fix**: no skill shortcuts; Pinned skills card and skills in search for owners and scouts only
- **fix**: no promise of skills in the search box for the team; help names both ways to start a skill

## v0.87.0 — 2026-11-25

- **feat**: Home shortcuts can open a place or a drawer
- **fix**: short shortcut groups first; panel hint names places and drawers

## v0.86.0 — 2026-11-25

- **feat**: email threads find their project and show as one row
- **fix**: review fixes for email threads
- **fix**: number the email threads note for 0.85.0
- **fix**: an email given with a Message-ID and a thread is still known by that Message-ID
- **fix**: number the email threads note for 0.86.0

## v0.85.0 — 2026-11-25

- **feat**: save hidden Home items and shortcuts in settings
- **feat**: choose what shows on Home and add shortcut buttons
- **fix**: Customise Home notes belong to 0.85.0
- **fix**: a stale reload never becomes the list a failed save falls back to
- **fix**: review fixes for Customise Home
- **refactor**: own class prefix for the Customise Home panel; note the accepted reload gap

## v0.84.0 — 2026-11-25

- **feat**: publish facts on permission requests
- **feat**: guard app code for owners and scouts, and confirm every merge or push on a card
- **fix**: close guard gaps from review; clearer merge-and-push card and help
- **fix**: tighten the brain-sync exemption and app marker; time-box the guard's lookups
- **fix**: no brain-sync exemption after a step with command-running options

## v0.83.0 — 2026-11-25

- **feat**: open the app to the whole team for the first release

## v0.82.2 — 2026-11-25

- **fix**: keep the rail's foot the same height when it opens on hover

## v0.82.1 — 2026-11-25

- **fix**: days and weeks stand out on the Meetings card

## v0.82.0 — 2026-11-25

- **feat**: call favourites Pinned, with a pushpin icon instead of the star

## v0.81.0 — 2026-11-25

- **feat**: add Start my day button on Home that runs /gm

## v0.80.0 — 2026-11-25

- **feat**: Recent projects card, newest last-worked first

## v0.79.2 — 2026-11-24

- **fix**: help covers unsaved chats and reading a teammate's task

## v0.79.1 — 2026-11-24

- **refactor**: to-dos are called tasks on every screen
- **fix**: help says tasks instead of to-dos
- **fix**: new screenshots and a What's new note for tasks
- **fix**: name the todo skill clearly and tidy the What's new note

## v0.79.0 — 2026-11-24

- **feat**: save a chat to its project as a summary update
- **fix**: review fixes for chat summaries
- **fix**: chat summary screens follow the design rules
- **fix**: the chat drawer can't save a width wider than it shows
- **fix**: What's new for saving chats to projects

## v0.78.0 — 2026-11-24

- **feat**: Everyone / Mine switch on a project's To-dos tab
- **fix**: Mine switch follows the design rules

## v0.77.0 — 2026-11-24

- **feat**: list and search done to-dos in the drawer
- **fix**: date open-to-anyone done to-dos and keep reveals through a stale list
- **feat**: find done to-dos in search and on project pages
- **fix**: name who ticked a project's done to-dos and tidy the Done tab
- **feat**: open a teammate's to-do read-only from a project page
- **feat**: open a teammate's to-do read-only from the Overview cards
- **fix**: retry a teammate's to-do, keep personal rows out, follow a hand-over
- **fix**: keep finished to-dos in search current with the drawer closed

## v0.76.0 — 2026-11-24

- **feat**: show the client's background on a project's Overview

## v0.75.2 — 2026-11-24

- **fix**: every add opens the full to-do form

## v0.75.1 — 2026-11-24

- **fix**: What's new note for 0.75.0 (the fresh tour)

## v0.75.0 — 2026-11-24

- **feat**: tour shows Projects, Working on, the Workbench, Images and Documents and Home's cards; keeps up by itself

## v0.74.1 — 2026-11-24

- **docs**: help caught up with v0.55 to v0.74: What's new notes for each release, 14 pages fixed against the app, Home screenshot retaken

## v0.74.0 — 2026-11-24

- **feat**: every chat drafts email for projects, never reads the drafts (R2 phase 5)
- **feat**: email entries approved by the inbox owner (R2 phase 5)
- **fix**: email approval wording, Save says why, own help page, never an address (UX review)
- **fix**: one name per line keeps 'Smith, Alex' whole; an email may have no subject (correctness review)
- **fix**: approve key lives outside the brain; guard checks paths, never prose (security and correctness reviews)
- **fix**: guard resolves . and .., catches shell writes into updates/, walks repeated globs (fix-round review)
- **fix**: updates guard checks each shell command part; the skill's own update-remove runs (fix-round recheck)
- **fix**: updates guard follows cd and pushd; residual risk worded exactly (overseer sign-off)

## v0.73.2 — 2026-11-24

- **fix**: Projects sits straight under Home in the main menu

## v0.73.1 — 2026-11-24

- **fix**: card grips always visible

## v0.73.0 — 2026-11-24

- **feat**: drag Home's cards into your own order, kept per person in this browser
- **fix**: card order keeps hidden Ads approvals in place; focus only after a real move; reset focuses the first grip

## v0.72.1 — 2026-11-24

- **fix**: code note no longer promises email matching before it exists

## v0.72.0 — 2026-11-24

- **feat**: invite links on every meeting and a Home meetings read
- **feat**: Home meetings card; invite and Join links on project meetings
- **fix**: compact Home meetings card after design review
- **fix**: narrow Home meetings card keeps the project link visible
- **fix**: Home meeting meta wraps so the project link is never cut off
- **fix**: full meeting title on hover; review outcomes

## v0.71.0 — 2026-11-24

- **feat**: shared rules for reading project codes
- **feat**: project codes on cards, pages, search and meetings (R2 phase 4b)
- **fix**: full git history for old codes, show the retry reason, hide personal codes from search
- **fix**: project code UI after UX review (duplicate shows no Copy, focus, status line, wording)
- **fix**: codes ignore archived projects for meetings; show only known ref reasons

## v0.70.0 — 2026-11-24

- **feat**: show claude.ai artifacts in projects as copies or link cards
- **fix**: review fixes for claude.ai pages in projects
- **fix**: plainer words for claude.ai pages (UX review)
- **fix**: re-read claude.ai tags for html entries saved without them

## v0.69.0 — 2026-11-23

- **feat**: meetings on the project home, from your own calendar
- **fix**: read a client's Website line written as a bullet
- **fix**: tighten meeting matching after review

## v0.68.1 — 2026-11-23

- **refactor**: remove due reminders from Ads Command Centre
- **fix**: keep the start-up board load so search still finds Ads tasks

## v0.68.0 — 2026-11-23

- **feat**: Since you last looked stays until you press Clear; its file rows open the file in Documents or Images
- **refactor**: one shared LibraryBrowser for Documents and Images, ready for a project's Files tab
- **feat**: a project's Files tab uses the shared library browser: kind switch, type filter, sort and layout
- **fix**: Files tab groups files by where they sit in the project, the kind switch keeps its width, and the tabs row wraps on a phone
- **fix**: review fixes: kind switch width and Tab order, fixed group order, Home's project picker cleared when opening a file outside it, one note after Clear, help trimmed
- **fix**: switching Documents/Images keeps keyboard focus; a Clear that finishes after a project switch says nothing; review outcomes

## v0.67.1 — 2026-11-23

- **fix**: activity rows only open a to-do the panel can show; the panel stops waiting for one that never arrives
- **fix**: an activity row that switches tab puts focus on that tab; the rule written into the design system
- **fix**: the panel also gives up when the to-do list never loaded

## v0.67.0 — 2026-11-23

- **feat**: what changed since you last looked, and what's coming up
- **fix**: a linked file outside the project reads as Linked; no doubled name on update rows
- **fix**: a teammate's note that syncs in late still shows; your own personal to-do ticks aren't listed back
- **fix**: activity cards follow the design system (five rows then Show more, end date row doesn't lift, one empty-state size)
- **fix**: an old update paged back in isn't new; a new project starts folded; one-change wording; badge tones in the design system

## v0.66.0 — 2026-11-23

- **feat**: updates log on each project
- **fix**: updates log uses the app's health words, keeps focus, explains archived
- **fix**: Remove only where the script allows it; names and edited entries read right
- **feat**: nothing from an email reaches a project without the inbox owner's yes
- **fix**: Updates tab follows the design system
- **fix**: the Updates form's Kind switch fits its words; design sign-off recorded

## v0.65.1 — 2026-11-23

- **fix**: a message Claude Code held back shows why, with Send again
- **fix**: Send again re-levels in auto mode, is marked sent, and is accessible
- **fix**: a message sent again counts once towards the kept-model turns

## v0.65.0 — 2026-11-23

- **feat**: chats remember their project and Claude files its work there
- **fix**: a woken chat remembers the place it was given; review fixes
- **fix**: Chats labels prefer the live project at a key over a moved one
- **fix**: a woken chat never saves the page's place over one that couldn't be read

## v0.64.3 — 2026-11-23

- **fix**: a message sent in a chat that went to sleep reopens it
- **fix**: a woken chat keeps its client and to-do; /clear works after a restart

## v0.64.2 — 2026-11-23

- **fix**: proposal panel's Previous/Next stay fixed above the proposal
- **fix**: panel's discard strip sticks to the top of the proposal; design doc names the stepper's band

## v0.64.1 — 2026-11-23

- **fix**: filters stay fixed in every drawer; hard cut with a lift on scroll, no fade
- **fix**: panel switch matches drawer inset; content's own sticky bands cover the edge shadow

## v0.64.0 — 2026-11-23

- **feat**: leaving a page asks before discarding typed work; one file language; health words
- **fix**: a Projects search hit while Projects shows asks before replacing a changed form
- **fix**: star and chat only on my to-dos on a project page
- **fix**: design gate - every project form asks before leaving; Keep puts you back
- **fix**: All projects, Edit and the picker's Close ask before dropping unsaved work

## v0.63.0 — 2026-11-23

- **fix**: release 1 of UX consistency - shared file-stage styles, one small size, health in words, drift guard
- **fix**: drift guard counts repeats, reads @layer, finds eager code by imports; design system Actions section
- **feat**: one Undo line for to-dos, files and chats; deleting a chat can be undone
- **fix**: an Undo line that goes away while held restarts the clock, so the hold still sends
- **feat**: release 2 of UX consistency - one action standard across the app
- **fix**: project Edit at the right, back chevron points left, Ads period options stay on one line
- **fix**: keep Working on when a Home to-do opens, clear discarded typing, keep focus on a Home card after unfavouriting
- **refactor**: shared pieces built once - notice, dot, form field, popover, stat, panel head, Confirm, ShowMore, StateNote, useCopy
- **refactor**: every copy swapped to the shared pieces; old classes deleted
- **fix**: release 3 review - update buttons stay together, Ads load errors are errors, high-contrast marks
- **refactor**: CSS layers, scale tokens, primitives.css and settings.css
- **refactor**: every size, radius, layer, timing and colour from tokens; guard locked
- **fix**: final critique - working is blue, Ads stepping asks before discarding, busy buttons stay focusable
- **feat**: the Ads panel asks before discarding typed work
- **fix**: pin the Rate calls footer so Save stays in view; doc matches the screens
- **fix**: the panel hold covers tool tabs, a shut panel and the first proposal
- **fix**: the pinned Rate calls footer is solid and covers the panel's bottom padding

## v0.62.0 — 2026-11-22

- **feat**: show the app version and an update button at the foot of the rail

## v0.61.4 — 2026-11-22

- **fix**: documents and images always open in the viewer drawer
- **fix**: project files open in the drawer at once; the library name follows
- **fix**: keep the opener's delete choice on refresh; Open in Documents shows the details panel

## v0.61.3 — 2026-11-22

- **fix**: move the old project folders into clients/ (tdsapp-projects 0.3.2, migration, Workbench v2)
- **fix**: the move refuses without the ignore rule; moved-wording waits for the move

## v0.61.2 — 2026-11-22

- **fix**: Project box shows just the project name, grouped under its client

## v0.61.1 — 2026-11-22

- **fix**: Skills sits above Help and is for owners and scouts only

## v0.61.0 — 2026-11-22

- **feat**: keep the brain working with projects in their new homes
- **feat**: Workbench patch that shows projects in client folders
- **fix**: review fixes for the brain compatibility work
- **fix**: Workbench refreshes project cards after a linked to-do is ticked

## v0.60.1 — 2026-11-22

- **fix**: show each client's real name

## v0.60.0 — 2026-11-22

- **feat**: archive, unarchive and delete a project
- **fix**: close the owner-claim delete hole and review findings
- **fix**: leftover delete needs the owner unless nothing synced

## v0.59.2 — 2026-11-22

- **fix**: tidy the to-do row layout

## v0.59.1 — 2026-11-21

- **fix**: line every sheet up to one gutter

## v0.59.0 — 2026-11-21

- **feat**: link several files to a project at once

## v0.58.2 — 2026-11-21

- **fix**: tidy the drawer's filters and rows
- **fix**: Asked rows don't repeat the filtered project either

## v0.58.1 — 2026-11-21

- **fix**: use a folder icon for Projects instead of a calendar

## v0.58.0 — 2026-11-21

- **feat**: move a project to another client

## v0.57.0 — 2026-11-21

- **feat**: Working on and Chat for together inside the message box

## v0.56.0 — 2026-11-21

- **feat**: one project filter across Mine, Open and Asked, with project chips on rows

## v0.55.0 — 2026-11-21

- **feat**: release 1 of the projects system
- **fix**: review fixes for release 1
- **fix**: line up teammates' to-do rows with your own on a project's To-dos tab
- **fix**: sign-off and fix-round review items

## v0.54.1 — 2026-11-20

- **fix**: to-do panel ticks show at once, brain-file links keep their checklists, and retries keep the title history

## v0.54.0 — 2026-11-20

- **feat**: tabs for General, Claude, Skill levels, Health and About
- **fix**: the to-dos link lands on its switch when a drawer covers the sheet
- **fix**: the Settings link closes an open to-do panel when already on Settings
- **fix**: with the drawer floating, the Settings link asks about unsaved changes once

## v0.53.1 — 2026-11-20

- **fix**: ticks and saves in the to-do panel no longer fail with "That change wasn't understood"

## v0.53.0 — 2026-11-20

- **feat**: rail slides out on hover; tabs for the Ads tools
- **fix**: rail hover opens after a pop-up closes; focused toggle is visible
- **fix**: pinning names from the hovered rail no longer dips its width

## v0.52.0 — 2026-11-20

- **feat**: names instead of usernames, the due count from start-up, Previous and Next in the proposal panel

## v0.51.0 — 2026-11-20

- **feat**: Release 2 - all accounts' standups, 7/30/90-day totals, earlier months, result links, record and draft

## v0.50.0 — 2026-11-19

- **feat**: split the Ad Manager into three Ads tools under a foldable Ads group

## v0.49.1 — 2026-11-17

- **fix**: Ad Manager review fixes: one waiting count, no phantom selection, focus to the proposal, tidier type and spacing
- **fix**: a narrow proposals table keeps Details in view
- **fix**: Details moves focus to the title only when the panel is already open

## v0.49.0 — 2026-11-16

- **feat**: tool chats open in a drawer on the right, so Ad Manager's board stays in view while Claude works
- **fix**: chat drawer review fixes: Esc under a floating drawer, typed text kept on Open full screen, sized by the sheet
- **fix**: chat drawer header matches the viewer's, and the attached-files note clears

## v0.48.0 — 2026-11-16

- **feat**: Ad Manager run times shared with the team through the brain
- **fix**: run log compaction never follows a planted link, and junk files can't hide real runs
- **fix**: run log compaction keeps only tasks on the list

## v0.47.1 — 2026-11-16

- **fix**: keep a bare web address bare when its paragraph is edited

## v0.47.0 — 2026-11-16

- **feat**: Ad Manager task cards show when each task last ran, and Running while its chat works
- **feat**: Ad Manager report tables as one shared table, reorderable and full-width, laid out as you leave them
- **fix**: review fixes for the Ad Manager tables and run times

## v0.46.1 — 2026-11-16

- **fix**: Ad Manager cadence cards in two columns so each task has room
- **fix**: Ad Manager cadence cards go to one column at the same width as the other trays
- **refactor**: clear every lint warning

## v0.46.0 — 2026-11-16

- **feat**: Workbench section and Ad Manager tool
- **fix**: keep Apply locked after a disagreeing read-back on a re-appliable proposal
- **fix**: security review of Ad Manager
- **fix**: correctness review of Ad Manager (server)
- **fix**: UX, accessibility and correctness review of Ad Manager (client)
- **fix**: recheck of Ad Manager fixes
- **fix**: exit-4 guard fails closed; what's-new note for the Workbench

## v0.44.0 — 2026-11-16

- **feat**: files on to-dos (link from the library or upload)

## v0.43.1 — 2026-11-16

- **fix**: "Show N more" expands Home's pinned cards in place

## v0.43.0 — 2026-11-16

- **feat**: show to-dos you've asked of others and each to-do's history

## v0.42.0 — 2026-11-16

- **feat**: open to-dos in a wide panel with a rich-text editor

## v0.41.1 — 2026-11-15

- **fix**: Home help says what the What's new card is and how to close it

## v0.41.0 — 2026-11-15

- **feat**: delete images and documents from the library, kept 30 days and logged

## v0.40.0 — 2026-11-15

- **feat**: TDS Brain is now TDS Cortex, with a first-run tour and What's new

## v0.39.0 — 2026-11-15

- **feat**: Help is for everyone who uses Cortex

## v0.38.0 — 2026-11-15

- **feat**: Cortex Guide, help in search, Settings help links and every help page

## v0.37.0 — 2026-11-15

- **feat**: help engine, owners-only Help drawer and scripted help screenshots

## v0.36.0 — 2026-11-15

- **feat**: kit logic, savings ledger, Tokens saved panel and the tdsapp-kits brain skill
- **feat**: wire the kit tracker and savings ledger into chats (shadow mode)
- **fix**: review fixes: typed names only count as real skills, salt repair, stdin cap, clearer copy, guard tests
- **fix**: kit pick gets its own query so level picks stay exactly as before; close the sync switch's env back door
- **fix**: never pick a reopened chat's kit from a later message

## v0.35.0 — 2026-11-15

- **feat**: pinned to-dos, chats and files on Home, with a star on files

## v0.34.0 — 2026-11-15

- **feat**: drag the pop-up viewer's left edge to make it wider
- **feat**: show a grip on the viewer's edge so it reads as draggable
- **fix**: a quiet grip bar in the design system's language instead of the dotted pill
- **fix**: grip visible at rest (grey-dot), fill-only hover, recorded in the design system
- **fix**: show the resize grip's tooltip beside it, not at the top of the window
- **fix**: a click on the grip saves nothing, no grip without room to move, screen reader details

## v0.33.0 — 2026-11-15

- **feat**: contract for opening a page's links in a new tab
- **feat**: open page links in a new tab, show pages saved by scripts, keep libraries fresh, sweep leftovers
- **fix**: let a page's own link handlers win, rebuild script-made pages on replay, allow coarse file times
- **fix**: say quick pages go to personal/, as the brain's save rules do, not an unnamed scratchpad
- **fix**: clearer stop notice and save choice, explainer says what is built
- **fix**: offer the client's folder first in a client chat, and open a page's file link as the page
- **feat**: show the brain's templates in Documents, and pages Claude makes with a script
- **fix**: the page viewer's message box is the chat's own, so its ring and red Stop match

## v0.32.0 — 2026-11-15

- **feat**: compaction notice, context meter, brain-aware summaries and held model switches
- **fix**: review fixes for the meter, Context panel and summaries

## v0.31.0 — 2026-11-14

- **feat**: open Claude's published pages in the app, suggest changes and convert to TDS branding
- **feat**: pages are the HTML Claude writes; TDS-branded download and filing
- **fix**: keep pages in the chat state; plain version names; no republish talk without a link
- **fix**: show the TDS logo as a picture so a logo file can never run script in a client copy
- **fix**: self-contained branded copies, sandboxed library pages, replay parity
- **fix**: stop a page that leaves for another site instead of reloading it; keep deferred script order
- **fix**: say to download a branded copy that is too large to file
- **feat**: Claude asks where a new document goes when nobody has said
- **feat**: open the page Claude made when its turn ends; never a browser window
- **fix**: keep showing a closed chat's latest page, open late file lists, save changes back to the page

## v0.30.0 — 2026-11-14

- **feat**: search logic and client codes for the client picker
- **feat**: type-to-search client picker in place of the client selects
- **fix**: picker selects the name again so typing replaces it
- **fix**: keep the name selected on a real click; codes in Library
- **fix**: picker chevron points up while the list is open
- **fix**: picker double-click keeps the name selected; sign-off tidy-ups

## v0.29.2 — 2026-11-14

- **fix**: star skills as favourites, like chats and to-dos

## v0.29.1 — 2026-11-14

- **fix**: navy Send with a paper-plane icon, to pair with Stop

## v0.29.0 — 2026-11-14

- **feat**: Stop takes Send's place while Claude works

## v0.28.1 — 2026-11-14

- **fix**: give a to-do's title the row's full width

## v0.28.0 — 2026-11-14

- **feat**: tooltips on every icon-only button

## v0.27.2 — 2026-11-14

- **fix**: show a link icon on Web links rows

## v0.27.1 — 2026-11-14

- **fix**: show the chat icon on a to-do's chat button

## v0.27.0 — 2026-11-14

- **feat**: star a to-do to keep it at the top of the To-dos drawer
- **fix**: start a chat from a to-do's arrow button, not the whole row
- **fix**: read a to-do's details with its chat button

## v0.26.0 — 2026-11-14

- **feat**: star a chat to keep it at the top of the Chats drawer

## v0.25.1 — 2026-11-14

- **fix**: refuse rule-breaking helper calls instead of rewriting them, so auto mode runs them

## v0.25.0 — 2026-11-14

- **feat**: show each chat's helpers in the Chats drawer

## v0.24.0 — 2026-11-14

- **feat**: delete an earlier chat by moving it to the Bin

## v0.23.0 — 2026-11-14

- **feat**: the app picks Quick, Standard or Deep for each chat, with team levels per skill
- **fix**: the chat level answer matches what the page expects
- **fix**: level line and offer review fixes
- **fix**: skills with their own setting skip team levels, and a stopped /skill resets the level line
- **feat**: the app's own helpers (scout, worker, expert) each run on the right model
- **fix**: Choose myself applies to open chats straight away again

## v0.22.0 — 2026-11-14

- **feat**: TDS / Personal kind for chats, with a filter in the Chats drawer

## v0.21.0 — 2026-11-14

- **feat**: remove the Steps tab from the This chat panel

## v0.20.0 — 2026-11-14

- **fix**: hide background helper notices when reopening a chat
- **feat**: fold Claude's working notes into What Claude did and the Steps tab
- **fix**: keep answers and single folds around hidden helper turns; review fixes
- **feat**: show helpers' reports inside What Claude did; give the fold its own panel
- **fix**: review fixes for helper reports and the fold panel

## v0.19.0 — 2026-11-14

- **feat**: choose the model and effort for chats in Settings

## v0.18.0 — 2026-11-14

- **feat**: show each chat's model and effort under the message box

## v0.17.1 — 2026-11-14

- **fix**: link a short file name only in a folder its own reply names
- **fix**: no lone-name links in a reply that names two clients' folders

## v0.17.0 — 2026-11-14

- **feat**: open chat files in a viewer over the chat
- **fix**: file viewer review follow-ups

## v0.16.2 — 2026-11-14

- **fix**: chat files count shell reads and short names in replies
- **fix**: chat files review follow-ups for shell reads and short names
- **fix**: grep flag values and git -am are not taken as files read

## v0.16.1 — 2026-11-13

- **fix**: chat files follow-ups
- **fix**: chat files review follow-ups

## v0.16.0 — 2026-11-13

- **feat**: chat files tracker, library lookup, Files tab and reply links
- **feat**: send each chat's files to the page and serve what changed
- **fix**: chat files review findings
- **fix**: restore chat styles lost in the review fixes
- **fix**: restore chat styles lost in the review fixes

## v0.15.0 — 2026-11-13

- **feat**: inline Open on library items; Documents drops ticks; search closes the drawer

## v0.14.0 — 2026-11-13

- **feat**: work out a new chat's client from its first message
- **feat**: count how each new chat's client is decided

## v0.13.1 — 2026-11-13

- **fix**: opening an app closes the open drawer

## v0.13.0 — 2026-11-13

- **feat**: approval cards for file edits show the actual change

## v0.12.1 — 2026-11-13

- **fix**: chat text wraps to the panel instead of running off the side

## v0.12.0 — 2026-11-13

- **feat**: one button language across the app

## v0.11.1 — 2026-11-13

- **fix**: personal to-dos no longer show up as documents

## v0.11.0 — 2026-11-13

- **feat**: search results show their full details in a tooltip

## v0.10.0 — 2026-11-13

- **feat**: to-dos show who passed them on, New to you, TDS or personal, search and a quick add
- **feat**: one search finds to-dos, chats, skills, clients, images and documents

## v0.9.1 — 2026-11-13

- **fix**: a test copy of the app no longer signs you out of the live one

## v0.9.0 — 2026-11-13

- **feat**: in-app updates - TDS Brain checks GitHub main and updates itself with one click

## v0.8.2 — 2026-11-13

- **fix**: show/hide toggles are icons only, always at the top right

## v0.8.1 — 2026-11-13

- **fix**: version history folds use the same chevron as the to-do list

## v0.8.0 — 2026-11-13

- **feat**: prompt to reload when the app has been updated

## v0.7.0 — 2026-11-13

- **feat**: version history in Settings for owners and scouts

## v0.6.0 — 2026-11-13

- **feat**: tdsapp-todo skill v0.3 with 13 backward-compatible fixes
- **fix**: after a to-do conflict, keep a teammate's untouched fields and show what they changed

## v0.5.0 — 2026-11-12

- **feat**: add, edit, pass on, re-date and delete to-dos through the brain's todo skill
- **feat**: undo for 10 seconds after ticking, deleting or passing on a to-do
- **feat**: finish a to-do from inside it, with no tick box in the list
- **feat**: keep deleted to-dos in todo/deleted/ with who, when and from where

## v0.4.0 — 2026-11-12

- **feat**: brain skills to install, update and check the app, fully guided

## v0.3.0 — 2026-11-12

- **feat**: setup screen chooses the brain folder when none is usable

## v0.2.0 — 2026-11-12

- **feat**: TDS Brain runs by itself on macOS, installs as a Dock app, opens Settings with how it's running, and has a blue brain icon

## v0.1.0 — 2026-11-11

- **feat**: first version of the TDS Brain App: chats, to-dos, the app shell, and the image and document library
