# Task change notices (release 2 of the task hand-over programme)

Date: 2026-11-27. Branch: `task-change-notices`. Follows release 1 (`docs/plans/2026-11-27-task-updates-handback.md`, shipped v0.96.0).

## Objective

Ian: "there should be a more prominent notification of a task that has been actioned, updated etc."
Release 1 put who did what, and when, on the task. Release 2 tells you when that happened without your having to open each task.

## User decisions (fixed)

- In the app only: no Mac banners, no sound.
- For tasks you hold and tasks you asked someone else to do.
- Shown as: a count on the rail, a section in the Tasks drawer, a Home card, and a line on the task.

## Facts (checked 2026-11-27)

- "New to you" exists: `client/src/state/todo-new.ts` (`isNewToYou`), `prefs.todoSeen` (key → `handover.at`), the rail badge (`Rail.tsx:170`), the drawer's "New to you" fold with "Mark all as seen" (`TodosDrawer.tsx` ~1470), `markTodosSeen` in the store. It covers a task arriving (a pass-on or a hand back to you) and nothing else.
- `prefs.todoSeen` is pruned by reading each value as a date (`server/store/app-store.ts` `pruneSeen`), so it can't hold anything else.
- Release 1 serves each task's log as `updates` (`TodoTimelineFields`), oldest first: notes and automatic lines carry `by` (slug); handover lines carry `byName` only. Times are to the minute.
- The Asked list is loaded inside the drawer (`TodosDrawer.tsx` ~498 `loadAsked`, `api.askedTodos()`), not in the store, so the rail and Home can't see it today.
- Home cards: ids in `HOME_ITEM_IDS` (`shared/contract.ts`), titles in `client/src/shell/home-items.ts`, drawn in `Home.tsx` (`HOME_CARDS`, `cardList`, the `recent-todos` card is the pattern).
- Tour rule (Ian, 2026-11-24): a new Home feature gets a tour step, a `TOUR_VERSION` bump and a `TOUR_HISTORY` line (`client/src/tour/steps.ts`, now version 4).

## Decisions

1. **What counts as a change.** An entry in the task's log made by someone else: a note, an automatic line, a handover. For a task you asked for, its being finished by someone else counts too. Your own actions never count. Personal tasks never count.
   Plain: you are told when a teammate does something to a task you care about, and never about your own actions.
2. **Which tasks.** TDS tasks you hold (Mine) and tasks you asked someone to do (Asked: waiting, and finished). Not Open tasks, not teammates' tasks.
3. **Only what happened since the task was last passed.** On a task you hold: after it came to you (its arrival stays "New to you", unchanged; a task that is still "New to you" is not also listed as updated). On a task you asked for: after you passed it on. On a task you handed back: only notes and the finish are news, not the other person's automatic lines.
   Plain: a task handed to you shows once, as new; later changes by others show as updates; old history never does.
4. **The rule lives in one file**, `shared/todo-changes.ts` (written and tested by the lead): `todoChange`, `lookedMark`, `othersEntries`, `pruneLooked`, `isLookedMark`. Every screen calls it. A change older than 7 days (`TODO_CHANGED_DAYS`) is never news.
5. **The marker.** `prefs.todoLooked`: task `id` → `{ keys, done?, seen }`: a short key for each entry by others you have seen (from its time, author, kind and text), whether it was finished, and when you looked. App data, never the brain. An entry is new when its key is not there. The file's fingerprint is not used (the Reminders sync and your own edits change it with nobody else involved), and nor is a count (overseer pre-review: it gave false alarms after a hand back and when a sync slotted an older entry in). This replaces the outline in release 1's plan, decision 15.
   Plain: the app remembers exactly which lines of each task's story you have read.
5a. **Handover lines get their author's slug.** The server matches the written name to the roster and fills `by` on handover entries; the rule compares slugs and falls back to the name.
   Plain: your own pass-on is never mistaken for someone else's, even when it was written under a different name.
