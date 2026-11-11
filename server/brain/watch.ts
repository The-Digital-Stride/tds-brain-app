import { type FSWatcher, watch } from 'node:fs';
import { join } from 'node:path';
import type { BrainArea } from '../../shared/contract.ts';

const DEBOUNCE_MS = 400;

interface Target {
  area: BrainArea;
  rel: string[];
  recursive: boolean;
  /** Only react to this file name inside the folder. */
  only?: string;
}

const TARGETS: Target[] = [
  { area: 'skills', rel: ['.claude', 'skills'], recursive: true },
  { area: 'skills', rel: ['.claude', 'commands'], recursive: true },
  { area: 'todos', rel: ['todo'], recursive: true },
  { area: 'clients', rel: ['clients'], recursive: false },
  { area: 'clients', rel: ['.claude'], recursive: false, only: 'accounts.json' },
  { area: 'identity', rel: ['.team-config'], recursive: true },
  { area: 'usage', rel: ['z-logs', 'team-usage'], recursive: false },
];

export function watchBrain(root: string, onChange: (area: BrainArea) => void): () => void {
  const watchers: FSWatcher[] = [];
  const timers = new Map<BrainArea, NodeJS.Timeout>();
  const fire = (area: BrainArea) => {
    const old = timers.get(area);
    if (old) clearTimeout(old);
    timers.set(
      area,
      setTimeout(() => {
        timers.delete(area);
        try {
          onChange(area);
        } catch {
          // a listener must not take the watcher down
        }
      }, DEBOUNCE_MS),
    );
  };
  for (const t of TARGETS) {
    try {
      const w = watch(join(root, ...t.rel), { recursive: t.recursive }, (_event, file) => {
        if (t.only && String(file ?? '') !== t.only) return;
        fire(t.area);
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch {
      // missing folder or unsupported: skip it
    }
  }
  return () => {
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
    watchers.length = 0;
    for (const tm of timers.values()) clearTimeout(tm);
    timers.clear();
  };
}
