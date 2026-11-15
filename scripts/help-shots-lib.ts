/**
 * Pure safety helpers for scripts/help-shots.ts, kept apart so they can be tested without starting anything
 * (plan docs/plans/2026-11-15-cortex-help-phase-1.md, decisions 12–14 and the security review).
 */
import { demoSafeEnv } from '../server/engine/demo-guard.ts';

/** Hides the single-use sign-in code: Playwright errors quote the page address. */
export function redact(text: string): string {
  return text.replace(/([?&#]code=)[^&#\s'"]+/g, '$1[hidden]');
}

/**
 * The environment for git in the demo Brain: no secrets, and no GIT_* from the caller (a hook's GIT_DIR or
 * GIT_INDEX_FILE would point git at another repo). Fixed dates keep the demo history the same on every run.
 */
export function demoGitEnv(env: NodeJS.ProcessEnv, date: Date): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(demoSafeEnv(env)).filter(([k]) => !k.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: date.toISOString(),
    GIT_COMMITTER_DATE: date.toISOString(),
  };
}
