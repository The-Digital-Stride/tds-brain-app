import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BrainHealth } from '../../shared/contract.ts';
import { isDir } from './util.ts';

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function checkHealth(root: string): Promise<BrainHealth> {
  const problems: string[] = [];
  if (!(await isDir(root))) {
    problems.push(`The brain folder was not found at ${root}.`);
  } else {
    if (!(await isFile(join(root, 'AGENTS.md'))) && !(await isFile(join(root, 'CLAUDE.md')))) {
      problems.push(
        'This folder does not look like an Agency Brain: AGENTS.md and CLAUDE.md are both missing.',
      );
    }
    if (!(await isDir(join(root, '.claude', 'skills')))) {
      problems.push('The brain has no skills folder (.claude/skills), so no skills can be listed.');
    }
  }
  return { ok: problems.length === 0, path: root, problems };
}
