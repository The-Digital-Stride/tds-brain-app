---
name: tdsapp-skill-levels
description: Set, clear or bulk-import the team's level (Quick, Standard or Deep) for a skill, through one small script, so everyone's TDS Cortex app uses the same level for it. A level says how hard Claude works when the app runs that skill. It never changes the skill's own file. USE WHEN asked to set, change, clear or list a skill's level, or someone says "make /google-ads-audit Deep", "what level is the ads audit?", "set a team level for this skill", "clear the level for that skill", "import the reviewed skill levels". TDS Cortex also runs this script for its Skill levels settings.
version: 0.1
last_updated: 2026-11-14
roles: owner, scout
maturity: draft
members: false
agency: true
---

# tdsapp-skill-levels

The team's skill levels live in one file, `.claude/tdsapp-skill-levels.json`. This skill's script is the
only thing that writes it. TDS Cortex reads the file and uses a skill's level when it runs that
skill; the same skill run from the terminal behaves as it always has. No skill's own file is touched.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it to the
team. Everyone's app can read the levels; only the owner and scouts can change them.

## The levels

| Level | Runs on | Good for |
|---|---|---|
| `quick` | Haiku, medium effort | Look-ups, short answers and simple edits |
| `standard` | Sonnet, medium effort | Most writing, reports and everyday work |
| `deep` | Opus, high effort | Audits, strategy and anything that needs careful judgement |

A skill that files, sends or changes accounts should be Standard or higher.

## How to run it

Send one JSON object on stdin and name the command:

```bash
echo '{"skill":"google-ads-audit","tier":"deep","note":"Needs careful judgement"}' \
  | node .claude/skills/tdsapp-skill-levels/scripts/tdsapp-skill-levels.cjs set
```

| Command | Fields | What it does |
|---|---|---|
| `set` | `skill`, `tier`; optional `note` (up to 160 characters) | Sets the skill's level, recording who set it and when. The skill (or command) must exist in this brain. |
| `clear` | `skill` | Removes the skill's level, so the app picks one itself again. |
| `import` | `levels`: `{ "<skill>": { "tier": "...", "note": "..." } }` | Adds a reviewed batch, recorded as set by `prefill`. All or nothing: one bad name or level and nothing is written. A level a person set stays as it is. |
| `capabilities` | none | `{"version":"0.1","features":["set","clear","import"]}`. |

It prints one line of JSON. Exit 0 means it worked. Exit 2 means it refused, and the JSON says why
(`error`, with `status` 400 for bad input, 403 when you aren't the owner or a scout, 500 when the file
couldn't be read or written). Tell the person in a plain sentence what changed, or why it didn't.

## How it decides who you are

From the brain's own identity, read only: `git config user.email` (or `user.name` if there's no email),
looked up in `.team-config/roles.json`. Anything sent about who or what role is ignored.

## How it writes the file

- Skills are in alphabetical order, one per line, so git merges the file cleanly.
- It's written to a hidden temporary file in `.claude/` and swapped in, so a crash can't leave a
  half-written file. If the write fails the temporary file is removed, so the brain's sync never
  shares it.
- A row it doesn't understand (for example a level from a newer version) is kept as it was.
- A file that isn't valid is never overwritten: the script refuses and says so.
