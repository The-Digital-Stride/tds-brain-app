# Home meetings and meeting invite links

Date: 2026-11-24 · Size: L · Branch: `home-meetings` · Explainer: no (Ian) · Contract: `shared/home-meetings-contract.ts`
(+ `link`/`join`/`MeetingLinks` in `shared/project-meetings-contract.ts`)

Follows Projects R2 phase 4 (`docs/plans/2026-11-23-projects-r2-meetings.md`, v0.69.0) and 4b (codes, v0.71.0).

## Objective

Ian (2026-11-24): "When you show up and coming meetings, always include the link to Google Calendar. Also, on the
home page, show up and coming meeting for the user in a efficient layout (use a UX/UI expert for this) and display
all meeting regardless of existing in a project or not. The purpose of Cortex is to keep the user organised."
Then: "Everywhere a meeting displays, always have the link to the meeting invite."

## User decisions (fixed)

- Merge, push, and copy the brain edits once checks and reviews pass (Ian, 2026-11-24). Files only, never git in
  the brain; grep-check each; tell Ian.
- Every UI change follows `docs/design-system.md`; a UX/UI expert designs the Home layout and signs it off from
  screenshots before merge.
- No explainer.

## Facts (2026-11-24)

- The cache `briefing/meetings-cache.json` holds `{id, title, start, end, allDay, location, attendees, refs?}`.
  No link. Ian's has 15 meetings (source `google-calendar-api`, written by `calendar-live.cjs`).
- `calendar-live.cjs` calls `calendar.events.list` with no `fields` filter, so each event already has `htmlLink`
  (e.g. `https://www.google.com/calendar/event?eid=…&ctz=Europe/London`) and, for video calls, `hangoutLink` /
  `conferenceData.entryPoints[].uri` (type `video`). The claude.ai Google Calendar connector used by /gm returns
  `htmlLink` and `conferenceUrl` too (checked live).
- An eid is base64 of `<event id> <calendar email>`. The app doesn't hold the calendar email for sure, so it can't
  build an event link from `id` alone; it uses `htmlLink`, else the day view.
- Meetings show in the app in three places today, all on the project Overview (`ProjectMeetings.tsx`,
  `ProjectActivity.tsx`): Last meeting, Next meeting, and the next meeting as a plain line in Coming up. Home has
  none (`client/src/shell/Home.tsx`: Ads approvals, Favourite to-dos/chats/files, Skills cards).
- `server/brain/meeting-match.ts` has `matchMeeting` (project) and `matchClient` (client only).
- External links elsewhere: `<a className="btn" href target="_blank" rel="noopener noreferrer">`
  (`PageStage.tsx:302`, `FileViewer.tsx:176`).

## Decisions

1. **The cache carries each meeting's invite link and video link.** Brain edits: `calendar-live.cjs` adds
   `link: ev.htmlLink || null` and `join: ev.hangoutLink || <first video entry point uri> || null`; gm Step 3's
   shape adds `"link"` (the event's `htmlLink`) and `"join"` (its video call link, or null).
   Plain: after the next /gm, every meeting knows its own Google Calendar page and its call link.
2. **The server keeps only safe links.** `link` must be https on `www.google.com`/`calendar.google.com` with a
   path under `/calendar/`; `join` must be https on Meet, Teams or Zoom (`JOIN_LINK_HOSTS`). Anything else is
   dropped. Location text is never made a link.
   Plain: a strange address written into an invite can't turn into a button in Cortex.
3. **Every meeting always has a calendar link.** No usable event link (older caches, history from before this
   release): the Google Calendar day view for the meeting's local date (`calendarKind: 'day'`).
   Plain: the link always works; before the next /gm it opens the right day rather than the invite itself.
4. **Project page: every meeting links to its invite.** `MeetingView` gains `MeetingLinks`. Last and Next meeting
   rows get "Open invite" (and "Join" for the next one when it has a call link). The history keeps the cleaned
   `link` so Last meeting opens the invite later. The Coming up meeting row gets the same link.
   Plain: wherever a meeting shows on a project, one click opens it in Google Calendar.
5. **Same guards as phase 4.** Read only when git ignores the cache; only this Mac's calendar; attendee emails
   never reach the page; the app never writes the cache.
6. **Home gets a Meetings card with every upcoming meeting**, project or not (`GET /api/meetings`): not ended,
   starting within `HOME_MEETING_DAYS` (14), soonest first. Each row: when, title, the project (opens it) or else
   the client, people, Open invite, Join. Layout from the UX/UI expert (Appendix A).
   Plain: Home shows what's coming up across your whole diary, so you don't need a second app open.
7. **Project and client on each Home row** come from the same matching as phase 4/4b (`matchMeeting`, archived
   projects ignored); with no project, `matchClient` gives the client.
8. **Working on doesn't hide meetings.** Ian asked for all meetings. (Overseer to rule whether a chosen project's
   meetings are marked.)
