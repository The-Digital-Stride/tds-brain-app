# Brain rules for the Projects system (release 1)

Proposed text for six brain files, for Ian to paste in by hand. The app and its tooling never write
the brain. Each file here has a "Why", the exact current passage (quoted from the real brain file on
2026-11-21) and the replacement.

## Before you start

Apply these only after the `tdsapp-projects`, `tdsapp-todo` v0.6 and `tdsapp-files` v0.3 skills are
copied into the brain. The text tells every session to use them, so applying it first would point
people at actions that don't exist yet. If a "current passage" no longer matches, the brain file has
changed: re-read it and adjust the edit rather than overwriting.

## Order and one-line checks

| # | File here | Brain file | Check after applying |
|---|---|---|---|
| 1 | `clients-AGENTS.md` (3 edits) | `clients/AGENTS.md` | `grep -n "^## Projects" clients/AGENTS.md` finds one heading |
| 2 | `todo-AGENTS.md` (3 edits) | `todo/AGENTS.md` | `grep -n "^## Project and stage" todo/AGENTS.md` finds one heading |
| 3 | `personal-AGENTS.md` (1 edit) | `personal/AGENTS.md` | `grep -n "^## Personal projects" personal/AGENTS.md` finds one heading |
| 4 | `projects-AGENTS.md` (2 edits) | `projects/AGENTS.md` | `grep -c "clients/the-digital-stride/projects" projects/AGENTS.md` is at least 1 |
| 5 | `save-locations.md` (2 edits) | `.claude/rules/save-locations.md` | `grep -c "Ongoing internal project documents" .claude/rules/save-locations.md` is 0 |
| 6 | `client-setup-SKILL.md` (2 edits) | `.claude/skills/client-setup/SKILL.md` | `grep -c "projects/\`, \`context/memory/\`" .claude/skills/client-setup/SKILL.md` is 1 |

Clients first, because the other files point at its "Projects" section.

## Notes

- Nothing is renamed and nothing is moved. Old `project:` labels and `projects/` folders keep working.
- `client-setup` is deliberately not asked to pre-create `projects/`: git doesn't keep empty
  folders, and the skill pre-creates only folders that carry a README. `tdsapp-projects` makes the
  folder with the first project.
- Then save and sync as usual so the team gets the text.

## Archive and delete (tdsapp-projects 0.3)

Each of the files below has a new "Archive and delete" section at the end, for the
`projects-archive/` folders and the skill's `archive`, `unarchive` and `delete` actions
(docs/plans/2026-11-21-project-archive-delete.md, decision 14). They apply on top of the release 1
edits, which are already in the brain, so each "current passage" quotes that text as applied.

### Before you start

- Copy `tdsapp-projects` 0.3 into the brain first, and make sure every Mac runs the TDS Cortex release
  that reads the archive folders before anyone archives: older apps don't see archived projects.
- Check the brain's `.gitignore` ignores names ending in `~` (a `*~` line). Delete hides a project's
  folder as `.tdsapp-projects-<project>-<code>.deleting~` while it removes it, so a sync mid-delete
  never shares half a project; without `*~` the skill refuses to delete.

### Order and one-line checks

| # | File here | Brain file | Check after applying |
|---|---|---|---|
| 7 | `clients-AGENTS.md` (edits 4, 5) | `clients/AGENTS.md` | `grep -c "projects-archive/" clients/AGENTS.md` is at least 2 |
| 8 | `personal-AGENTS.md` (edit 2) | `personal/AGENTS.md` | `grep -c "personal/projects-archive" personal/AGENTS.md` is 1 |
| 9 | `projects-AGENTS.md` (edit 3) | `projects/AGENTS.md` | `grep -c "Archive and delete" projects/AGENTS.md` is 1 |
| 10 | `save-locations.md` (edit 3) | `.claude/rules/save-locations.md` | `grep -c "An archived project" .claude/rules/save-locations.md` is 1 |
| 11 | `save-locations-cjs.md` (edit 1) | `tools/lib/save-locations.cjs` | `grep -c "'projects-archive'" tools/lib/save-locations.cjs` is 1 |

The Command Centre's "Archive project" (`tools/members/command-centre/server.cjs`) is noted, not
changed: it renames a clashing folder to `<slug>-2`, which breaks the key. Use the skill instead.

## Brain compatibility (tdsapp-projects 0.3.1)

These edits keep the brain working as it does today for everyone, on Cortex or not, now that
projects can live inside a client folder (docs/plans/2026-11-22-brain-compat-projects.md). Earlier
edits are already in the brain, so each "current passage" quotes the brain file as it is now.

### Before you start

- Copy `tdsapp-projects` 0.3.1 into the brain first. It opens the skill to the `team` role, lets
  owners and scouts change a project's Account Owner, and stops a list file blocking an archive.
- The Workbench patch changes `tools/members/command-centre`. Check `patch --dry-run` applies cleanly
  first, and stop on any mismatch: never overwrite whole files.

### Order and one-line checks

| # | File here | Brain file | Check after applying |
|---|---|---|---|
| 12 | `meeting-notes-SKILL.md` (1 edit) | `.claude/skills/meeting-notes/SKILL.md` | `grep -c "Internal (projects/)" .claude/skills/meeting-notes/SKILL.md` is 0 |
| 13 | `transcripts.md` (2 edits) | `.claude/rules/transcripts.md` | `grep -c "or \`projects/<project>/\` \|" .claude/rules/transcripts.md` is 0 |
| 14 | `root-AGENTS.md` (1 edit) | `AGENTS.md` | `grep -c "Ongoing project docs → \`projects/\`\." AGENTS.md` is 0 |
| 15 | `find-call-note-cjs.md` (3 edits) | `tools/find-call-note.cjs` | `node tools/find-call-note.cjs --client the-digital-stride --date 2026-11-20 --json` runs |
| 16 | `gm-SKILL.md` (1 edit) | `.claude/skills/gm/SKILL.md` | `grep -c "a leftover from archiving" .claude/skills/gm/SKILL.md` is 1 |
| 17 | `command-centre.patch` (see `command-centre.md`) | `tools/members/command-centre/` | `patch --dry-run -p1` is clean, then the checks in `command-centre.md` |

Item 17 replaces the note above: the Workbench's Archive now refuses a clash instead of renaming.

## Release 2, phase 1: files made in a project chat

`r2-chat-project.md`: one edit to `.claude/rules/save-locations.md` and one to
`.claude/skills/tds-doc/SKILL.md`, so sessions outside TDS Cortex also file a project's work in its
folder. Apply only with Ian's yes, after the app version with "New chat for this project" is installed.

## Release 2, phase 4: meetings and call notes

`r2-meetings.md`: three edits to `.claude/skills/meeting-notes/SKILL.md` (call notes record their project as
`project:`) and one to `.claude/skills/gm/SKILL.md` (the meeting list holds the next 14 days). Copy straight after
the merge (Ian's standing yes, 2026-11-23); the checks are in the file.
