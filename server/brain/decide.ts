/**
 * The brain is decided once, at start-up, and checked (setup-screen plan, decision 1). Only a `ready`
 * decision's `path` may reach anything that touches the brain.
 */
import type { AppState, BrainCheck, BrainDecision, DecideBrain } from '../../shared/install-contract.ts';

export const decideBrain: DecideBrain = async (candidate, check) => {
  let result: BrainCheck;
  try {
    result = await check(candidate.path);
  } catch {
    result = { ok: false, reason: 'not-found' };
  }
  if (result.ok) return { kind: 'ready', path: result.path, source: candidate.source };
  // `~/agencybrain` was never chosen, so there is nothing to explain: the person just picks one.
  if (candidate.source === 'default') return { kind: 'setup', tried: null, source: null, reason: null };
  return { kind: 'setup', tried: candidate.path, source: candidate.source, reason: result.reason };
};

/** What boot tells the page. */
export function appStateFor(decision: BrainDecision): AppState {
  if (decision.kind === 'ready') return { kind: 'ready' };
  return { kind: 'setup', tried: decision.tried, source: decision.source, reason: decision.reason };
}
