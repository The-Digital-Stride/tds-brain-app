# TDS Cortex help, Phase 1: help engine, Help drawer, screenshots, first pages

Date: 2026-11-15 · Size: L · Branch: `cortex-help-phase-1` · Explainer: declined (programme decision)
Parent plan: `docs/plans/2026-11-15-tds-cortex-help.md` (decisions there are fixed; numbers below are Phase 1's own).
Standard: `docs/help-standard.md`. Contract: `client/src/help/contract.ts`.

## Objective

The help engine, its checks, an owners-only Help drawer, the screenshot script with a fail-closed demo mode, and the
first 9 pages with real screenshots. Nobody but owners sees anything new. The app is still called TDS Brain in
Phase 1 (the rename is Phase 3), but help pages already say "TDS Cortex", because only owners read them until launch.

## Facts (2026-11-15)

- Drawers: `DrawerName = 'chats' | 'todos' | 'skills'` (`client/src/shell/contract.ts:21`), `DRAWERS` list in
  `client/src/state/shell.ts:33`, bodies mapped in `client/src/App.tsx:54` (`DRAWER_BODIES`). Rail items in
  `client/src/shell/Rail.tsx`; "Go to" entries in `client/src/shell/search-sources.ts` (`DRAWERS[name].go`,
  `goToEntries`). Icons: `client/src/shell/Icon.tsx` (an `IconName` union).
- Keys: `client/src/state/keys.ts`. Letters T, C, S, `[` and `/`. The Shift check comes before letters, so `?`
  (Shift+/) must be handled before it, like `/`.
- Views: `View = 'chat' | 'settings' | 'profile' | \`app:${string}\`` (`client/src/store.tsx:79`); Home is the
  `chat` view with no active chat. Role: `boot.identity.role` (`owner | scout | team | unknown`).
- Markdown: `client/src/markdown.tsx` (`renderMarkdown`, marked + DOMPurify, unwraps every non-web link).
- Vite root is `client` (`vite.config.ts:12`). From `client/src/help/`, the repo's `help/` is `../../../help/`.
- Server: `server/index.ts` builds `engine: EngineFns` (`server/engine/session-manager.ts:166`); config in
  `server/config.ts` (`TDS_BRAIN_APP_DATA`, `TDS_BRAIN_PATH`, `TDS_BRAIN_APP_PORT`, `TDS_BRAIN_SERVICE`,
  `DEFAULT_PORT`). `checkBrain` (`server/brain/locate.ts`) needs the Brain inside home with `.git`,
  `.team-config/roles.json` and `tools/whoami.cjs`.
- `test/fixtures/brain` is used by eight test files: **do not change it**.
- `pnpm check` = typecheck, lint, test, build. Dev preview: per-task folder `/tmp/tba-preview-<task>/`, port 3878,
  own `TDS_BRAIN_APP_DATA` (memory: worktree-for-every-task).

## Decisions

1. **Help files** live in `help/*.md` (repo root), pictures in `help/images/*.webp`, shots in `help/shots.json`.
   Loaded by `client/src/help/library.ts` with `import.meta.glob('../../../help/*.md', { query: '?raw', import:
   'default', eager: true })` and images with `import.meta.glob('../../../help/images/*.webp', { query: '?url',
   import: 'default', eager: true })`. A bad file never breaks the app: it is left out and `console.warn`ed (the
   tests make sure no bad file ships). Plain: help is part of the app and can't take it down.
2. **Frontmatter** is a tiny subset parsed by our own code (`frontmatter.ts`): `key: value` lines, `[a, b]`
   lists, `#` comments. No YAML dependency.
3. **Rendering**: `render.ts` exports `renderHelp` (contract `RenderHelp`): its own `Marked` instance + DOMPurify
   with the same forbidden tags as `markdown.tsx`; `help:<id>` links become `<a href="#help-<id>"
   data-help-id="<id>">` (only for ids in the library; others unwrap to text); `images/x.webp` srcs map through
   `imageUrl`, an unknown image is dropped; web links open in a new tab with `rel="noopener noreferrer"`.
   `HelpArticle.tsx` renders it and handles clicks on `[data-help-id]`. `markdown.tsx` is not changed.
4. **Context → page** (`context.ts`, `helpForContext`): a waiting chat → `approvals-and-questions`; drawer `chats` → `chats-drawer`, `todos` → `todos`,
   `skills` → `skills`; else view `home` → `home`, `chat` → `talking-to-claude`, `app:documents` → `documents`,
   `app:images` → `images`; anything else (settings, profile, other apps) → `welcome` for now. A missing id falls
   back to `welcome`.
5. **Who sees Help** (`visibility.ts`): `helpVisible(role) = role === 'owner'` in Phase 1. One function, flipped in
   Phase 3. Hidden means no rail item, `H` and `?` do nothing, no "Go to → Help", no `HelpLink`s.
6. **Help drawer**: `DrawerName` gains `'help'`. `HelpDrawer.tsx` reuses the Skills drawer's shapes (`Fold`,
   `.drawer-tools` search field, `.line` rows): the page for where you are on top (rendered with `HelpArticle`),
   then "All help pages" (a `Fold` per area, closed), then search results replace the list while the search box
   has text. A row opens that page in the drawer, with a quiet **Back** (`btn` quiet) to the previous page.
   Plain: it looks and works like the other drawers.
