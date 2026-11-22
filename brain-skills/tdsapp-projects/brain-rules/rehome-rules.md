# Brain edits: the old project folders move into `clients/`

Plan: `docs/plans/2026-11-22-rehome-legacy-projects.md`, decision 6. Edits A to G and I are part of
sync 1: apply them, with `tdsapp-projects` 0.3.2 and the Workbench v2 patch, before the move itself
runs. Edit H goes in sync 2, straight before the move script, so it reaches every Mac in the same
sync as the move (applied earlier, anything new saved in the old folder before the move would never
be shared). They are
file writes only: nothing runs git in the brain.

Each passage below was read from the brain on 2026-11-22. If a passage no longer matches, stop and
re-read it before changing anything.

## Edit A: `.claude/rules/save-locations.md`, the internal project row

### Current passage

```
| A file for an internal TDS project | `clients/the-digital-stride/projects/<project>/`. Older internal folders in `projects/<project>/` stay where they are |
```

### Proposed replacement

```
| A file for an internal TDS project | `clients/the-digital-stride/projects/<project>/`. The older internal folders in `projects/` moved there in November 2026: never make a new one in `projects/` |
```

## Edit B: `projects/AGENTS.md`, the whole file

### Proposed replacement

````markdown
# Projects Folder (retired)

**Nothing new goes here.** Internal projects live in `clients/the-digital-stride/projects/<slug>/`,
each with a `project.md` card, and client projects in `clients/<client>/projects/<slug>/` (see
`clients/AGENTS.md`, "Projects"). The folders that used to be here moved there in November 2026,
under the same names, so their keys (`the-digital-stride/<slug>`) didn't change.

A folder that still turns up here on one Mac is a leftover of files git doesn't share (such as a
`node_modules/` or private working files). Move anything you still need into the project's folder
under `clients/`, then delete the leftover. Never add files to it.

Archive and delete a project only with the `tdsapp-projects` skill, never by hand.
````

## Edit C: `projects/README.md`, the whole file

### Proposed replacement

````markdown
# Projects (retired)

Projects now live in `clients/<client>/projects/<project>/`, internal ones in
`clients/the-digital-stride/projects/<project>/`. See `AGENTS.md` in this folder.
````

## Edit D: `.claude/skills/meeting-notes/SKILL.md`, internal meetings

### Current passage

```
  the project's own folder instead and skip the business.md cross-check. Projects live in more than one
  place, so find the folder first: `ls -d clients/the-digital-stride/projects/<project> projects/<project>`
  and use the one that exists. Never make a second folder for a project that already has one. If
  neither exists, it's a new internal project: see `.claude/rules/save-locations.md`.
```

### Proposed replacement

```
  the project's own folder instead and skip the business.md cross-check. Internal projects live in
  `clients/the-digital-stride/projects/<project>/`. Check with
  `ls -d clients/the-digital-stride/projects/<project> projects/<project>`: when both exist, use the
  `clients/` one (the other is a leftover on this Mac). Never make a second folder for a project that
  already has one. If neither exists, it's a new internal project: see `.claude/rules/save-locations.md`.
```

## Edit E: `.claude/skills/gm/SKILL.md`, step 4

### Current passage

From `4. Nudge for projects missing a Workbench todo list.` to the end of that step: the bash block
`for d in projects/*/; do [ -f "$d/todo.md" ] || echo "${d%/}"; done` and the paragraph after it,
which ends `If none are missing, say nothing.`

### Proposed replacement

```
4. Projects' next actions are to-dos linked to the project (`project:` in `todo/*.md`), shown on
   the Workbench and in TDS Cortex. There is no `todo.md` to backfill any more, so this step says
   nothing.
```

Keep the numbering of the steps after it as it is. In step 5, change its opening words
`Nudge for client folders below the house standard. Same shape as the projects check
   above, and it exists because` to `Nudge for client folders below the house standard. It exists because`.

## Edit F: `.claude/skills/briefing-generator/SKILL.md`, project boards

### Current passage

```
- **Project boards** from `projects/*/todo.md` (`## Active` sections).
```

### Proposed replacement

```
- **Project boards** from to-dos linked to a project (`project:` in `todo/*.md`), plus any open
  `## Active` items still in a project folder's `todo.md` (`clients/*/projects/*/todo.md`).
