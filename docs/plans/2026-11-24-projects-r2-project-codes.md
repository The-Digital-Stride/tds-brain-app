# Projects R2 phase 4b: project codes

Date: 2026-11-24 · Size: L · Branch: `projects-r2-project-codes` · Explainer: none (Ian: No)
Parent: `docs/plans/2026-11-20-projects-system.md` (Release 2). Comes before phase 5 (email entries) so email
entries can use codes from day one.

## Objective

Give every client and internal project a short, permanent code such as `AST4K7`. People put it in a meeting
invite or an email subject. When the app, /gm or meeting-notes finds a code that belongs to a real project, it
knows which project the meeting, note or email is about, instead of guessing from title words.

## User decisions (fixed)

- Ian (2026-11-24): the code is the client's code, then **number, letter, number**, with **no dash**. Client
  codes are 2 to 4 characters long.
- Ian: a CRM expert reviews the idea for holes first (done, see "Expert review" below), then this plan.
- Ian (standing rule): no email content reaches a project without the inbox owner's approval. A code never
  changes that.
- Ian (standing rule): the app never writes brain files itself; all writes go through brain skill scripts.
  Edits to brain skills are copied into `~/agencybrain` after merge (files only, never git).
- Explainer: No.
- Ian (2026-11-24, after the plan): **meetings read codes from the invite title and description**; the
  Appendix A codes are **all correct**, Swift stays **`SWFT`**, and Ian fills in any codes from the three
  unread Monday boards after the build; **go build**.

## Facts (from the code and the brain, 2026-11-24)

- 14 of 35 client profiles have `code:` in their frontmatter: AST, BUL, BUY, CCM, GAP, H2O, HN, JF, PB, R4R,
  SF, SWFT, UAL, UC. Two contain a digit (H2O, R4R). No two clash. Ian has an open to-do (2026-11-14) to add
  codes to every client.
- The app doesn't read `code:` anywhere yet (`server/brain/clients.ts` ignores it).
- 17 project cards exist: 11 internal (`clients/the-digital-stride/projects/*`), 2 H2O, and 1 each for GAP,
  UC, weightmans and weightmans-litigation. the-digital-stride, weightmans and weightmans-litigation have no
  code.
- A folder `h20-restorations-ppc` exists, so people already type H2O as H20.
- `movedCardText` (`tdsapp-projects.cjs:1538`) keeps every frontmatter line it doesn't know byte for byte,
  so a `ref:` line survives a move without changes. A ref's letters can therefore name a client the project
  has since left.
- The script already runs git in the brain through `gitInBrain` (`tdsapp-projects.cjs:304`).
- Meetings reach the app through `briefing/meetings-cache.json` (gitignored), which is written two ways:
  Claude in /gm Step 3 through the calendar connector, and `tools/members/command-centre/lib/calendar-live.cjs`
  (brain file), which maps only `ev.summary` (line 90) and never the description.
- `monday_id` is already a card field (reserved).

## Expert review (CRM expert, Opus, 2026-11-24), all adopted unless noted

Blocking: (1) internal projects need a client code before they can get one; (2) after a move a ref's letters
name the wrong client, so the client must come from the card; (3) duplicate codes from two Macs, and reused
codes from deleted projects, must never mean two projects. Should: (4) leave confusable characters out and
space codes apart so a typo finds nothing; (5) for email, the thread beats the code; (6) codes go in
subjects, never signatures; (7) invites mostly won't carry codes, so domain and title matching stays the
main route, and both cache writers must use the same pattern check; (8) a code is a pointer, never
permission. Nice: (9) show it in brackets `[AST4K7]`; (10) never route on client letters alone; (11) Monday
and invoices (left for later, see Out of scope).

## Decisions

1. **The format.** A project code (`ref`) is the client's code exactly as in its profile, then a digit, a
   letter, a digit: `AST4K7`, `HN3P8`, `SWFT7N2`, `H2O4K7`. Digits are 2 to 9 (no 0 or 1, which look like O
   and I). The letter is one of 20: A C D E F G H J K M N P Q R T U V W X Y (no B, I, L, O, S, Z, which look
   like 8, 1, 1, 0, 5 and 2). That gives 8 × 20 × 8 = 1,280 codes per client. Always stored and shown in
   capitals.
   Plain: each project gets a code like AST4K7: the client's letters plus three characters chosen so they
   can't be misread.

