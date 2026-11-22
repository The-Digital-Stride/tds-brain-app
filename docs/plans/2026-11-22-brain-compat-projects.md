# Brain compatibility for the projects system

Date: 2026-11-22. Size L. Follows a read-only Fable review of the brain against v0.60.1.

## Objective

The agency brain keeps working exactly as it does today, whether people use TDS Cortex or not.

- People who haven't moved to Cortex keep seeing what they see now on the Workbench (`tools/members/command-centre`).
- The brain's own tools and rules cope with projects in their new homes (`clients/<c>/projects/<slug>/`, `personal/projects/<slug>/`, `projects-archive/`).

Ian chose to let the `team` role change projects, as the projects plan said ("anyone on the team").

## Facts (checked)

- **The Workbench is `tools/members/command-centre`.** It is tracked in the brain, so it reaches every Mac at the next sync. The server needs restarting to load new code.
  - It is not the same as the skill copy in `.claude/skills/workbench/assets/app`, which is the generic library version and is left alone.
  - Its `lib/todo-parser.cjs` lists only `projects/*/`. A project card shows `## Active` items from `projects/<name>/todo.md`.
  - The card's endpoints `tick`, `add-todo` and `archive` take a name matching `^[A-Za-z0-9][A-Za-z0-9 ._-]*$`. A name with a slash is refused, so none of them can write outside `projects/`.
  - Archive renames on a clash (`<name>-2`), which breaks the project's key.
  - `cc.js:1252` shows a to-do's raw `project:` value. Since the tidy-up, that value can be a key (`the-digital-stride/client-portal`) where it used to be a label.
- **Old internal-meeting wording.** `meeting-notes/SKILL.md:84-86`, `.claude/rules/transcripts.md:12,14` and `AGENTS.md:134` file internal work under `projects/<project>/`. For a project that lives elsewhere, this makes a card-less twin that blocks archive and move.
- **`tools/find-call-note.cjs:101`** searches `clients/` and `projects/` only.
- **The tidy-up's placeholder list.** `server/brain/tidy.ts:39` lists only `optional-project-slug`; the brain template now says `optional-project-key`.
- **The archive guard.** `filesNaming` in `tdsapp-projects.cjs` treats `tools/save-location-baseline.json`, a data list, as a writer, which blocks archiving `ai-search-outreach`.
- **Roles.** All six `tdsapp-*` skills say `roles: owner, scout`. The app's `mayChange` (`server/brain/index.ts:95`) follows the skill's `roles:`. The script separately requires a `roles.json` member and keeps owner changes and delete to the Account Owner or the Owner.
- **Old checklists in Cortex.** Cortex shows a legacy `todo.md` only as a path ("Old checklist") and counts none of its items. There are 23 unticked items across 7 projects.

## Decisions

1. **Workbench, legacy projects unchanged.** Top-level `projects/*/` cards keep their names, titles, order, to-dos, buttons and behaviour. The only change is that dot-folders are skipped (`.deleting~` leftovers).
   Plain: nobody's existing project cards change.
2. **Workbench, new-home projects appear.** Each `clients/<c>/projects/<slug>/project.md` gets a card, and so does each `personal/projects/<slug>/project.md` (own Mac only, git-ignored).
   - Projects with `status: done` and anything in `projects-archive/` are left out.
   - The card's `name` is the key; its title comes from the card's `title:`, followed by the client name.
   - Its to-dos are the open `todo/*.md` files whose `project:` is that key, or one of its `moved_from` keys.
   - Tick uses the existing loose-to-do tick (`/api/todos/tick`, which moves the file to `todo/done/`). The Workbench already does this for those files.
   - There is no todo.md "Add to-do" and no Workbench Archive on these cards. Cortex owns those, and the endpoints refuse a slash name anyway.
   - Dispatch tells the session to read `<folder>/project.md` and the folder's notes.

   Plain: projects made in Cortex show on the Workbench with their to-dos.
3. **Workbench archive never renames.** If `projects-archive/<name>` exists, the request is refused with a clear message, so keys stay stable.
   Plain: archiving can't quietly change a project's name.
4. **Workbench shows a project name, not a key.** A to-do's `project:` that matches a project key (a card, or a legacy folder under the-digital-stride) shows that project's title. Anything else shows as it does today.
   Plain: to-dos read the same as before the tidy-up.
5. **Brain wording for internal project notes.** The meeting-notes, transcripts and root `AGENTS.md` lines say to file in the project's existing folder, wherever it lives (`projects/<p>/`, or `clients/<c>/projects/<p>/`). Only a brand-new internal project goes in `projects/<p>/`. Never make a second folder with the same name.
   Plain: meeting notes go to the project's real folder.
6. **Call-note search covers archives.** `find-call-note.cjs` also searches `projects-archive/`. `clients/` already covers client archives.
7. **Placeholder.** Add `optional-project-key` to `PLACEHOLDER_LABELS`.
8. **Archive guard ignores data lists.** `filesNaming` skips `tools/save-location-baseline.json`. The script becomes v0.3.1, with no capability change.
9. **Team role can change projects.** `tdsapp-projects` SKILL.md says `roles: owner, scout, team`. The script's own rules are unchanged: only a `roles.json` member may change a shared project, and only the Account Owner or the Owner may delete or change the owner. The other `tdsapp-*` skills are out of scope.
   Plain: Alex and Ben can create, archive and delete their own projects.
