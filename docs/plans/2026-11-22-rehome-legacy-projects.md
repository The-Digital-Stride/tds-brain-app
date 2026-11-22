# Move the old project folders into their new homes

Date: 2026-11-22. Size L. Follows v0.61.0 (docs/plans/2026-11-22-brain-compat-projects.md).

## Objective

Ian asked for every old top-level project folder to move into its new home. Both apps must then agree:
the Workbench and TDS Cortex show the same project name and the same to-dos.

Ian's decisions (2026-11-22):
- Move all eight live folders and the two archived ones.
- Update every skill, template, script and ignore rule that points at them, in the same step.
- Leave dated records (call notes, notes, done to-dos, plans, client deliverables, `_archive`) as history.
- Convert the 23 unticked `todo.md` checklist items into real to-dos linked to their project, made with
  the `tdsapp-todo` skill, each assigned to the project's Account Owner (open when there is none).
- Both apps use the project card's `title:` as the name.
- Steve gets a to-do: once his Mac has synced, move his own `inbox/` and `shortlists/` folders for AI
  Search Outreach across. Nothing of his is touched.
- No explainer.

## Facts (checked read-only on the real brain)

**The live folders.** All eight have a `project.md` card. All but `supermetrics-studio` have a
`todo.md` with only an `## Active` section: 23 open items, no Backlog.
- `agency-brian-google-ads-manager`: 4 items, Account Owner `pete-tyler`.
- `ai-blueprint`: 4 items, `pete-tyler`.
- `ai-in-your-stride`: 3 items, `ian-hancock`.
- `ai-search-outreach`: 4 items, `pete-tyler`.
- `brain-map`: 3 items, `ian-hancock`.
- `client-portal`: 4 items, `simon-jones`.
- `gads-api-writes`: 1 item, `pete-tyler`.
- `supermetrics-studio`: no checklist, `ben-mcadam`.

**The archived folders.** Both are card-less.
- `uc-multiple-condenser-functionality`: Urban Cooling's (its README says so).
- `aesop-funnel-report`: there's no Aesop client folder.

**Keys.**
- A top-level `projects/<slug>` already has the key `the-digital-stride/<slug>`, and so does
  `clients/the-digital-stride/projects/<slug>`. Moving an internal project keeps its key, so the
  keyed to-dos, bare labels (matched by slug) and the Workbench's key labels keep working.
- The UC archive's key changes to `urban-cooling/uc-multiple-condenser-functionality`. Nothing links
  to it.

**What points at the folders.** These are found by `grep`, outside the folders themselves.
- `ai-blueprint`:
  - the `blueprint-builder` and `blueprint-intake` skills (prompts and references);
  - `templates/blueprint/**`;
  - a `.gitignore` comment;
  - `context/business/services/ai-blueprint-planning-progress.md`;
  - client deliverables (left as history).
- `brain-map`:
  - `.claude/skills/brainmap/scripts/open.cjs:12` builds `path.join(ROOT, 'projects', 'brain-map')`, so the code itself must change;
  - `brainmap/SKILL.md`;
  - `brain-overrides.md`.
- `gads-api-writes`:
  - `.claude/skills/gads-write/SKILL.md`;
  - comments in client build scripts;
  - an open to-do.
- `ai-search-outreach`:
  - its own scripts' usage text;
  - `tools/save-location-baseline.json`;
  - `clients/urban-apothecary/context/business.md`;
  - an open to-do;
  - `.team-config/feedback`.
- The other four: only dated records, or their own files.

**Files git doesn't share.** On other Macs these stay behind in the old folder: Brain Map's
`node_modules`, and AI Search Outreach's `inbox/` and `shortlists/` (its own `.gitignore` moves with
it).
- Cortex already hides a card-less twin of a live key.
- The Workbench's ghost rule (v0.61.0) only covers archived folders and `moved_from`, so it needs one
  more case.

**The Workbench after v0.61.0.**
- Old-style cards come from `projects/*/`.
- Card projects come from `clients/*/projects/*/project.md`. They show the card's title, linked
  to-dos, the folder's `todo.md` open items, Add to-do (as a linked to-do) and a tick. They have no
  Archive button.
- Today's "next action per project" reads only the old-style list.

## Decisions

Revised after the overseer's pre-review (4 blocking, 8 should, 5 nice; all taken). `B/` is the brain.

1. **Two syncs, in this order.**
   - Sync 1 (safe on its own): the Workbench v2 patch (decision 4), `tdsapp-projects` 0.3.2
     (decision 5) and the rules text that is true either way (decision 6, `rehome-rules.md` edits D–G and I).
   - Sync 2, at a quiet time, only after Ian has seen the dry run and said yes: edits A–C (the folders
     have moved) and H (the root `.gitignore` rule; the script refuses without it), then the move,
     rewrites and to-dos (decision 2).
   - Plain: every Mac has the new Workbench and the safety rules before any folder moves.
