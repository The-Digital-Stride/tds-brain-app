---
name: todo
description: "Deprecated: use tdsapp-todo. Kept for one release so older copies of the TDS Brain app, which look for this skill, keep working; its script just runs tdsapp-todo's."
version: 0.3
last_updated: 2026-11-13
roles: owner, scout
maturity: draft
members: false
agency: true
---

# todo (deprecated)

This skill has been renamed `tdsapp-todo`, so everything the TDS Brain app adds to the brain starts with
`tdsapp-`. Use `tdsapp-todo` for every to-do change. This folder stays for one release only, because the
TDS Brain app before v0.6 looks here: `scripts/todo.cjs` simply runs
`../tdsapp-todo/scripts/tdsapp-todo.cjs` with the same input and output, and the `roles:` line above keeps
the app's access check the same. It will be removed once every installed app is v0.6 or later.
