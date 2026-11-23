# Brain rules for Projects R2 phase 4: meetings and call notes

Proposed text, copied into the brain straight after the merge (files only, never git in the brain). Plan:
`docs/plans/2026-11-23-projects-r2-meetings.md`, decisions 8 and 9.

## Why

TDS Cortex now shows your last and next meeting on a project's page. It reads the meeting list /gm already
keeps on your Mac (`briefing/meetings-cache.json`, never synced), and it checks whether a meeting's notes are
filed. Two small edits make that work well:

1. Call notes record the project they're about (`project:` in the frontmatter), so the app can tell a
   meeting's notes are filed, and later list them on the project.
2. /gm writes the next 14 days into the meeting list, not just today, so the app knows your next meeting.
   The Workbench Meetings view and the time skill read the same file and already handle a longer list.

## Before you start

If a "current passage" no longer matches, the brain file has changed: re-read it and adjust the edit rather
than overwriting.

## 1. `.claude/skills/meeting-notes/SKILL.md` (3 edits)

### Edit 1: settle the project with the client (step 2)

Current passage:

```
  already has one. If neither exists, it's a new internal project: see `.claude/rules/save-locations.md`.
- **Date:** the meeting date, not today's. AI exports usually state it.
```

Replacement:

```
  already has one. If neither exists, it's a new internal project: see `.claude/rules/save-locations.md`.
- **Project:** the open project the meeting was about, if any. List the client's projects with
  `ls clients/<client>/projects/` and leave out any whose `project.md` says `status: done`. One clearly
  named in the notes, or a project the person or the prompt named → use it. More than one could fit:
  **[Ask]** with those projects plus "Not about one project". None open, or a general catch-up → no
  project. An internal meeting filed in a project's folder is about that project. Never guess: if the
  prompt says "probably for the X project; check that with me", confirm it in the same question as the
  client.
- **Date:** the meeting date, not today's. AI exports usually state it.
```

### Edit 2: write it in the frontmatter (step 8)

Current passage:

```
client: <client-slug>
meeting_start: <ISO UTC start, if known>
```

Replacement:

```
client: <client-slug>
project: <project folder name, e.g. website-rebuild; omit when not about one project>
meeting_start: <ISO UTC start, if known>
```

### Edit 3: the project update uses the same project (step 9 (d))

Current passage:

```
- **(d) A project update.** One or two sentences on what was agreed, added to the project's
  updates log with the `tdsapp-projects` skill's `update` action as a `call` entry. Internal
```

Replacement:

```
- **(d) A project update.** One or two sentences on what was agreed, added to the project's
  updates log (the project settled at step 2, after the call note is written) with the
  `tdsapp-projects` skill's `update` action as a `call` entry. Internal
```

Checks after applying:
- `grep -c "^- \*\*Project:\*\* the open project" .claude/skills/meeting-notes/SKILL.md` is 1.
- `grep -c "^project: <project folder name" .claude/skills/meeting-notes/SKILL.md` is 1.
- `grep -c "the project settled at step 2" .claude/skills/meeting-notes/SKILL.md` is 1.

## 2. `.claude/skills/gm/SKILL.md` (1 edit, Step 3)

Current passage:

```
Then write the events to `briefing/meetings-cache.json` so the Workbench Meetings view can show them (the always-on Workbench server can't call the calendar connector itself — it reads this cache). Include today's and any upcoming events you pulled. Shape:
```

Replacement:

```
Then write the events to `briefing/meetings-cache.json` so the Workbench Meetings view and TDS Cortex's project pages can show them (neither can call the calendar connector itself; both read this cache). Include today's events and the next 14 days: if you only pulled today, ask the connector for the next 14 days too (as `calendar-live.cjs` does). The file stays on this Mac (`briefing/` is never synced). Shape:
```

Check after applying: `grep -c "TDS Cortex's project pages" .claude/skills/gm/SKILL.md` is 1.

## Not changed

- `tools/members/command-centre/lib/calendar-live.cjs` already fetches 14 days ahead.
- Old call notes without `project:` keep working; the app also counts a note as filed when its
  `meeting_start` is within 30 minutes of the meeting.
