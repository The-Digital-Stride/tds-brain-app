# Brain edit: `.claude/skills/gm/SKILL.md`

## Why

Step 4 nudges for `projects/<name>/` folders with no `todo.md`. When a project is archived or moved
in TDS Cortex, git removes its tracked files, but on other Macs the folder can linger with untracked
leftovers (`.DS_Store`, `node_modules`, ignored data). Without a `README.md` the step already skips
it. This edit also skips one whose project now sits in `projects-archive/`, so `/gm` never offers to
write a `todo.md` that would bring a ghost folder back to life. Nothing else in the step changes:
the Workbench still reads `todo.md` checklists exactly as before.

## Edit 1

### Current passage

```
   Ignore `.gitkeep` and any folder without a `README.md` (not a real project yet). If one or more real projects are missing a `todo.md`,
```

### Proposed replacement

```
   Ignore `.gitkeep`, any folder without a `README.md` (not a real project yet) and any folder whose name is also in `projects-archive/` (a leftover from archiving). If one or more real projects are missing a `todo.md`,
```

### Check after applying

`grep -c "a leftover from archiving" .claude/skills/gm/SKILL.md` is 1.
