# Brain edit: `.claude/rules/transcripts.md`

## Why

The routing table sends internal work meetings and pasted threads to `projects/<project>/`. A project
made in TDS Cortex lives in `clients/the-digital-stride/projects/<project>/`; filing it under
`projects/` makes a hidden twin folder that blocks archive and move. Older `projects/` folders keep
working.

## Edit 1: work meetings

### Current passage

```
| Client or internal **work meeting** | A call about a piece of work: a client, a project, a pitch | `clients/<client>/call-notes/`, or `projects/<project>/` |
```

### Proposed replacement

```
| Client or internal **work meeting** | A call about a piece of work: a client, a project, a pitch | `clients/<client>/call-notes/`, or the internal project's own folder (`clients/the-digital-stride/projects/<project>/`, or an older `projects/<project>/` where that's where it is). Never a second folder for the same project |
```

## Edit 2: pasted threads

### Current passage

```
| **Pasted thread** | Slack, WhatsApp or email messages | `clients/<client>/notes/`, or `projects/<project>/`. See §7 |
```

### Proposed replacement

```
| **Pasted thread** | Slack, WhatsApp or email messages | `clients/<client>/notes/`, or the internal project's own folder (as for work meetings). See §7 |
```

### Check after applying

`grep -c "or \`projects/<project>/\` |" .claude/rules/transcripts.md` is 0.
