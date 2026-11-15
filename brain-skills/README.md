# Brain skills for the TDS Brain app

These are Claude Code skills for the Agency Brain, so a team member can install, update and check
the TDS Brain app by typing one command in Claude in their brain folder:

| Skill | What it does |
|---|---|
| `/install-brain-app` | Checks the Mac, downloads and builds the app, sets it to start at login, signs in and adds it to the Dock |
| `/update-brain-app` | Shows what's new, warns that a restart closes open chats, then updates, restarts and checks |
| `/doctor-brain-app` | Runs `bin/tds-brain doctor` and explains each problem in plain words |
| `/tdsapp-todo` | Adds, edits, passes on, re-dates, deletes and ticks to-dos, the way the Workbench does plus the fixes in `os/tds-brain-app/change-requests.md` marked "Built in the skill". The app runs its script (`tdsapp-todo/scripts/tdsapp-todo.cjs`) for every to-do change except the tick (still the app's own code, for now), so it never writes those changes itself. In testing: `roles: owner, scout` and `maturity: draft` until Pete releases it. Copy it without `scripts/tdsapp-todo.test.ts` and `test-fixtures/`. |
| `/tdsapp-skill-levels` | Sets, clears or bulk-imports the team's level (Quick, Standard or Deep) for a skill, in `.claude/tdsapp-skill-levels.json`, which only its script writes. The app reads that file to choose how hard Claude works when it runs a skill, and runs the script for its Skill levels settings. Doesn't touch any skill's own file. In testing: `roles: owner, scout` and `maturity: draft` until Pete releases it. Copy it without `scripts/tdsapp-skill-levels.test.ts`. |
| `/tdsapp-kits` | Shows, changes and reviews the start-up kits (short lists of connectors and plugins for one kind of work) in `.claude/tdsapp-kits.json`, which only its script writes. In shadow mode the app only notes which kit it would pick for each chat and switches nothing off; `review` shows how the picks would have gone. Also holds `tdsapp-usage.cjs`, which files the app's per-chat events in `z-logs/app-usage/`. Its `SYNC_APP_EVENTS` switch stays off until Pete confirms the Command Centre skips unknown events. In testing: `roles: owner, scout` and `maturity: draft`. Copy it without `scripts/tdsapp-kits.test.ts`. |
| `/tdsapp-files` | Deletes images and documents from the library into `tdsapp-deleted/`, puts them back, lists what's waiting, and erases each one 30 days after it was deleted. Every delete, put-back and erase goes in a team log in `tdsapp-deleted/log/` (one file per person per Mac). The app runs its script (`tdsapp-files/scripts/tdsapp-files.cjs`) for the library's bin buttons and a daily clear-out, so it never moves or erases these files itself. Client files for anyone on the team, templates for the owner only. In testing: `roles: owner, scout` and `maturity: draft` until Pete releases it. Copy it without `scripts/tdsapp-files.test.ts`. |
| `/todo` | **Deprecated** (renamed `tdsapp-todo` in v0.3). A shim kept for one release so an older app still works: its script just runs `tdsapp-todo.cjs`. Remove it once every installed app is v0.6 or later. |

They're written and reviewed here, next to the code they drive. Copying them into the brain's
`.claude/skills/` is a separate step that needs Ian's approval, because it changes the shared brain
everyone syncs. When a command or path in `bin/tds-brain` changes, update these skills in the same
change and copy them across again.

Everything the TDS Brain App adds to the brain is named `tdsapp-…` from 2026-11-13 (the three install,
update and doctor skills came first and keep their names). Every change stays backward compatible
with older brain files, older copies of the app and the brain's other readers.

Brain conventions they follow: `members: false` (the brain-update tool leaves them alone),
`agency: true`, and a `USE WHEN` list in the description.