9. **States:** no cache → "Your meetings show here after /gm has checked your calendar."; stale → "Calendar last
   checked 22 Nov."; nothing ahead → "No meetings in the next 14 days."; error → StateNote error with Try again.
10. **The Home card re-reads** each time Home shows and every `HOME_MEETINGS_REFRESH_MS` (5 min) while shown, so
    finished meetings drop off and a new /gm shows without a reload.
11. **No refresh button that runs the calendar from the app** (proposed out of scope: running a brain tool from
    the app is new ground; /gm already does it). Overseer to confirm.

## Team

| Role | Model | Why |
|---|---|---|
| Overseer (pre-review, sign-off) | fable high | |
| UX/UI expert (Home layout design + sign-off) | opus high | Ian asked for it |
| Lead: contract, server, route, api, brain-rules docs | (me) | small, already in context |
| Builder: Home card, project links, CSS, design-system.md, help | sonnet medium | UI |
| Reviewers: correctness (opus high, link safety folded in), UI/a11y (sonnet medium) | | |

## Tests

- Lead (tests first): link cleaning (good htmlLink, http, other host, `javascript:`, path outside `/calendar/`,
  join hosts incl. zoom subdomain and `evilzoom.us`), day-link fallback (local date, all-day), Home read (all
  meetings incl. unmatched, ended dropped, in-progress kept, beyond 14 days dropped, archived project → client
  only, emails never in output, ignore guard → 'none'), history keeps `link`, route 200/405.
- Builder: Home card states (loading, none, stale, empty, rows), links have `target=_blank rel=noopener noreferrer`
  and accessible names, project row opens the project, Coming up meeting row has the link.

## Brain edits (prepared in `brain-skills/tdsapp-projects/brain-rules/home-meetings-links.md`)

- `.claude/skills/gm/SKILL.md` Step 3: shape gains `link` and `join`.
- `tools/members/command-centre/lib/calendar-live.cjs`: map adds `link` and `join` (patch file).

## Overseer pre-review (2026-11-24): outcomes

- **Blocking 1, all-day/multi-day:** fixed in the contract and `home()`. All-day values stay plain dates (end
  exclusive; no end = one day), ended once the local date reaches the end; `day` (listed under: start date, or
  today when still running) and `lastDay` ("until Fri 27 Nov") come from the server; order is day, all-day first,
  start time. Tested under Los Angeles time.
