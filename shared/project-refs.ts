/**
 * Project codes ("refs"): the pure rules, shared by server and client (plan
 * docs/plans/2026-11-24-projects-r2-project-codes.md, decision 7; contract shared/project-refs-contract.ts).
 * brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs copies these rules; both run project-refs-vectors.json.
 */

import { REF_CANDIDATE_SOURCE, REF_PATTERN, REF_PROJECT_PART } from './project-refs-contract.ts';

const CANDIDATE = new RegExp(`^${REF_CANDIDATE_SOURCE}$`);
/** Words are maximal runs of A–Z a–z 0–9; everything else is a boundary. */
const WORD = /[A-Za-z0-9]+/g;

/** Code-shaped words in `text`, upper-cased, de-duplicated, in order. No cap: callers cap after lookup. */
export function refCandidates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    if (word.length < 5 || word.length > 7) continue;
    const up = word.toUpperCase();
    if (!CANDIDATE.test(up) || seen.has(up)) continue;
    seen.add(up);
    out.push(up);
  }
  return out;
}

/** A stored ref: client code + digit + letter + digit from the allowed sets, upper case. */
export function isValidRef(s: string): boolean {
  return REF_PATTERN.test(s);
}

/** Client codes compared with O→0 and I→1, so H2O and H20 are the same client code. */
export function foldClientCode(code: string): string {
  return code.toUpperCase().replace(/O/g, '0').replace(/I/g, '1');
}

/** The lookup key: upper-cased, client part folded, project part (last 3) unchanged. */
export function foldRef(ref: string): string {
  const up = ref.toUpperCase();
  const cut = up.length - REF_PROJECT_PART;
  if (cut <= 0) return up;
  return foldClientCode(up.slice(0, cut)) + up.slice(cut);
}

/** True when `a` and `b` (already folded, same length) differ by one substitution or one neighbouring swap. */
function oneSlip(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diff.push(i);
      if (diff.length > 2) return false;
    }
  }
  if (diff.length === 1) return true;
  const [i, j] = diff as [number, number];
  return j === i + 1 && a[i] === b[j] && a[j] === b[i];
}

/** The refs one slip from `candidate` (compared folded), never the exact ref, in the order given, de-duplicated. */
export function nearRefs(candidate: string, refs: readonly string[]): string[] {
  const c = foldRef(candidate);
  const out: string[] = [];
  for (const ref of refs) {
    if (out.includes(ref)) continue;
    if (oneSlip(c, foldRef(ref))) out.push(ref);
  }
  return out;
}
