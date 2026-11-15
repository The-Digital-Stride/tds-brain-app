/**
 * The one token savings ledger (plan 2026-11-15-startup-kits, decisions 1-3). Every tool records here
 * and nothing keeps its own tally. Tokens only, measured only; `cache` is shown on its own and never
 * added into `saved`. Days are UTC. Never throws.
 */
import {
  KITS_MODE,
  type SavingsEntry,
  type SavingsSource,
  type SavingsSummary,
  type SavingsTotals,
} from '../../shared/kits-contract.ts';
import { parseSavingsCell, type TokenSavingsStore } from '../store/token-savings.ts';

export interface SavingsService {
  /** True when the entry was counted; false for a repeat key, bad input or a failed save. Never rejects. */
  record(entry: SavingsEntry): Promise<boolean>;
  /** Never rejects; an unreadable file gives the empty summary. */
  summary(): Promise<SavingsSummary>;
}

export interface SavingsOptions {
  store: TokenSavingsStore;
  now?: () => number;
}

const MEASURE_OF: Record<SavingsSource, SavingsEntry['measure']> = {
  summary: 'compacted',
  cache: 'reused',
  kits: 'switched-off',
};

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const emptyTotals = (): SavingsTotals => ({ saved: 0, reused: 0, bySource: {} });

export function emptySummary(): SavingsSummary {
  return {
    since: null,
    today: emptyTotals(),
    last7: emptyTotals(),
    last30: emptyTotals(),
    all: emptyTotals(),
    kitsMode: KITS_MODE,
    team: null,
  };
}

function addTo(t: SavingsTotals, source: SavingsSource, tokens: number): void {
  if (source === 'cache') t.reused += tokens;
  else t.saved += tokens;
  t.bySource[source] = (t.bySource[source] ?? 0) + tokens;
}

export function createSavings(opts: SavingsOptions): SavingsService {
  const now = opts.now ?? Date.now;
  return {
    async record(entry) {
      try {
        if (MEASURE_OF[entry.source] !== entry.measure) return false;
        const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : now();
        return await opts.store.add({
          day: utcDay(at),
          source: entry.source,
          measure: entry.measure,
          tokens: entry.tokens,
          dedupeKey: entry.dedupeKey,
        });
      } catch {
        return false;
      }
    },
    async summary() {
      const out = emptySummary();
      try {
        const data = await opts.store.read();
        if (!data) return out;
        const today = utcDay(now());
        const t = Date.parse(`${today}T00:00:00Z`);
        const from7 = utcDay(t - 6 * 86_400_000);
        const from30 = utcDay(t - 29 * 86_400_000);
        for (const [day, cells] of Object.entries(data.days)) {
          if (day > today) continue;
          if (out.since === null || day < out.since) out.since = day;
          for (const [cell, tokens] of Object.entries(cells)) {
            const parsed = parseSavingsCell(cell);
            if (!parsed) continue;
            addTo(out.all, parsed.source, tokens);
            if (day >= from30) addTo(out.last30, parsed.source, tokens);
            if (day >= from7) addTo(out.last7, parsed.source, tokens);
            if (day === today) addTo(out.today, parsed.source, tokens);
          }
        }
      } catch {
        return emptySummary();
      }
      return out;
    },
  };
}
