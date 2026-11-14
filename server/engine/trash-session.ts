import { execFile } from 'node:child_process';
import { promises as fsp, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SessionError } from './session-manager.ts';

/** macOS 15 and later ship this. We never fall back to erasing anything. */
const TRASH_BIN = '/usr/bin/trash';
const MAX_DIR_NAME = 200;
const SAFE_DIR_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export const MSG_NOT_FOUND = "That chat's files couldn't be found, so nothing was deleted.";
export const MSG_FAILED = "That chat couldn't be moved to the Bin, so it hasn't been deleted. Try again.";

/** `/usr/bin/trash` is not on this Mac (macOS older than 15). The session manager words it for the person. */
export class TrashMissingError extends Error {
  constructor() {
    super('trash is not available');
    this.name = 'TrashMissingError';
  }
}

/** How Claude Code names a project's history folder: the real path, NFC, everything but letters and digits to `-`. */
export function projectDirName(realBrainPath: string): string {
  return realBrainPath.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-');
}

export interface TrashDeps {
  /** Runs one program with its arguments, no shell. Rejects on a non-zero exit. */
  run?: (file: string, args: string[]) => Promise<void>;
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  lstat?: (p: string) => Promise<Stats | null>;
  realpath?: (p: string) => Promise<string>;
  /** Status lines only: never a path. */
  log?: (line: string) => void;
}

const defaultRun = (file: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30_000 }, (err) => (err ? reject(err) : resolve()));
  });

const defaultLstat = async (p: string): Promise<Stats | null> => {
  try {
    return await fsp.lstat(p);
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err as NodeJS.ErrnoException).code === 'ENOTDIR'
    ) {
      return null;
    }
    throw err;
  }
};

/**
 * Moves an earlier chat's history (`<id>.jsonl`, and the `<id>/` folder when there is one) to the macOS Bin
 * with `/usr/bin/trash`, one path per call. Nothing is ever erased. Client messages never carry paths.
 */
export function createTrashSession(deps: TrashDeps = {}) {
  const run = deps.run ?? defaultRun;
  const env = deps.env ?? process.env;
  const lstat = deps.lstat ?? defaultLstat;
  const realpath = deps.realpath ?? ((p: string) => fsp.realpath(p));
  const log = deps.log ?? (() => {});

  return async function trashSession(id: string, opts: { dir: string }): Promise<void> {
    const notFound = () => new SessionError('not-found', MSG_NOT_FOUND);
    const failed = () => new SessionError('internal', MSG_FAILED);

    const configDir = deps.configDir ?? env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    let folderName: string;
    if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CODE_PROJECT_DIR_NAME !== undefined) {
      if (!SAFE_DIR_NAME.test(env.CLAUDE_CODE_PROJECT_DIR_NAME)) throw notFound();
      folderName = env.CLAUDE_CODE_PROJECT_DIR_NAME;
    } else {
      let real: string;
      try {
        real = await realpath(opts.dir);
      } catch {
        throw notFound();
      }
      folderName = projectDirName(real);
    }
    if (folderName.length > MAX_DIR_NAME) throw notFound();

    const projectDir = join(configDir, 'projects', folderName);
    const jsonl = join(projectDir, `${id}.jsonl`);
    const folder = join(projectDir, id);

    let jsonlStat: Stats | null;
    let folderStat: Stats | null;
    try {
      jsonlStat = await lstat(jsonl);
      folderStat = await lstat(folder);
    } catch {
      throw failed();
    }
    if (!jsonlStat?.isFile()) throw notFound();

    try {
      await run(TRASH_BIN, [jsonl]);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') throw new TrashMissingError();
      throw failed();
    }
    // Trust the result, not the exit code: the file must have gone.
    let still: Stats | null;
    try {
      still = await lstat(jsonl);
    } catch {
      throw failed();
    }
    if (still) throw failed();

    if (folderStat?.isDirectory() && !folderStat.isSymbolicLink()) {
      try {
        await run(TRASH_BIN, [folder]);
      } catch {
        log("A chat's helper folder couldn't be moved to the Bin; the chat itself was.");
      }
    }
  };
}
