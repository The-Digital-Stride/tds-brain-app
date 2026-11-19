import type { SearchHit, SearchSource } from '../../shell/contract.ts';
import { matchRank } from '../../state/search-match.ts';
import { ADS_TOOL_IDS, ADS_TOOL_TITLES } from './ads-tools-contract.ts';
import { adStore } from './store.ts';

const SECTION = 'workbench';
const TOOL = ADS_TOOL_IDS.command;
const TITLE = ADS_TOOL_TITLES[TOOL];
/** Hits shown per group (the palette's own `SEARCH_GROUP_MAX`, not imported: that module imports the tool list). */
const MAX = 6;

type OpensTools = { openTool: (section: string, tool: string, arg?: string) => void };

const CADENCE: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

/**
 * Ads Command Centre in the global search: the tool itself, and each task of the account's board by title (choosing
 * one opens the tool on the current account). Instant: it reads only the board already in the ad store and never asks
 * the bridge while you type, so with no board it offers just the tool. Kept out of `ui.ts` so the palette never loads
 * the screens.
 */
export const commandSearch: SearchSource = {
  id: TOOL,
  title: TITLE,
  search: (query, ctx) => {
    if (ctx.ads?.visible !== true) return { hits: [], total: 0 };
    const s = adStore.get();
    const account = s.account ?? undefined;
    const open = (a: unknown) => (a as OpensTools).openTool(SECTION, TOOL, account);
    const hits: SearchHit[] = [];
    if (
      matchRank(query, TITLE, [
        'command centre',
        'ads',
        'google ads',
        'tasks',
        'standup',
        'operating rhythm',
      ]) !== null
    )
      hits.push({ id: 'tool', label: TITLE, hint: 'Workbench', icon: 'go', run: open });
    const board = s.board && s.boardFor === s.account ? s.board : null;
    const tasks = Array.isArray(board?.cards) ? (board?.cards ?? []) : [];
    const found = tasks
      .map((c) => ({ c, rank: matchRank(query, c.title, [c.description]) }))
      .filter((m): m is { c: (typeof tasks)[number]; rank: 0 | 1 | 2 | 3 } => m.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    for (const { c } of found)
      hits.push({
        id: `task:${c.id}`,
        label: c.title,
        hint: `${TITLE}, ${CADENCE[c.cadence] ?? c.cadence}`,
        icon: 'go',
        run: open,
      });
    return { hits: hits.slice(0, MAX), total: hits.length };
  },
};
