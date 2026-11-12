import { type FSWatcher, watch } from 'node:fs';
import { join, sep } from 'node:path';
import type { BrainArea } from '../../shared/contract.ts';
import type { WatchFolder } from './library.ts';
import { isNeverListed } from './library-rules.ts';

const DEBOUNCE_MS = 400;

interface Target {
  area: BrainArea;
  rel: string[];
  recursive: boolean;
  /** Only react to this file name inside the folder. */
  only?: string;
  /** A library folder: the changed path is passed on so only its scope is walked again. */
  library?: WatchFolder;
}

const TARGETS: Target[] = [
  { area: 'skills', rel: ['.claude', 'skills'], recursive: true },
  { area: 'skills', rel: ['.claude', 'commands'], recursive: true },
  { area: 'todos', rel: ['todo'], recursive: true },
  { area: 'clients', rel: ['clients'], recursive: false },
  { area: 'clients', rel: ['.claude'], recursive: false, only: 'accounts.json' },
  { area: 'identity', rel: ['.team-config'], recursive: true },
  // The Profile page's title, departments and day-to-day work.
  { area: 'identity', rel: ['context'], recursive: false, only: 'team-profile.md' },
  { area: 'usage', rel: ['z-logs', 'team-usage'], recursive: false },
  { area: 'library', rel: ['clients'], recursive: true, library: 'clients' },
  { area: 'library', rel: ['personal'], recursive: true, library: 'personal' },
];

export interface WatchHooks {
  /**
   * Called at once (before the debounce) for each change in a library folder: the changed path from
   * the brain's root with forward slashes, or null when the platform did not say which.
   */
  onLibraryChange?(rel: string | null, folder: WatchFolder): void;
  /** Whether a live watcher is running for a library folder. */
  onLibraryLive?(folder: WatchFolder, live: boolean): void;
}

export function watchBrain(
  root: string,
  onChange: (area: BrainArea) => void,
  hooks: WatchHooks = {},
): () => void {
  const watchers: FSWatcher[] = [];
  const timers = new Map<BrainArea, NodeJS.Timeout>();
  const liveFolders = new Set<WatchFolder>();
  const setLive = (folder: WatchFolder, on: boolean) => {
    if (on) liveFolders.add(folder);
    else liveFolders.delete(folder);
    try {
      hooks.onLibraryLive?.(folder, on);
    } catch {}
  };
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
      const folder = t.library;
      const w = watch(join(root, ...t.rel), { recursive: t.recursive }, (_event, file) => {
        if (t.only && String(file ?? '') !== t.only) return;
        if (folder) {
          const name = file ? String(file).split(sep).join('/') : '';
          const rel = name ? `${t.rel.join('/')}/${name}` : null;
          // Never-listed places (dot names, crm/data, ...) cannot change what the library shows.
          if (rel && isNeverListed(rel)) return;
          try {
            hooks.onLibraryChange?.(rel, folder);
          } catch {}
        }
        fire(t.area);
      });
      w.on('error', () => {
        if (folder) setLive(folder, false);
      });
      watchers.push(w);
      if (folder) setLive(folder, true);
    } catch {
      // missing folder or unsupported: skip it (the library then re-walks after 30 seconds)
    }
  }
  return () => {
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
    watchers.length = 0;
    for (const f of [...liveFolders]) setLive(f, false);
    for (const tm of timers.values()) clearTimeout(tm);
    timers.clear();
  };
}
