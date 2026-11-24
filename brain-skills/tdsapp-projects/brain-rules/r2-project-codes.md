# Brain rules for Projects R2 phase 4b: project codes

Proposed text, copied into the brain straight after the merge (files only, never git in the brain). Plan:
`docs/plans/2026-11-24-projects-r2-project-codes.md`, decisions 2, 10 and 11.

## Why

Every client and internal project gets a short code such as `AST4K7`: the client's code, then a digit, a
letter and a digit. People put it in a meeting invite (title or description) or an email subject, and TDS
Cortex, /gm and meeting-notes then know which project it is about. A code points at a project; it never gives
anyone permission to put anything into it.

Five edits make that work:

1. Every client profile has a `code:` (21 are missing, Ian approved the list on 2026-11-24).
2. client-setup asks for the code when a client is added.
3. meeting-notes looks for a code before asking which project a meeting was about.
4. /gm Step 3 keeps the code-shaped words from each invite's description in the meeting list.
5. The Workbench's `calendar-live.cjs` does the same (`calendar-live-refs.patch`).

## Before you start

Copy `tdsapp-projects` 0.5.0 into the brain first (`.claude/skills/tdsapp-projects/`): meeting-notes calls
its new `find-ref` action. If a "current passage" no longer matches, the brain file has changed: re-read it and
adjust the edit rather than overwriting.

## 1. Client codes (21 profiles)

Add one line, `code: <CODE>`, straight after the `client:` line in each `clients/<slug>/profile.md`
frontmatter. Nothing else in the file changes.

| Profile | Line |
|---|---|
| `clients/360-interiors/profile.md` | `code: TSI` |
| `clients/ai-stores/profile.md` | `code: AIS` |
| `clients/bayliss-group/profile.md` | `code: BG` |
| `clients/berganza/profile.md` | `code: BER` |
| `clients/book-vault/profile.md` | `code: BV` |
| `clients/collexchange/profile.md` | `code: CLX` |
| `clients/conference-care/profile.md` | `code: CONF` |
| `clients/cotswold-fridge-hire/profile.md` | `code: CFH` |
| `clients/healthcare-delivery-reviews/profile.md` | `code: HCDR` |
| `clients/hepplewhite-fitted-furniture/profile.md` | `code: HFF` |
| `clients/homebrands/profile.md` | `code: HB` |
| `clients/jr-motor-company/profile.md` | `code: JRM` |
| `clients/kinedo/profile.md` | `code: KIN` |
| `clients/optima-health/profile.md` | `code: OPT` |
| `clients/palette-london/profile.md` | `code: PAL` |
| `clients/skyseal/profile.md` | `code: SKY` |
| `clients/the-digital-stride/profile.md` | `code: TDS` |
| `clients/the-parks-trust/profile.md` | `code: TPT` |
| `clients/weightmans/profile.md` | `code: WM` |
| `clients/weightmans-litigation/profile.md` | `code: WML` |
| `clients/willen-lake/profile.md` | `code: WL` |

Checks after applying:
- Every profile has exactly one: `grep -c '^code:' clients/*/profile.md` shows 1 for each of the 21.
- No two clients share a code once O is read as 0 and I as 1:
  `grep -h '^code:' clients/*/profile.md | awk '{print toupper($2)}' | tr OI 01 | sort | uniq -d` prints nothing.

## 2. `.claude/skills/client-setup/SKILL.md` (2 edits)

### Edit 1: the template carries the code

Current passage:

````text
---
owner: {owner-slug}
client: {Client Name}
status: active
since: {YYYY-MM}
---
````

Replacement:

````text
---
owner: {owner-slug}
client: {Client Name}
code: {CODE}
status: active
since: {YYYY-MM}
---
````

### Edit 2: how to pick the code

Current passage:

````text
The lightweight agency record — who runs this client and where they stand. It carries
YAML frontmatter so the owner is machine-readable (the `/gm` structure check and any
future "who owns what" question read it from here).
````

Replacement:

````text
The lightweight agency record — who runs this client and where they stand. It carries
YAML frontmatter so the owner is machine-readable (the `/gm` structure check and any
future "who owns what" question read it from here).

**The client code (`code:`).** Every client has a short code that starts each of its project codes
(`AST` → project codes like `AST4K7`). Rules:
- 2 to 4 capital letters or digits. Avoid O, I, 0 and 1 (they get misread).
- If Monday's TDS Projects board already names this client with a prefix (items like "BG - Bayliss Group
  Website Project"), use that prefix.