7. **Putting you back**: shell state gains `helpReturn: DrawerName | null` (never saved). Opening Help while another
   drawer is open records it; closing Help (its close button, `H`, Esc) reopens that drawer. Opening any other
   drawer clears it. The context Help opens with is computed when it opens and kept until it closes.
8. **Keys**: `h` toggles Help; `?` (handled before the Shift check, not while typing, palette shut, single keys on)
   opens it. Only when `helpVisible`. The Settings text listing single keys adds "H or ? for Help" only for owners.
9. **Rail**: a "Help" item directly above Settings, icon `help` (new `IconName`: a circle with a question mark,
   in the same stroke style as the other icons). It toggles the Help drawer like the other drawer items.
10. **HelpLink** (`HelpLink.tsx`): a 32px quiet `icon-btn` (like the other header controls) with the `help` icon, `aria-label` "Help: <title>", `data-tip` "Help",
    opening Help on that id. Phase 1 places one in the To-dos, Chats and Skills drawer headers only, through the
    `actions` that `App.tsx` passes to `Dock` (no change to the drawer files). A saved `help` drawer is never
    restored on load.
11. **Demo mode fails closed, by allow-list** (`server/engine/demo-guard.ts`, pure, fully tested). Two checks:
    - **Env check, before `resolveConfig()`** (which writes `runtime.json`): if `TDS_CORTEX_DEMO` is unset, nothing
      changes. If it is set to anything but `1`, exit. With `1`, all must hold: not under the service
      (`TDS_BRAIN_SERVICE` ≠ `1`); `--no-open` given; `TDS_BRAIN_APP_PORT` set and ≠ `DEFAULT_PORT`;
      `TDS_BRAIN_APP_DATA` and `TDS_BRAIN_PATH` both set, and both resolve (links followed, `realpathSync`) inside
      `<appRoot>/.help-demo/`.
    - **Brain check, straight after `decideBrain`, before `buildBrainSide`**: the decision is `ready` (setup mode
      exits), its real path equals the resolved `TDS_BRAIN_PATH`, and it holds a `.cortex-demo` file.
    Any failure prints one plain line naming the rule and exits with code 1. In demo mode `engine` is
    `createDemoEngine()` (`server/engine/demo-engine.ts`), which never starts Claude.
    Plain: demo mode says where it may run, instead of listing where it may not, so it can only see made-up data.