2. **One-off script `brain-rules/rehome-legacy-projects.cjs`, dry run by default, `--apply` to write.** Never runs git.
   Every step resumes rather than refuses, so a second run after a failure finishes the job without doubling anything.
   - **Preflight** (refuses before any write):
     - the Workbench v2 patch isn't in place;
     - a live source has no card;
     - a target exists with different contents;
     - a payload fails the to-do script's own checks;
     - the assignee isn't in the `roster` reply (owner not on it: open to-do, owner named in the details);
     - a reference to a moved path sits in a file that is on neither the rewrite list nor the history list.
   - **Convert checklists, one item at a time.** Each unticked `## Active` item:
     1. Path text inside it is rewritten to the new place first.
     2. It goes to `tdsapp-todo add`:
        - `title` cut at a word boundary to 200 characters, full text in `body` when cut;
        - assignee is the card's owner;
        - `client: the-digital-stride`, `project: the-digital-stride/<slug>`;
        - `via: "project move"`.
     3. It is ticked in `todo.md` as `- [x] … → todo/<file>`.
     4. Skip rule: an item whose title, project and `source: added from project move` already exist in `todo/` (or `todo/done/`) is only ticked.
     - The agency-brian item that already names `todo/20261116-ads-manager-gate-closes-the-loop.md` is ticked with that pointer, never added: 22 new to-dos.
     - A line under `## Active`: "Moved to to-dos on <run date>: open the project in TDS Cortex or the Workbench."
   - **Move the folders.**
     - The eight live folders: `projects/<slug>` → `clients/the-digital-stride/projects/<slug>`.
     - The UC archive → `clients/urban-cooling/projects-archive/`.
     - The Aesop archive → `clients/the-digital-stride/projects-archive/`.
     - AI Search Outreach's `inbox/` and `shortlists/` stay at the old path on every Mac, this one included (Steve's four tracked files stay tracked; nothing is deleted anywhere). Its `.gitignore` moves with the folder.
     - Brain Map's `node_modules` stays behind (ignored).
   - **Fix relative paths that are one level deeper now:**
     - `ai-in-your-stride/build-kit.cjs:19` (`'../..'` → `'../../../..'`);
     - `ai-search-outreach/scripts/qualify.cjs:59` and `visibility-check.cjs:45` (`'../../..'` → `'../../../../..'`);
     - `ai-blueprint/README.md:32,36` (`../../` gains two levels).
   - **Rewrite references from an explicit file list.**
     - On the list:
       - `.claude/skills/{blueprint-builder,blueprint-intake,brainmap,gads-write}/**`;
       - `templates/blueprint/**`;
       - `.gitignore` (comment);
       - `brain-overrides.md`;
       - `context/business/services/ai-blueprint-planning-progress.md`;
       - `clients/urban-apothecary/context/business.md`;
       - `todo/20261125-gads-write-…md`;
       - the moved folders' README, scripts and `todo.md`.
     - Left as history:
       - changelogs, `.team-config/feedback/**` and `clients/*/created/**`;
       - call notes, notes, done to-dos and plans;
       - `_archive`;
       - inside moved folders: `call-notes/`, `notes/`, `benchmarks/`, `output/`, `graph.js` and `project.md`;
       - the Steve to-do and `tools/save-location-baseline.json` (both describe the four files at their old path).
     - `brainmap/scripts/open.cjs:12` `path.join(ROOT, 'projects', 'brain-map')` is a listed code edit.
   - **Steve's to-do** (assignee `steve-blassberg`, from `roster`): once his Mac has synced, move his private files (`inbox/`, `shortlists/`, prospect screenshots, approval lists) into the same folders under `clients/the-digital-stride/projects/ai-search-outreach/`. Leave the four shared files, and keep the old folder while they are in it.
   - Plain: one careful script moves everything, shows exactly what it will do first, and can be rerun safely.
3. **Cortex.** No code change. Keys and bare labels resolve as before. Until Steve moves his files, the leftover folder shows Cortex's one "same name" note.
4. **Workbench v2 patch** (on top of v1, recorded as `brain-rules/command-centre-v2.patch`).
   - **Ghost rule:** a card-less `projects/<name>/` is skipped when `clients/the-digital-stride/projects/<name>/project.md` exists.
   - **All done:** a card project is "all done" only with no open linked to-dos and no open checklist items (`server.cjs:241` counted only the checklist).
   - **Created by:** git history of the card's current path, else of `projects/<slug>/project.md`, else the card's `created_by`/`owner`.
   - **Archive project** on card projects: runs `tdsapp-projects` `check` and then `archive` with `expect` and `filesExpect`, as Cortex does. It is hidden unless `capabilities` lists `projects-archive-v1`, and shows the script's refusal text.
   - **Score:** count card to-dos in it (`cc.js:103`).
   - **Wording:** "projects/" mentions at `cc.js:11,99` say "project folders".
   - **Today:** unchanged; it already lists my and open to-dos.
   - Plain: the moved projects keep their name, buttons and to-dos on the Workbench.
