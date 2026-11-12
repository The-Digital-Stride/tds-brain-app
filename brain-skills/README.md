# Brain skills for the TDS Brain app

These are Claude Code skills for the Agency Brain, so a team member can install, update and check
the TDS Brain app by typing one command in Claude in their brain folder:

| Skill | What it does |
|---|---|
| `/install-brain-app` | Checks the Mac, downloads and builds the app, sets it to start at login, signs in and adds it to the Dock |
| `/update-brain-app` | Shows what's new, warns that a restart closes open chats, then updates, restarts and checks |
| `/doctor-brain-app` | Runs `bin/tds-brain doctor` and explains each problem in plain words |

They're written and reviewed here, next to the code they drive. Copying them into the brain's
`.claude/skills/` is a separate step that needs Ian's approval, because it changes the shared brain
everyone syncs. When a command or path in `bin/tds-brain` changes, update these skills in the same
change and copy them across again.

Brain conventions they follow: `members: false` (the brain-update tool leaves them alone),
`agency: true`, and a `USE WHEN` list in the description.
