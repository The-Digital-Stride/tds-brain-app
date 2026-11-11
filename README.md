# TDS Brain App

A local "face" for the TDS Agency Brain: a small server on this laptop plus a page in Chrome, so the brain
can be used without a terminal or an IDE. Internal tool. **Local only: this repo has no remote and nothing
here is published.**

- It keeps nothing of the brain's. It reads the brain folder and drives the Claude Code already installed.
- The terminal and the IDE keep working exactly as before.
- How it fits together: open `docs/explainer.html`. The build plan: `docs/plans/`.

## Run it

```bash
pnpm install
pnpm build      # builds the page into dist/client
pnpm start      # starts the server on 127.0.0.1:3877 and opens Chrome
```

Needs Node 22.18 or newer, and Claude Code installed and signed in (`claude` on your PATH).

## Check it

```bash
pnpm check      # type-check, lint, tests, build
```

## Signing in

The app opens Chrome with a one-time code and then keeps you signed in with a cookie for 30 days.
To sign every browser out, stop the app, delete `data/runtime.json` and start it again.

```bash
lsof -ti tcp:3877 | xargs kill   # stop the app
```

## Layout

| Folder | What it holds |
|---|---|
| `shared/contract.ts` | The types and routes both halves build against |
| `server/brain/` | Reads the brain folder (skills, to-dos, clients, identity, usage). Never runs brain code in-process |
| `server/engine/` | Drives Claude Code through the Agent SDK |
| `server/http/` | The local web server and its security checks |
| `server/store/` | The app's own notes (pins, layout), kept in `data/` |
| `client/` | The page (React) |
