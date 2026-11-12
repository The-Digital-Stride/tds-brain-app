---
name: doctor-brain-app
description: Check the TDS Brain app on this Mac and explain what's wrong in plain words - runs the app's own doctor (Node, tools, Claude Code, brain folder, build, login item, sign-in app, whether it's running) and helps fix each problem. USE WHEN someone says "/doctor-brain-app", "TDS Brain isn't working", "the brain app won't open", "TDS Brain is broken", "check the brain app", or the TDS Brain window shows it isn't running.
version: 1.0
last_updated: 2026-11-12
maturity: beta
members: false
agency: true
---

# Check the TDS Brain app

Talk to the person in plain UK English. Explain each problem in one or two sentences and what to
do about it; don't paste raw output at them.

**Rules for every command.** Claude Code does not keep shell variables between commands, so
**start every command block with** `APP="$HOME/Library/Application Support/TDS Brain/app"`, and
quote it: the path has spaces. Never run `sudo`.

## Step 1: Find the app

Check `test -x "$HOME/Library/Application Support/TDS Brain/app/bin/tds-brain"`. If it doesn't exist, the app isn't installed here: offer `/install-brain-app`
and stop.

## Step 2: Run the doctor

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" doctor
```

Each line starts `OK` or `FIX`. The last line says "Everything looks fine." or "Some things need
attention (marked FIX above)."

- All `OK`: say the app looks healthy. If they came here because something seemed wrong, ask what
  they saw, and look at the end of the log (Step 3).
- Any `FIX`: go through them in order. Each `FIX` line already says what to do; turn it into plain
  steps for them.
  - If the fix is to restart the app, ask first (AskUserQuestion): restarting closes any chats open
    in TDS Brain. If `printenv TDS_BRAIN_SERVICE` prints `1`, this chat is running in the app and
    will end too; say so. Then run `"$APP/bin/tds-brain" restart` (in a block starting with the `APP=` line).
  - If the fix is in System Settings (for example switching **TDS Brain Sign-in** back on under
    General, Login Items), tell them where to click; you can't do it for them.
  - If the fix needs a new install or update step, offer `/install-brain-app` or
    `/update-brain-app`. "Not installed here yet" means setup never finished: `/install-brain-app`
    picks up where it stopped. If it says the app hasn't been built ("run pnpm build"), offer
    `/update-brain-app`: it finishes the build without the person needing pnpm.
  - If the brain folder is the problem, tell them they can choose another folder in TDS Brain
    itself: it opens a "Choose your brain folder" page when it can't use the one it has, and
    Settings has a **Change…** button on the Brain folder row.
  - Don't edit the app's files, its `data/` folder or its settings file by hand.

After fixing, run doctor again and say what changed.

## Step 3: When doctor isn't enough

If the app still misbehaves, read the end of its log:

```bash
tail -n 40 "$HOME/Library/Logs/TDS Brain/server.log"
```

Summarise anything that looks like an error in a sentence. If it isn't something you can fix with
the steps above, say: "Send Ian the last part of the TDS Brain log." and offer to copy those lines
into a message for them.