12. **Demo engine**: replies keyed by the first word of the prompt, message shapes copied from the
    session-manager tests' fake (`server/engine/session-manager.test.ts`), not invented:
    - the **level picker's** call (`persistSession: false`, `tools: []`; `session-manager.ts:899`) gets a fixed
      valid pick at once, so pictures match on every Mac;
    - anything else → a short reply with one Read step and Markdown text, then a `result`;
    - `approve …` → yields the `tool_use` message first, then calls `options.canUseTool` with the same
      `toolUseID` and a live `signal`, then finishes when answered;
    - `ask …` → the same path as `AskUserQuestion`, with input `parseQuestions` accepts;
    - ends cleanly on `close()`.
13. **Demo seed**: `scripts/help-demo/brain/` (committed), a made-up Brain: `.team-config/roles.json` with
    "Sam Taylor" (owner) and "Alex Morgan" (team), `tools/whoami.cjs` answering Sam, clients `acme-heating` and
    `northwind` with a few documents (`.md`, a small `.pdf`) and pictures (small `.png`), 6 to-dos (mine and open),
    3 skills, a `.cortex-demo` marker. `scripts/help-shots.ts` copies it to `.help-demo/brain` (git-ignored),
    runs `git init` there, and starts the server with demo env on port 3879 and data folder `.help-demo/data`.
