/**
 * STUB written by the lead; Builder C replaces the body. The store (Builder A) calls this at boot and on the
 * `ads-changed` event. Resolves to null when the server has no ads routes or the bridge is unavailable.
 * `appIdentity` is the app's own identity slug (boot.identity.slug), for `AdsSummary.sameIdentity`.
 */
import type { AdsSummary } from '../../../../shared/ads-contract.ts';

export async function loadAdsSummary(_appIdentity: string): Promise<AdsSummary | null> {
  return null;
}
