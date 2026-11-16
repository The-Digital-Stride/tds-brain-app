/**
 * Called by the store (Builder A) at boot and on the `ads-changed` event. Resolves to null when the server has no ads
 * routes (an older server: 404) or the bridge is unavailable, so Ad Manager stays hidden.
 * `appIdentity` is the app's own identity slug (boot.identity.slug), for `AdsSummary.sameIdentity`.
 */
import { ADS_CAPABILITY, type AdsSummary } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';

export async function loadAdsSummary(appIdentity: string): Promise<AdsSummary | null> {
  try {
    const caps = await api.adsCapabilities();
    const visible =
      caps.features?.includes(ADS_CAPABILITY) === true && caps.adsAccess === true && caps.adsManager === true;
    const sameIdentity = caps.me !== null && caps.me.slug === appIdentity;
    if (!visible) return { visible: false, me: caps.me, sameIdentity, waiting: 0, clients: [] };
    const approvals = await api.adsApprovals();
    const clients = approvals.clients
      .filter((c) => c.mine)
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        waiting: c.open.filter((p) => p.fm.status !== 'approved').length,
      }));
    return { visible: true, me: approvals.me ?? caps.me, sameIdentity, waiting: approvals.waiting, clients };
  } catch {
    return null;
  }
}
