import type { AdsAccount } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import type { SearchHit, SearchSource } from '../../shell/contract.ts';
import { matchRank } from '../../state/search-match.ts';

const SECTION = 'workbench';
const TOOL = 'ad-manager';

type OpensTools = { openTool: (section: string, tool: string, arg?: string) => void };

/**
 * Ads Manager in the global search: the tool itself (the old name, "ad manager", still finds it), and each ads account
 * by name (choosing one opens Ads Manager on it). Server-backed because the accounts live in the brain; a Mac without Ad Manager gets an error, which is no hits.
 * Kept out of `ui.ts` so the palette never loads the screens.
 */
export const adManagerSearch: SearchSource = {
  id: 'ad-manager',
  title: 'Ads Manager',
  searchAsync: async (query, signal) => {
    let accounts: AdsAccount[] = [];
    try {
      accounts = await api.adsAccounts();
    } catch {
      return { hits: [], total: 0 };
    }
    if (signal.aborted) return { hits: [], total: 0 };
    const open = (arg?: string) => (a: unknown) => (a as OpensTools).openTool(SECTION, TOOL, arg);
    const hits: SearchHit[] = [];
    if (matchRank(query, 'Ads Manager', ['ad manager', 'ads', 'google ads', 'proposals']) !== null)
      hits.push({
        id: 'tool',
        label: 'Ads Manager',
        hint: 'Workbench',
        icon: 'chart' as SearchHit['icon'],
        run: open(),
      });
    for (const a of accounts) {
      if (matchRank(query, a.name, [a.key]) === null) continue;
      hits.push({
        id: `account:${a.key}`,
        label: a.name,
        hint: a.waiting > 0 ? `Ads Manager, ${a.waiting} waiting` : 'Ads Manager',
        icon: 'chart' as SearchHit['icon'],
        run: open(a.key),
      });
    }
    return { hits, total: hits.length };
  },
};
