# Brain edit: `tools/lib/save-locations.cjs`

## Why

The save-location hook checks where a file is saved inside a client's folder against
`CLIENT_ROOT_ALLOWED`. That list doesn't have `projects`, so every session saving a file in
`clients/<client>/projects/<project>/` is told it's in the wrong place. Archived projects now live in
`clients/<client>/projects-archive/<project>/` too. This is a code file in the brain: apply it by
hand, as the text edits. The app and its tooling never write the brain.

## Edit 1: allow the project folders at a client's root

### Current passage

The `CLIENT_ROOT_ALLOWED` list, about lines 47 to 52. It wasn't quoted here (the brain is never read
by the app's tooling): open the file and find the list of folder names allowed at a client's root.

### Proposed replacement

Add these two entries to that list, in the same style as the others:

````js
  'projects',
  'projects-archive',
````

Leave every other entry as it is.

## Check after applying

- `grep -c "'projects-archive'" tools/lib/save-locations.cjs` is 1.
- `node -e "require('./tools/lib/save-locations.cjs')"` runs without an error.
- Save a test file in `clients/<client>/projects/<project>/` from a session: the hook says nothing.
