# Ads Release 3 (v0.52.0): names, the due count from start-up, Previous and Next

The three follow-ups Ian agreed to leave out of Release 2 (plan `2026-11-19-ads-release-2.md`, review outcomes), done
together on 2026-11-20. Size M: built by the lead; a correctness reviewer and a UX gate check it before it lands.

## Decisions

1. **The drawer's "N due" note is worked out from start-up.** A new hook, `useAdsDue`, is mounted once in the shell
   (`App.tsx`). When Ads is available it picks the account the tools would (`prefs.adsAccount`, else the first with
   proposals waiting) and loads its board, reloading it when the Ads summary changes, then counts due and overdue tasks as before (`dueCount`, the standup verdict counting as a run).
   It is now the only place that sets `adsDue`; `useAdsAccount` no longer does. An Ads tool opened later keeps the
   account and reloads its board, as it always has.
   Plain: the Workbench menu says what is due before you click into the Ads tools.

2. **People are named from the roster.** The bridge (skill 0.4, add-only) adds `people` to the `approvals` reply:
   each roster member's name slug (as proposals and configs write them, e.g. `pete-tyler`) and roster `slug`, to their
   name, using the brain's own `proposals.cjs` `loadRoster` and `slugify`. Names only, never emails. The app's
   `personName` uses it for the reviewer chip, "reviewed by", "Waiting for", the Approved column, Recent decisions'
   By column and the proposal facts, and falls back to the slug as written when the skill is older or the person is
   unknown. Only the map's own string values count, so a slug like `constructor` can't pick up an inherited property.
   Plain: screens say "Pete Tyler", not "pete-tyler", once the new skill is in the brain.

3. **Previous and Next in the proposal panel.** They step through the account's open proposals in page order
   (waiting for a decision, then approved), with "N of M"; they don't wrap, and the ends are `aria-disabled` so focus
   stays put. Recent decisions aren't in the panel, so they aren't in the order.
   Plain: you can read proposals one after another without going back to the table.

4. **The write-gate note is marked done** (`2026-11-19-brain-write-gate-ads-bridge.md`), with the line as applied in
   the brain on 2026-11-20.

## Backward compatibility

- An older skill sends no `people`: every name shows as the slug, as in v0.51.0.
- The new skill's `people` is a new field; older apps ignore it.
- No stored data changes. `adsDue` is in memory only.

## Tests

- `use-ads-due` (in `Command.test.tsx`): the count at start-up with no tool open; nothing loads when Ads is hidden or
  no account was used.
- `words.test.ts`: `personName` (case, fallback, blank names, inherited keys), names in `proposalFacts` and
  `decisionWords`.
- `AdManager.test.tsx`: Previous and Next order and ends; the reviewer chip by name.
- Bridge: `approvals.people` keys, names only, no emails, blank names skipped.

## Review outcomes

- **Correctness (Opus):** no Must or Should. Nice, both done: the note now also reloads when the Ads summary changes
  with no tool open (a decision or a teammate's run); a Shell test checks the hook is mounted, since the Command
  tests mount their own copy. Not done: a timer for tasks that fall due overnight with the app left open.
- **UX gate (Sonnet):** no Must. Done: the step is announced as one sentence ("Proposal 2 of 3, Add negatives") from
  its own live region, with the visible "2 of 3" hidden from screen readers; the monthly close's "Signed off by" also
  uses the roster name. Left: no extra announcement at the ends (`aria-disabled` already says it).
- **Lead's browser check (pretend brain, port 3596):** found that the start-up count needs a saved account, which an
  account chosen automatically never was. The hook now starts from the same fallback as the tools: the account used
  last, else the first with proposals waiting. Confirmed afterwards: "4 due" in the drawer after a fresh start with no
  tool opened; "Reviewer: Ian Hancock" and "by Pete Tyler"; Previous and Next from 1 of 3 to 3 of 3, focus staying on
  Next; no page errors.
- The step buttons first used a visually-hidden " proposal" for their names, which testing showed came out as
  "Previousproposal"; they now use `aria-label`.
