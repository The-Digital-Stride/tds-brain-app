# Move a project to another client (2026-11-21)

Ian: "I can't change or set the client on a project, or change it from Personal to client" and "When
creating a project, there's no picker for client or personal." A project's client is its folder
(`clients/<client>/projects/<slug>/` or `personal/projects/<slug>/`), and release 1 left moving out
(projects plan decision 3: "A future 'move project' is a script action that rewrites every reference in
one go"). The create form has a Client picker, but "Personal (only you)" hides inside its option list.

Scope (Ian, 2026-11-21): **personal → a client** (The Digital Stride included) and **client → another
client**. Not client → personal. No visual explainer.

## Decisions

1. **New script action `move` in `tdsapp-projects` 0.2**, capability `projects-move-v1`:
   `{ kind: 'move', key, client, expect, dropPersonal? }`. `client` is the destination client slug
   (never `personal`). The new key is `<client>/<slug>`: the folder name never changes.
   Plain: changing the client moves the project's folder; its name stays the same.
2. **What may move:** a project with a readable card (`card: 'ok'`) in `clients/<c>/projects/` or
   `personal/projects/`. Refused: archived projects, card-less folders ("add a card first"), legacy
   `projects/<slug>` folders (other skills still write there; out of scope), a move to the same client,
   a destination client whose `clients/<client>/` folder isn't a real folder, and a destination key
   that already resolves anywhere (archives and INTERNAL_PRECEDENCE included) → `exists`.
   Plain: only proper project cards move, and never on top of another project.
3. **Order, so a failure never loses anything:** check `expect` against the card, write the new card
   bytes in the OLD folder (temp file then swap, as `edit`), then `fs.rename` the folder to the new place
   (making `clients/<client>/projects/` if missing). A failed rename leaves the folder where it was with a
   harmless extra line. Same filesystem only (both under the brain root); `EXDEV` → `internal`.
   Plain: the project is either fully in its old place or fully in its new one.
4. **The card remembers where it was:** frontmatter `moved_from:` list (newest last, at most 10) gets
   the old key. `## Linked files` lines that point inside the old folder are rewritten to the new
   folder; every other line is left byte-for-byte.
   Plain: old links to the project keep working.
5. **Old keys keep resolving.** `ProjectCard.movedFrom?: ProjectKey[]`. In `resolveTodoProject` and
   `index.byKey`, a well-formed key with no live project is looked up in `movedFrom` and resolves to
   the new key (`how: 'key'`). A live folder at a key always wins over an alias. A TDS to-do still never
   resolves a `personal/` key (decision 8 of the projects plan), alias or not.
   Plain: to-dos on other people's Macs that still say the old name still show in the project.
6. **Privacy, personal → client:** the move refuses with `not-allowed` while the card links a
   `personal/` file outside its own folder, unless `dropPersonal: true` (those lines are removed). It
   refuses if any symlink is inside the folder. The app asks first and says plainly that everything in
   the folder will be shared with the team.
   Plain: nothing private outside the project gets shared by accident.
7. **The app re-points this Mac's to-dos** after a successful move: every to-do in the to-do pool (TDS
   and personal) whose `project:` is the old key gets `tdsapp-todo` `project` with the new client and
   key, keeping its stage, `expect` = its version. Failures are ignored; decision 5 covers them.
   Plain: your to-dos follow the project; anything missed still shows up through the old name.
8. **Who may move:** the same as edit (`mayChange`), and the script's `requireTeam` when the destination
   is shared (always, in this scope).
