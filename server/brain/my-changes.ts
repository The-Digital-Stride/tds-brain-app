/**
 * "My changes" (plan 2026-11-25-my-recents): which files under clients/, templates/ and projects/ this
 * person changed, and when. From one read-only `git log` per brain, HEAD and person (confirmed commit by
 * commit with the same author matching the to-do lists use), plus the uncommitted files from
 * `git status` timed by their modified time, so a file made in a chat shows before the brain syncs.
 * Writes nothing and never throws: when the history can't be read, `readable` is false.
 */
import { promises as fs, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Identity, MyChanges } from '../../shared/contract.ts';
import type { ProjectCard } from '../../shared/projects-contract.ts';
import { type Member, readMembers } from './identity.ts';
import { type GitLogRunner, runGit } from './todo-history.ts';
import { authorSlug, isSelf, readTeam, workbenchSlug } from './todos.ts';

/** Same limits as the asked log. */
export const MY_LOG_MAX_OUTPUT = 2 * 1024 * 1024;
export const MY_LOG_TIMEOUT_MS = 10_000;
export const MY_LOG_MAX_COUNT = 400;
export const MY_STATUS_TTL_MS = 5000;

const FOLDERS = ['clients', 'templates', 'projects'] as const;

export type { MyChanges };

export interface MyChangesReader {
  read(root: string, identity: Identity): Promise<MyChanges>;
}

const inFolders = (path: string) => FOLDERS.some((f) => path.startsWith(`${f}/`));

/** The log arguments for these author values (already non-empty). */
export function myLogArgs(authors: string[]): string[] {
  return [
    'log',
    '-z',
    '--no-merges',
    '--no-renames',
    '--no-follow',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--diff-filter=d',
    '--name-only',
    '-i',
    '-F',
    ...authors.map((a) => `--author=${a}`),
    `--max-count=${MY_LOG_MAX_COUNT}`,
    '--format=%x1e%an%x00%ae%x00%aI',
    '--',
    ...FOLDERS,
  ];
}

/**
 * Parses the `-z` log into path → newest time, keeping commits `keep` accepts. A cut log drops its last
 * record, which may be half a file list.
 */
export function parseMyLog(
  stdout: string,
  cut: boolean,
  keep: (author: { name: string; email: string }) => boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  const records = stdout.split('\x1e');
  if (cut) records.pop();
  // Newest first, so the first time a path is seen is its newest.
  for (const record of records) {
    const [name, email, at, ...rest] = record.split('\0');
    if (!name || !at || Number.isNaN(Date.parse(at))) continue;
    if (!keep({ name: name.trim(), email: (email ?? '').trim() })) continue;
    for (const raw of rest) {
      const path = raw.replace(/^\n+/, '');
      if (!path || !inFolders(path)) continue;
      const key = path.toLowerCase();
      if (!out.has(key)) out.set(key, at.trim());
    }
  }
  return out;
}

/** The paths `git status --porcelain=v1 -z` lists that still exist as changed files (no deletes, no conflicts). */
export function parseStatus(stdout: string): string[] {
  const out: string[] = [];
  const parts = stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy is followed by its old path, which is not a change we keep.
    if (xy.includes('R') || xy.includes('C')) i++;
    if (xy.includes('D') || xy.includes('U') || xy === 'AA') continue;
    if (inFolders(path)) out.push(path);
  }
  return out;
}

const same = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
};

const UNREADABLE: MyChanges = { paths: new Map(), readable: false };