6. **When a task counts as looked at.** Opening its panel from anywhere (drawer, Home, a project, search), while it stays open (new entries that arrive are marked seen), and "Mark all as seen" (on "New to you" too: it writes both markers, so a task that arrived with a note doesn't jump into Updated). Opening also marks the old "New to you" marker, as today.
7. **Rail.** The Tasks badge counts "New to you" plus updated tasks (held and asked).
   Needs the Asked list in the store: loaded with the task list and again on every `todos` change event; the drawer reads it from the store. The last list is kept while a reload runs (the count never dips); one request in flight plus one queued; while it is loading or has failed the rail counts held tasks only and says nothing.
8. **Drawer.** Mine tab: an "Updated" fold under "New to you", same row dot, same "Mark all as seen". Asked tab: the same fold at the top. The Asked tab's label carries a dot (with hidden text "has updates") when any asked task is updated, so it is visible from Mine. Each updated row carries one line saying the newest change, e.g. "Alex added an update · Today, 14:05", and "and 2 more" when there are more.
9. **Home.** A new card "Task updates" (`task-updates`, after Ads approvals): the updated tasks, newest change first, each with the same line; pressing one opens the task. Empty: "Updates from teammates on your tasks show here." It can be hidden in Customise Home like any card. Home's summary sentence gains "N tasks have updates" when N > 0.
10. **On the task.** In the panel's Updates list, entries you had not seen carry a "New" tag for that visit, and a line above the list says "2 new since you last looked." (as a polite status, not an alert).
11. **Wording of each change line** comes from the entry itself: notes say "<Name> added an update"; automatic and handover lines say what they already say ("<Name> changed the due date…", "<Name> handed it back to <Name>"); a finish says "<Name> marked it as done".
12. **Carry-overs from release 1** (overseer, 2026-11-27):
    a. A task you handed back shows in your Asked tab as "Handed back to <name>, <date>" (`AskedTodo.handedBack`).
    b. Delete with typed text: after "Discard changes" the task is deleted (with its Undo), not just the panel closed.
    c. The panel foot at narrow widths keeps Edit on the right when it wraps.
    d. A hand back (or pass-on) and the note sent with it show as one card: the handover line as the heading, the note under it. Display only; the file and the count are unchanged.
13. **Tour and help.** Tour step for the Home card and the rail count (`TOUR_VERSION` 5). Help: `task-updates.md`, `todos.md`, `asked-of-others.md`; one new picture; `help/whats-new/0.97.0.md`.
14. **Backward compatibility.** Nothing in the brain changes and the script is untouched. `todoLooked` and `handedBack` are optional, so older apps and older prefs files keep working. First run after the update: tasks with a teammate's entry in the last 7 days show as updated once.

## Contract

- `shared/todo-changes.ts`: the rule, its types and limits (done, 21 tests): `todoChange`, `othersEntries`, `lookedMark`, `entryKey`, `pruneLooked`, `fitLooked`, `isLookedMark`.
- `shared/contract.ts`: `AppPrefs.todoLooked?`, `AskedTodo.handedBack?`, `'task-updates'` in `HOME_ITEM_IDS` (done).
- Store additions (builder 1 implements; the others read them):
  - `asked: AskedTodoList | null`, `askedState: 'loading' | 'loaded' | 'failed'`, `reloadAsked: () => void`.
  - `markTodosLooked: (subjects: ChangeSubject[]) => void`: saves `lookedMark` for each, optimistic like `markTodosSeen`, sending the whole map (through `fitLooked`) with `api.updatePrefs({ todoLooked })`. It writes nothing when no marker would change apart from its `seen` time.
- One helper every screen uses (builder 1, `client/src/state/todo-changed.ts`): `changedTodos(todos, asked, me, prefs, now)` → `{ held: { todo, change }[]; asked: { todo, change }[]; total: number }`, newest change first, leaving out held tasks that are "New to you". `changeLine(change, team)` (the text for decision 11) lives in `client/src/shell/words.ts` with the other status lines (builder 2).

## Team and file ownership

| Who | Model, effort | Owns |
|---|---|---|
| Overseer (same agent as release 1) | Fable, high | pre-review, decisions, sign-off |
| Builder 1: data (lands first) | Sonnet, medium | `server/store/app-store.ts`, `server/http/routes.ts` (the `todoLooked` pref), `server/brain/todo-asked.ts` (`handedBack`), `server/brain/todo-timeline.ts` (slug on handover entries), `client/src/store.tsx`, `client/src/state/todo-changed.ts`, `client/src/shell/Rail.tsx`, `client/src/shell/todo-test-kit.tsx`, and their tests. No types in `client/src/shell/contract.ts` |
| Builder 2: drawer and panel | Sonnet, medium | `client/src/shell/TodosDrawer.tsx`, `TodoPanel.tsx`, `TodoUpdates.tsx`, `TodoForms.tsx`, `words.ts`, `client/src/styles/todo-panel.css`, the drawer's styles, and their tests |
| Builder 3: Home and tour | Sonnet, medium | `client/src/shell/Home.tsx`, `home-items.ts`, `CustomiseHome.tsx`, `client/src/state/home-layout.ts`, `client/src/shell/contract.ts` (summary), `client/src/tour/steps.ts`, and their tests |
| Lead | — | the rule, the contract, help pages, picture, What's new, browser check |
| Reviewers | Opus high (correctness; security folded in: one new pref route), Sonnet medium (UI and accessibility) | read only |
| UX/UI gate | Opus expert, high | sign-off before merge |

No Opus builder: nothing here is on the hard list (the one tricky rule is already written and tested).

## Tests

- Builder 1: route and prefs file accept, refuse and prune `todoLooked`; `handedBack` only for the hander's own hand back; store marks optimistically and keeps earlier marks; `changedTodos` leaves out "New to you" and personal tasks; rail count.
- Builder 2: folds, row line, tab dot, "New" tags for the visit, marks on open and while open, carry-overs b and d.
- Builder 3: card rows, empty state, hide in Customise Home, summary sentence, tour version.
- New requests go through the real `checkRequest` gate (memory: test new requests through the gate).

## Gates

`pnpm check`; deletions scan; real-browser check on a throwaway brain typed key by key; UX/UI expert; help standard (page, picture, What's new); tour step.

## Overseer pre-review (2026-11-27)

- BLOCKING, fixed: the count marker gave false alarms (after your own hand back; a late-synced older entry; your own pass-on under a git name). Now seen-entry keys, an "after you asked" cut, and slugs on handover entries (decisions 3, 5, 5a).
- SHOULD, taken: "Mark all as seen" writes both markers; store rules for the Asked list; handed-back tasks only tell you about notes and the finish; `changeLine` in `words.ts`; builder 1 lands first and owns the test kit.
- NICE, taken: the app drops the oldest markers to fit 500; known miss documented in `shared/todo-changes.ts` (a task you asked for that its holder passes to a third person leaves your Asked list with no notice).
- Decided: the four places plus the tab dot and Home sentence stay; all four carry-overs stay (12d pairs a handover and its note by same minute and same written name); launch-day one-off flags accepted.

## Review outcomes

(Filled at the end.)
