# Brain edit: `.claude/skills/client-setup/SKILL.md`

## Why

A new client does not need a `projects/` folder made for it. Git does not keep empty folders, the skill's own rule says every pre-made folder carries a README, and `tdsapp-projects` creates `projects/` on demand.
So the edit is one line in the "do not pre-create" list, plus a pointer so the skill's hand-off mentions projects.

## Edit 1: don't pre-create `projects/`

### Current passage

````text
**Do NOT pre-create** `config/`, `created/`, `context/memory/`, `context/analysis/`,
````

### Proposed replacement

````text
**Do NOT pre-create** `config/`, `created/`, `projects/`, `context/memory/`, `context/analysis/`,
````

## Edit 2: tell the person where projects go

Paste it at the end of Step 5.

### Current passage

````text
For a **non-Google-Ads client**, skip the handoff and say the folder is complete.
````

### Proposed replacement

````text
For a **non-Google-Ads client**, skip the handoff and say the folder is complete.

Projects for this client live in `clients/{slug}/projects/<project>/`. There is nothing to set up:
the `tdsapp-projects` skill (or the Projects app) creates the folder with the first project.
````
