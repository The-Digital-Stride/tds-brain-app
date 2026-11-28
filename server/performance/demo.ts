/**
 * Made-up Performance figures for demo mode (plan decision 9): under `TDS_CORTEX_DEMO` the real logs are never
 * read. The shape comes from the same view builder as the real report, so the screenshots match the real page.
 */
import { type PerformanceReport, PRICES_CHECKED } from '../../shared/performance-contract.ts';
import { projectKey } from './projects.ts';
import { localDate } from './reader.ts';
import type { PerformanceService } from './refresh.ts';
import type { Counts, FileRecord, PerformanceHistory } from './store.ts';
import { buildViews, datesEndingAt, historyFrom } from './views.ts';

const PROJECTS = [
  { key: projectKey('/demo/example-website'), label: 'example-website', weight: 3 },
  { key: projectKey('/demo/example-shop'), label: 'example-shop', weight: 2 },
  { key: 'brain', label: 'Brain', weight: 2 },
  { key: 'temp', label: 'Temporary folders', weight: 1 },
];
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

/** A fixed pseudo-random sequence, so every demo shows the same figures. */
function sequence(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function demoHistory(now: Date): PerformanceHistory {
  const today = localDate(now);
  const dates = datesEndingAt(today, 100);
  const rnd = sequence(42);
  const files: Record<string, FileRecord> = {};
  dates.forEach((date, di) => {
    for (const p of PROJECTS) {
      if (rnd() > 0.3 + p.weight * 0.2) continue;
      const codeMode = di >= 50 && rnd() > 0.4;
      const sessionId = `demo-${di}-${p.label}`;
      const model = MODELS[rnd() < 0.7 ? 0 : 1] as string;
      const requests = Math.round(20 + rnd() * 120 * p.weight);
      const counts: Counts = [
        requests,
        requests * 4,
        Math.round(requests * (codeMode ? 900 : 1500)),
        Math.round(requests * 200),
        Math.round(requests * (codeMode ? 22000 : 34000)),
        Math.round(requests * 320),
      ];
      files[`demo/${sessionId}.jsonl`] = {
        kind: 'main',
        sessionId,
        project: { key: p.key, label: p.label },
        codeMode,
        size: 1,
        mtimeMs: di,
        firstTs: '',
        days: { [date]: { [model]: counts } },
      };
      if (rnd() > 0.5) {
        const agentCounts: Counts = [
          Math.round(requests / 4),
          Math.round(requests),
          Math.round(requests * 100),
          0,
          Math.round(requests * 3000),
          Math.round(requests * 40),
        ];
        files[`demo/${sessionId}/agent-1.jsonl`] = {
          kind: 'agent',
          sessionId,
          agentId: `agent-${di}-${p.label}`,
          agentType: rnd() > 0.5 ? 'reviewer' : 'builder',
          project: { key: p.key, label: p.label },
          codeMode,
          size: 1,
          mtimeMs: di,
          firstTs: '',
          days: { [date]: { 'claude-haiku-5-5': agentCounts } },
        };
      }
    }
  });
  // As if the first refresh found logs going back to the first sample day.
  return {
    version: 1,
    lastRunDate: today,
    updatedAt: now.toISOString(),
    completeFrom: dates[0] as string,
    files,
  };
}

export function createDemoPerformance(now: () => Date = () => new Date()): PerformanceService {
  const report = async (): Promise<PerformanceReport> => {
    const at = now();
    const history = demoHistory(at);
    return {
      status: 'ready',
      refreshing: false,
      updatedAt: at.toISOString(),
      historyFrom: historyFrom(history),
      completeFrom: history.completeFrom ?? null,
      pricesChecked: PRICES_CHECKED,
      views: buildViews(history, localDate(at)),
    };
  };
  return { report, start: report, refreshNow: async () => {}, dueToday: async () => false };
}
