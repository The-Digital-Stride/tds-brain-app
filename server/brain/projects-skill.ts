/**
 * Runs the brain's `tdsapp-projects` skill script for one project change (plan
 * docs/plans/2026-11-20-projects-system.md, decision 9). The app never writes a project card itself:
 * it sends the ProjectAction as one JSON object and reads the script's one-line JSON reply. One runner
 * per brain, so changes run one at a time, in the order asked.
 */
import { promises as fs } from 'node:fs';
import {
  PROJECTS_SCRIPT_TIMEOUT_MS,
  type ProjectAction,
  type ProjectKey,
  ProjectsError,
  type ProjectsErrorCode,
} from '../../shared/projects-contract.ts';
import {
  createCapabilityProbe,
  createQueue,
  locateScript,
  type Outcome,
  parseReply,
  runScript,
  type ScriptOptions,
  withDefaults,
} from './skill-runner.ts';

export const PROJECTS_SKILL = 'tdsapp-projects';
export const PROJECTS_SCRIPT = '.claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs';
/** A card is small; the brief is at most 20,000 characters. */
export const PROJECTS_SCRIPT_MAX_OUTPUT_BYTES = 64 * 1024;

/** Test injection: the spawner (`spawn`), environment, time limit and output cap. */
export type ProjectsSkillOptions = ScriptOptions;

export interface ProjectsSkillRunner {
  /** Runs one change. Resolves with the project's key and its card's new version; else rejects with ProjectsError. */
  run(action: ProjectAction): Promise<{ key: ProjectKey; version: string }>;
  /** The script's `capabilities` features, cached per script real path and mtime. None when it is missing or fails. */
  capabilities(): Promise<string[]>;
}

/** The app's own words when the script's reason isn't shown. */
export const PROJECTS_CHANGE_MESSAGES = {
  'bad-request': "That change couldn't be saved. Check the details and try again.",
  'not-found': 'That project could not be found. It may have been moved, archived or not synced here yet.',
  exists: 'That project already exists, or someone added its card meanwhile. Refresh and try again.',
  changed: "Someone else changed this project since you opened it, so your change wasn't made.",
  'not-allowed': "That change isn't allowed for this project.",
  internal: 'The change could not be made. Try again.',
} as const satisfies Record<ProjectsErrorCode, string>;

/** Refusals whose reason, written in plain words by the script, is shown to the person. */
const SHOW_REASON: readonly ProjectsErrorCode[] = ['bad-request', 'exists', 'not-allowed'];
const REASON_MAX = 300;
const CODES: readonly ProjectsErrorCode[] = ['bad-request', 'not-found', 'exists', 'changed', 'not-allowed'];

/** The fixed command line per action: nothing from a request ever becomes part of it. */
const COMMAND = { create: 'create', card: 'card', edit: 'edit', link: 'link', unlink: 'unlink' } as const;

export async function findProjectsSkill(
  root: string,
): Promise<{ skill: string; script: string | null } | null> {
  const found = await locateScript(root, PROJECTS_SKILL, PROJECTS_SCRIPT);
  return found.folder ? { skill: PROJECTS_SKILL, script: found.script } : null;
}

export async function findProjectsScript(root: string): Promise<string | null> {
  return (await findProjectsSkill(root))?.script ?? null;
}

/** The script's reason as a sentence, or null when it isn't one fit to show. */
function reasonOf(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const text = message.replace(/[\p{Cc}\s]+/gu, ' ').trim();
  if (text === '' || text.length > REASON_MAX) return null;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function judge(outcome: Outcome): { key: ProjectKey; version: string } | ProjectsError {
  const internal = new ProjectsError('internal', PROJECTS_CHANGE_MESSAGES.internal);
  if (outcome.failed) return internal;
  const reply = parseReply(outcome.stdout);
  if (reply === null) return internal;
  if (outcome.code === 0 && reply.ok === true) {
    if (
      typeof reply.key !== 'string' ||
      typeof reply.version !== 'string' ||
      !/^[0-9a-f]{64}$/.test(reply.version)
    )
      return internal;
    return { key: reply.key, version: reply.version };
  }
  if (outcome.code === 2 && reply.ok === false) {
    const code = reply.error;
    if (typeof code === 'string' && (CODES as readonly string[]).includes(code)) {
      const c = code as ProjectsErrorCode;
      const reason = SHOW_REASON.includes(c) ? reasonOf(reply.message) : null;
      return new ProjectsError(c, reason ?? PROJECTS_CHANGE_MESSAGES[c]);
    }
  }
  return internal;
}

/** One runner per brain: changes run one at a time, in the order they were asked for. */
export function createProjectsSkillRunner(
  root: string,
  opts: ProjectsSkillOptions = {},
): ProjectsSkillRunner {
  const options = withDefaults(opts, PROJECTS_SCRIPT_TIMEOUT_MS, PROJECTS_SCRIPT_MAX_OUTPUT_BYTES);
  const queue = createQueue();

  const runOnce = async (action: ProjectAction): Promise<{ key: ProjectKey; version: string }> => {
    if (action.kind === 'capabilities' || !Object.hasOwn(COMMAND, action.kind)) {
      throw new ProjectsError('bad-request', PROJECTS_CHANGE_MESSAGES['bad-request']);
    }
    const script = await findProjectsScript(root);
    if (!script) throw new ProjectsError('internal', PROJECTS_CHANGE_MESSAGES.internal);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      throw new ProjectsError('internal', PROJECTS_CHANGE_MESSAGES.internal);
    }
    const outcome = await runScript(script, realRoot, COMMAND[action.kind], JSON.stringify(action), options);
    const result = judge(outcome);
    if (result instanceof ProjectsError) throw result;
    return result;
  };

  // A script that doesn't know `capabilities` would refuse it as bad-request: a settled "none".
  const probe = createCapabilityProbe(
    root,
    () => findProjectsScript(root),
    options,
    (r) => r.ok === false && r.error === 'bad-request',
  );

  return {
    run: (action) => queue(() => runOnce(action)),
    capabilities: async () => [...(await probe())],
  };
}