```

## Edit G: `tools/lib/save-locations.cjs`, warn about new files in a moved folder

### Current passage

```js
    if (parts[0] === 'to-be-filed') return checkToBeFiled(parts);
    return ok(); // plans/, projects/, todo/, docs/, data/, context/, tools/, os/, personal/ … not policed
```

### Proposed replacement

```js
    if (parts[0] === 'to-be-filed') return checkToBeFiled(parts);
    // A file in an old projects/<name>/ folder whose project moved into clients/ (November 2026).
    if (parts[0] === 'projects' && parts.length > 2) {
      const card = path.join(root, 'clients', 'the-digital-stride', 'projects', parts[1], 'project.md');
      if (require('fs').existsSync(card)) {
        return bad(
          `an old projects/ folder: ${parts[1]} moved into clients/the-digital-stride/projects/`,
          `clients/the-digital-stride/projects/${parts.slice(1).join('/')}`,
        );
      }
    }
    return ok(); // plans/, projects/, todo/, docs/, data/, context/, tools/, os/, personal/ … not policed
```

## Checks after applying

```bash
cd ~/agencybrain
grep -c "stay where they are" .claude/rules/save-locations.md        # 0
grep -c "use the\s*$" .claude/skills/meeting-notes/SKILL.md          # any; read the passage
grep -c 'projects/\*/todo.md' .claude/skills/gm/SKILL.md .claude/skills/briefing-generator/SKILL.md  # 0 0
node --check tools/lib/save-locations.cjs
node -e "const s=require('./tools/lib/save-locations.cjs');console.log(s.check('projects/ai-blueprint/x.md').ok, s.check('projects/new-thing/x.md').ok)"
# before the move: true true; after it: false true
```

## Edit H: `.gitignore` at the brain's root (sync 2, straight before the move)

### Proposed addition (append at the end)

```
# AI Search Outreach moved into clients/the-digital-stride/projects/ (November 2026). The private
# prospect lists left at the old path on each Mac must never be shared by the sync's `git add -A`.
/projects/ai-search-outreach/
/projects-archive/ai-search-outreach/
```

Files git already tracks there (four of Steve's, see `todo/20261118-ask-steve-…`) stay tracked:
an ignore rule never untracks a file, so nothing is deleted on anyone's Mac.

### Check

```bash
git -C ~/agencybrain check-ignore -q projects/ai-search-outreach/inbox/new.json && echo ignored
```

(Ian runs this one himself: tooling never runs git in the brain.)

## Edit I: `.claude/skills/decision-bench/`, find a project's folder in its new home

Decision Bench isn't switched on in the Workbench yet, but its two files build
`path.join(BRAIN_ROOT, 'projects', <slug>)`. Switched on after the move, it would refuse the moved
projects, or write `decisions.md` into a leftover old folder.

### Current passages

`scripts/add-decision.cjs`, about line 42:

```js
if (!fs.existsSync(path.join(BRAIN_ROOT, 'projects', args.project))) {
  console.error(`No folder at projects/${args.project}. Use the project folder's exact name.`);
  process.exit(1);
}
```

`assets/lib/decision-bench-route.cjs`, about line 116:

```js
      const dir = path.join(BRAIN_ROOT, 'projects', project);
```

### Proposed replacements

```js
const projectDir = (slug) => [
  path.join(BRAIN_ROOT, 'clients', 'the-digital-stride', 'projects', slug),
  path.join(BRAIN_ROOT, 'projects', slug),
].find((d) => fs.existsSync(path.join(d, 'project.md')) || fs.existsSync(path.join(d, 'README.md')));
if (!projectDir(args.project)) {
  console.error(`No project folder called ${args.project}. Use the project folder's exact name.`);
  process.exit(1);
}
```

```js
      const dir = [
        path.join(BRAIN_ROOT, 'clients', 'the-digital-stride', 'projects', project),
        path.join(BRAIN_ROOT, 'projects', project),
      ].find((d) => fs.existsSync(path.join(d, 'project.md'))) || path.join(BRAIN_ROOT, 'projects', project);
```

Check: `node --check` on both files.
