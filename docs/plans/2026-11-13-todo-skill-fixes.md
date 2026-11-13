# The to-do skill's script-only fixes, and the `tdsapp-` rename (2026-11-13)

**Owner:** Ian Hancock · **Branch:** `todo-skill-fixes` · **Contract:** `shared/contract.ts` (TodoItem,
TodoList, TodoAction, TODO_SKILLS, the script's command line above TODO_SCRIPT_TIMEOUT_MS)

## Objective

Fix the 13 weak spots in `os/tds-brain-app/change-requests.md` that can be fixed in our own script
and the app alone, without changing any other brain file: BCR-01, 02, 03, 04/16, 06, 07, 09, 11,
12, 13, 14, 15 and 17. Rename the skill `todo` → `tdsapp-todo` (Ian's rule: everything the app adds to the
brain starts with `tdsapp-`; Ian switched from `app-` the same day because `app-` is generic and already used in the brain. TDS Brain App files only). **Everything stays backward compatible** (Ian, 2026-11-13): older to-do files,
older callers and older copies of the app keep working, and the files we write still read correctly
in every existing reader.

Out of scope: the Workbench (`tools/members/command-centre/`), `todo/AGENTS.md`, `tools/whoami.cjs`, and
BCR-00, 05 (already built), 08, 10, 18, 19, 20. The app's own tick stays the app's code.

## Who reads and writes to-do files (checked 2026-11-13)

| Reader | Parser | Quotes | BOM | CRLF |
|---|---|---|---|---|
| Workbench | `tools/members/command-centre/lib/todo-parser.cjs` | strips one matching pair; no unescaping | not handled (no frontmatter seen) | yes |
| Reminders sync (Ian) | `~/.plaud-reminders/todo-sync.mjs` `parse` | strips one matching pair; no unescaping | not handled | yes |
| The app | `server/brain/frontmatter.ts` | strips one matching pair; no unescaping | yes | yes |
| Claude by hand | `todo/AGENTS.md` rules | | | |

All three read the title from `title:`, else the first `^#\s+` heading, else the file name. Nothing
reads `source:` text (only the Workbench writes "added from the Workbench").

## Decisions

1. **Rename to `tdsapp-todo`.** The brain gets `.claude/skills/tdsapp-todo/SKILL.md` and
   `scripts/tdsapp-todo.cjs`; the app repo's copy moves to `brain-skills/tdsapp-todo/`. The app looks for
   `tdsapp-todo` first and falls back to `todo` only when the `tdsapp-todo` folder is absent (presence, not
   access: a restricted `tdsapp-todo` never falls through). **The brain keeps `.claude/skills/todo/` for
   one release as a shim** (overseer, blocking): `SKILL.md` keeps its `roles:` (the v0.5.0 app's access
   check reads it) with a "Deprecated: use tdsapp-todo" description, and `scripts/todo.cjs` just requires
   `../../tdsapp-todo/scripts/tdsapp-todo.cjs`. Order: update Ian's installed app first, then the brain. The
   shim is removed later, once every installed app is v0.6 or later (a pipeline item).
   Plain: one search for `tdsapp-` finds everything the app added; an app or brain that's out of step still works.
2. **BCR-01: `expect`.** Optional on edit, due, assignee, delete and tick: the hex SHA-256 of the
   file's raw bytes (read as a Buffer, hashed, then decoded, on both sides, so invalid UTF-8 can't
   cause a permanent mismatch). Mismatch → 409 `changed since read`, nothing written. The script's
   `list` adds `version`. The app adds `TodoItem.version`, sends it as `expect`, and **also checks it
   itself** in `changeTodo` before running (so the protection holds even with the v0.2 fallback, which
   ignores `expect`). In a multi-step save each step after the first uses the version from the list
   the previous step returned; if the to-do is missing there, the save stops. The editor's version is
   the one when it opened. On `changed` the editor stays open with the draft, shows the message, and
   adopts the fresh version, so pressing Save again is a deliberate overwrite and typed text isn't
   lost. A held change (pass-on, delete) sent on `pagehide` can't show the error: it fails safe
   (nothing changes).
   Plain: if a teammate's change syncs in while you have a to-do open, your save stops instead of overwriting it.
3. **BCR-02: refuse, don't cut.** Title over 200 (after line breaks → spaces and trimming), details
   over 8000 (after CRLF → LF and trimming) or an assignee over 40 (after slugging) → 400 with a clear
   message. Lengths are JavaScript string lengths, as the app checks them.
   Plain: long text is never lost quietly; you're told it's too long.
