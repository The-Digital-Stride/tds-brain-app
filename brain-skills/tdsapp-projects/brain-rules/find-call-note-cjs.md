# Brain edit: `tools/find-call-note.cjs`

## Why

The "is this meeting already filed?" search looks at client `call-notes/` and `notes/` folders and
everything under the top-level `projects/`. With the new wording, internal meetings can be filed
straight into `clients/the-digital-stride/projects/<project>/`, and archived internal projects move to
`projects-archive/`. Neither was searched, so the same call could be filed twice.

## Edit 1: search archived internal projects too

### Current passage

```js
  const clientDirs = CLIENT
    ? [path.join(ROOT, 'clients', CLIENT)]
    : [path.join(ROOT, 'clients'), path.join(ROOT, 'projects')];
```

### Proposed replacement

```js
  // Internal meetings may sit in the older top-level projects/ folders or their archive, so the
  // internal client searches those too.
  const internalDirs = [path.join(ROOT, 'projects'), path.join(ROOT, 'projects-archive')];
  const clientDirs = CLIENT
    ? [path.join(ROOT, 'clients', CLIENT), ...(CLIENT === 'the-digital-stride' ? internalDirs : [])]
    : [path.join(ROOT, 'clients'), ...internalDirs];
```

## Edit 2: count files filed straight into a project folder

### Current passage

```js
      // Client calls live in call-notes/, pasted threads in notes/; internal ones under projects/.
      const parts = rel.split(path.sep);
      if (parts.includes('call-notes') || parts.includes('notes') || rel.startsWith('projects' + path.sep)) files.push(f);
```

### Proposed replacement

```js
      // Client calls live in call-notes/, pasted threads in notes/; internal ones in a project's
      // folder: projects/ or projects-archive/ at the top, or inside a client.
      const parts = rel.split(path.sep);
      const inProject = parts[0] === 'projects' || parts[0] === 'projects-archive'
        || (parts[0] === 'clients' && (parts[2] === 'projects' || parts[2] === 'projects-archive'));
      if (parts.includes('call-notes') || parts.includes('notes') || inProject) files.push(f);
```

### Check after applying

`node tools/find-call-note.cjs --client the-digital-stride --date 2026-11-20 --json` runs without an
error.
