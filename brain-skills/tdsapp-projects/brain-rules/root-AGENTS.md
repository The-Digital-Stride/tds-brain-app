# Brain edit: `AGENTS.md` (brain root)

## Why

"Ongoing project docs → `projects/`" sends new project files to the top-level folder. Projects now
have a home inside their client (`clients/the-digital-stride/` for internal work), as
`.claude/rules/save-locations.md` already says. Older `projects/` folders stay where they are.

## Edit 1

### Current passage

```
- Short-lived plans → `plans/`. Ongoing project docs → `projects/`.
```

### Proposed replacement

```
- Short-lived plans → `plans/`. Ongoing project docs → the project's own folder: `clients/<client>/projects/<project>/` (internal work under `clients/the-digital-stride/`), or an older `projects/<project>/` where the project already lives. Never make a second folder for the same project.
```

### Check after applying

`grep -c "Ongoing project docs → \`projects/\`\." AGENTS.md` is 0.