4. **BCR-03: quote titles only when needed, and only when no escapes are needed.** A title needs
   quoting if it starts with one of `-?:,[]{}#&*!|>'"%@` or a backtick, contains `: ` or ` #`, ends
   with `:`, or would be read as another type (true/false/yes/no/on/off/null/~, a number, a date). Then:
   double quotes if it has no `"` and no `\`; else single quotes if it has no `'`; else written as
   today, except that a title starting with a quote mark is double-quoted anyway (it's invalid YAML
   today too, and all three readers then show it right). No reader unescapes, so this never shows a
   reader anything worse than today. The brain's 63 existing colon titles are already double-quoted
   this way.
   Plain: "ON HOLD: quote" stays readable by strict tools, and still shows the same everywhere.
5. **BCR-04/16: a title change follows `todo/AGENTS.md`.** When the title really changes, the first
   level-1 `#` heading in the body (outside code fences) becomes the new title **only if it matched the
   old title** after normalising case, spaces and punctuation (overseer, blocking: 102 of 150 to-dos
   with a heading have one that differs from `title:`, written on purpose); otherwise it's left alone.
   In every real title change
   `- YYYY-MM-DD: was "<old title>"` (UK date) goes at the end of a `## Title history` section,
   created at the end of the file if missing. The old title is the frontmatter title, else the H1;
   with neither, no history line. A change of only case, spaces or punctuation updates the heading
   but adds no history line ("only when the remaining work has really changed"). A history line can
   push details past 8000 characters, making them read-only in the app; accepted. With `body` sent,
   the rules apply to the new body.
   Plain: old titles can still be found by searching, as the brain's rules ask.
6. **BCR-06: `open: true` on `add`.** No assignee line. Old callers (no `open`) behave as before. The
   app offers "Open to anyone" when adding only when `canAddOpen` (the skill found is `tdsapp-todo`),
   because the older `todo` script would assign it to the person.
   Plain: you can add a to-do for anyone in one step.
7. **BCR-07: an explicit assignee must be on the team.** On `add` (when sent) and `assignee`, the
   slug must equal a member's name slugged by the Workbench rule or by the `whoami.cjs` rule (so
   BCR-20 can't lock anyone out). If `roles.json` is missing, unreadable or has no names, anything is
   accepted as before. The default (git name) on `add` isn't checked. Existing to-dos are untouched.
   Plain: a typo can't send a to-do to nobody.
8. **BCR-09: tick records who and when.** The script's tick writes the same record as the app's
   `stampDone` (`status: done`, `completed`, `completed_at`, `completed_by`, `completed_via`, and the
   "Done" section), from optional `by`, `by_name` (else git name) and `via` (else `todo skill`),
   writing the stamped copy then removing the original (rollback as delete).
   Plain: every finished to-do says who finished it and when, whichever tool did it.
9. **BCR-11: keep the file as it was written.** CRLF files stay CRLF (including a replaced body
   and a new frontmatter block); a UTF-8 BOM is kept and the frontmatter after it is found.
   Plain: an edit only shows the lines that changed in the sync history.
10. **BCR-12: protect the rules files.** Every write command refuses `CLAUDE.md`, `README.md` and
    `AGENTS.md` in any letter case.
    Plain: the to-do rules file can't be retitled, re-dated or deleted by mistake.
11. **BCR-13: the caller names the source.** `add` takes optional `via`; `source: added from <via>`.
    Default `added with the todo skill`. The app sends `via: "TDS Brain App"`. Existing files untouched.
    Plain: each to-do says where it was really added.
12. **BCR-14: a new name avoids finished and deleted ones.** `add` picks a name free in `todo/`,
    `todo/done/` and `todo/deleted/`.
    Plain: re-adding a to-do you finished today can still be ticked later.
13. **BCR-15: all-or-nothing writes.** Changes write a temporary dot-file in the same folder named
    `.tdsapp-todo-<pid>-<random>.tmp~` (overseer, blocking: the trailing `~` is ignored by the brain's
    `.gitignore` `*~` rule, so a leftover is never synced), fsync it, keep the original's permissions,
    then rename over the original. To keep today's behaviour, a symlink or a file without write
    permission is refused first (rename would otherwise replace it). New files (add, and copies into
    done/ and deleted/) are written to a temp file and hard-linked into place, which fails rather than
    overwrite; on any link error other than EEXIST, fall back to the current `wx` write (tested by
    injection). Temp files are removed on failure, and each run removes its own pattern's temps older
    than 10 minutes. Line endings are detected from the first line break.
    Plain: a crash or a clash can't leave a half-written to-do.
14. **BCR-17: real dates only.** `add` and `due` refuse dates like 2026-02-31.
    Plain: impossible dates are caught when saved.
15. **Skill v0.3.** SKILL.md: name `tdsapp-todo`, version 0.3, still `roles: owner, scout`, `maturity: draft`;
    the table lists every new optional field; a "Backward compatibility" note. The script header lists
    its differences from the Workbench.

## Backward compatibility (Ian's rule)

**Nothing here breaks an older file, an older caller or an existing reader.** Checked three ways:

| Direction | Result |
|---|---|
| Older to-do files → new script | All still read and changed: no frontmatter, CRLF, BOM, unquoted titles, no title line, an H1 only. BOM files are now handled better. |
| New files → existing readers | Quoted titles are stripped by all three parsers; quotes are only written when no escapes are needed. `## Title history` isn't a level-1 heading, so no reader takes it for the title. The tick record is the one the app and the Reminders sync already write. |
| Older app (v0.5.0) → new script | Finds the `todo` shim, which runs the new script. Sends no new fields, so behaves as before except the listed fixes and that a new to-do's `source:` reads "added from …"/"added with the todo skill" (nothing reads that text; checked). Its tick is its own code. |
| New app → older script (`todo` v0.2) | Found by the fallback. `expect` and `via` are ignored, so it works as before; "Open to anyone" when adding is hidden. |
| Claude following SKILL.md | Old instructions still work; new fields are optional. `tick` now also stamps who and when (the same record the app already writes). |

**Behaviour changes to call out (stricter, not breaks):** over-long text, a non-team assignee, an
impossible date and the rules files are now refused with a clear message, where before they were
quietly cut or accepted. The app never sends any of these. Claude, if it does, gets told why.

## Files and owners

| Builder | Files |
|---|---|
| A: script (opus) | `brain-skills/tdsapp-todo/**` (moved from `brain-skills/todo/`): `SKILL.md`, `scripts/tdsapp-todo.cjs`, `scripts/tdsapp-todo.test.ts` |
| B: server (sonnet) | `server/brain/todo-skill.ts`, `server/brain/todos.ts`, `server/brain/skills.ts` (if a version reader is needed), `server/http/routes.ts`, their tests, `server/brain/test-helpers.ts` |
| C: client (sonnet) | `client/src/store.tsx`, `client/src/api.ts`, `client/src/shell/TodosDrawer.tsx`, `client/src/shell/TodoForms.tsx`, their tests |
| Lead | `shared/contract.ts`, this plan, docs, brain project notes |

## Tests (written first for logic)

- A: every decision 2–14 has a failing test first in `tdsapp-todo.test.ts`, plus compatibility tests: a
  Workbench-format file round-trips; a request with only the Workbench's fields gives the old result
  (apart from the listed fixes); files written are read back the same by **frozen verbatim copies** of
  the Workbench's `parseFrontmatter` (`lib/todo-parser.cjs`) and the Reminders sync's `parse`, kept in
  `brain-skills/tdsapp-todo/test-fixtures/` (not copied to the brain), and by `server/brain/frontmatter.ts`
  imported directly; the shim runs the new script.
- B: fallback to `todo`; `canAddOpen` by version; `version` hash of the bytes; `expect` passed through;
  409 → `changed`; route shapes accept `expect` and `assignee: null` on add.
- C: the editor's version is captured on open; the second step of a save uses the fresh version; the
  held pass-on uses the version after the save's own steps; `changed` shows its message and reloads;
  "Open to anyone" only with `canAddOpen`.

## Review outcomes (2026-11-13)

- **Overseer pre-review (fable):** three blockers, all applied: H1 replaced only when it matched the old
  title (102 of 150 real to-dos have a deliberately different heading); temp names end in `~` so the
  brain's `.gitignore` covers them; keep a `todo` shim for one release. Also applied: hash bytes on both
  sides, the server checks `expect` too, lookup by presence, no version gate, symlink and no-write
  refusal, frozen parser fixtures.
- **Ian, mid-build:** prefix `app-` → `tdsapp-` (`app-` is generic and already used in the brain); the
  rule is for TDS Brain App files only.
- **Correctness (opus):** two client bugs, fixed in b617046 with tests. Save after a conflict overwrote
  a teammate's untouched fields (the draft now rebases: untouched fields take the fresh values), and text
  typed during a failing save could be lost (functional state updates).
- **Backward compatibility (opus):** no findings. Old and new script run side by side on copies of all
  237 real to-dos: due and assignee byte-identical, edits differ only by the intended quoting, history and
  heading; every result read back the same by the real Workbench parser, the Reminders sync's parse and
  the app's parser; the v0.5.0 app works through the shim; temp files are git-ignored.
- **Security (opus):** no findings.
- **UX (sonnet):** the conflict message pointed at a "latest version below" that didn't exist. Now a plain
  server message, an in-form note listing their version where it differs, "Press Save to replace it with
  yours, or Cancel to keep theirs", and its own text for held changes; clearer partial-save text.
- **Overseer sign-off (fable):** signed off, no blockers; re-ran the shim on all 238 real to-dos.
- **Browser check** (throwaway brain): add open to anyone wrote no assignee, a quoted title and
  `source: added from TDS Brain App`; a teammate's edit during editing was refused, the note appeared,
  their date and details were adopted, and Save again kept them and added a title history line. Found
  that the preview was serving a stale build; rebuilt before the check.
