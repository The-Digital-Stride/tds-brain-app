# Brain edits: meeting invite links (home meetings, 2026-11-24)

Plan: `docs/plans/2026-11-24-home-meetings.md` (decision 1). Copied into the brain after merge, files only, never
git. The app reads these fields from `briefing/meetings-cache.json` and keeps only Google Calendar event links and
Meet/Teams/Zoom call links; anything else is dropped. Older caches without them still work (the app opens the
meeting's day in Google Calendar instead).

## 1. `tools/members/command-centre/lib/calendar-live.cjs`

Apply `calendar-live-links.patch` (from `tools/members/command-centre/`, `patch -p1`): adds `joinFrom(ev)` and three
fields in the event map, `link: ev.htmlLink || null`, `join: joinFrom(ev)` and `kind: ev.eventType || null`.

Check: `grep -c "link: ev.htmlLink" tools/members/command-centre/lib/calendar-live.cjs` → 1 and
`grep -c "kind: ev.eventType" tools/members/command-centre/lib/calendar-live.cjs` → 1.

## 2. `.claude/skills/gm/SKILL.md`, Step 3 cache shape

In the JSON example, after the `"attendees"` line, the `"refs"` line becomes:

```
      "refs": [ "AST4K7" ],
      "link": "<the event's htmlLink>", "join": "<its video call link, or null>",
      "kind": "<the event's eventType, e.g. default, focusTime, outOfOffice>" }
```

and after the paragraph that starts `` `refs` holds the project codes``, add:

```
`link` is the event's own Google Calendar page (the connector's `htmlLink`) and `join` its video call link (the
connector's `conferenceUrl` / `hangoutLink`), or null when it has none. TDS Cortex links every meeting it shows to
its invite with these, and leaves out focus time, out of office and birthdays by `kind`. Leave out cancelled
events, events you declined and working-location markers ("Home", "Office") altogether, as `calendar-live.cjs`
does.
```

Check: `grep -c '"link": "<the event' .claude/skills/gm/SKILL.md` → 1, `grep -c "links every meeting it shows" .claude/skills/gm/SKILL.md` → 1 and
`grep -c "events you declined" .claude/skills/gm/SKILL.md` → 1.

Note for Ian: the "leave out declined" line also changes what teammates' Workbench Meetings view shows when their
/gm uses the connector (declined meetings no longer appear), matching what calendar-live.cjs already does.
