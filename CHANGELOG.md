# Changelog

Written automatically. When a `feat`, `fix`, `perf` or `refactor` commit lands on `main` (committed there or merged in), a git hook bumps the version in `package.json` and adds an entry here. See `scripts/bump-version.ts`.

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