2. **Client codes come first.** A client's projects get refs only once its profile has `code:`. Client codes
   are 2 to 4 characters from A–Z and 2–9 (existing H2O and R4R are allowed as written, since the reader
   treats O/0 and I/1 alike in the client part, decision 7). No two clients may have codes that are equal
   after that O/0, I/1 folding. The 21 missing codes, including `TDS` for internal projects, are a one-off
   brain edit Ian approves (Appendix A); the brain's `client-setup` skill gains a step that asks for the code
   when a client is added and checks it against the others.
   Plain: every client gets its own short code, and internal projects use TDS.

3. **Where the ref lives.** `ref: AST4K7` in `project.md` frontmatter. Written only by the `tdsapp-projects`
   script: by `create`, by `card` (adding a card to a folder that has none), and by a new `ref` action
   (decision 5). `edit` refuses to change it. A move keeps it as it is (already true). Personal projects get
   none; when a personal project moves into a client or internal space, the move gives it one, or keeps the
   ref it already has if that is still unique. A project moved from a client to personal keeps its ref in the
   file but the app neither shows it nor resolves it.
   **Capability (overseer blocker 5):** the script answers `PROJECTS_REFS_CAPABILITY` (`projects-refs-v1`) in
   `capabilities`; without it the app hides every code button (an older script on this Mac).
   Plain: the code is written once and never edited by hand through the app.

