# Where tdsapp-ads's copies come from

TDS Cortex's Ad Manager must work on a Mac that never runs the Workbench, so a few Workbench pieces
are copied into this skill (plan `docs/plans/2026-11-16-workbench-ad-manager.md`, decision 9). The
brain has no git history to compare against, so each source's sha256 at the time of copying is kept
here. The app's test (`scripts/tdsapp-ads.test.ts`) hashes the brain's files when they are on the Mac
and fails when one has changed: copy it again, check the copy still behaves, and update its line.

The proposal, monthly, apply and client-draft rules are never copied: the bridge loads them from the
brain's `.claude/skills/ads-manager/scripts/` every time it runs.

Copied 2026-11-16. Paths are from the brain's root.

| Source | sha256 | Copied to |
|---|---|---|
| `tools/members/command-centre/lib/approvals-board.cjs` | `2d8ebdc57786fb33796de745f6b317d4150a2ce2365f3bb21ae62baab0be5457` | `scripts/lib/approvals-board.cjs` (header added; BRAIN_ROOT from the environment or five folders up) |
| `tools/members/command-centre/lib/ads-board-data.cjs` | `2a1a636a5b364480b549fb459aa614dc910271e9930a4f949955f4624fee1767` | `scripts/lib/ads-board-data.cjs` (header added; BRAIN_ROOT fallback five folders up) |
| `tools/members/command-centre/lib/ads-normalize.cjs` | `6200318ce4c53bee5d3b67f3152d4a7af68a017f82c15af99730e3568a23edc3` | `scripts/lib/ads-normalize.cjs` (header added only) |
| `tools/members/command-centre/lib/standup-board.cjs` | `c1390a96bc30a3ed05c1fbe27a5e102f11e47c5145081078d3e275b11c49e85c` | `scripts/lib/standup-board.cjs` (header added; BRAIN_ROOT fallback five folders up) |
| `tools/members/command-centre/public/ads-command-board.html` | `59a7ecbd4c961e791327a65430062e56aa0dd54c57320980d876b62afb7dae0e` | `scripts/cadence-tasks.json`: `TYPES`, `COLS`, `COL_LABEL`, `BASE`, `TASKS` (16 cards, each prompt `BASE` plus its own text), `CONTRACT_PATH`, `P_DISCOVER`, `P_SHEET`, `P_PROXY`, `STANDUP_PROMPT`, `ACTION_LABELS`, word for word |
| `tools/members/command-centre/server.cjs` | `392d7f56dd838b6c019f61542f4df231995199102cfbb2f336ee430f92a774d7` | `scripts/cadence-tasks.json` `revisePrompt` (from `POST /api/approvals/decide`), and the bridge's checks and wording for the approvals, standup-config, standup-brief and standup-feedback routes; `hasAdsAccess()` |
| `.claude/skills/ads-manager/scripts/lib/proposals.cjs` | `8a6b4b1b6a7c9ea0d6a0aed0e5dbb71f47b85ea6a95d444448d1ef2b23296992` | `test-fixtures/ads-manager/lib/proposals.cjs` (tests only, verbatim) |
| `.claude/skills/ads-manager/scripts/lib/common.cjs` | `04e206494c8662686f38ca63bc2dbf0b0dfd36a653fc2bd91dfe6d93efc10050` | `test-fixtures/ads-manager/lib/common.cjs` (tests only, verbatim) |
| `.claude/skills/ads-manager/scripts/monthly.cjs` | `bdca36481e32d8ba1e431dbb3673e1b84192146ac02e0034f29a1d404a78b979` | `test-fixtures/ads-manager/monthly.cjs` (tests only, verbatim) |

The test fixtures are frozen copies so the tests run the brain's real proposal and monthly rules
against a throwaway brain. `apply.cjs` and `client-draft.cjs` are never copied: they reach Google
Ads and Gmail, so the tests use stubs.
