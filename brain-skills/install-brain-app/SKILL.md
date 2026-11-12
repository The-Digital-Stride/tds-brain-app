---
name: install-brain-app
description: Install the TDS Brain app on this Mac - the always-running local app that opens from the Dock and runs Claude Code in your brain. Fully guided for people who aren't technical - checks the Mac, installs anything missing (Node, Apple's command line tools, Chrome) through the Mac's own install windows, downloads the app, sets it to start at login, signs you in and puts it in your Dock. USE WHEN someone says "/install-brain-app", "install TDS Brain", "set up the brain app", "get the TDS Brain app", or is a new team member setting up the app for the first time.
version: 1.0
last_updated: 2026-11-12
maturity: beta
members: false
agency: true
---

# Install the TDS Brain app

The person running this is probably not technical. Guide every step: say what is about to happen
and why, in one or two plain UK English sentences, before it happens. Never assume they know what
Terminal, Node or git are. Don't paste command output at them; say what it means. Do one thing at
a time and confirm it worked before moving on.

The app lives in `~/Library/Application Support/TDS Brain/` (code in `app/`, their sign-in secret,
settings and pins in `data/`). It starts by itself at login and restarts if it stops.

## Rules for every command

- Claude Code does not keep shell variables between commands. **Start every command block with**
  `APP="$HOME/Library/Application Support/TDS Brain/app"` when it uses `$APP`, and write the brain
  folder path out in full (the path you found in "Before anything"), never as a variable. Always
  quote paths: they contain spaces.
- Never run `sudo`, and never ask for or accept the person's Mac password in this chat. When the Mac
  needs their password, it asks in its own window; tell them that's expected and safe.
- Claude Code will ask the person before running commands. Tell them once, at the start: "I'll ask
  before each step, and Claude Code will check with you before running anything. Choose Yes when
  it's a step I've just described."
- If a step fails, stop, say what happened in a sentence, and don't improvise a different install
  method. Offer to try that step again, or to stop and ask Ian.

## Before anything

1. **Is it already running here?** `printenv TDS_BRAIN_SERVICE`. If it prints `1`, this chat is
   inside the TDS Brain app, so it's already installed. Offer `/update-brain-app` or
   `/doctor-brain-app` and stop.
2. **Terminal, not Cowork.** If this is a Cowork or sandbox session, say it needs Claude Code in the
   Terminal app on their Mac, and stop.
3. **In the brain folder.** Run `pwd -P` and check that folder has `.team-config/roles.json` and
   `tools/whoami.cjs`. If not, tell them how, step by step: open Terminal, type `cd ` (with a
   space), drag their brain folder from Finder onto the Terminal window, press Return, type
   `claude`, press Return, then type `/install-brain-app`. Stop. Otherwise note that path as the
   brain folder.
   - It must be inside their home folder. If it's in Documents, Desktop or Downloads, say: "macOS
     can stop background apps reading these folders. The install checks this before changing
     anything, so we'll find out." and carry on.
4. **Not already installed, or only half installed.** Run:

   ```bash
   test -d "$HOME/Library/Application Support/TDS Brain/app/.git" && echo code
   test -f "$HOME/Library/LaunchAgents/uk.co.thedigitalstride.tds-brain.plist" && echo service
   ```

   - Both `code` and `service`: it's installed. Offer `/update-brain-app` or `/doctor-brain-app`
     and stop.
   - `code` without `service`: an earlier install stopped before the end (or the app was
     uninstalled; its code is kept). Say "TDS Brain was downloaded here but never finished setting
     up. I'll finish it." Carry on, and in Step 3 use the **finish** command instead of downloading
     again.
   - Neither: a fresh install. Carry on.
5. **Mac only.** `uname -s` must print `Darwin`.

Then tell them the plan in three lines: check the Mac and install anything missing, download the
app, then set it up and add it to the Dock. About 10 minutes, longer if things need installing.

## Step 1: Check the Mac, and install what's missing

Check all of these first, then show a short list (ready, or needs installing). Then fix the missing
ones in this order, re-checking each before the next.

### Apple's command line tools (git)

Check: `git --version` prints a version.

If not: say "Your Mac needs Apple's command line tools, a free download from Apple. A window will
ask you to install them." Run `xcode-select --install`. Tell them: click **Install**, then
**Agree**, and wait for it to finish (it can take 5 to 15 minutes). Use AskUserQuestion: "Has the
install window finished?" with "Yes, it's done" and "Something went wrong". Re-check `git --version`.
If it says the tools are already installed but git still fails, stop and ask Ian.

### Node (runs the app)

Check: the app only uses Node from a few places, and picks the newest there. List them:

```bash
for n in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
  [ -x "$n" ] && echo "$n $("$n" --version)"
done
```

Ready if any line shows v22.18 or newer (v22.18+, v23 or later). It doesn't matter what `node`
means in their terminal: the app's commands below use the app's own Node finder.

If not, install Node 24, the long-term support version the app is built and tested on, using the
official installer from nodejs.org:

1. Say: "Your Mac needs Node, which runs the app. I'll download the official installer from
   nodejs.org, check it's genuine, and open it. Your Mac will ask for your password in the
   installer window; that's normal."