4. **Picking a code (script).** The script picks at random from the unused codes for that client. "Used"
   means: on any card in the brain now (live or archived, any client, compared after O/0, I/1 folding), or on
   any `ref:` line in the brain's git history (so a deleted project's code is never handed out again). It
   also avoids codes one character away (one substitution) or one swap away (two neighbouring characters
   swapped) from any used code of the same client, so a typo matches nothing. If no spaced code is left, it
   takes any unused code.
   **The history scan (overseer a):** only deleted cards matter (live and archived ones are on disk). Two git
   calls: `git log --diff-filter=D --no-renames --name-only --format=%H -- <card globs>`, then one
   `git cat-file --batch` reading `<commit>^:<path>` for each, taking each `ref:` line. No `-G`/`-p` over the
   whole history. A shallow clone, a timeout (`gitInBrain` gives up at 5 s) or any git error counts as
   "can't answer".
   **Never blocks (overseer blocker 1):** when git can't answer, `create`, `card` and `move` still write the
   card, just without `ref` (it then shows "Make a code"). Only the `ref` action refuses ("Couldn't check old
   codes just now. Try again in a moment.").
   Plain: no code is ever used twice, a one-character slip doesn't land on another project, and making a
   project never fails because of its code.

5. **Codes for existing projects.** A new script action `ref` gives a code to one card (`{key}`) or to every
   client and internal card that lacks one (`{all: true}`). Never changes a ref that's there, except with
   `{key, replace: true}`, which is allowed only when the app reports that ref as a duplicate (decision 6).
   **`{all: true}` is for the brain owner only (overseer blocker 3, `isBrainOwner`, script `:412`)**, and only
   they see the "Give projects codes" button: two people backfilling before a sync would write different
   `ref:` lines into the same cards and the merge conflict would make every one unreadable. After merge Ian
   runs it once. Anyone on the project can use "Make a code" on one card (a card made later by an older app on
   another Mac). Projects whose client has no code show a plain note, "Add a client code first" (no link:
   the app can't write client codes).
   Plain: Ian gives the existing projects codes in one click; anyone can fix a single straggler.

6. **Duplicates (two Macs at once).** Two Macs can pick the same code for two new projects before they sync
   (about 1 in 1,280 per pair, per client). They are different files, so git merges both without a clash.
   A copied folder is the likelier cause. When the app reads the brain, any ref held by more than one card is
   a duplicate: it resolves to nothing, and both project pages say "This code is also used by <other
   project>" with "Make a new code" behind the inline Confirm, which says "AST4K7 will then mean <other
   project>." (overseer b: `created` is only a date, so "newer" would be arbitrary). The script checks the
   duplicate on disk itself before replacing. A client `code:` that fails the pattern reads as none, never an
   error.
   Plain: if two projects ever share a code, the app notices, uses neither, and either one can take a new
   code.

7. **Reading codes in text (one rule everywhere).** A candidate is a whole word (not part of a longer word or
   number), any case, brackets ignored, matching `[A-Z0-9]{2,4}[0-9][A-Z][0-9]` after upper-casing (broader
   than a real ref on purpose, so a slip like `AST4O7` can still get a "did you mean"). The last
   three characters are the project part and the rest is the client part, so `H2O4K7` splits only one way.
   For lookup, the client part has O→0 and I→1 folded (so `H20 4K7` typed as `H204K7` still finds H2O4K7);
   the project part is exact. A candidate counts **only if it equals one live or archived card's ref**.
   Anything else is ignored. Near-misses (one substitution or swap from a real ref) are reported as
   "did you mean" where a person is looking (project search, the meeting-notes skill), never acted on.
   Postcodes (end in letters) and flight numbers (no middle letter) don't fit the pattern; anything else
   that happens to fit is dropped by the lookup. Any cap on how many are kept applies after lookup, never
   before, so junk tokens can't push the real code out (overseer c).
   Plain: the app only reacts to a code that belongs to a real project, so random text can't trigger it.

8. **The client always comes from the card, never the letters.** A resolved ref gives a project key; its
   client is whatever that card says now. Client letters alone (AST, GAP, SF…) never route anything: those
   are everyday abbreviations.
   Plain: "GAP" in a sentence files nothing, and a moved project still works.

9. **Project page.** The Overview shows the code next to the title area with one Copy button that copies
   `[AST4K7]` (brackets so it stands out in a subject line, as help desks do). The ref itself never has
   brackets. Help text: "Put this in the meeting invite or the email subject so meetings and emails find this
   project." States: no code ("Make a code"), client has no code (plain note "Add a client code first"),
   duplicate (decision 6), personal (nothing shown), no capability (code shown, no buttons). The Projects
   list search and the shell's "Search or jump to" (`client/src/shell/search-sources.ts`) find a project by
   its code. A "Give projects codes" button on the Projects home shows only to the brain owner, and only
   while some client or internal project lacks a code and its client has one. Layout and wording follow `docs/design-system.md`
   and get UX expert sign-off.
   Plain: each project shows its code with a Copy button, and you can search by code.

10. **Meetings (extends phase 4): title and description (Ian, 2026-11-24).** The overseer had ruled title
    only; Ian chose both. The cache gains an optional `refs: string[]` per meeting: the description's words
    that fit REF_PATTERN after upper-casing, de-duplicated, at most MEETING_REFS_MAX (20, larger than the
    lookup cap because the writers can't look codes up), omitted when none. Written by the /gm Step 3 text
    and by `calendar-live.cjs` (`ev.description`), both brain edits; the description itself is never
    stored. The app reads `refs` defensively and adds `refCandidates(title)`. `matchMeeting` checks codes first: if
    the meeting's refs resolve to exactly one project, that's the match (`match: 'ref'`), unless the
    attendees' email domains point at a different known client, in which case refs are ignored and the
    phase 4 rules run as before. Two or more different projects → refs ignored. An old cache with no `refs`
    works as today. `server/store/meeting-history.ts:39` accepts `'ref'` (overseer blocker 4) so a meeting
    matched by code still becomes "Last meeting". The "File the notes" prompt for a ref match says "It's for the <Client Project>
    project." (the code isn't put in the prompt).
    Plain: a meeting with a code in its invite title or description goes straight to the right project, and
    everything else matches as it does now.

11. **Meeting notes (brain edit).** At step 2, meeting-notes looks for a code in what it's filing from
    (invite, transcript, notes) and checks it with the script's new `find-ref` action. One real match: use
    that project and say so ("Filed under <project> from its code AST4K7"). Attendees from a different
    client, or two codes: ask. A near-miss: ask "did you mean AST4K7?". Never files on the code alone if the
    person says otherwise.
    Plain: notes with a code in them go to the right project without the usual question.

12. **Email (phase 5 uses this; nothing is built for email now).** Recorded here so phase 5 follows it:
    a thread already linked to a project wins; then a code in the subject; then a code in the newest
    message's own text (not quoted earlier messages); then the sender's domain. Two or more different codes →
    ask. A code only pre-selects the project on the approval screen. **Nothing is saved without the inbox
    owner's approval**, code or not. Codes never go in email signatures (help page says so).
    Plain: the code picks where an email would go; the inbox owner still decides whether it goes.

13. **A code is a pointer, not a permission.** Anyone can copy a code into an invite or email. No route
    writes anything to the brain because of a code alone: meetings only display, meeting-notes asks when
    anything disagrees, email waits for the owner.
    Plain: knowing a code doesn't let anyone put anything into a project.

## Out of scope

- Email entries themselves (phase 5).
- Monday matching by `monday_id`, and codes on invoices (Xero): good follow-ups once codes exist.
- Codes for personal projects.

## Contract

`shared/project-refs-contract.ts`: the alphabet, pattern, length limits, `ProjectRefState`, the card and
API fields, the script actions (`ref`, `find-ref`) and the meeting cache `refs` field. Pure helpers
`refCandidates`, `foldRef`, `nearRefs` live in `shared/project-refs.ts` (same rules for server, client and,
copied, the script).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable (resumed from phases 1–4) | plan critique and sign-off | (read-only) |
| CRM expert | `expert`, opus | done: idea review | (read-only) |
| Builder A | `builder`, opus | hard list: data integrity. It is the one file that writes the shared brain, and this is its first read of git history (overseer d) | `brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs`, `brain-skills/tdsapp-projects/test/**`, `brain-skills/tdsapp-projects/SKILL.md` |
| Builder B | `builder`, sonnet | default | `server/brain/project-refs.ts` (+test), `server/brain/projects.ts` (+test), `server/brain/projects-skill.ts`, `server/brain/clients.ts`, `server/brain/meeting-match.ts` (+test), `server/brain/project-meetings.ts`, `server/store/meeting-history.ts` (+test), `server/http/routes.ts`, route tests |
| Builder C | `builder`, sonnet | default | `client/src/apps/projects/**`, `client/src/shell/search-sources.ts`, `client/src/api.ts`, `client/src/styles/projects.css`, `help/projects.md`, `docs/design-system.md` |
| Lead (me) | | | `shared/project-refs.ts` (+test), `shared/project-refs-vectors.json` (test cases both suites read, written first), `shared/project-refs-contract.ts`, `shared/projects-contract.ts`, `shared/project-meetings-contract.ts`, `shared/contract.ts`, brain edits (`brain-skills/tdsapp-projects/brain-rules/r2-project-codes.md`: meeting-notes step 2, client-setup, gm Step 3, `calendar-live-refs.patch`, the 21 client `code:` lines) |
| Reviewers | correctness (opus), UI/accessibility (sonnet) | | (read-only) |
| UX expert | `expert`, opus | standing gate | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `shared/project-refs.test.ts` | pattern finds `[AST4K7]`, `ast4k7`, `H2O4K7`; ignores `AST4K7X` and `XAST4K7` (part of a word), `SW1A1AA` (postcode), `BA284` (all digits); `AST4K1` and `AST4O7` are candidates but never valid refs (`isValidRef`); folding `H204K7`→`H2O4K7`; near-misses (substitution, swap) | B (tests first) |
| `server/brain/project-refs.test.ts` | index: duplicates resolve to nothing and name each other (both 'duplicate'); archived resolve; personal never; invalid client `code:` reads as none; refState per card | B (tests first) |
| `server/store/meeting-history.test.ts` | a `'ref'` match is kept and read back | B |
| `server/brain/meeting-match.test.ts` | ref in title wins; ref in cached `refs` (description) wins; junk `refs` ignored; disagreeing attendee domain ignores refs; two projects ignore refs; cache without refs unchanged | B (tests first) |
| `brain-skills/tdsapp-projects/test/*` | `create`/`card` write a ref; `create` still writes the card (no ref) when git fails or the clone is shallow; `edit` refuses ref; no ref without a client code; never reuses a code from a deleted card; spaced from neighbours; `ref` refuses when git fails; `ref all` owner only and skips existing; `replace` only for a duplicate on disk; move from personal adds or keeps a unique ref; `find-ref`; capability answered; constants match the contract; vectors file passes | A (tests first) |
| client tests | code shown with Copy (copies brackets); each state; owner-only Give projects codes; buttons hidden without capability; search and jump-to by code | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on port 3878, `/tmp/tba-preview-projects-r2-project-codes`)
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert sign-off (standing rule)
- [ ] Browser check: project page code and Copy in every state, Give projects codes, search by code, a
      meeting matched by ref, phone width

## Appendix A: client codes (Ian: all correct, 2026-11-24)

Ian (2026-11-24): most codes can be fetched from Monday. Checked read-only through the Monday connector:
the Clients board (1788463064) has no code column; the codes live as prefixes on item names in TDS Projects
(5089802472), e.g. "BG - Bayliss Group Website Project", "HCDR - Website Rebuild", "TDS - Email Marketing".
These match the brain wherever both exist (AST, BUL, BUY, H2O, HN, JF, PB), except Swift, which Monday writes
as both SWFT and SWIFT (brain: SWFT). Three boards linked as Retainers (5088932909, 5088933151, 5092357335)
couldn't be read by the connector. Codes marked (Monday) below come from there; the rest are proposals.

| Client | Proposed | | Client | Proposed |
|---|---|---|---|---|
| 360-interiors | `TSI` | | jr-motor-company | `JRM` |
| ai-stores | `AIS` | | kinedo | `KIN` |
| bayliss-group | `BG` (Monday) | | optima-health | `OPT` |
| berganza | `BER` | | palette-london | `PAL` |
| book-vault | `BV` | | skyseal | `SKY` |
| collexchange | `CLX` | | the-digital-stride | `TDS` (Monday) |
| conference-care | `CONF` | | the-parks-trust | `TPT` |
| cotswold-fridge-hire | `CFH` | | weightmans | `WM` |
| healthcare-delivery-reviews | `HCDR` (Monday) | | weightmans-litigation | `WML` |
| hepplewhite-fitted-furniture | `HFF` | | willen-lake | `WL` |
| homebrands | `HB` | | | |

## Pre-review outcomes (overseer, Fable, 2026-11-24)

Verdict: build after five blocking changes, all made above and checked in code by the lead:
1. `create`/`card`/`move` never fail on code picking (decision 4). 2. The history scan reads deleted cards
only, two git calls (decision 4). 3. `ref {all}` owner only (decision 5). 4. `meeting-history.ts:39` drops
any match but 'title'/'only', so it now accepts 'ref', owned by B with a test (decision 10). 5.
`PROJECTS_REFS_CAPABILITY` (decision 3).
Rulings: duplicates simplified (both cards can take a new code behind Confirm; `refCanReplace` dropped);
broad candidate pattern kept, capped after lookup; Opus for A kept on a data-integrity ground; one shared
vectors file. Should items adopted: search-sources owned by C; attendee domain of another client wins
over a code; personal project returning keeps a unique ref; invalid client `code:` reads as none.
Nice adopted: `360I` replaced (it holds I, against decision 2); the contract notes that 0 and 1 in client
codes are for existing codes only.
**Escalated to Ian:** the overseer ruled meetings read codes from the title only. Ian chose title and
description (decision 10).

## Review outcomes (2026-11-24)

- Build: lead wrote `shared/project-refs.ts` (+ test) and the vectors file before the builders started, so all
  three built against one implementation; Builder A (opus) script 0.5.0, B (sonnet) server, C (sonnet) client.
  C moved the help section to its own page, `help/project-codes.md` (the projects page would pass the 350-word cap).
- Correctness reviewer (opus): 3 confirmed, all fixed with tests that fail without them: the history scan needed
  `--full-history` (a card made and deleted on another Mac before a merge was missed, so its code could be
  reused); the script exits 1 for `internal`, so the "Couldn't check old codes" reason was lost; personal cards
  still sent `ref`, so search found them (decision 3).
- UX expert (opus): signed off with 9 should/nice items, all applied: a duplicate code shows no Copy and no
  help line; focus returns after Cancel, Make a code and Give projects codes; always-mounted status line; Copy
  label swaps to "Copied" like the app's other copy buttons; help says meetings show on the Meetings card and
  emails come later; punctuation; no extra landmark; "Did you mean" clears filters.
- Overseer (fable) sign-off: no blockers. Ruling: **a code never matches an archived project's meeting** (it has
  no Meetings card); phase 4 rules place it instead; a done project still matches. Should items applied: for
  `ref` internal refusals only the two known sentences are shown (raw script errors can hold paths). Follow-up
  to watch: the history scan has a 5 s budget; if Ian's first "Give projects codes" says it couldn't check old
  codes twice running, raise `REF_HISTORY_BUDGET_MS`.
- Builder decisions kept: `ref:` sits straight after `client:`; archived cards are refused for `ref`; spacing
  checks every client's codes (stricter than decision 4); a shallow clone makes cards without codes.
- Browser check (demo brain, port 3878): create writes a code; every state; Make a new code; Give projects
  codes; search and did-you-mean; a meeting matched by a code in its description and one by a lower-case
  bracketed code in its title; phone width.
