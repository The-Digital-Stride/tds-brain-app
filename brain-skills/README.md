# Brain skills for the TDS Brain app

These are Claude Code skills for the Agency Brain, so a team member can install, update and check
the TDS Brain app by typing one command in Claude in their brain folder:

| Skill | What it does |
|---|---|
| `/install-brain-app` | Checks the Mac, downloads and builds the app, sets it to start at login, signs in and adds it to the Dock |
| `/update-brain-app` | Shows what's new, warns that a restart closes open chats, then updates, restarts and checks |
| `/doctor-brain-app` | Runs `bin/tds-brain doctor` and explains each problem in plain words |
| `/tdsapp-todo` | Adds, edits, passes on, re-dates, deletes and ticks to-dos, the way the Workbench does plus the fixes in `os/tds-brain-app/change-requests.md` marked "Built in the skill". The app runs its script (`tdsapp-todo/scripts/tdsapp-todo.cjs`) for every to-do change except the tick (still the app's own code, for now), so it never writes those changes itself. In testing: `roles: owner, scout` and `maturity: draft` until Pete releases it. Copy it without `scripts/tdsapp-todo.test.ts` and `test-fixtures/`. |
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
