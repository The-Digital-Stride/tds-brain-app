---
name: update-brain-app
description: Update the TDS Brain app on this Mac to the newest version - shows what's new, warns that restarting closes open chats, then downloads, builds and restarts the app and checks it. Also finishes an update that stopped halfway. USE WHEN someone says "/update-brain-app", "update TDS Brain", "update the brain app", "get the latest TDS Brain", or the app's Settings or a teammate says a new version is out.
version: 1.0
last_updated: 2026-11-12
maturity: beta
members: false
agency: true
---

# Update the TDS Brain app

The person may not be technical. Say what each step does in a plain UK English sentence before it
runs, and summarise output rather than pasting it.

**Rules for every command.** Claude Code does not keep shell variables between commands, so
**start every command block with** `APP="$HOME/Library/Application Support/TDS Brain/app"`, and
quote it: the path has spaces. Never run `sudo`. pnpm runs through `npx --yes pnpm@10`, which needs
no install.

## Step 1: Find the app

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
test -d "$APP/.git" && echo installed
```

If it doesn't print `installed`, the app isn't installed here: offer `/install-brain-app` and stop.

## Step 2: Check the installed copy is clean

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
git -C "$APP" status --porcelain
```

If this prints anything, someone has changed files in the installed copy. Don't discard or stash
them. Say: "The installed TDS Brain has changes made on this Mac, so I've left it alone. Ask Ian to
look at it." Stop.

## Step 3: See what's new

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
git -C "$APP" fetch --quiet && git -C "$APP" log --oneline 'HEAD..@{upstream}'
```

- If the fetch fails, it's almost always the internet connection (the code is public, so no
  sign-in is involved). Ask them to check they're online, then try again. If it still fails, say:
  "This Mac can't reach GitHub to check for updates. Ask Ian to take a look." Stop.
- If commits are listed, read the new notes with
  `git -C "$APP" show '@{upstream}:CHANGELOG.md'` (start the block with the `APP=` line), take the
  entries above their current version, and summarise them in two or three plain lines. Go to Step 4.
- If nothing is listed, check whether a previous update stopped halfway (the code was downloaded
  but never built):

  ```bash
  APP="$HOME/Library/Application Support/TDS Brain/app"
  built=$(stat -f %m "$APP/dist/client/index.html" 2>/dev/null || echo 0)
  code=$(git -C "$APP" log -1 --format=%ct)
  [ "$built" -ge "$code" ] && echo "up to date" || echo "needs finishing"
  ```

  - `up to date`: say they already have the newest version, giving it from
    `node -p 'require(process.argv[1]).version' "$APP/package.json"`. Stop.
  - `needs finishing`: say "The last update downloaded but didn't finish. I'll finish it now." Go to
    Step 4, and in Step 5 skip `git pull`.

## Step 4: Warn, and ask

Restarting the app ends every chat that's open in TDS Brain. Check whether this chat is itself
running inside the app: `printenv TDS_BRAIN_SERVICE` prints `1` if so.

Use AskUserQuestion:
- In a terminal: "Updating restarts TDS Brain, which closes any chats open in it. Finish or note
  anything you're in the middle of first."
- Inside the app: say the same, and add: "This chat is running in TDS Brain, so it will end when
  the app restarts. The update will be finished by then; reopen TDS Brain after a few seconds."

Options: "Update and restart now" and "Not now". On "Not now", stop.

## Step 5: Download and build

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
cd "$APP" && git pull --ff-only && export PATH="$APP/bin:$PATH" \
  && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 build
```

`export PATH="$APP/bin:$PATH"` makes `node` the app's own Node finder (the newest suitable Node on
the Mac), so an older default Node in their terminal can't break the build.

(When finishing a half-done update, leave out `git pull --ff-only &&`.)

If any part fails, stop and don't restart. Explain the last lines in a sentence.
- `git pull --ff-only` refusing means the installed copy has drifted from GitHub: ask Ian.
- If the install or build fails, the app keeps running for now, but it may show a blank page after
  its next restart. Say: "The update didn't finish. Running /update-brain-app again will try to
  finish it; if it fails again, send Ian the error." Show the last few lines so they can copy them.

## Step 6: Restart and check

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" restart
```

Inside the app, this is the last thing that happens in this chat. Before running it, tell them:
"Restarting now. Reopen TDS Brain in a few seconds; it will be on the new version."

In a terminal, wait about five seconds, then run doctor (start the block with the `APP=` line):
`"$APP/bin/tds-brain" doctor`. If it ends "Everything looks fine.", say TDS Brain is updated to the
new version and they may need to reload its window once (Command-R). If a line starts `FIX`, explain
it and help, or suggest `/doctor-brain-app`.
