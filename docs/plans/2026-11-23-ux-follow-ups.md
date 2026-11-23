# UX follow-ups (after the consistency programme)

Date: 2026-11-23. Source: the five follow-ups the design expert accepted in
`2026-11-22-ux-consistency.md` (Review outcomes, "Final critique"). Rules: `docs/design-system.md`, Actions.

Ian's answers: all five; merge and push when reviewed; no explainer.

## Team

| Role | Model | Why |
|---|---|---|
| Lead | Opus | decisions below, doc edits, gates, browser check |
| Builder A: leave guard | opus, high | data integrity (typed work lost on navigation) across the store and shell holds; the Sonnet-built panel hold needed 3 fixes |
| Builder B: items 2–5 | sonnet, medium | UI and wording |
| Reviewers | opus (correctness), sonnet (UI/a11y) | |
| UX/UI gate | expert, fable | domain gate for UI |

## Decisions

1. **Leaving a page asks first.** Every page change the app makes (rail, search and palette results, Home,
   Settings, opening a chat or a tool) goes through one leave guard. While a right-panel form (Ads note,
   Rate calls) or a sheet form (project form) has unsaved work, the change is held and that form shows its
   "Discard your changes?" strip. Keep stays; Discard runs the held change. The to-do panel keeps its own hold.
   Plain: clicking away from a half-filled form now asks before throwing your typing away, everywhere.
2. **One file language.** Adding is "Add" with a plus: "Add files" on a project's Files tab (primary; it picks
   several), "Add a file" in the to-do panel (standard, rule 7's exception). Removing is an X icon button in the
   row, named "Remove {file} from this {to-do|project}", tooltip "Remove from this {thing}. The file stays in
   the library." "Link" goes (the Words table already bans "Unlink"); stored links are unchanged.
   Plain: attaching and removing a file looks and reads the same on a to-do and a project.
3. **Health says what it means.** The lights read "On track", "At risk", "Off track" (green, amber, red) for
   Health and Client comms, in the page, the form and the list summary. The dot colour stays. The stored values
   (green/amber/red in the brain's project cards) don't change.
   Plain: "Health: amber" becomes "Health: at risk", and no project file changes.
4. **Project to-do rows match drawer rows.** The same star (Favourite) and Start a chat buttons, in the same
   order, from the same components.
   Plain: a to-do offers the same buttons on a project page as in the To-dos drawer.
5. **The chat drawer header is a `.panel-head`.** Same band, title and close position as the other panels;
   labels unchanged (Open full screen, Hide chat).
   Plain: the chat drawer's top bar looks like every other panel's.

## Tests

- A (tests first): navigation with a dirty right panel asks and holds; Keep stays; Discard navigates; nothing
  dirty navigates at once; project form dirty + rail click asks; to-do hold unchanged; Home and search too.
- B: file rows' accessible names and tooltip; Add files label; light words in page, form and summary; project
  to-do row buttons; chat drawer header structure.

## Review outcomes
