/**
 * Projects R2 phase 4b (plan docs/plans/2026-11-24-projects-r2-project-codes.md): project codes ("refs").
 *
 * A ref is the client's code (profile frontmatter `code:`) then digit, letter, digit, no dash: `AST4K7`,
 * `H2O4K7`. Stored as `ref:` in project.md, written ONLY by the tdsapp-projects script (`create`, `card`,
 * `ref`, and `move` from personal). A ref is a pointer, never a permission (decision 13): nothing is written to
 * the brain because of a ref alone.
 *
 * The script is plain CommonJS and can't import this file: it copies these constants, and a test in
 * brain-skills/tdsapp-projects/test checks the copies match.
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── Format (decisions 1, 2) ────────────────────────────────────────────────────────────────────

/** Digits used in the project part (no 0 or 1). */
export const REF_DIGITS = '23456789';
/** Letters used in the project part (no B, I, L, O, S, Z). 20 letters. */
export const REF_LETTERS = 'ACDEFGHJKMNPQRTUVWXY';
/**
 * Client codes: 2–4 characters, A–Z and 0–9, as written in the profile. 0/1/O/I are allowed only so existing
 * codes (H2O, R4R) keep working; new client codes should avoid them. A `code:` that fails this reads as none.
 */
export const CLIENT_CODE_PATTERN = /^[A-Z0-9]{2,4}$/;
/** A valid ref: client code + digit + letter + digit from the sets above. Upper case only. */
export const REF_PATTERN = /^[A-Z0-9]{2,4}[2-9][ACDEFGHJKMNPQRTUVWXY][2-9]$/;
/** Length of the project part (always the last 3 characters). */
export const REF_PROJECT_PART = 3;

// ─── Finding refs in text (decision 7) ─────────────────────────────────────────────────────────

/**
 * A candidate in free text: a whole word (no letter or digit either side), any case, brackets ignored, that
 * matches this after upper-casing. Broader than REF_PATTERN on purpose so near-misses can be offered.
 * Use with the `gi` flags plus your own boundary check, or through `refCandidates` (shared/project-refs.ts).
 */
export const REF_CANDIDATE_SOURCE = '[A-Z0-9]{2,4}[0-9][A-Z][0-9]';
/** At most this many are kept per text, counted AFTER lookup/validity filtering, never before (overseer c). */
export const REF_CANDIDATES_MAX = 5;

/*
 * shared/project-refs.ts (pure, tests first):
 *   refCandidates(text: string): string[]      upper-cased, de-duplicated, in order, at most REF_CANDIDATES_MAX
 *   isValidRef(s: string): boolean             REF_PATTERN
 *   foldRef(ref: string): string               client part O→0, I→1; project part unchanged (lookup key)
 *   foldClientCode(code: string): string       O→0, I→1 (uniqueness between clients)
 *   nearRefs(candidate, refs): string[]         refs one substitution or one neighbouring swap away (folded)
 */

// ─── On the card and in the API (decisions 3, 6, 9) ────────────────────────────────────────────

/**
 * Added to ProjectCard (shared/projects-contract.ts) as optional fields, absent from older readers:
 *   ref?: string | null          as written on the card (upper-cased), null when none or invalid
 *   refState?: ProjectRefState
 *   refDuplicateOf?: ProjectKey[] other cards holding the same (folded) ref, when refState is 'duplicate'
 * Any duplicate card may take a new code (overseer b); the script re-checks the duplicate on disk.
 */
export type ProjectRefState =
  /** Has a ref that resolves to this card alone. */
  | 'ok'
  /** No ref yet and the client has a code: "Make a code". */
  | 'missing'
  /** No ref and the client has no code: "Add a client code first". */
  | 'no-client-code'
  /** The same ref is on another card: it resolves to nothing. */
  | 'duplicate'
  /** Personal project: no ref shown or resolved. */
  | 'personal';

/** Added to ClientInfo (server/brain/clients.ts) as optional `code?: string | null` (valid CLIENT_CODE_PATTERN, upper-cased). */

/** The server's lookup (server/brain/project-refs.ts), built with the projects list. */
export interface RefIndex {
  /** Folded ref → the one key holding it. Duplicates and personal cards are not in here. */
  resolve(candidate: string): ProjectKey | null;
  /** Valid refs one slip away from the candidate, for "did you mean". */
  near(candidate: string): string[];
}

// ─── Script actions (decisions 4, 5, 11) ───────────────────────────────────────────────────────

/** Answered by the script's `capabilities` (overseer blocker 5). Absent → the app hides every code button. */
export const PROJECTS_REFS_CAPABILITY = 'projects-refs-v1';

/*
 * Picking never blocks a write (overseer blocker 1): `create`, `card` and `move` write the card without `ref`
 * when git can't say which codes deleted cards used (shallow clone, timeout, error). Only `ref` refuses then.
 * Used codes = every card on disk (live, archived, any client, folded) + `ref:` lines of cards deleted in git
 * history (`git log --diff-filter=D --no-renames --name-only` then one `git cat-file --batch`).
 */

/**
 * `ref`: give codes. `{key}` one card; `{all: true}` every client/internal card without one, BRAIN OWNER ONLY
 * (overseer blocker 3: two backfills before a sync would conflict in every card); `replace` only when the
 * script itself finds the card's ref on another card on disk.
 */
export interface RefActionInput {
  action: 'ref';
  key?: ProjectKey;
  all?: boolean;
  replace?: boolean;
}
export interface RefActionResult {
  /** Cards given a code. */
  given: { key: ProjectKey; ref: string }[];
  /** Cards left without one, and why. */
  skipped: { key: ProjectKey; reason: 'has-ref' | 'no-client-code' | 'personal' | 'archived' | 'no-card' }[];
}

/** `find-ref`: for meeting-notes and phase 5. Read-only. */
export interface FindRefInput {
  action: 'find-ref';
  text: string;
}
export interface FindRefResult {
  /** Candidates that resolved, each to exactly one project. */
  found: { ref: string; key: ProjectKey; title: string; client: string | null }[];
  /** Candidates that didn't resolve but are one slip from a real ref. */
  near: { candidate: string; suggestions: string[] }[];
}

// ─── Meetings (decision 10) ────────────────────────────────────────────────────────────────────

/**
 * ProjectMatch gains 'ref'; server/store/meeting-history.ts must accept it (overseer blocker 4). The app reads
 * codes from the cached invite TITLE. OPEN FOR IAN: if descriptions are wanted too, CachedMeeting gains optional
 * `refs?: string[]` (REF_PATTERN-shaped candidates from the description, written by /gm Step 3 and
 * calendar-live.cjs; the description itself never stored).
 */
