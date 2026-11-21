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
