---
name: tdsapp-kits
description: Show, change and review the start-up kits the TDS Brain app uses. A kit is a short list of connectors and plugins that suits one kind of work, such as everyday agency work, ads and search, or websites and code. For now the app only notes which kit it would have picked for each chat and switches nothing off. USE WHEN asked to show, list, change or review the start-up kits, or someone says "what kits does the app have?", "add a connector to the ads kit", "take a plugin out of the web kit", "would the kits have been enough?", "how did the kit picks go this month?", "review the kits". The TDS Brain app also reads this skill's kits file.
version: 0.1
last_updated: 2026-11-15
roles: owner, scout
maturity: draft
members: false
agency: true
---

# tdsapp-kits

When the TDS Brain app starts a chat, it loads every connector and plugin you have, and that costs a lot
before you've typed a word. A **kit** is a shorter list that suits one kind of work. There are four:

| Kit | For |
|---|---|
| `core` (Everyday) | Clients, notes, to-dos, email, calendar, documents and meetings |
| `ads` (Ads and search) | Paid ads, SEO and analytics |
| `web` (Websites and code) | Websites, code, deployments and design files |
| `full` (Everything) | Anything else, or when unsure |

## Shadow mode: nothing is switched off yet

For now the app only watches. For each work chat it notes which kit it would have picked and whether
that kit would have covered everything the chat actually used. Every chat still starts with everything
on, so nothing can go missing. `review` shows how well the picks would have worked, so the kits can be
tuned before anything is ever switched off.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it to the
team.

## How to run it

```bash
node .claude/skills/tdsapp-kits/scripts/tdsapp-kits.cjs show
node .claude/skills/tdsapp-kits/scripts/tdsapp-kits.cjs set ads --connectors semrush,ahrefs --plugins marketing
node .claude/skills/tdsapp-kits/scripts/tdsapp-kits.cjs review --days 30
```

| Command | What it does |
|---|---|
| `show` | The kits as the app sees them: the built-in kits with any changes from `.claude/tdsapp-kits.json`. Add `--json` for JSON. |
| `set <kit> --connectors a,b --plugins c,d` | Replaces that kit's connector and/or plugin lists. Owner and scouts only. `full` can't be changed and an unknown kit is refused. Leave a flag out to keep that list as it is. |
| `review [--days N]` | Reads your own record of chats (the last 30 days unless you say). Shows how often the picked kit would have been enough, by how it was picked; the misses; connectors in a kit that were never used; roughly how much start-up the kits would have saved (a certain figure up to an approximate one); and the summaries and cache totals. Add `--json` for JSON. |

Exit 0 means it worked. Exit 2 means it refused, and the output says why. Tell the person in a plain
sentence what changed, or why it didn't.

## How it decides who you are

From the brain's own identity, read only: `git config user.email` (or `user.name` if there's no email),
looked up in `.team-config/roles.json`. Only `set` checks it; `show` and `review` are for anyone who can
run them.

## How it writes the file

`.claude/tdsapp-kits.json` is written whole to a hidden temporary file and swapped in, so a crash can't
leave half a file. A file that isn't valid is never overwritten: the script refuses and says so. If the
file is missing or broken, the app quietly uses the built-in kits.
