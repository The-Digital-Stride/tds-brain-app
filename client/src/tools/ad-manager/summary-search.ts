import type { SearchHit, SearchSource } from '../../shell/contract.ts';
import { matchRank } from '../../state/search-match.ts';
import { ADS_TOOL_IDS, ADS_TOOL_TITLES } from './ads-tools-contract.ts';
import { adStore } from './store.ts';

const SECTION = 'workbench';
const TOOL = ADS_TOOL_IDS.summary;
const TITLE = ADS_TOOL_TITLES[TOOL];
/** Hits shown per group (the palette's own `SEARCH_GROUP_MAX`, not imported: that module imports the tool list). */
const MAX = 6;

type OpensTools = { openTool: (section: string, tool: string, arg?: string) => void };

/**
 * Ads Account Summary in the global search: the tool itself, and each deep-dive table of the account's board by title
 * (choosing one opens the tool on the current account, landing on that table). Instant: it reads only the board
 * already in the ad store and never asks the bridge while you type, so with no board it offers just the tool. Kept out
 * of `ui.ts` so the palette never loads the screens.
 */
export const summarySearch: SearchSource = {
  id: TOOL,
  title: TITLE,
  search: (query, ctx) => {
    if (ctx.ads?.visible !== true) return { hits: [], total: 0 };
    const s = adStore.get();
    const account = s.account ?? undefined;
    const open = (jump?: string) => (a: unknown) => {
      adStore.set({ jump: jump ? (`table:${jump}` as const) : null });
      (a as OpensTools).openTool(SECTION, TOOL, account);
    };
    const hits: SearchHit[] = [];
    if (matchRank(query, TITLE, ['account summary', 'ads', 'google ads', 'tables', 'deep dive']) !== null)
      hits.push({ id: 'tool', label: TITLE, hint: 'Workbench', icon: 'chart', run: open() });
    const board = s.board && s.boardFor === s.account ? s.board : null;
    const tables = Array.isArray(board?.tables) ? (board?.tables ?? []) : [];
    const found = tables
      .map((t) => ({ t, rank: matchRank(query, t.title, [t.subtitle]) }))
      .filter((m): m is { t: (typeof tables)[number]; rank: 0 | 1 | 2 | 3 } => m.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    for (const { t } of found)
      hits.push({ id: `table:${t.id}`, label: t.title, hint: TITLE, icon: 'chart', run: open(t.id) });
    return { hits: hits.slice(0, MAX), total: hits.length };
  },
};
