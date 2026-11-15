/**
 * Runs the brain's `tdsapp-files` skill script to delete a library file or purge the holding folder
 * (plan 2026-11-15-delete-library-files, decisions 1, 3 and 6). The app never moves or erases these
 * files itself: it sends one JSON object and reads the script's one-line JSON reply. Script codes
 * become `FilesChangeError`s with the app's own words; the script's text is never shown.
 */
import { promises as fs } from 'node:fs';
import { TODO_SCRIPT_MAX_OUTPUT_BYTES, TODO_SCRIPT_TIMEOUT_MS } from '../../shared/contract.ts';
import {
  FILES_CAPABILITY,
  FILES_CHANGE_MESSAGES,
  FilesChangeError,
  type FilesDeleteInput,
  type FilesErrorCode,
  type FilesPurgeInput,
} from '../../shared/files-contract.ts';
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
import { APP_VIA } from './todo-skill.ts';

export const FILES_SKILL = 'tdsapp-files';
export const FILES_SCRIPT = '.claude/skills/tdsapp-files/scripts/tdsapp-files.cjs';

/** A purge may touch many entries; a delete is one move. */
export const PURGE_TIMEOUT_MS = 60_000;

export type FilesSkillOptions = ScriptOptions;

/** The skill's name (for the roles check) and its script's real path, null if unusable; null when the folder is missing. */
export async function findFilesSkill(root: string): Promise<{ skill: string; script: string | null } | null> {
  const found = await locateScript(root, FILES_SKILL, FILES_SCRIPT);
  return found.folder ? { skill: FILES_SKILL, script: found.script } : null;
}

export async function findFilesScript(root: string): Promise<string | null> {
  return (await findFilesSkill(root))?.script ?? null;
}

/** The command line is fixed here: nothing from a request ever becomes part of it. */
const COMMAND = { delete: 'delete', purge: 'purge' } as const;

/** What a person's delete says, with the tool name and who it is for. `path` is relative to the brain root. */
export interface FilesDeleteRequest {
  path: string;
  expect?: string;
  by?: { slug: string; name: string };
}

export interface FilesSkillRunner {
  /** Deletes one file. Resolves when the script says it worked; otherwise rejects with FilesChangeError. */
  delete(request: FilesDeleteRequest): Promise<void>;
  /** Erases what has been held for 30 days. Resolves to the number erased; rejects with FilesChangeError. */
  purge(): Promise<number>;
  /** The script's `capabilities` features, cached per script real path and mtime. None when it fails. */
  capabilities(): Promise<readonly string[]>;
}

const CODES: readonly FilesErrorCode[] = [
  'bad-request',
  'not-found',
  'not-allowed',
  'changed',
  'exists',
  'internal',
];

/** The reply of a script that worked, or the error it means. Anything unexpected is `internal`. */
function judge(outcome: Outcome): { reply: Record<string, unknown> } | { code: FilesErrorCode } {
  if (outcome.failed) return { code: 'internal' };
  const reply = parseReply(outcome.stdout);
  if (reply === null) return { code: 'internal' };
  if (outcome.code === 0 && reply.ok === true) return { reply };
  if (outcome.code === 2 && reply.ok === false) {
    const code = reply.code;
    if (typeof code === 'string' && (CODES as readonly string[]).includes(code) && code !== 'internal')
      return { code: code as FilesErrorCode };
  }
  return { code: 'internal' };
}

export function createFilesSkillRunner(root: string, options: FilesSkillOptions = {}): FilesSkillRunner {
  const opts = withDefaults(options, TODO_SCRIPT_TIMEOUT_MS, TODO_SCRIPT_MAX_OUTPUT_BYTES);
  const queue = createQueue();

  async function run(command: string, input: object, timeoutMs: number): Promise<Record<string, unknown>> {
    const script = await findFilesScript(root);
    if (!script) throw new FilesChangeError('internal');
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      throw new FilesChangeError('internal');
    }
    const result = judge(
      await runScript(script, realRoot, command, JSON.stringify(input), { ...opts, timeoutMs }),
    );
    if ('code' in result) throw new FilesChangeError(result.code, FILES_CHANGE_MESSAGES[result.code]);
    return result.reply;
  }

  // An older script that doesn't know `capabilities` refuses it: a settled answer, so it is cached too.
  const probe = createCapabilityProbe(
    root,
    () => findFilesScript(root),
    opts,
    (r) => r.ok === false && r.code === 'bad-request',
  );

  return {
    delete: (request) =>
      queue(async () => {
        const input: FilesDeleteInput = {
          path: request.path,
          via: APP_VIA,
          ...(request.expect !== undefined ? { expect: request.expect } : {}),
          ...(request.by ? { by: request.by.slug, by_name: request.by.name } : {}),
        };
        await run(COMMAND.delete, input, opts.timeoutMs);
      }),
    purge: () =>
      queue(async () => {
        const input: FilesPurgeInput = { via: APP_VIA };
        const reply = await run(COMMAND.purge, input, options.timeoutMs ?? PURGE_TIMEOUT_MS);
        return typeof reply.erased === 'number' && reply.erased >= 0 ? Math.floor(reply.erased) : 0;
      }),
    capabilities: probe,
  };
}

/** True when the script is there and reports the delete feature. The caller checks the skill's `roles:`. */
export async function hasDeleteCapability(runner: Pick<FilesSkillRunner, 'capabilities'>): Promise<boolean> {
  return (await runner.capabilities()).includes(FILES_CAPABILITY);
}
