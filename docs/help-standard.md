# TDS Cortex help standard

Every help page in Cortex follows this file. The checks in `client/src/help/help.test.ts` enforce the parts a computer
can check; the copy reviewer checks the rest. If a rule here and a page disagree, the page is wrong.

## 1. Who we write for

Someone at TDS who is 16, bright, busy and not technical. They have never used Claude Code or a terminal. They want
to get a job done, then get back to work.

- **Short sentences.** Aim for 15 words; never more than 25.
- **Everyday words.** "Pick", not "select". "Start", not "initiate". "Change", not "modify".
- **Say "you".** "You can pin a chat", not "Users can pin chats".
- **Active voice.** "Claude files it", not "It is filed".
- **Explain a word the first time**, in the same sentence: "a *skill* (a saved set of steps Claude follows)".
  Words in the glossary link to it.
- **Benefit before mechanics.** Say why it helps, then how.
- **UK English**: colour, organise, favourite, cancelled, licence (noun), centre, behaviour.
- **Exact labels.** Quote buttons as they appear, in bold: **New chat**, **Mark as done**. Sentence case, as in the app.
- **Reading level**: Flesch–Kincaid grade 9 or lower per page (checked).
- **Only promise timing that's true.** Check every "when" and "how fast" against the code. A passed to-do
  reaches a teammate when their Brain next syncs, not "straight away".
- **No jargon list**: API, endpoint, SDK, frontmatter, repo, cache, session id, token (except for "how full a chat is", "Tokens saved" and the glossary).
  If one is truly needed, explain it.
- **Brain and Cortex**: "the Brain" is the agency's shared folder of knowledge; "Cortex" is the app. Write
  "TDS Cortex" once per page, then "Cortex". Never "Brain app" or "Cortex brain".
- **Names that haven't changed**: the sign-in helper is still called **TDS Brain Sign-in**, and the
  `/install-brain-app` commands keep their names. Quote them exactly as they are.

## 2. One file per feature

`help/<topic-id>.md`. The id is kebab-case and matches an entry in `client/src/help/topics.ts`.

```markdown
---
id: todos
title: To-dos
area: todos                 # getting-started | home | chats | todos | team | skills | files | getting-around | settings | help
order: 10                   # position within the area
summary: See what you and the team need to do, and tick things off.   # ≤ 90 characters; used in search and lists
benefit: Nothing slips through the cracks, and everyone can see who's doing what.
roles: all                  # or [owner, scout]
related: [adding-todos, passing-todos-on, change-todos-setting]
since: 0.36.0               # the version the feature first appeared in Cortex help
reviewed: 2026-11-20        # the date someone last checked this page against the app
---

## What it does
One or two sentences.

## Why it helps
Two or three bullets, each a real benefit to someone's day.

## How to use it
1. Numbered steps, one action each, using the exact button labels.
2. A screenshot after the step it shows.

![The To-dos drawer with the Mine tab open](images/todos-drawer.webp)

## Good to know
Bullets: limits, what's off by default, who can use it, what happens to your data.

## Try this
One idea to try today, written as something you could type or click.
```

- Headings are exactly these five, in this order. "Good to know" and "Try this" may be left out on very small pages.
- **Getting started** pages (Welcome, Why Cortex, A day with Cortex) are free-form, but keep the reading rules.
- **Length**: 120–350 words for a feature page. If it's longer, split it into two pages and link them.

## 3. Screenshots

- **Never by hand.** Every picture comes from `pnpm help:shots` (`scripts/help-shots.ts`), which runs Cortex on the
  demo seed (`scripts/help-demo/brain/`) with a pretend Claude. Add or change a shot in `help/shots.json`, then run
  the script. It refuses to start unless it is sure it is using the demo seed.
- **Made-up data only**: the demo clients (Acme Heating, Northwind), demo people and demo to-dos. Never a real
  client, person, email, username, home folder or file name. The script checks each picture's text as it takes it.
- **Crop to the part that matters**: one drawer, card or control with about 16px around it. Not the whole window
  unless the page is about the layout.
- **Numbered callouts**: navy circles with white numbers, at most 4 per shot. The steps refer to them: "Press
  **Add a to-do** (1)."
- **Size**: 2× pixel density, WebP, 150 KB or smaller, light theme, width 720px or less as shown.
- **Alt text**: says what the picture shows, in one sentence, as if read aloud. Not "screenshot of…".
- **One idea per picture.** Use a second shot rather than a crowded one.
- **When a screen changes**, the branch that changed it re-runs `pnpm help:shots` and commits the new pictures.

## 4. Benefits and inspiration

- Every feature page has a **Why it helps** section: what it saves (time, worry, mistakes) or makes possible.
- Use numbers only when they're measured, and say where they came from: "about 3 minutes saved per call filed
  (savings ledger, Nov 2026)". Never invent a number.
- **Team stories** (added later): one short box, "How Sam uses it", with the person's agreement. Never a real client
  name: say "a heating client".
- **Sharing with your team** is a headline benefit. Where a feature shares work (passing a to-do, filing notes,
  saving a file to the Brain), say what teammates see and that nobody has to set up access.
- **Try this** gives a concrete idea: "Type *'What's overdue for Acme Heating?'* in the Home box."

## 5. Owners and scouts

Pages with `roles: [owner, scout]` show a "For owners and scouts" chip. Everyone can read them. Start with one line
for everyone else: "Only owners and scouts can change this. Ask one if you need it."

## 6. When you change Cortex

A change that adds, removes or renames something people see updates its help page in the same branch:

1. Edit or add `help/<id>.md`, and bump `reviewed`.
2. Re-run `pnpm help:shots` if a pictured screen changed.
3. Add a line to `help/whats-new/<next-version>.md` in plain words, linking the page.
4. `pnpm test` passes. It checks: every screen has a page; frontmatter and headings; summary ≤ 90 characters;
   sentences ≤ 25 words; 120–350 words; reading level; UK spelling; banned jargon; every **bold** button label
   still exists in the app; `related` pages exist; pictures exist, have alt text, are small, have ≤ 4 callouts.

## 7. What's new notes

`help/whats-new/<version>.md`: up to five bullets, each "what you can do now", most useful first, each linked to its
help page. Not the changelog: no "fixed race in…", no internal names.
