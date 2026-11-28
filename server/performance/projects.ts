/**
 * Names the project a session belonged to from its real folder (plan decision 4), never from the encoded
 * folder name. Worktrees fold into their repo. Pure apart from the injected `isRepoRoot`.
 */
import { createHash } from 'node:crypto';
import { basename, dirname, sep } from 'node:path';

export interface ProjectName {
  key: string;
  label: string;
}

export interface ProjectResolverOptions {
  home: string;
  /** The brain's path and any other brain folder (e.g. ~/agencybrain). */
  brainPaths: readonly string[];
  /** Temporary folders: the system temp dir, /tmp and Claude's scratch folders under them. */
  tempDirs: readonly string[];
  /** True for a folder that is a repo's own root (it holds a `.git` folder, not a worktree's `.git` file). */
  isRepoRoot: (path: string) => boolean;
  /** Every `cwd` seen in the logs; a sibling folder only folds into a repo that is also one of these or a root. */
  knownCwds: ReadonlySet<string>;
}

/**
 * A project's key: the first 12 hex of the folder path's sha256, so a key is stable across refreshes but never carries
 * a path or a username to the browser. The fixed keys `home`, `brain`, `temp` and `unknown` aren't hex-only words of
 * that length, so they never clash.
 */
export const projectKey = (path: string): string =>
  createHash('sha256').update(path).digest('hex').slice(0, 12);

const inside = (parent: string, child: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

export function createProjectResolver(o: ProjectResolverOptions) {
  const HOME: ProjectName = { key: 'home', label: 'Home folder' };
  const BRAIN: ProjectName = { key: 'brain', label: 'Brain' };
  const TEMP: ProjectName = { key: 'temp', label: 'Temporary folders' };
  const UNKNOWN: ProjectName = { key: 'unknown', label: 'Unknown' };
  const rootCache = new Map<string, boolean>();
  const isRoot = (p: string) => {
    let v = rootCache.get(p);
    if (v === undefined) {
      v = o.isRepoRoot(p);
      rootCache.set(p, v);
    }
    return v;
  };
  const named = (path: string): ProjectName => ({ key: projectKey(path), label: basename(path) || path });
  const isProject = (p: string) => isRoot(p) || o.knownCwds.has(p);

  return {
    resolve(cwd: string | undefined, gitBranch: string | undefined): ProjectName {
      if (!cwd) return UNKNOWN;
      const path = cwd.length > 1 ? cwd.replace(/[\\/]+$/, '') : cwd;
      if (path === o.home) return HOME;
      if (o.brainPaths.some((b) => inside(b, path))) return BRAIN;
      if (o.tempDirs.some((t) => inside(t, path)) || inside(`${o.home}${sep}.claude`, path)) return TEMP;
      // Inside a repo (a subfolder or a worktree under it): the nearest ancestor that is a repo root.
      if (!isRoot(path)) {
        let up = dirname(path);
        while (up !== dirname(up) && up !== o.home && up.length > o.home.length) {
          if (isRoot(up)) return named(up);
          up = dirname(up);
        }
      }
      // A sibling worktree `<repo>-<branch>` of a repo that is also a project.
      if (gitBranch && gitBranch !== 'HEAD') {
        const base = basename(path);
        for (const b of new Set([gitBranch, gitBranch.replace(/\//g, '-')])) {
          const tail = `-${b}`;
          if (base.length > tail.length && base.endsWith(tail)) {
            const repo = `${dirname(path)}${sep}${base.slice(0, -tail.length)}`;
            if (isProject(repo)) return named(repo);
          }
        }
      }
      return named(path);
    },
  };
}
