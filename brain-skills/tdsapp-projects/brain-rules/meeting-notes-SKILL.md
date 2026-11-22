# Brain edit: `.claude/skills/meeting-notes/SKILL.md`

## Why

For an internal meeting the skill says to file under `projects/<project>/`. Projects made in TDS
Cortex live in `clients/the-digital-stride/projects/<project>/`, so following the old line for one of
them makes a second, card-less `projects/<project>/` folder. Cortex hides that twin, and it stops the
project being archived or moved. Older internal projects in `projects/` keep working exactly as now.

## Edit 1: file internal meetings in the project's own folder

### Current passage

```
  options, plus "New client (run client-setup first)" and "Internal (projects/)". If it is a
  genuinely new client, point at `client-setup` first. If the meeting is internal (no client), file it under
  `projects/<project>/` instead and skip the business.md cross-check.
```

### Proposed replacement

```
  options, plus "New client (run client-setup first)" and "Internal (a TDS project)". If it is a
  genuinely new client, point at `client-setup` first. If the meeting is internal (no client), file it in
  the project's own folder instead and skip the business.md cross-check. Projects live in more than one
  place, so find the folder first: `ls -d clients/the-digital-stride/projects/<project> projects/<project>`
  and use the one that exists. Never make a second folder for a project that already has one. If
  neither exists, it's a new internal project: see `.claude/rules/save-locations.md`.
```

### Check after applying

`grep -c "Internal (projects/)" .claude/skills/meeting-notes/SKILL.md` is 0.