export function createMyChanges(run: GitLogRunner = runGit, now: () => number = Date.now): MyChangesReader {
  const logs = new Map<string, Promise<Map<string, string> | null>>();
  const statuses = new Map<string, { at: number; paths: Promise<string[]> }>();

  async function readLog(root: string, identity: Identity): Promise<Map<string, string> | null> {
    const [members, team] = await Promise.all([readMembers(root), readTeam(root)]);
    const rosterEmail = members.find(
      (m: Member) => typeof m.name === 'string' && workbenchSlug(m.name) === identity.slug,
    )?.email;
    const authors = [
      ...new Set(
        [identity.email, typeof rosterEmail === 'string' ? rosterEmail : null, identity.name]
          .map((a) => (a ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (authors.length === 0) return null;
    const top = (await run(['rev-parse', '--show-toplevel'], root)).stdout.trim();
    if (!top || !same(top, root)) return null;
    const out = await run(myLogArgs(authors), root, {
      maxOutput: MY_LOG_MAX_OUTPUT,
      timeoutMs: MY_LOG_TIMEOUT_MS,
    });
    return parseMyLog(out.stdout, out.cut, (author) =>
      isSelf(authorSlug(members, team, author), author.email, identity),
    );
  }

  /** Whether a merge is under way: `rev-parse -q --verify MERGE_HEAD` prints its id, else fails quietly. */
  async function merging(root: string): Promise<boolean> {
    try {
      return (await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], root)).stdout.trim() !== '';
    } catch {
      return false;
    }
  }

  function status(root: string): Promise<string[]> {
    const hit = statuses.get(root);
    if (hit && now() - hit.at < MY_STATUS_TTL_MS) return hit.paths;
    const paths = (async () => {
      try {
        // Mid-merge (a sync stopped on a conflict), the working tree holds a teammate's files too: none count.
        if (await merging(root)) return [];
        const out = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root, {
          maxOutput: MY_LOG_MAX_OUTPUT,
          timeoutMs: MY_LOG_TIMEOUT_MS,
        });
        return parseStatus(out.stdout);
      } catch {
        return [];
      }
    })();
    statuses.set(root, { at: now(), paths });
    return paths;
  }

  return {
    async read(root, identity) {
      try {
        const head = (await run(['rev-parse', 'HEAD'], root)).stdout.trim();
        if (!/^[0-9a-f]{40,64}$/.test(head)) return UNREADABLE;
        const key = `${root}\0${head}\0${identity.slug}\0${identity.email ?? ''}`;
        let log = logs.get(key);
        if (!log) {
          const read = readLog(root, identity).catch(() => null);
          log = read;
          if (logs.size >= 16) logs.clear();
          logs.set(key, read);
          // A failed read isn't kept (as createAskedLog): the next call tries again at the same HEAD.
          void read.then((got) => {
            if (got === null && logs.get(key) === read) logs.delete(key);
          });
        }
        const [committed, changed] = await Promise.all([log, status(root)]);
        if (!committed) return UNREADABLE;
        const paths = new Map(committed);
        for (const rel of changed) {
          const key = rel.toLowerCase();
          let mtime: number;
          try {
            mtime = (await fs.stat(join(root, rel))).mtimeMs;
          } catch {
            continue;
          }
          const was = paths.get(key);
          if (was === undefined || mtime > Date.parse(was)) paths.set(key, new Date(mtime).toISOString());
        }
        return { paths, readable: true };
      } catch {
        return UNREADABLE;
      }
    },
  };
}

/**
 * Each shared project card with `lastMine`: the newest of this person's changes under its folder, else null.
 * One pass: every changed path walks up its parent folders against a lower-cased map of the card folders.
 * Unreadable history leaves the cards as they are (no `lastMine`); personal projects never get one.
 */
export function withLastMine<T extends Pick<ProjectCard, 'folder' | 'space'>>(
  cards: T[],
  mine: MyChanges,
): (T & { lastMine?: string | null })[] {
  if (!mine.readable) return cards;
  const byFolder = new Map<string, { at: number; iso: string } | null>();
  for (const c of cards) if (c.space !== 'personal') byFolder.set(c.folder.toLowerCase(), null);
  for (const [path, iso] of mine.paths) {
    const at = Date.parse(iso);
    if (Number.isNaN(at)) continue;
    for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
      const folder = path.slice(0, i);
      if (!byFolder.has(folder)) continue;
      const best = byFolder.get(folder);
      if (!best || at > best.at) byFolder.set(folder, { at, iso });
    }
  }
  return cards.map((c) =>
    c.space === 'personal' ? c : { ...c, lastMine: byFolder.get(c.folder.toLowerCase())?.iso ?? null },
  );
}
