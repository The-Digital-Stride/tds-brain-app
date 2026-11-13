/**
 * Runs the brain's own `todo` skill script for one to-do change (Workbench to-dos plan, decision 2).
 * The app never writes these changes itself: it hands the Workbench route body to the script and
 * reads its one-line JSON reply. See the command line above TODO_SCRIPT_TIMEOUT_MS in the contract.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import {
  TODO_SCRIPT_MAX_OUTPUT_BYTES,
  TODO_SCRIPT_TIMEOUT_MS,
  TODO_SKILLS,
  type TodoAction,
  TodoChangeError,
  type TodoChangeErrorCode,
} from '../../shared/contract.ts';
import { scrubEnv } from '../engine/session-manager.ts';
import { isDir } from './util.ts';

/** The tool name the app records on to-dos it finishes or deletes. */
export const APP_VIA = 'TDS Brain App';

/** The app's own words for each failure. The script's error texts are for developers and never shown. */
export const TODO_CHANGE_MESSAGES = {
  'bad-request': "That change wasn't understood. Check the title and date, then try again.",
  'not-found': 'That to-do could not be found. It may have been finished, deleted or passed on.',
  'not-allowed': "Changing to-dos isn't available to you in the app yet.",
  changed:
    "Someone changed this to-do since you opened it, so your change wasn't saved. Check the latest version below, then save again.",
  internal: 'The change could not be made. Try again.',
} as const satisfies Record<TodoChangeErrorCode, string>;

export function todoChangeError(code: TodoChangeErrorCode): TodoChangeError {
  return new TodoChangeError(code, TODO_CHANGE_MESSAGES[code]);
}

/** Starts a child process. Tests inject one to see the arguments or to fail the start. */
export type TodoSpawner = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** A fixed map, so nothing from the request ever becomes part of the command line. */
const COMMAND: Record<TodoAction['kind'], string> = {
  add: 'add',
  edit: 'edit',
  due: 'due',
  assignee: 'assignee',
  delete: 'delete',
};

/** Variables the script must not inherit: `WORKBENCH_AS` would act as someone else, `NODE_OPTIONS` could load code. */
const DROPPED_ENV = ['WORKBENCH_AS', 'NODE_OPTIONS'];

/** Who a change is for, as the app knows them (the same identity its tick records use). */
export interface TodoActor {
  name: string;
  slug: string;
}

/** The Workbench route's request body for an action, with the Workbench's field names. */
export function scriptPayload(action: TodoAction, by?: TodoActor): Record<string, string | boolean> {
  const expect: Record<string, string> =
    'expect' in action && action.expect !== undefined ? { expect: action.expect } : {};
  switch (action.kind) {
    case 'add':
      // `via` names this app as the tool; an open to-do sends `open` and no assignee. An older script
      // ignores both and the server only offers open adds when the newer skill is there.
      return action.assignee === null
        ? { title: action.title, due: action.due ?? '', open: true, via: APP_VIA }
        : { title: action.title, due: action.due ?? '', assignee: action.assignee, via: APP_VIA };
    case 'edit':
      return action.details === undefined
        ? { file: action.id, title: action.title, ...expect }
        : { file: action.id, title: action.title, body: action.details, ...expect };
    case 'due':
      return { file: action.id, due: action.due ?? '', ...expect };
    case 'assignee':
      return { file: action.id, assignee: action.assignee ?? '', ...expect };
    case 'delete':
      // The skill keeps the file in todo/deleted/, recording who, when and this app as the tool.
      // Who is the app's own identity, so deletes and ticks name a person the same way.
      return by
        ? { file: action.id, via: APP_VIA, by: by.slug, by_name: by.name, ...expect }
        : { file: action.id, via: APP_VIA, ...expect };
  }
}

function inside(child: string, parent: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** The skill the app uses: its name (for the roles check) and its script's real path, null if unusable. */
export interface TodoSkillFound {
  skill: string;
  script: string | null;
}

/**
 * The first skill in TODO_SKILLS whose folder exists (presence, not access), or null when none does.
 * `script` is its real path when it is a regular file inside the brain's real path, else null. There
 * is no fallback to the next skill once a folder is found.
 */
export async function findTodoSkill(root: string): Promise<TodoSkillFound | null> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return null;
  }
  for (const entry of TODO_SKILLS) {
    const folder = join(realRoot, '.claude', 'skills', entry.skill);
    if (!(await isDir(folder))) continue;
    try {
      const real = await fs.realpath(join(realRoot, entry.script));
      if (!inside(real, realRoot)) return { skill: entry.skill, script: null };
      return { skill: entry.skill, script: (await fs.stat(real)).isFile() ? real : null };
    } catch {
      return { skill: entry.skill, script: null };
    }
  }
  return null;
}

/** The real path of the script of the skill found, or null. */
export async function findTodoScript(root: string): Promise<string | null> {
  return (await findTodoSkill(root))?.script ?? null;
}

export interface TodoSkillOptions {
  spawn?: TodoSpawner;
  /** The environment to scrub and pass on. Default: this process's. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface TodoSkillRunner {
  /** Runs one change. Resolves when the script says it worked; otherwise rejects with TodoChangeError. */
  run(action: TodoAction, by?: TodoActor): Promise<void>;
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
  opts: Required<TodoSkillOptions>,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...scrubEnv(opts.env), BRAIN_ROOT: realRoot };
    for (const key of DROPPED_ENV) delete env[key];
    let child: ChildProcess;
    try {
      child = opts.spawn(process.execPath, [script, command], {
        cwd: realRoot,
        env,
        shell: false,
        // stderr is ignored by the agreement; not piping it means a chatty script can't fill a pipe and stall.
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
    // A script that exits without reading stdin makes this write fail; the exit code tells the story.
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

/** What the script's exit code and reply mean for the app. */
function judge(outcome: Outcome): TodoChangeErrorCode | null {
  if (outcome.failed) return 'internal';
  const reply = parseReply(outcome.stdout);
  if (reply === null) return 'internal';
  if (outcome.code === 0) return null;
  if (outcome.code === 2) {
    if (reply.status === 400) return 'bad-request';
    if (reply.status === 404) return 'not-found';
    if (reply.status === 409) return 'changed';
  }
  return 'internal';
}

/** One runner per brain: changes run one at a time, in the order they were asked for. */
export function createTodoSkillRunner(root: string, options: TodoSkillOptions = {}): TodoSkillRunner {
  const opts: Required<TodoSkillOptions> = {
    spawn: options.spawn ?? nodeSpawn,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? TODO_SCRIPT_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? TODO_SCRIPT_MAX_OUTPUT_BYTES,
  };
  let tail: Promise<unknown> = Promise.resolve();

  const runOnce = async (action: TodoAction, by?: TodoActor): Promise<void> => {
    const script = await findTodoScript(root);
    if (!script) throw todoChangeError('internal');
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      throw todoChangeError('internal');
    }
    const outcome = await runScript(
      script,
      realRoot,
      COMMAND[action.kind],
      JSON.stringify(scriptPayload(action, by)),
      opts,
    );
    const code = judge(outcome);
    if (code) throw todoChangeError(code);
  };

  return {
    run(action, by) {
      const next = tail.then(() => runOnce(action, by));
      tail = next.catch(() => {});
      return next;
    },
  };
}