2. Download and verify:

   ```bash
   cd "$TMPDIR" && curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
     && PKG=$(awk '/node-v24\.[0-9.]*\.pkg$/ {print $2}' SHASUMS256.txt) \
     && curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$PKG" \
     && grep " $PKG\$" SHASUMS256.txt | shasum -a 256 -c - && echo "READY $PKG"
   ```

   Then check Apple vouches for it: `pkgutil --check-signature "$TMPDIR/<the .pkg name>"` must say
   "signed by a developer certificate issued by Apple" and "trusted by the Apple notary service".
   Continue only if both checks pass. If either fails, delete the download and stop: don't open
   an installer that didn't match.
3. Open it: `open "$TMPDIR/<the .pkg name it printed>"`. Tell them: click **Continue** on each page,
   **Agree** to the licence, then **Install**; enter their Mac password when the Mac asks; click
   **Close** at the end (and **Move to Bin** if it offers).
4. AskUserQuestion: "Has the Node installer finished?" with "Yes, it's done" and "Something went
   wrong". Then check `/usr/local/bin/node --version` prints `v24` (check that path exactly; plain
   `node` may still mean an older copy, which is fine).

### Google Chrome

Check: `test -d "/Applications/Google Chrome.app"`.

If not: say "TDS Brain opens in Google Chrome. I'll open Chrome's download page." Run
`open https://www.google.com/chrome/`. Tell them: click **Download Chrome**, open the downloaded
file, drag **Google Chrome** onto **Applications**, then open Chrome once and close it.
AskUserQuestion "Is Chrome installed?" ("Yes, it's done" / "Something went wrong"), then re-check.

### Claude Code

It's running now, so it's installed. Check `command -v claude` or `test -x ~/.local/bin/claude`. If
neither, stop and ask Ian (the app needs to find Claude Code by itself).

### Reaching the app's code on GitHub

The app's code is public on GitHub, so no GitHub account or sign-in is needed. Check the Mac can
reach it:

```bash
GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/The-Digital-Stride/tds-brain-app.git HEAD
```

If that prints a line, carry on. If not, it's almost always the internet connection: ask them to
check they're online (open any website), then try again. If it still fails, stop and say: "This
Mac can't reach GitHub to download TDS Brain. Ask Ian to take a look."

The app itself doesn't need pnpm installed: the commands below run it through `npx`, which comes
with Node and needs no extra install or password.

## Step 2: Say what will happen, and ask

Use AskUserQuestion. Say, in plain words:
- It downloads the app into `~/Library/Application Support/TDS Brain/app` and gets it ready (a few
  minutes).
- It sets TDS Brain to start when they log in. macOS will show a **"Background Items Added"**
  notice: that's TDS Brain, and they should leave it switched on, or the app won't start by itself.
- It opens Chrome, signed in to TDS Brain. If they have more than one Chrome profile, use the one
  they use every day.
- It uses their brain folder (give the path).

Options: "Install it" and "Not now". On "Not now", stop.

## Step 3: Download and get it ready

Fresh install:

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
mkdir -p "$HOME/Library/Application Support/TDS Brain" \
  && git clone https://github.com/The-Digital-Stride/tds-brain-app.git "$APP" \
  && cd "$APP" && export PATH="$APP/bin:$PATH" \
  && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 build
```

Finish (code already downloaded):

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
cd "$APP" && git pull --ff-only && export PATH="$APP/bin:$PATH" \
  && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 build
```

`export PATH="$APP/bin:$PATH"` makes every `node` in these commands the app's own Node finder, which
uses the newest suitable Node on the Mac. The `&&` matters: if a step fails, nothing after it runs.
If anything fails, stop and explain the last lines in a sentence. A failed download leaves nothing
behind; anything later can be finished by running `/install-brain-app` again once the cause is
fixed.

## Step 4: Set it up

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" install --brain "<the brain folder path, written out>"
```

- It checks the brain folder first and changes nothing if it can't use it. Relay its message in
  plain words.
- If another copy of TDS Brain is already running (port 3877), it stops and says so. Ask them to
  quit that copy, then run this step again.
- On success it adds **TDS Brain Sign-in** to their Applications folder, starts the app, and opens
  Chrome signed in. Remind them about the "Background Items Added" notice: leave it on.

## Step 5: Put it in the Dock

Tell them, one step at a time, and wait for "done" (AskUserQuestion) before the next:
1. In the TDS Brain page Chrome just opened, click **Settings** (the sliders icon near the bottom of
   the left-hand bar), then **Add TDS Brain to your Dock**, then **Install**. If that button isn't
   there, click the install icon at the right-hand end of Chrome's address bar (a screen with a
   down arrow) and choose **Install**.
2. TDS Brain opens in its own window. To keep it in the Dock: right-click its Dock icon, choose
   **Options**, then **Keep in Dock**.
3. If they're ever signed out, they open **TDS Brain Sign-in** from their Applications folder.

## Step 6: Check

```bash
APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" doctor
```

If it ends "Everything looks fine.", tell them it's installed, that it starts by itself when they
log in, and that `/update-brain-app` gets new versions. If any line starts `FIX`, explain it in plain
words (the line says what to do), help them through it, and run doctor again.
