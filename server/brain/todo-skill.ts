/**
 * Runs the brain's own `todo` skill script for one to-do change (Workbench to-dos plan, decision 2).
 * The app never writes these changes itself: it hands the Workbench route body to the script and
 * reads its one-line JSON reply. See the command line above TODO_SCRIPT_TIMEOUT_MS in the contract.
 */
import { promises as fs } from 'node:fs';
import {
  TODO_SCRIPT_MAX_OUTPUT_BYTES,
  TODO_SCRIPT_TIMEOUT_MS,
  TODO_SKILLS,
  type TodoAction,
  TodoChangeError,
  type TodoChangeErrorCode,
  type TodoScope,
} from '../../shared/contract.ts';
import {
  createCapabilityProbe,
  createQueue,
  locateScript,
  type Outcome,
  parseReply,
  runScript,
  type ScriptOptions,
  type ScriptSpawner,
  withDefaults,
} from './skill-runner.ts';

/** The tool name the app records on to-dos it finishes or deletes. */
export const APP_VIA = 'TDS Brain App';

/** The app's own words for each failure. The script's error texts are for developers and never shown. */
export const TODO_CHANGE_MESSAGES = {
  'bad-request': "That change wasn't understood. Check the title and date, then try again.",
  'not-found': 'That to-do could not be found. It may have been finished, deleted or passed on.',
  'not-allowed': "Changing to-dos isn't available to you in the app yet.",
  changed: "Someone else changed this to-do since you opened it, so your change wasn't made.",
  internal: 'The change could not be made. Try again.',
} as const satisfies Record<TodoChangeErrorCode, string>;

export function todoChangeError(code: TodoChangeErrorCode): TodoChangeError {
  return new TodoChangeError(code, TODO_CHANGE_MESSAGES[code]);
}

/** Starts a child process. Tests inject one to see the arguments or to fail the start. */
export type TodoSpawner = ScriptSpawner;

/**
 * A tick of a personal to-do, run by the script's `tick` (v0.4). Not a route action: the complete
 * route builds it. `scope` is always given; the app's own direct tick for `todo/` stays `completeTodo`.
 */
export interface TodoTickAction {
  kind: 'tick';
  id: string;
  scope: TodoScope;
  expect?: string;
}

/** Everything the runner can send to the script. */
export type TodoRunAction = TodoAction | TodoTickAction;

/** A fixed map, so nothing from the request ever becomes part of the command line. */
const COMMAND: Record<TodoRunAction['kind'], string> = {
  add: 'add',
  edit: 'edit',
  due: 'due',
  assignee: 'assignee',
  delete: 'delete',
  move: 'move',
  tick: 'tick',
};

/** Who a change is for, as the app knows them (the same identity its tick records use). */
export interface TodoActor {
  name: string;
  slug: string;
}

/**
 * The Workbench route's request body for an action, with the Workbench's field names. `scope` is sent
 * only for 'personal' (and always for `move`), so every v0.3 payload stays byte-identical.
 */
export function scriptPayload(action: TodoRunAction, by?: TodoActor): Record<string, string | boolean> {
  const expect: Record<string, string> =
    'expect' in action && action.expect !== undefined ? { expect: action.expect } : {};
  const scope: Record<string, string> =
    'scope' in action && action.scope === 'personal' ? { scope: 'personal' } : {};
  const actor: Record<string, string> = by ? { by: by.slug, by_name: by.name } : {};
  switch (action.kind) {
    case 'add':
      // `via` names this app as the tool; an open to-do sends `open` and no assignee. An older script
      // ignores both and the server only offers open adds when the newer skill is there.
      return action.assignee === null
        ? { title: action.title, due: action.due ?? '', open: true, via: APP_VIA, ...actor, ...scope }
        : {
            title: action.title,
            due: action.due ?? '',
            assignee: action.assignee,
            via: APP_VIA,
            ...actor,
            ...scope,
          };
    case 'edit':
      return action.details === undefined
        ? { file: action.id, title: action.title, ...expect, ...scope }
        : { file: action.id, title: action.title, body: action.details, ...expect, ...scope };
    case 'due':
      return { file: action.id, due: action.due ?? '', ...expect, ...scope };
    case 'assignee':
      // Who passed it on and through which tool goes into the handover stamp; without them the
      // script would use the machine's git user, which need not be the person the app knows.
      return {
        file: action.id,
        assignee: action.assignee ?? '',
        via: APP_VIA,
        ...actor,
        ...expect,
        ...scope,
      };
    case 'delete':
      // The skill keeps the file in todo/deleted/, recording who, when and this app as the tool.
      // Who is the app's own identity, so deletes and ticks name a person the same way.
      return by
        ? { file: action.id, via: APP_VIA, by: by.slug, by_name: by.name, ...expect, ...scope }
        : { file: action.id, via: APP_VIA, ...expect, ...scope };
    case 'tick':
      return { file: action.id, via: APP_VIA, ...actor, ...expect, ...scope };
    case 'move':
      return { file: action.id, scope: action.scope, to: action.to, ...expect, ...actor, via: APP_VIA };
  }
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
  for (const entry of TODO_SKILLS) {
    const found = await locateScript(root, entry.skill, entry.script);
    if (found.folder) return { skill: entry.skill, script: found.script };
  }
  return null;
}

/** The real path of the script of the skill found, or null. */
export async function findTodoScript(root: string): Promise<string | null> {
  return (await findTodoSkill(root))?.script ?? null;
}

export type TodoSkillOptions = ScriptOptions;

/** What the script answered to a change that worked. `file` is its reply's `file` (a `move` can rename). */
export interface TodoRunResult {
  file: string | null;
}

export interface TodoSkillRunner {
  /** Runs one change. Resolves when the script says it worked; otherwise rejects with TodoChangeError. */
  run(action: TodoRunAction, by?: TodoActor): Promise<TodoRunResult>;
  /**
   * The script's `capabilities` features (v0.4), cached per script real path and mtime. A script
   * that doesn't know the command (v0.3) or fails gives none.
   */
  capabilities(): Promise<readonly string[]>;
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
  const opts = withDefaults(options, TODO_SCRIPT_TIMEOUT_MS, TODO_SCRIPT_MAX_OUTPUT_BYTES);
  const queue = createQueue();

  const runOnce = async (action: TodoRunAction, by?: TodoActor): Promise<TodoRunResult> => {
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
    const file = parseReply(outcome.stdout)?.file;
    return { file: typeof file === 'string' ? file : null };
  };

  // A v0.3 script answers `unknown command` (400): that is a settled answer, so it is cached too.
  const probe = createCapabilityProbe(
    root,
    () => findTodoScript(root),
    opts,
    (r) => r.status === 400,
  );

  return {
    run: (action, by) => queue(() => runOnce(action, by)),
    capabilities: probe,
  };
}
