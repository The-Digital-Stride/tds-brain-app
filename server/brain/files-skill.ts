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
/** An add copies up to 32 MB into the brain. */
export const ADD_TIMEOUT_MS = 60_000;

/**
 * The script's `capabilities` feature for `add` (tdsapp-files v0.2, plan 2026-11-16-todo-attachments,
 * decision 3). The app offers uploads on to-dos only when it is listed.
 */
export const FILES_ADD_CAPABILITY = 'files-add-v1';

/**
 * The script's `capabilities` feature for `add-artifact` (tdsapp-files v0.4, plan
 * 2026-11-23-claude-artifacts-in-projects, decision 7). The app offers "Add a claude.ai page" only when it is listed.
 */
export const FILES_ARTIFACT_CAPABILITY = 'files-artifact-v1';

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
const COMMAND = { delete: 'delete', purge: 'purge', add: 'add', addArtifact: 'add-artifact' } as const;

/** What a person's delete says, with the tool name and who it is for. `path` is relative to the brain root. */
export interface FilesDeleteRequest {
  path: string;
  expect?: string;
  by?: { slug: string; name: string };
}

/**
 * What an upload asks the script to save: `source` is the staged file's real path (outside the brain),
 * `path` the brain-relative destination the server chose. The script may pick a free name (" (2)").
 */
export interface FilesAddRequest {
  source: string;
  path: string;
  by?: { slug: string; name: string };
}

/**
 * What "Add a claude.ai page" asks the script to save (`add-artifact` without `source`: a link card).
 * `path` is the brain-relative `.html` destination the server built.
 */
export interface FilesAddArtifactRequest {
  url: string;
  path: string;
  title: string;
  description?: string;
  by?: { slug: string; name: string };
}

export interface FilesSkillRunner {
  /**
   * Files a claude.ai artifact as a link card (v0.4 `add-artifact`). Resolves to the path the script saved it at
   * and its kind; rejects with FilesChangeError (`internal` for a reply without both).
   */
  addArtifact(request: FilesAddArtifactRequest): Promise<{ path: string; kind: 'copy' | 'link' }>;
  /**
   * Copies a file into the brain (v0.2 `add`). Resolves to the path the script saved it at, as it
   * replied; rejects with FilesChangeError (`internal` for a reply without a path).
   */
  add(request: FilesAddRequest): Promise<string>;
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
    add: (request) =>
      queue(async () => {
        // `by` is never read by the script (who comes from git); `by_name` is display text only.
        const input = {
          source: request.source,
          path: request.path,
          via: APP_VIA,
          ...(request.by ? { by_name: request.by.name } : {}),
        };
        const reply = await run(COMMAND.add, input, options.timeoutMs ?? ADD_TIMEOUT_MS);
        if (typeof reply.path !== 'string' || reply.path === '') throw new FilesChangeError('internal');
        return reply.path;
      }),
    addArtifact: (request) =>
      queue(async () => {
        const input = {
          url: request.url,
          path: request.path,
          title: request.title,
          ...(request.description !== undefined ? { description: request.description } : {}),
          via: APP_VIA,
          ...(request.by ? { by_name: request.by.name } : {}),
        };
        const reply = await run(COMMAND.addArtifact, input, options.timeoutMs ?? ADD_TIMEOUT_MS);
        if (
          typeof reply.path !== 'string' ||
          reply.path === '' ||
          (reply.kind !== 'copy' && reply.kind !== 'link')
        )
          throw new FilesChangeError('internal');
        return { path: reply.path, kind: reply.kind };
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

/** True when the script is there and reports `add`. The caller checks the skill's `roles:`. */
export async function hasAddCapability(runner: Pick<FilesSkillRunner, 'capabilities'>): Promise<boolean> {
  return (await runner.capabilities()).includes(FILES_ADD_CAPABILITY);
}

/** True when the script is there and reports `add-artifact`. The caller checks the skill's `roles:`. */
export async function hasArtifactCapability(
  runner: Pick<FilesSkillRunner, 'capabilities'>,
): Promise<boolean> {
  return (await runner.capabilities()).includes(FILES_ARTIFACT_CAPABILITY);
}