- **Blocking 2, freshness:** the Home card ALWAYS shows when the calendar was checked ("Calendar checked today at
  08:12" / "yesterday at 17:40" / "22 Nov"); stale (3+ days) adds "Run /gm to update."; empty reads "No meetings
  coming up in your calendar."
- Should, all taken: `kind` (eventType) in the cache, focus time / out of office / birthdays / working location
  dropped on every read; gm Step 3 says to leave out cancelled, declined and working-location events (tell Ian:
  changes teammates' Workbench too); "Open calendar" label for the day fallback; the agency's own client is never
  shown; rows keyed by id + start; dot-dot link paths tested; Show more states its count.
- Rulings: decision 8, no marking/filtering/reordering for Working on (help line says meetings aren't narrowed);
  decision 11, no in-app refresh; Join in scope as an addition, shown only from 15 minutes before start to the end
  (UX tuning); link history accepted with the privacy note on `MeetingLinks`/`KeptMeeting.link` and a test that
  the File-the-notes prompt holds no link.

## Appendix A: Home layout (UX/UI expert, with the overseer's overrides)

1. **Placement:** first in `.tray`, before Ads approvals, spanning both columns (`.home-meetings { grid-column:
   1 / -1 }`). `h2#home-meetings` "Meetings". No `.count` (count means "waiting"). Head button: quiet small
   `<a class="btn">` "Open Google Calendar" (`CALENDAR_HOME_URL`) + visually hidden " (opens in a new tab)".
   Working on doesn't filter or mark.
2. **Grouping:** by the server's `day`. `h3.meet-day` per day: "Today", "Tomorrow", then "Wed 26 Nov" (en-GB
   short). Each day its own `ul.drawer-list`; a heading only when its day has visible rows. Rows shown before
   Show more: `max(PINNED_ROWS, today's count)`; then `ShowMore` (wording "more", noun meeting/meetings) in place.
   All-day first in a day (server order), never "Now". In progress (timed, start ≤ now < end): `.dot[data-state=
   "working"]` and "Now" in the time column. `useNow(60_000)` tick (no fetch) drives Now/Join and drops ended rows
   between the 5-minute re-reads.
3. **Row:** static `li.line.home-meeting` (not a button), keyed `id + start`.
   - Time column `.meet-when` (48px): line 1 start "14:00" (14/500 navy, tabular-nums); line 2 end "14:30" (12px
     iron) with a hidden " to "; all-day: "All day" (12/600 navy). en-GB 24h (`hourCycle: 'h23'`).
   - `line-title`: the title. `line-meta` parts joined ", ": (1) place: client name, " · ", project title as a
     `.link-btn` opening the project (`projectPageRequest.set(key)` then `openView('app:projects')`, name "Open
     project {title}"); no project → client name; neither → left out. (2) "with Sam Lee, Jo Hart +2" (lower-case
     "with" when not first). (3) multi-day all-day: "until Fri 27 Nov" (from `lastDay`). No parts → no meta span.
   - Actions `.meet-actions` (inline-flex, gap `--sp-6`), Open invite always at the right edge: **Join** (standard
     small `<a class="btn">`, only when `join` and now is between 15 min before start and the end); **Open invite**
     (quiet small `<a class="btn">`; label "Open calendar" when `calendarKind === 'day'`). All links `target=
     "_blank" rel="noopener noreferrer"`; names with visually hidden text: "Open invite<span class=visually-hidden>
     for {title} (opens in a new tab)</span>", "Join {title} (opens in a new tab)", "Open calendar for {Wed 26
     Nov} (opens in a new tab)". No external-link icon.
   - Move `meetingWhen`, `meetingDate`, `withWords` to `client/src/shell/meeting-words.ts` (Home mustn't pull the
     lazy Projects chunk).
4. **States:** first load only StateNote loading; refreshes keep rows. No cache: "Your meetings show here after
   /gm has checked your calendar." Always a `.hint` "Calendar checked …" above the first day (overseer); stale
   adds " Run /gm to update." Empty: "No meetings coming up in your calendar." Error with no data: StateNote error
   "Couldn't read your meetings." + Try again; a failed refresh keeps rows silently.
5. **Project page:** each Meetings row's actions in `.proj-notes` (+ `flex: none`). Last: [Notes filed + Open
   notes] or [File the notes], then Open invite. Next: Join (15-minute rule), then Open invite. Coming up meeting
   row stays `.line.proj-static` with a trailing quiet small Open invite where the Overdue badge sits
   (`ComingRow` carries `calendar`, `calendarKind`); no Join there.
6. **Phone:** `@container (max-width: 560px)` (`.home-in` is a container): `.home-meeting { flex-wrap: wrap }`,
   `.meet-actions { flex-basis: 100%; padding-left: calc(var(--meet-when) + var(--sp-10)) }`. Nothing hidden.
7. **CSS** in `home.css` `@layer features`: `.home-meeting` (`--meet-when: 48px`, `align-items: flex-start`, and
   `.tray .line.home-meeting:hover, :active { background: var(--glass-92); box-shadow: none; transform: none }` so
   a static row doesn't lift), `.meet-when`, `h3.meet-day` (`--fs-small`/600 `--iron`, padding `var(--sp-4)
   var(--sp-8)`, `margin-top: var(--sp-8)` except the first), `.meet-actions`.
   **design-system.md:** Actions rule 1 (invite + Join instead of "a meeting can't be opened"), the Home Meetings
   card, Coming up's meeting row, outside links (`<a class="btn">`, hidden " (opens in a new tab)", no icon),
   Words: "Open invite", "Open calendar", "Join".

## Design review (2026-11-24, after Ian: "The home meeting card is using a lot of space")

A design and layout expert (opus) reviewed screenshots of the card as built (~450px tall, both tray columns, a
text "Open invite" on every row, 5+ rows, actions wrapping on phones). Changes made, overriding Appendix A items
1, 2, 3, 6 and 7:
- One tray column like the other cards (sits beside Favourite to-dos), not both.
- Shows all of today's meetings, at least 3 (`MEETING_ROWS`), then "Show N more meetings".
- Title and meta one line each with an ellipsis (on a card narrower than 360px inside: title up to two lines, meta wraps, Join moves under the text).
- The invite link is a 28px calendar `icon-btn` (`InviteIcon`), named "Open invite for {title} (opens in a new
  tab)" / "Open calendar for {d} …", tooltip "Open invite" / "Open calendar". Project page keeps the text links.
- Tighter day headings; the phone wrap block removed.
Measured in the browser: 281px tall at 1280px with 1 all-day + 2 timed today (was ~450px across both columns).

## Review outcomes

- Correctness/link-safety/privacy reviewer (opus): no findings (tried ~two dozen link bypasses; dates incl. DST and
  roll-overs; brain patch applied to a scratch copy). Coverage gap added: recurring instances sharing an id get
  their own call link.
- Design and layout expert (opus): redesign above; narrow-card blocker (project link hidden by the ellipsis, so a
  focusable link could be invisible) fixed by measuring the card itself (`container-type`), wrapping the meta at
  every width, and moving Join under the text below 360px. Signed off.
- Overseer (fable): signed off, no blockers. Added: full title on hover. Tell Ian: Join is an addition he didn't
  ask for; gm Step 3's "leave out declined" line also changes teammates' Workbench. Watch: on team seats Join and
  the non-meeting filter depend on Claude writing `join`/`kind` through the connector; check one teammate's cache
  after their next /gm.