10. **Cortex shows old checklist items.** The project card gains `checklistOpen: string[]`, the unticked `- [ ]` items in `todo.md` `## Active`, at most 20. The field is additive and optional. The "Old checklist" card lists them, saying they are still on the Workbench; it stays read-only. To-do counts are unchanged.
    Plain: Cortex shows the same project to-dos the Workbench does.
12. **Anyone on the team can rename a project** (Ian, 2026-11-22).
    - The title has no rule of its own. The script's `card` action and the edit form both allow it for anyone who may change the card.
    - So decision 9 is what opens it to the `team` role. It covers any card that isn't archived; a legacy folder needs a card added first ("Add a card").
    - The folder name (slug) and key never change, so links, to-dos and the Workbench keep working.
    - Tests: a team-role member renames through the script, and the app lets a team-role member change projects.

    Plain: anyone on the team can change a project's name; its folder stays put.
11. **How brain edits are recorded.**
    - Text edits go into `brain-skills/tdsapp-projects/brain-rules/` as before ("current passage → replacement").
    - The Workbench change is a patch file there, `command-centre.patch`.
    - Ian approved applying all of them. Apply as file writes only, never git in the brain.

    Plain: every brain change is written down in the app repo first, then copied in.

## Changes from the overseer's pre-review (2026-11-22)

- **Blocking 1:** `getProjectsList()` output stays exactly as today, because Today and "next action" read it. New-home cards come from a separate reader, merged only in `/api/projects`. A before/after `/api/today` equality check covers it.
- **Blocking 2:** a card-less `projects/<name>/` is skipped when `projects-archive/<name>/project.md` exists, or when a live card's `moved_from` lists `the-digital-stride/<name>`. These are the app's own twin rules. They hide the ghost folders git leaves behind on other Macs after a Cortex archive or move.
- **Decision 2 refined:**
  - Personal projects stay off the Workbench.
  - A card shows everyone's linked to-dos, assignee shown, first three plus a count. They live in their own field, so the "Loose to-dos" scorecard doesn't change.
  - A card also lists its folder's own `todo.md` `## Active`, ticked through a key the server resolved from its own scan.
  - Empty-state text and footer are its own.
  - "Add to-do" goes through `/api/todos/add` with an optional `project`, accepted only when it equals a scanned live shared key. The server writes `client:` and `project:` the way tdsapp-todo does.
  - There is no Archive button.
  - The creator comes from `created_by`, not a git call.
  - Ticking reloads both lists.
- **Dispatch:** a key resolves to its folder from the server's scan; an unknown key gets a 400.
- **Archive:** also refused when `clients/the-digital-stride/projects-archive/<name>` exists.
- **Labels:** to-do labels also map `moved_from` and archived keys.
- **The server restart:** the server restarts itself when a file changes, but not when someone started it in a terminal. So every new field is optional, and the new `cc.js` must work against the old server.
- **`find-call-note`:** files in a client project folder's root count (done in the edit).
- **`/gm`'s todo.md nudge** skips card-less ghosts (decision 2 rules).
- **Applying the patch:** `command-centre.patch` goes in with `patch --dry-run` first. Stop on any mismatch.
- **Decision 9 corrected:** any `roles.json` member may edit, move and archive any shared project, and delete stays with the Account Owner or the Owner. The skill's "in testing until Pete releases it" line needs Pete's yes before the brain copy changes.

13. **Owners and scouts can change any project's Account Owner** (Ian, 2026-11-22). `ownerChangeRule` allows the Account Owner, role `owner` or role `scout`; on a card with none, an owner or a scout. The same applies to naming an owner on a card-less folder's new card.
    - Delete keeps `ownerRule`: the Account Owner or the brain's Owner.
    - Note: a scout can make themselves Account Owner and then delete. The change is visible on the card.

    Plain: Pete, Ian and Simon can hand any project to someone else.

## Team

| Role | Model | Owns |
|---|---|---|
| Overseer (pre-review, sign-off) | fable high | — |
| Lead | opus | decisions 5–11 (app, script, skill, rules text), plan, applying to brain |
| Workbench builder | sonnet medium | decisions 1–4, on a scratch copy of `tools/members/command-centre`, output `command-centre.patch` |
| Explainer draft | sonnet medium | one self-contained HTML page |
| Reviewers | opus high (correctness, security: roles), sonnet medium (UI) | — |

## Tests

- Lead:
  - a `tidy.ts` placeholder test;
  - a script test that a baseline JSON naming a project doesn't block archive;
  - a `projects.ts` test for `checklistOpen`.
- Workbench builder: a node check against a temp brain copy that covers:
  - legacy cards unchanged (before and after JSON equal for top-level projects);
  - new-home cards and their to-dos;
  - done and archive exclusion;
  - dot-folder skip;
  - archive clash refused;
  - key-to-title labels.

## Review outcomes

(filled at the end)
