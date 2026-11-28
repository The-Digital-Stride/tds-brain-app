import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrainArea } from '../../shared/contract.ts';
import type { WatchFolder } from './library.ts';

// fs.watch is replaced so each test can hand a watcher the exact file name the platform would report.
interface FakeWatcher {
  path: string;
  recursive: boolean;
  emit(file: string | null): void;
  emitter: EventEmitter;
  closed: boolean;
}
const watchers: FakeWatcher[] = [];
const missing = new Set<string>();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: (
      path: string,
      opts: { recursive?: boolean },
      cb: (event: string, file: string | null) => void,
    ) => {
      if (missing.has(path)) throw new Error('ENOENT');
      const emitter = new EventEmitter();
      const w: FakeWatcher = {
        path,
        recursive: !!opts.recursive,
        emit: (file) => cb('change', file),
        emitter,
        closed: false,
      };
      watchers.push(w);
      return Object.assign(emitter, {
        close: () => {
          w.closed = true;
        },
      });
    },
  };
});

const { isAdsPath, watchBrain } = await import('./watch.ts');

const ROOT = '/brain';

/** The watcher for a folder under the root; `recursive` picks between the two on clients/. */
function on(rel: string, recursive?: boolean): FakeWatcher {
  const path = join(ROOT, ...rel.split('/'));
  const found = watchers.filter(
    (w) => w.path === path && (recursive === undefined || w.recursive === recursive),
  );
  const [only] = found;
  if (!only || found.length !== 1) throw new Error(`expected one watcher on ${rel}, found ${found.length}`);
  return only;
}

function start() {
  const seen: BrainArea[] = [];
  const library: [string | null, WatchFolder][] = [];
  const projects: (string | null)[] = [];
  const live: string[] = [];
  let ads = 0;
  const stop = watchBrain(ROOT, (a) => seen.push(a), {
    onLibraryChange: (rel, folder) => library.push([rel, folder]),
    onLibraryLive: (folder, isLive) => live.push(`${folder}:${isLive}`),
    onAdsChange: () => {
      ads++;
    },
    onProjectsChange: (rel) => projects.push(rel),
  });
  return { seen, library, projects, live, ads: () => ads, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  watchers.length = 0;
  missing.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isAdsPath', () => {
  it('matches the files Ad Manager shows', () => {
    expect(isAdsPath('clients/acme/proposals/2026-11-01.md')).toBe(true);
    expect(isAdsPath('clients/acme/proposals/evidence/shot.png')).toBe(true);
    expect(isAdsPath('clients/acme/reports/monthly/2026-10.md')).toBe(true);
    expect(isAdsPath('clients/acme/context/google-ads/board/keywords.csv')).toBe(true);
    expect(isAdsPath('clients/acme/data/_fetch-status.json')).toBe(true);
    expect(isAdsPath('clients/acme/standup/today.md')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isAdsPath('clients/acme/reports/new.pdf')).toBe(false);
    expect(isAdsPath('clients/acme/reports/weekly/2026-10.md')).toBe(false);
    expect(isAdsPath('clients/acme/context/google-ads/data/raw.json')).toBe(false);
    expect(isAdsPath('clients/acme/data/other.json')).toBe(false);
    expect(isAdsPath('clients/acme/data/_fetch-status.json.bak')).toBe(false);
    expect(isAdsPath('clients/proposals/x.md')).toBe(false); // no client folder
    expect(isAdsPath('personal/acme/proposals/x.md')).toBe(false);
    expect(isAdsPath('x/clients/acme/proposals/x.md')).toBe(false); // anchored at the root
    expect(isAdsPath('')).toBe(false);
  });
});

describe('watchBrain: areas', () => {
  it('debounces repeated changes into one call per area', () => {
    const w = start();
    on('todo').emit('a.md');
    on('todo').emit('b.md');
    vi.advanceTimersByTime(399);
    expect(w.seen).toEqual([]);
    on('.claude/skills').emit('seo/SKILL.md');
    vi.advanceTimersByTime(1);
    expect(w.seen).toEqual(['todos']);
    vi.advanceTimersByTime(400);
    expect(w.seen).toEqual(['todos', 'skills']);
    w.stop();
  });

  it('maps each watched folder to its area', () => {
    const w = start();
    on('.claude/commands').emit('gm.md');
    on('.team-config').emit('roles.json');
    on('z-logs/team-usage').emit('2026-11.jsonl');
    on('clients', false).emit('new-client');
    vi.advanceTimersByTime(400);
    expect([...w.seen].sort()).toEqual(['clients', 'identity', 'skills', 'usage']);
    w.stop();
  });

  it('reacts only to the named file in a folder watched for one file', () => {
    const w = start();
    on('.claude', false).emit('settings.json');
    on('context').emit('notes.md');
    on('context').emit(null);
    vi.advanceTimersByTime(400);
    expect(w.seen).toEqual([]);
    on('.claude', false).emit('accounts.json');
    on('context').emit('team-profile.md');
    vi.advanceTimersByTime(400);
    expect([...w.seen].sort()).toEqual(['clients', 'identity']);
    w.stop();
  });

  it('keeps going when the listener throws', () => {
    const seen: BrainArea[] = [];
    const stop = watchBrain(ROOT, (a) => {
      seen.push(a);
      throw new Error('boom');
    });
    on('todo').emit('a.md');
    expect(() => vi.advanceTimersByTime(400)).not.toThrow();
    on('todo').emit('b.md');
    vi.advanceTimersByTime(400);
    expect(seen).toEqual(['todos', 'todos']);
    stop();
  });
});