- It must differ from every other client's code, reading O as 0 and I as 1. Check with
  `grep -h '^code:' clients/*/profile.md`.
- Propose one and confirm it with the person: **[Ask]** with your proposal (Recommended) and "Something
  else". Never change an existing client's code: its projects' codes start with it.
````

Checks after applying:
- `grep -c "^code: {CODE}" .claude/skills/client-setup/SKILL.md` is 1.
- `grep -c "The client code" .claude/skills/client-setup/SKILL.md` is 1.

## 3. `.claude/skills/meeting-notes/SKILL.md` (1 edit, step 2)

Current passage:

```
Then:

- **Client:** match to a folder under `clients/`. Run `ls clients/` — never guess a
```

Replacement:

```
Then:

- **Project code first.** Look for a project code (like `AST4K7` or `[AST4K7]`: a client code, then a
  digit, a letter and a digit) in what you're filing from: the invite title and description, the notes,
  the transcript. Check them all in one go:
  `printf '%s' '{"text": "<the invite title and description, and the notes>"}' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs find-ref`
  (JSON-escape the text). It answers `found` (codes that belong to one real project, with its key, title
  and client) and `near` (codes one slip from a real one).
  - One project in `found` → that settles the client and the project below; say so when you report
    ("Filed under <project> from its code AST4K7"). Still **[Ask]** if the attendees are from a different
    client, or the person or the prompt names another project: the code never overrides them.
  - Two or more projects in `found` → **[Ask]** which one, with those projects plus "Not about one project".
  - Only `near` → **[Ask]** "Did you mean AST4K7 (<project>)?" with Yes and No.
  - Nothing → carry on below as usual. Client letters on their own (AST, GAP, SF) are everyday
    abbreviations and never pick a client or project.
- **Client:** match to a folder under `clients/`. Run `ls clients/` — never guess a
```

Check after applying: `grep -c "Project code first" .claude/skills/meeting-notes/SKILL.md` is 1.

## 4. `.claude/skills/gm/SKILL.md` (1 edit, Step 3)

Current passage:

````text
    { "id": "<stable event id>", "title": "…", "start": "<ISO>", "end": "<ISO>",
      "allDay": false, "location": "… or null",
      "attendees": [ { "name": "… or null", "email": "…" } ] }
  ]
}
```

Keep the real calendar `id` (the Meetings view uses it to spot the next meeting and to de-dupe).
````

Replacement:

````text
    { "id": "<stable event id>", "title": "…", "start": "<ISO>", "end": "<ISO>",
      "allDay": false, "location": "… or null",
      "attendees": [ { "name": "… or null", "email": "…" } ],
      "refs": [ "AST4K7" ] }
  ]
}
```

`refs` holds the project codes in the event's **description**: each whole word that, in capitals, is 2 to 4
letters or digits followed by a digit 2–9, one of the letters A C D E F G H J K M N P Q R T U V W X Y, and a
digit 2–9 (for example `AST4K7`, `[ast4k7]` → `AST4K7`). At most 20, no repeats; leave `refs` out when there are
none. Never copy the description itself into the file. TDS Cortex uses these to put the meeting on the
right project.

Keep the real calendar `id` (the Meetings view uses it to spot the next meeting and to de-dupe).
````

Check after applying: `grep -c '"refs": \[ "AST4K7" \]' .claude/skills/gm/SKILL.md` is 1.

## 5. `tools/members/command-centre/lib/calendar-live.cjs` (patch)

`calendar-live-refs.patch` (next to this file) adds `refs` to each meeting it writes, by the same rule, from
`ev.description`; the description itself is never written.

Apply (from inside `tools/members/command-centre`, file writes only, no git):

    patch --dry-run -p1 < calendar-live-refs.patch
    patch -p1 < calendar-live-refs.patch

Stop on any mismatch. Checks: `node --check lib/calendar-live.cjs`; `grep -c "refs: refsFrom(ev.description)"
lib/calendar-live.cjs` is 1. The Workbench Meetings view ignores the new field. Restart the Workbench server
afterwards if it was started from a terminal.

## Not changed

- Old meeting lists without `refs` keep working: the app also reads codes from the invite title.
- Codes never go in email signatures: one there would tag every email you send. The app's help page says so.
- Phase 5 (email entries) uses codes too, but nothing about email is in the brain yet.
