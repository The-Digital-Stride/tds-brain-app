/**
 * Projects R2 phase 4b (plan docs/plans/2026-11-24-projects-r2-project-codes.md): the project-code ("ref") index.
 * Pure: built from every card (live and archived) and the clients' codes. A ref is a pointer, never a permission.
 */
import { foldRef, isValidRef, nearRefs } from '../../shared/project-refs.ts';
import type { ProjectRefState, RefIndex } from '../../shared/project-refs-contract.ts';
import { INTERNAL_CLIENT, type ProjectKey } from '../../shared/projects-contract.ts';

export interface RefCardInput {
  key: ProjectKey;
  space: 'client' | 'personal' | 'legacy';
  /** Null for personal; internal projects carry the-digital-stride. */
  client: string | null;
  /** The card's `ref:` line as written (any case), or null. */
  ref: string | null;
}

export interface CardRefInfo {
  ref: string | null;
  refState: ProjectRefState;
  refDuplicateOf?: ProjectKey[];
}

export interface RefIndexResult {
  index: RefIndex;
  /** Per card key (every card passed in). */
  byKey: Map<ProjectKey, CardRefInfo>;
}

/** A ref as written, upper-cased, when it passes REF_PATTERN; else null. */
export function cleanRef(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase();
  return isValidRef(up) ? up : null;
}

/**
 * `clientCodes`: client slug → its profile code (null/absent: none). The internal client is the-digital-stride.
 */
export function buildRefIndex(
  cards: readonly RefCardInput[],
  clientCodes: ReadonlyMap<string, string | null>,
): RefIndexResult {
  const refOf = new Map<ProjectKey, string | null>();
  const holders = new Map<string, ProjectKey[]>();
  for (const c of cards) {
    const ref = c.space === 'personal' ? null : cleanRef(c.ref);
    refOf.set(c.key, cleanRef(c.ref));
    if (!ref) continue;
    const folded = foldRef(ref);
    const list = holders.get(folded) ?? [];
    list.push(c.key);
    holders.set(folded, list);
  }
  const byKey = new Map<ProjectKey, CardRefInfo>();
  const resolvable = new Map<string, { key: ProjectKey; ref: string }>();
  for (const c of cards) {
    const ref = refOf.get(c.key) ?? null;
    if (c.space === 'personal') {
      byKey.set(c.key, { ref, refState: 'personal' });
      continue;
    }
    if (ref) {
      const others = (holders.get(foldRef(ref)) ?? []).filter((k) => k !== c.key);
      if (others.length > 0) {
        byKey.set(c.key, { ref, refState: 'duplicate', refDuplicateOf: others });
      } else {
        byKey.set(c.key, { ref, refState: 'ok' });
        resolvable.set(foldRef(ref), { key: c.key, ref });
      }
      continue;
    }
    const client = c.client ?? INTERNAL_CLIENT;
    byKey.set(c.key, { ref: null, refState: clientCodes.get(client) ? 'missing' : 'no-client-code' });
  }
  const refs = [...resolvable.values()].map((v) => v.ref);
  return {
    byKey,
    index: {
      resolve: (candidate) => resolvable.get(foldRef(candidate))?.key ?? null,
      near: (candidate) => nearRefs(candidate, refs),
    },
  };
}
