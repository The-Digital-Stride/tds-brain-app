# Workbench (command-centre) patch, v2

Why: the old project folders move into `clients/the-digital-stride/projects/`. The Workbench must show them there with the same name, buttons and to-dos, and must not show the leftover folder as a second project.

Needs v1 (`command-centre.patch`) already applied.

What changes (`tools/members/command-centre`):
- `lib/todo-parser.cjs`:
  - ghost rule: a card-less `projects/<name>/` is skipped when `clients/the-digital-stride/projects/<name>/project.md` exists;
  - card projects also report `owner` and how many checklist items are ticked;
  - the marker `cardProjectsV2` (the migration script checks for it).
- `server.cjs`:
  - a card project is "all done" only with no open linked to-dos, no open checklist items and at least one ticked item;
  - "Created by" comes from git history of the card's folder, else of the old `projects/<slug>/project.md`, else the card's `created_by`, then `owner`;
  - new route `POST /api/projects/archive-card`: runs the brain's `tdsapp-projects` script (`capabilities` once, cached; then `check`; then `archive` with `expect` and `filesExpect` from the check). The key must be one the server's own scan knows. The script's refusal text is passed back as it is;
  - `/api/projects` adds `allDone` per card project, and `cardArchive: true` when the script lists `projects-archive-v1`.
- `public/js/cc.js`:
  - an "Archive project" button on card projects, only when the server says `cardArchive`; it confirms in the page and names the number of files;
  - the score counts card to-dos;
  - the "projects/" wording now says "project folders".

Old and new mix safely: an old page ignores the new fields, and the new page without `cardArchive` shows no button. Legacy cards, Today and every legacy route output are unchanged.

Apply (from inside `tools/members/command-centre`, file writes only, no git):
    patch --dry-run -p1 < command-centre-v2.patch
    patch -p1 < command-centre-v2.patch
Stop on any mismatch. Restart the Workbench server afterwards.

Check:
- `node --check lib/todo-parser.cjs server.cjs public/js/cc.js`
- Open the Workbench: a moved project appears once, with its to-dos; one with an open to-do isn't "all done"; Archive project asks first and moves the folder.