describe('watchBrain: library folders', () => {
  it('passes the changed path on at once and fires library after the debounce', () => {
    const w = start();
    on('clients', true).emit('acme/reports/new.pdf');
    on('personal').emit('notes/new.md');
    on('templates').emit('brief.md');
    on('projects').emit('old/readme.md');
    expect(w.library).toEqual([
      ['clients/acme/reports/new.pdf', 'clients'],
      ['personal/notes/new.md', 'personal'],
      ['templates/brief.md', 'templates'],
      ['projects/old/readme.md', 'projects'],
    ]);
    expect(w.seen).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(w.seen).toEqual(['library']);
    w.stop();
  });

  it('passes null on when the platform did not say which file changed', () => {
    const w = start();
    on('personal').emit(null);
    expect(w.library).toEqual([[null, 'personal']]);
    expect(w.projects).toEqual([null]);
    vi.advanceTimersByTime(400);
    expect(w.seen).toEqual(['library']);
    w.stop();
  });

  it('ignores never-listed places but still tells the projects hook', () => {
    const w = start();
    on('clients', true).emit('acme/crm/data/people.csv');
    on('clients', true).emit('acme/reports/.draft.md');
    on('clients', true).emit('_archive/old.md');
    on('personal').emit('todo/mine.md');
    vi.advanceTimersByTime(400);
    expect(w.library).toEqual([]);
    expect(w.seen).toEqual([]);
    expect(w.projects).toEqual([
      'clients/acme/crm/data/people.csv',
      'clients/acme/reports/.draft.md',
      'clients/_archive/old.md',
      'personal/todo/mine.md',
    ]);
    w.stop();
  });
});

describe('watchBrain: Ad Manager', () => {
  it('fires onAdsChange once, debounced, for ads files under clients/', () => {
    const w = start();
    on('clients', true).emit('acme/proposals/a.md');
    on('clients', true).emit('acme/standup/today.md');
    vi.advanceTimersByTime(399);
    expect(w.ads()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(w.ads()).toBe(1);
    expect(w.seen).toEqual(['library']);
    w.stop();
  });

  it('fires for an ads file the library hides, and when the file is unknown', () => {
    const w = start();
    on('clients', true).emit('acme/proposals/.draft.md');
    vi.advanceTimersByTime(400);
    expect(w.ads()).toBe(1);
    expect(w.library).toEqual([]);
    on('clients', true).emit(null);
    vi.advanceTimersByTime(400);
    expect(w.ads()).toBe(2);
    w.stop();
  });

  it('does not fire for other files, other folders or the non-recursive clients watcher', () => {
    const w = start();
    on('clients', true).emit('acme/reports/new.pdf');
    on('personal').emit('acme/proposals/a.md');
    on('clients', false).emit(null);
    on('todo').emit('a.md');
    vi.advanceTimersByTime(400);
    expect(w.ads()).toBe(0);
    w.stop();
  });

  it('is fine without an onAdsChange hook', () => {
    const seen: BrainArea[] = [];
    const stop = watchBrain(ROOT, (a) => seen.push(a));
    on('clients', true).emit('acme/proposals/a.md');
    vi.advanceTimersByTime(400);
    expect(seen).toEqual(['library']);
    stop();
  });
});

describe('watchBrain: projects hook', () => {
  it('hears library folders and to-dos, nothing else', () => {
    const w = start();
    on('todo').emit('a.md');
    on('templates').emit('brief.md');
    on('.claude/skills').emit('seo/SKILL.md');
    on('clients', false).emit('acme');
    on('.team-config').emit('roles.json');
    expect(w.projects).toEqual(['todo/a.md', 'templates/brief.md']);
    w.stop();
  });

  it('a throwing hook does not stop the rest', () => {
    const seen: BrainArea[] = [];
    const library: (string | null)[] = [];
    const stop = watchBrain(ROOT, (a) => seen.push(a), {
      onProjectsChange: () => {
        throw new Error('boom');
      },
      onLibraryChange: (rel) => {
        library.push(rel);
        throw new Error('boom');
      },
    });
    on('personal').emit('notes/a.md');
    vi.advanceTimersByTime(400);
    expect(library).toEqual(['personal/notes/a.md']);
    expect(seen).toEqual(['library']);
    stop();
  });
});

describe('watchBrain: live state and stopping', () => {
  it('reports each library folder live, then not live on error or stop', () => {
    const w = start();
    expect(w.live).toEqual(['clients:true', 'personal:true', 'templates:true', 'projects:true']);
    on('templates').emitter.emit('error', new Error('gone'));
    expect(w.live.at(-1)).toBe('templates:false');
    w.live.length = 0;
    w.stop();
    expect(w.live.sort()).toEqual(['clients:false', 'personal:false', 'projects:false']);
    expect(watchers.every((x) => x.closed)).toBe(true);
  });

  it('skips a folder it cannot watch', () => {
    missing.add(join(ROOT, 'personal'));
    const w = start();
    expect(w.live).toEqual(['clients:true', 'templates:true', 'projects:true']);
    expect(watchers.some((x) => x.path === join(ROOT, 'personal'))).toBe(false);
    w.stop();
  });

  it('drops pending calls once stopped', () => {
    const w = start();
    on('todo').emit('a.md');
    on('clients', true).emit('acme/proposals/a.md');
    w.stop();
    vi.advanceTimersByTime(1000);
    expect(w.seen).toEqual([]);
    expect(w.ads()).toBe(0);
  });
});
