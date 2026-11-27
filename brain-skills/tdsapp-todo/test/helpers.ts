// Shared helpers for the v0.6 tests of the `tdsapp-todo` script (plan 2026-11-20-projects-system).
// Each case runs the real script as a child process against a throwaway brain that is not a git
// repository, so personal to-dos are offered. This stays in the app repo; it is not copied into the brain.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const SCRIPT = fileURLToPath(new URL('../scripts/tdsapp-todo.cjs', import.meta.url));

const ROLES = {
  members: [
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Ben McAdam', email: 'ben@example.test', role: 'team' },
  ],
};

export interface Brain {
  root: string;
  /** `env` is added to the script's environment (v0.7: NODE_ENV and TDSAPP_TODO_TEST_NOW set the clock). */
  run(
    command: string,
    input?: unknown,
    env?: Record<string, string>,
  ): { code: number | null; json: Record<string, unknown> };
  put(rel: string, text: string | Buffer): void;
  /** The file without the lines v0.7 adds to every change (see withoutLog). */
  read(rel: string): string;
  /** The file as it is. */
  raw(rel: string): string;
  sha(rel: string): string;
  folder(rel: string): void;
  remove(): void;
}

/**
 * v0.7 (plan 2026-11-27-task-updates-handback, decision 14): every real change also appends an entry
 * under "## Updates", and add writes `created_at:`. The v0.6 cases read files without those lines, so
 * they still pin v0.6's behaviour; updates.test.ts pins the log itself.
 */
export function withoutLog(text: string): string {
  return text
    .replace(/\r?\n## Updates\r?\n\r?\n(?:- [^\r\n]*\r?\n(?: {2}[^\r\n]*\r?\n)*)+/g, '')
    .replace(/^created_at: [^\r\n]*\r?\n/m, '');
}

export function makeBrain(): Brain {
  const root = mkdtempSync(join(tmpdir(), 'todo-v06-'));
  mkdirSync(join(root, 'todo'));
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
  const abs = (rel: string) => join(root, ...rel.split('/'));
  return {
    root,
    run(command, input = {}, extra = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, command], {
        input: typeof input === 'string' ? input : JSON.stringify(input),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          BRAIN_ROOT: root,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'user.name',
          GIT_CONFIG_VALUE_0: 'Sam Example',
          ...extra,
        },
        cwd: root,
        encoding: 'utf8',
      });
      const lines = r.stdout.split('\n').filter(Boolean);
      expect(lines, r.stderr).toHaveLength(1);
      return { code: r.status, json: JSON.parse(lines[0] as string) };
    },
    put(rel, text) {
      mkdirSync(dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), text);
    },
    read: (rel) => withoutLog(readFileSync(abs(rel), 'utf8')),
    raw: (rel) => readFileSync(abs(rel), 'utf8'),
    sha: (rel) => createHash('sha256').update(readFileSync(abs(rel))).digest('hex'),
    folder: (rel) => mkdirSync(abs(rel), { recursive: true }),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
