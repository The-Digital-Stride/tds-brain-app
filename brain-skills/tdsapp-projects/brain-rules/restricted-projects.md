# Brain rules for restricted projects

Proposed text for Ian to paste in by hand (files only, never git in the brain), together with
`tdsapp-projects` 0.9.0 (script and SKILL.md). Plan: `docs/plans/2026-11-27-restricted-projects.md`,
decisions 1, 8, 13 and 14. The current passages were quoted from the real brain files on 2026-11-27.

## Why

A shared project's card can now carry `visibility: restricted`. TDS Cortex then shows the project only
to its Account Owner, its team and every owner and scout; to everyone else it isn't there. This hides
the project in the Cortex app only: its folder still syncs to every Mac, so sessions outside the app
need to be told how to treat it. The to-do script isn't changed in this release, so the rule about
giving out its to-dos is written down here instead.

## Before you start

- Copy `tdsapp-projects` 0.9.0 into the brain first. With an older script, `visibility` is refused as
  an unknown field.
- An older Cortex ignores the line and shows the project to everyone: the restriction holds only for
  people on the release that reads it.
- If a "current passage" no longer matches, the brain file has changed: re-read it and adjust the edit
  rather than overwriting.

## 1. `.claude/skills/tdsapp-projects/` (copy)

Copy `brain-skills/tdsapp-projects/SKILL.md` and `scripts/tdsapp-projects.cjs` (version 0.9.0) over the
brain's 0.8.0 copy (without `test/`). Cards without a `visibility` line behave exactly as before;
`capabilities` now also lists `projects-visibility-v1`.

## 2. `clients/AGENTS.md` (1 edit, the "## Projects" section)

Current passage (the last two bullets of the list under "## Projects"):

```
- **To-dos in a project** are set with `tdsapp-todo`'s `project` action (see `todo/AGENTS.md`).
- A project with no card is still a project. Add one with the skill's `card` action.
```

Replacement:

```
- **To-dos in a project** are set with `tdsapp-todo`'s `project` action (see `todo/AGENTS.md`).
- A project with no card is still a project. Add one with the skill's `card` action.
- **A restricted project** has `visibility: restricted` on its card. Set it and clear it only with
  the `tdsapp-projects` skill (its Account Owner, an owner or a scout), never by hand. TDS Cortex then
  shows the project only to its Account Owner, its team and every owner and scout. It does NOT hide
  the folder in the brain: it still syncs to every Mac. So don't open, read or summarise a restricted
  project's contents for someone who isn't on it (not its Account Owner, not on its team, not an
  owner or a scout), and don't name it to them.
```

## 3. `todo/AGENTS.md` (1 edit, the "## Project and stage" section)

Current passage (the last bullet of the list under "## Project and stage"):

```
- Older labels (such as `project: harvey-nash`) keep working and are left alone. Don't rewrite them
  by hand: the app's tidy-up screen proposes a mapping and the person approves it.
```

Replacement:

```
- Older labels (such as `project: harvey-nash`) keep working and are left alone. Don't rewrite them
  by hand: the app's tidy-up screen proposes a mapping and the person approves it.
- **Don't give a to-do in a restricted project** (`visibility: restricted` on its card) to someone
  outside it: add them to the project's team first. Owners and scouts can always take one.
```

## Greps after copying

- `grep -c "projects-visibility-v1" .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs` → at least 1
- `grep -c "^version: 0.9.0" .claude/skills/tdsapp-projects/SKILL.md` → 1
- `grep -c "A restricted project" clients/AGENTS.md` → 1
- `grep -c "Don't give a to-do in a restricted project" todo/AGENTS.md` → 1
- `echo '{}' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs capabilities` lists `projects-visibility-v1`
