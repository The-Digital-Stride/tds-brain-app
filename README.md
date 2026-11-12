# TDS Brain App

A local "face" for the TDS Agency Brain: a small server on this Mac plus a page in Chrome, so the brain
can be used without a terminal or an IDE. Internal tool. **Local only: this repo has no remote and nothing
here is published.**

- It keeps nothing of the brain's. It reads the brain folder and drives the Claude Code already installed.
- The terminal and the IDE keep working exactly as before.
- How it fits together: open `docs/explainer.html` (the app) and `docs/shell-explainer.html` (the
  screen layout). The look: `docs/design-system.md`. Each piece of work has a plan in `docs/plans/`.

## What it does

- **Home**: start a chat, optionally for one client, or from a skill. Shows what needs you, your open
  chats and your pinned skills (or the ones you use most).
- **Chats**: talk to Claude in the brain folder, as in the terminal. Approvals and Claude's questions
  appear as cards in the chat. Up to four chats can be open at once; past chats can be reopened.
  The approval mode follows your Claude Code settings (never "skip permissions").
- **Attachments**: drop files on a chat, paste a screenshot, or use the paperclip (up to 10 files,
  32 MB each; documents, spreadsheets, slides, text and pictures). Claude files every attachment in
  the brain where `.claude/rules/save-locations.md` says, asks if the client or folder isn't clear,
  and tells you where each went. The app keeps only a private copy in its data folder until then
  (an hour if unsent, a day once sent).
- **To-dos**: your to-dos and the team's open ones. Ticking them off is off by default, because it
  changes the shared brain; switch it on in Settings ("Let the app tick to-dos"). A tick records who
  did it and when.
- **Skills**: the brain's skills and commands you can run. Skills kept for owners and scouts are
  refused for other roles.
- **Images** and **Documents**: everything in the brain you're allowed to see, by client, in a grid
  or a list, with previews. Pictures, text, Markdown, HTML pages (sandboxed) and PDFs open in the app;
  anything can be downloaded. Document page previews use macOS Quick Look.
- **Settings**: preferences, and what the app found on this computer (brain folder, Claude Code,
  approval mode).

Keys: <kbd>⌘K</kbd> opens the command palette; <kbd>Esc</kbd> closes a drawer. With single-key
shortcuts on (Settings), <kbd>[</kbd> shows or hides the names on the rail, and <kbd>T</kbd>,
<kbd>C</kbd> and <kbd>S</kbd> open To-dos, Chats and Skills.

## Run it

```bash
pnpm install
pnpm build      # builds the page into dist/client
pnpm start      # starts the server on 127.0.0.1:3877 and opens Chrome
```

Needs Node 22.18 or newer, and Claude Code installed and signed in (`claude` on your PATH).

**After pulling new work, rebuild and restart.** The server only reads its code when it starts, and
the page is whatever `pnpm build` last made. An app left running from an older start keeps showing the
older version:

```bash
lsof -ti tcp:3877 | xargs kill   # stop the app (open chats are closed)
pnpm build && pnpm start
```

### Settings from the environment

| Variable | Default | What it sets |
|---|---|---|
| `TDS_BRAIN_PATH` | `~/agencybrain` | The brain folder |
| `TDS_BRAIN_APP_DATA` | `./data` | The app's own folder: sign-in secret, preferences, picture cache |
| `TDS_BRAIN_APP_PORT` | `3877` | The port |
| `TDS_CLAUDE_PATH` | `claude` on PATH | Which Claude Code to drive |

`node server/index.ts --no-open` starts it without opening Chrome.

## Working on it

Keep this folder on `main` so the app you use every day always starts from finished work. Build new
features in a separate worktree, and try them on a second port so the real app is never touched:

```bash
git worktree add ../tds-brain-app-<task> -b <task>
cd ../tds-brain-app-<task> && pnpm install
pnpm exec vite build --outDir /tmp/tba-preview/dist/client --emptyOutDir   # never this folder's dist/
```

Then run a copy of `server/` and `shared/` beside that `dist/client` with `TDS_BRAIN_APP_PORT=3878`
and its own `TDS_BRAIN_APP_DATA`.

Checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm check      # all of the above plus a build (rewrites dist/client, so not in the folder the real app runs from)
```

## Signing in

The app opens Chrome with a one-time code and then keeps you signed in with a cookie for 30 days.
To sign every browser out, stop the app, delete `data/runtime.json` and start it again.

## Layout

| Folder | What it holds |
|---|---|
| `shared/contract.ts` | The types and routes both halves build against |
| `server/brain/` | Reads the brain folder (skills, to-dos, clients, identity, usage, the library and its previews). Never runs brain code in-process |
| `server/engine/` | Drives Claude Code through the Agent SDK: chats, approvals, questions |
| `server/http/` | The local web server and its security checks |
| `server/store/` | The app's own notes (pins, layout), kept in `data/` |
| `client/src/shell/` | The frame: rail, drawers, side panel, command palette, Home |
| `client/src/components/` | Chat, approval and question cards, Settings |
| `client/src/apps/` | Images and Documents, and the parts they share |
| `client/src/state/` | Page logic kept apart from the screens, so it can be tested |
| `test/fixtures/brain/` | A small pretend brain the tests read |