9. **Edit form:** a **Client** field (same SearchSelect as create) for movable projects. "Personal (only
   you)" is offered only while the project is personal. Changing it and saving shows a confirm panel that
   says where the project goes and what follows (to-dos moved with it; for personal → client: "Everything
   in this project's folder will be shared with the team"). Save sends `edit` (if other fields changed),
   then `move` with the new version. Without `projects-move-v1` the field is read-only with "Update the
   brain's skills to move projects."
10. **Create form:** the "who is it for" choice is visible, not hidden in a list (UX expert decides the
    exact control). Same rule on the edit form.
11. **Help:** `help/projects.md` explains moving; SKILL.md documents `move`.
12. **Known limits (told to Ian, not built):** a teammate editing the card on another Mac at the same
    time can make the brain's sync stop on a rename/modify clash; pinned files inside the folder lose
    their pin; relative links inside other markdown files in the folder are not rewritten.

## Overseer pre-review (2026-11-21): decisions changed

Blocking fixed in the plan:
- **B1 leftovers.** Git deletes only tracked files, so on teammates' Macs the old folder can linger
  (ignored `.DS_Store`, videos, zips). A card-less folder whose key is in a live card's `moved_from` is a
  leftover: the alias wins, it is left out of `projects` and listed in `ProjectList.leftovers`.
- **B2 all checks before any write.** Same device (`st.dev`), destination claimed with a non-recursive
  `mkdirSync` (as `create`), `requireRealPath` on the parent, then card write, then rename onto the claim.
  On a rename error: restore the card's original bytes and remove the claim. Retries are idempotent
  (`moved_from` deduped, never the card's own key). The card's `client:` line (if any) is set too.

Should, all taken:
- **S1 (replaces decision 9): Move is its own step.** The edit form shows the client read-only with a
  "Move…" button; the project page Overview's Client row has it too. Move opens a small screen: client
  picker, then a confirm with what happens. One script call, no edit-then-move chain.
- **S2 open to-dos only** (anyone's TDS to-dos and this person's personal ones, as tidy-up). Chosen
  before the move from `index.resolve` (`key` and `legacy` matches); `todo/done/` is never rewritten and
  resolves by alias. Alias also covers `<to-do client>/<label>` bare-slug labels. Move hidden without
  `todo-project-v1`.
- **S3 one folder walk before the write:** refuse symlinks, nested `.git`, files with `nlink > 1`,
  non-regular files.
- **S4 refuse if git ignores the destination card** (mirror of `requirePrivate`).
- **S5 personal → client changes folder depth 3 → 4:** rewrite the `../` prefix on every recognised
  `## Linked files` line.
- **S6 alias rules:** a live carded folder wins; two cards claiming one key → the lowest sorted key,
  tested; `personal/` aliases only in personal scope; `moved_from` added to `ORDER`.
- **S7 refuse when the old key has a twin** (a shadowed `projects/<slug>` or archive folder).
- **S8** to-do `## Files` lines and other cards' links into the old folder: mapped through the alias on
  read where the server resolves them (builder A's judgement; otherwise a listed known limit).
- **S9 known limit 12 reworded:** the real stall is a teammate adding a file to the old folder before
  syncing (git's `merge.directoryRenames` = conflict). The confirm says "Ask the team to sync first."
- **S10** confirm shows the file count and names, says ignored files stay on this Mac, and "This can't
  be undone here."
- Nice, taken: `library.changed` for both folders; picker and URL follow the new key; help line 44 and
  SKILL.md wording updated.

UX expert (decision 10, create form): after Title, a Seg "Who is it for" with **A client** / **Just
me**; "A client" shows the Client SearchSelect (clients only, The Digital Stride included, hint "The team
can see it."); "Just me" shows the hint "Only you can see it. You can move it to a client later." Empty
client error: "Choose a client." Confirm focus on "Keep editing"/"Cancel"; busy buttons `aria-disabled`;
after a move, ProjectsSheet's always-present visually hidden `role="status"` says "Moved to {Client}.
{n} to-dos moved with it."; `onDone` uses the new key (ProjectsSheet.tsx:129 used the old one).

## Contract (shared/projects-contract.ts, written)

`ProjectAction` `move` (with `check`), `PROJECTS_MOVE_CAPABILITY`, `PROJECT_MOVED_FROM_MAX`,
`ProjectMoveCheck`, `ProjectMoveRequest`, `ProjectMoveCheckResponse`, `ProjectMoveResult`,
`ProjectCard.movedFrom?`, `ProjectList.canMove?`, `ProjectList.leftovers?`.
Routes: `POST /api/projects/move` → `ProjectMoveCheckResponse` (with `check: true`) or `ProjectMoveResult`.

## Team

| Role | model | Owns |
|---|---|---|
| Overseer | fable, high | plan review, sign-off |
| UX expert | opus, high | create/edit client control and confirm wording |
| Builder A | opus (data integrity: folder moves, alias resolution) | `brain-skills/tdsapp-projects/**`, `shared/projects-contract.ts`, `shared/projects.ts` (+tests), `server/brain/projects.ts` (+tests), `server/http/routes.ts` move validation (+tests) |
| Builder B | sonnet | `client/src/apps/projects/**`, `client/src/styles/projects.css`, `help/projects.md` |
| Reviewers | opus correctness, opus security, sonnet UI | |

## Tests

- A: script `move` personal→client, client→client, `exists`, archived/legacy/card-less refused,
  `changed`, symlink refused, personal link refused and dropped, linked-file rewrite, `moved_from`
  written, failed rename leaves folder; resolver alias (live wins, TDS never personal); server re-points
  to-dos and ignores failures; route accepts exactly the `move` shape.
- B: edit form shows Client, confirm panel text, sends edit then move, read-only without capability,
  personal option only while personal; create form choice.

## Review outcomes

- Overseer pre-review: 2 blocking (leftover folders beating the alias; a failed move leaving the card
  changed), 10 should, 3 nice. All blocking and should taken; Move became its own screen.
- UX expert: create form "Who is it for" Seg, edit form read-only client with Move…, confirm copy.
- Correctness review: personal `moved_from` aliases hid a teammate's own personal folder of the same
  name and pulled their private to-dos under the client project (fixed: personal folders are never
  leftovers and always win over a personal alias). Re-check of the fix round: no findings.
- Security review: the file list wasn't fingerprinted between check and move (fixed: `filesVersion` /
  `filesExpect`, refused as `changed`). Everything else held (slugs, link rewriting, symlinks, hard
  links, case tricks, roles).
- UI review: "Personal" vs "Just me", repeat announcements going silent, confirm layout (fixed); focus
  stack after Edit → Move… and the Just-me hint not linked to the Seg left as nits.
- Overseer sign-off: no blockers. Follow-ups taken: leftovers notice, a `client:` line on every moved
  card, plain words for ignored files, known limits written down. Left: an empty destination folder left
  by a crash between claim and rename makes retries answer `exists` (remove it by hand).
- Known limits (help/projects.md): no move back to personal; to-do `## Files` links into the old folder
  aren't mapped; a teammate adding files to the old folder before syncing can stop their sync until
  resolved; pinned files inside the folder lose their pin.
- Browser check on a throwaway brain: personal → Skyseal → Acme → The Digital Stride; `moved_from`
  accumulates; the open personal to-do re-pointed with to-do writes on, and resolved by alias with them
  off.
