/**
 * Team skill levels (plan 2026-11-14-skill-levels-and-helpers, decision 8). The app only READS
 * `.claude/tdsapp-skill-levels.json`; changes go through the brain's `tdsapp-skill-levels` skill
 * script, run the way `todo-skill.ts` runs the to-do script. Nothing here writes the file.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { TODO_SCRIPT_MAX_OUTPUT_BYTES, TODO_SCRIPT_TIMEOUT_MS } from '../../shared/contract.ts';
import {
  isLevelTier,
  type LevelTier,
  SKILL_LEVEL_NOTE_MAX,
  SKILL_LEVELS_FILE,
  type SkillLevel,
} from '../../shared/levels-contract.ts';
import { scrubEnv } from '../engine/session-manager.ts';

/** Where the skill's script is in the brain. */
export const SKILL_LEVELS_SCRIPT = '.claude/skills/tdsapp-skill-levels/scripts/tdsapp-skill-levels.cjs';

/** Keeps the readable rows of the file: a known tier, text `setBy` and `at`. Anything else is skipped. */
export function parseSkillLevels(text: string): Record<string, SkillLevel> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  const levels = (data as { levels?: unknown } | null)?.levels;
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return {};
  const out = new Map<string, SkillLevel>();
  for (const [name, row] of Object.entries(levels)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (!isLevelTier(r.tier) || typeof r.setBy !== 'string' || typeof r.at !== 'string') continue;
    const level: SkillLevel = { tier: r.tier, setBy: r.setBy, at: r.at };
    if (typeof r.note === 'string' && r.note !== '') level.note = r.note.slice(0, SKILL_LEVEL_NOTE_MAX);
    out.set(name, level);
  }
  // Object.fromEntries defines own properties, so a skill called `__proto__` can't change the prototype.
  return Object.fromEntries(out);
}

export type SkillLevelErrorCode = 'bad-request' | 'not-allowed' | 'internal';

export class SkillLevelError extends Error {
  readonly code: SkillLevelErrorCode;
  constructor(code: SkillLevelErrorCode, message: string) {
    super(message);
    this.name = 'SkillLevelError';
    this.code = code;
  }
}

/** The app's own words; the script's error texts are for developers and never shown. */
export const SKILL_LEVEL_MESSAGES = {
  'bad-request': "That skill or level wasn't understood.",
  'not-allowed': 'Only owners and scouts can change skill levels.',
  internal: 'The level could not be changed. Try again.',
} as const satisfies Record<SkillLevelErrorCode, string>;

export type SkillLevelSpawner = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface SkillLevelsOptions {
  spawn?: SkillLevelSpawner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface SkillLevelsService {
  /** Fresh from the file every call; {} when it is missing or unreadable. Never throws. */
  read(): Promise<Record<string, SkillLevel>>;
  /** True when the brain has the skill's script, so changes are possible. */
  writable(): Promise<boolean>;
  /** Sets (`tier`) or clears (`null`) one level by running the script. Rejects with SkillLevelError. */
  change(skill: string, tier: LevelTier | null, note?: string): Promise<void>;
}

function inside(child: string, parent: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** The script's real path when it is a regular file inside the brain's real path, else null. */
export async function findSkillLevelsScript(
  root: string,
): Promise<{ script: string; realRoot: string } | null> {
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(join(realRoot, SKILL_LEVELS_SCRIPT));
    if (!inside(real, realRoot)) return null;
    return (await fs.stat(real)).isFile() ? { script: real, realRoot } : null;
  } catch {
    return null;
  }
}

/** Reads `SKILL_LEVELS_FILE` fresh; {} when missing, a link, too big or not readable. Never throws. */
export async function readSkillLevels(root: string): Promise<Record<string, SkillLevel>> {
  try {
    const file = join(root, SKILL_LEVELS_FILE);
    const st = await fs.lstat(file);
    if (!st.isFile() || st.size > 2_000_000) return {};
    return parseSkillLevels(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

interface Outcome {
  code: number | null;
  stdout: string;
  failed: boolean;
}

function runScript(
  script: string,
  realRoot: string,
  command: string,
  input: string,
  opts: Required<SkillLevelsOptions>,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...scrubEnv(opts.env), BRAIN_ROOT: realRoot };
    delete env.NODE_OPTIONS;
    let child: ChildProcess;
    try {
      child = opts.spawn(process.execPath, [script, command], {
        cwd: realRoot,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      resolve({ code: null, stdout: '', failed: true });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    let settled = false;
    const kill = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(kill, opts.timeoutMs);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), failed });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > opts.maxOutputBytes) kill();
      else chunks.push(chunk);
    });
    child.on('error', () => {
      failed = true;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

function parseReply(stdout: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(stdout.trim());
    return typeof j === 'object' && j !== null && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function judge(outcome: Outcome): SkillLevelErrorCode | null {
  if (outcome.failed) return 'internal';
  const reply = parseReply(outcome.stdout);
  if (reply === null) return 'internal';
  if (outcome.code === 0) return null;
  if (outcome.code === 2) {
    if (reply.status === 400) return 'bad-request';
    if (reply.status === 403) return 'not-allowed';
  }
  return 'internal';
}

/** One service per brain: changes run one at a time, in the order they were asked for. */
export function createSkillLevels(root: string, options: SkillLevelsOptions = {}): SkillLevelsService {
  const opts: Required<SkillLevelsOptions> = {
    spawn: options.spawn ?? nodeSpawn,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? TODO_SCRIPT_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? TODO_SCRIPT_MAX_OUTPUT_BYTES,
  };
  let tail: Promise<unknown> = Promise.resolve();

  const changeOnce = async (skill: string, tier: LevelTier | null, note?: string): Promise<void> => {
    const found = await findSkillLevelsScript(root);
    if (!found) throw new SkillLevelError('internal', SKILL_LEVEL_MESSAGES.internal);
    const body =
      tier === null ? { skill } : note !== undefined && note !== '' ? { skill, tier, note } : { skill, tier };
    const outcome = await runScript(
      found.script,
      found.realRoot,
      tier === null ? 'clear' : 'set',
      JSON.stringify(body),
      opts,
    );
    const code = judge(outcome);
    if (code) throw new SkillLevelError(code, SKILL_LEVEL_MESSAGES[code]);
  };

  return {
    read: () => readSkillLevels(root),
    writable: async () => (await findSkillLevelsScript(root)) !== null,
    change(skill, tier, note) {
      const next = tail.then(() => changeOnce(skill, tier, note));
      tail = next.catch(() => {});
      return next;
    },
  };
}
