#!/usr/bin/env node
// todo.cjs — deprecated shim (2026-11-13). The to-do skill is now `tdsapp-todo`
// (.claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs). This file only runs it, so an older TDS Brain
// App (v0.5.0, which looks for .claude/skills/todo/) keeps working for one release. Same command
// line, stdin and stdout; tdsapp-todo.cjs finds the brain from its own folder, so BRAIN_ROOT is
// still optional. Remove this skill once every installed app is v0.6 or later.

'use strict';

require('../../tdsapp-todo/scripts/tdsapp-todo.cjs');