5. **`tdsapp-projects` 0.3.2.** The archive naming guard (`tdsapp-projects.cjs:1895`) covers every shared project, not only legacy folders.
6. **Rules text.**
   - `save-locations.md:32`: internal projects live in `clients/the-digital-stride/projects/`.
   - `projects/AGENTS.md` and `projects/README.md` say the folders moved.
   - `meeting-notes/SKILL.md:87` prefers the `clients/` folder.
   - `gm/SKILL.md:131` and `briefing-generator/SKILL.md:117` wording.
   - `tools/lib/save-locations.cjs:259`: a warn rule for a new file under `projects/<name>/` when the client-folder twin exists.
   - `time/config/defaults.json:84`: blueprint and gads work keeps its current mapping under the new paths.

## Team

| Role | Model | Owns |
|---|---|---|
| Overseer | fable high | pre-review (done) and sign-off |
| Lead | opus | decisions 1, 3, 5 and 6; dry run; the real run after Ian's yes |
| Migration builder | opus high | decision 2 (hard list: data integrity, a one-off move of shared data) |
| Workbench builder | sonnet medium | decision 4, on a copy of the Workbench |
| Reviewer | opus high | correctness and data integrity of the script, patch and skill |

## Tests

- **Script:** run against a copy of the real brain (not git-synced, rsync'd to scratch).
  - The dry run lists every action.
  - `--apply` moves, converts and rewrites.
  - A second `--apply` changes nothing.
  - An `--apply` stopped half-way, then rerun, ends identical with no duplicate to-dos.
  - The history files are byte-identical.
  - The converted to-dos read back through the app's reader as linked to the right key.
  - `build-kit.cjs --help` and `open.cjs` resolve their paths.
- **Workbench:** a copy of `command-centre` on a spare port against the moved copy.
  - Same names and to-dos as Cortex.
  - The ghost skip.
  - All-done.
  - Archive through the script.
  - The new `cc.js` against the old server.

## Review outcomes

| Lens | Found | Outcome |
|---|---|---|
| Overseer pre-review (fable) | 4 blocking, 8 should, 5 nice | All taken into the decisions above |
| Lead check | Archive button never drawn (flag read after the cards were drawn); bold marks and backticks in titles | Fixed: flag set before drawing; titles are plain words, the item as written goes in the details |
| Correctness and data integrity (opus) | 2 should, 3 consider, 2 nits | "Created by" would credit the mover (git sees a moved folder as added): the old folder's first author now comes first, proved in a scratch repo. Steve's to-do would have deleted private files and four shared ones: rewritten to move only private files and leave the four. Rerun counts `todo/deleted/`. Decision Bench path code: edit I. Edit H moved to sync 2. gm step 5 wording and the archive refusal wording fixed |

Overseer sign-off (fable): two blockers, both fixed: the script now refuses without edit H, and edits
A–C moved to sync 2 (they say the folders have moved), with edit B forbidding deletion of the shared AI
Search Outreach files. Signed off on those fixes.

Rehearsal on a fresh copy of the brain (no git, private folders left out), with sync 1 applied:
- **Dry run:** 108 actions, no refusals.
- **Apply:** 23 to-dos (22 plus Steve's), 23 items ticked, 10 folders moved, 61 files rewritten.
- **Second apply:** 0 changes.
- **Cortex's reader and the patched Workbench agree on every project's name and open to-do count.** The one duplicate is `projects/ai-search-outreach`, until Steve moves his private files.

Applied to the real brain on 2026-11-22 with Ian's yes (files only, no git run):
- **Step 1:** skill 0.3.2, Workbench v2 patch, edits D–G and I.
- **Step 2:** edits A–C and H. Edit B is reworded so it doesn't name the old path: the script's preflight caught the first wording.
- **The move:** the dry run gave the same 108 actions as the rehearsal. `--apply` made 130 changes: 23 to-dos, 10 folders, 61 files. A second run made 0.
- **Checks:** the live Workbench and Cortex's reader agree on every project, and Created by keeps each project's original author.
- **Brain Map:** its local `node_modules` moved to the new folder.
- **Still to do:** `projects/ai-search-outreach/` stays until Steve moves his private files.