14. **Screenshot script** `pnpm help:shots` (`scripts/help-shots.ts`): builds the client, starts the demo server
    with `--no-open`, reads `.help-demo/data/runtime.json` and calls `codeFromRunningServer`
    (`server/launcher.ts:62`) for a one-time sign-in code (this also proves port 3879 is the server it started; no
    sign-in code is ever printed), opens `signInUrl` in its own Chrome driven by `playwright-core`
    (`channel: 'chrome'`, no browser download, never the person's own Chrome profile), at 2× device scale, light,
    with the browser clock frozen at 2026-11-20 09:30 Europe/London. Times the server makes (chat times, the sync
    stamp) still move, so shots crop them out or mask them. For
    each `help/shots.json` entry: run its scene, crop to `crop` + `pad`, draw numbered callouts (navy circle, white
    number, white 2px ring) at each target's top-left, encode WebP with `sharp`, and write the file only if the
    pixels changed. Before saving, read the crop's text and refuse (exit 1) if it holds the username, the home
    path, or any folder name under the live Brain's `clients/` (when `~/agencybrain/clients` exists). Ends by
    stopping the server. `--only <id>` re-takes one shot.
15. **Checks** (`client/src/help/help.test.ts`, reading the `help/` folder from disk with `node:fs`): all of the
    parent plan's decision 13 that apply to Phase 1 pages, plus: every page id is in `topics.ts`'s
    `HELP_TOPIC_IDS` and back; every context in decision 4 resolves to an existing page, and drawers and the two
    apps resolve to a non-fallback page; `helpVisible` is false for every role but owner.
16. **Readability** (`readability.ts`): Flesch–Kincaid grade on prose only (no headings, code, image lines, tables
    or link targets), syllables counted with a small rule set pinned by fixture words, sentences split on `.!?`
    and list items. No dependency.

## Pages (Phase 1) and their shots

| Page id | Area | Shot id (`help/images/<id>.webp`) | Alt text |
|---|---|---|---|
| `welcome` | getting-started | `home-overview` | Home in TDS Cortex, with the message box, the client picker and your pinned cards. |
| `home` | home | `home-start` | The message box on Home, with the client picker set to Auto. |
| `chats-drawer` | chats | `chats-drawer` | The Chats drawer with two open chats and the Earlier switch. |
| `talking-to-claude` | chats | `chat-reply` | A chat where Claude has replied, with the What Claude did fold. |
| `approvals-and-questions` | chats | `approval-card` | Claude asking permission to change a file, with Allow and Don't allow buttons. |
| `todos` | todos | `todos-drawer` | The To-dos drawer with the Mine tab open. |
| `skills` | skills | `skills-drawer` | The Skills drawer with a favourite skill at the top. |
| `documents` | files | `documents-grid` | Documents in a grid, filtered to one client. |
| `images` | files | `images-grid` | Images in a grid, with one picture selected. |

## Builders (files each owns; nobody touches another's files)

| Builder | Owns | Model |
|---|---|---|
| **A, help engine** (tests first) | `client/src/help/{frontmatter,library,render,context,visibility,readability,topics}.ts` + their tests, `client/src/help/help.test.ts`, `client/src/help/HelpArticle.tsx` | Sonnet, medium |
| **B, Help drawer UI** | `client/src/shell/{HelpDrawer,HelpLink}.tsx` + tests, `client/src/styles/help.css`, `client/src/main.tsx` (import `help.css`), edits to `shell/contract.ts` (DrawerName, `helpReturn`), `state/shell.ts`, `state/keys.ts` (+ tests), `shell/ShellProvider.tsx` (role into the key context; context captured on open), `shell/Rail.tsx`, `shell/Icon.tsx`, `shell/search-sources.ts`, `App.tsx` (drawer body, header `actions`), `components/SettingsView.tsx` (keys line only), `docs/design-system.md` (Help drawer and HelpLink entries) | Sonnet, medium |
| **C, screenshots + demo** | `server/engine/{demo-guard,demo-engine}.ts` + tests, `server/index.ts` (wiring only), `scripts/help-shots.ts`, `scripts/help-demo/**`, `help/shots.json`, `help/images/*.webp`, `package.json` (script + `playwright-core` devDependency), `pnpm-lock.yaml`, `biome.json` (exclude `scripts/help-demo/brain`), `.gitignore` | Sonnet, medium |
| **D, writer** | `help/*.md` (the 9 pages) | Sonnet, medium |

**Order**: A, C and D start together (C and D don't import A). B starts when A lands, because it needs A's real
modules to type-check. Then C runs the shots, and the lead integrates and runs `pnpm check`. The alt-text table
above is the one source for both `shots.json` and the pages.

**A's exports** (B builds against these names):
- `library.ts`: `helpLibrary: HelpLibrary`, `helpImageUrl(src: string): string | null`, `parseHelpFile: ParseHelpFile`.
- `context.ts`: `helpForContext: HelpForContext`.
- `visibility.ts`: `helpVisible(role: Role): boolean`.
- `render.ts`: `renderHelp: RenderHelp`.
- `topics.ts`: `HELP_TOPIC_IDS: readonly string[]`.
- `HelpArticle.tsx`: `HelpArticle({ topic, onOpen }: { topic: HelpTopic; onOpen: (id: string) => void })`.
- A waiting chat (pending approval or question) opens Help on `approvals-and-questions`: `HelpContext` gains
  `waiting: boolean`.

## Tests (first, for logic)

- frontmatter: valid file; missing field; bad area; summary too long; list syntax; comments.
- library: order, groups, byId, search ranking, a bad file left out.
- render: `help:` link to a known id kept, unknown unwrapped; image mapped, unknown dropped; script and iframe
  stripped; web link gets `target`/`rel`.
- context: every row in decision 4; unknown → `welcome`.
- readability: syllables of pinned words; grade of two fixture passages.
- keys: `h` and `?` toggle/open help only when visible and single keys on; `?` with Shift works; not while typing.
- shell state: `helpReturn` recorded and restored; cleared by opening another drawer.
- demo-guard: each rule's failure, all-pass, unset flag.
- help.test.ts: the standard checks over the real `help/` folder.

## Gates

UX/UI expert (consistency with drawers, `Fold`, icon style; a11y). Security expert on decisions 11–14. Reviewers:
correctness (Opus), UI and a11y (Sonnet), copy truth (Sonnet: every page against the code). Browser check on the
preview, owner and non-owner identity.
