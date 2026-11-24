/**
 * Runs the brain's `tdsapp-projects` skill script for one project change (plan
 * docs/plans/2026-11-20-projects-system.md, decision 9). The app never writes a project card itself:
 * it sends the ProjectAction as one JSON object and reads the script's one-line JSON reply. One runner
 * per brain, so changes run one at a time, in the order asked.
 */
import { promises as fs } from 'node:fs';
import { UPDATE_FILE_PATTERN, UPDATES_DIR } from '../../shared/project-updates-contract.ts';
import { parseProjectKey } from '../../shared/projects.ts';
import {
  INTERNAL_CLIENT,
  PROJECTS_SCRIPT_TIMEOUT_MS,
  type ProjectAction,
  type ProjectKey,
  type ProjectMoveCheck,
  type ProjectRemoveCheck,
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

/** What a run answers: the project's key (a move's new one) and its card's version; a move check adds `check`. */
export interface ProjectsSkillResult {
  /** Absent only for a `ref` with `all` (it answers who was given what, not one project). */
  key?: ProjectKey;
  version: string;
  check?: ProjectMoveCheck;
  /** An archive, unarchive or delete check's answer. */
  removeCheck?: ProjectRemoveCheck;
  /**
   * Delete only: the project is gone, but its hidden `.deleting~` folder couldn't be removed
   * (brain-relative; on this Mac only, git-ignored). The to-do choices still apply.
   */
  leftBehind?: string;
  /** `update` only: the new entry's brain-relative path (contract ProjectUpdateAction). */
  file?: string;
  /** `edit` only: the card change was saved but an automatic updates-log entry wasn't (decision 4). */
  updatesFailed?: true;
}

export interface ProjectsSkillRunner {
  /** Runs one change. Resolves with the project's key and its card's new version; else rejects with ProjectsError. */
  run(action: ProjectAction): Promise<ProjectsSkillResult>;
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

/** A move refused because the folder's files aren't those its check listed (`filesExpect`). */
export const PROJECTS_MOVE_FILES_CHANGED =
  'The files in this project changed since you checked. Check again.';
const FILES_CHANGED_REASON = /^the files in this project changed since you checked\b/i;

/** Refusals whose reason, written in plain words by the script, is shown to the person. */
const SHOW_REASON: readonly ProjectsErrorCode[] = ['bad-request', 'exists', 'not-allowed'];
const REASON_MAX = 300;
const CODES: readonly ProjectsErrorCode[] = ['bad-request', 'not-found', 'exists', 'changed', 'not-allowed'];

/** The fixed command line per action: nothing from a request ever becomes part of it. */
const COMMAND = {
  create: 'create',
  card: 'card',
  edit: 'edit',
  link: 'link',
  unlink: 'unlink',
  move: 'move',
  archive: 'archive',
  unarchive: 'unarchive',
  delete: 'delete',
  update: 'update',
  'update-remove': 'update-remove',
  ref: 'ref',
} as const;
/** An entry's brain-relative path: `<folder>/updates/<name>.md`, the name as UPDATE_FILE_PATTERN has it. */
const UPDATE_FILE = new RegExp(`^(?:[^/]+/)+${UPDATES_DIR}/${UPDATE_FILE_PATTERN.source.slice(1)}`);
const REMOVE_KINDS: readonly string[] = ['archive', 'unarchive', 'delete'];
const REFERENCES_MAX = 20;
/** A move check lists at most this many files (contract ProjectMoveCheck). */
const MOVE_FILES_MAX = 50;
const MOVE_PATH_MAX = 1024;
/**
 * The hidden folder a delete renames a project to (the script's DELETING), beside it in a folder
 * projects live in: `.tdsapp-projects-<the key's slug>-<12 hex>.deleting~`. Groups: the parent
 * folder, the slug.
 */
const LEFT_BEHIND =
  /^((?:clients\/[a-z0-9]+(?:-[a-z0-9]+)*\/|personal\/)?projects(?:-archive)?)\/\.tdsapp-projects-([a-z0-9]+(?:-[a-z0-9]+)*)-[0-9a-f]{12}\.deleting~$/;

/**
 * The folders a key's live or archive folder sits in (the script's locationsOf, less the read-only
 * archived-client one): the hidden folder a delete leaves behind is only ever in one of them.
 */
function deleteParentsOf(key: { client: string; slug: string }): string[] {
  if (key.client === 'personal') return ['personal/projects', 'personal/projects-archive'];
  const own = [`clients/${key.client}/projects`, `clients/${key.client}/projects-archive`];
  return key.client === INTERNAL_CLIENT ? [...own, 'projects', 'projects-archive'] : own;
}

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

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isVersion = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const pathList = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((p) => typeof p === 'string' && p !== '' && p.length <= MOVE_PATH_MAX && !/[\p{Cc}]/u.test(p));

/** A move check's answer, exactly as the contract has it, or null. */
function moveCheckOf(v: unknown, key: ProjectKey): ProjectMoveCheck | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  if (
    c.key !== key ||
    !pathList(c.files, MOVE_FILES_MAX) ||
    !isCount(c.fileCount) ||
    c.fileCount < c.files.length ||
    !isCount(c.ignoredCount) ||
    c.ignoredCount > c.fileCount ||
    !pathList(c.personalLinks, Number.MAX_SAFE_INTEGER) ||
    !isVersion(c.filesVersion)
  )
    return null;
  return {
    key,
    files: [...c.files],
    fileCount: c.fileCount,
    ignoredCount: c.ignoredCount,
    personalLinks: [...c.personalLinks],
    filesVersion: c.filesVersion,
  };
}

const isFlag = (v: unknown): v is boolean => typeof v === 'boolean';

/** An archive, unarchive or delete check's answer, exactly as the contract has it, or null. */
function removeCheckOf(v: unknown, key: ProjectKey): ProjectRemoveCheck | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  const place = (x: unknown): x is string => typeof x === 'string' && x !== '' && x.length <= MOVE_PATH_MAX;
  const who = reasonOf(c.allowedWho) ?? (c.allowedWho === '' ? '' : null);
  if (
    c.key !== key ||
    !place(c.from) ||
    !(c.to === null || place(c.to)) ||
    !pathList(c.files, MOVE_FILES_MAX) ||
    !isCount(c.fileCount) ||
    c.fileCount < c.files.length ||
    !isCount(c.images) ||
    !isCount(c.documents) ||
    !isCount(c.other) ||
    !isCount(c.bytes) ||
    !isCount(c.ignoredCount) ||
    c.ignoredCount > c.fileCount ||
    !isCount(c.localOnlyCount) ||
    c.localOnlyCount > c.fileCount ||
    !pathList(c.references, REFERENCES_MAX) ||
    !isCount(c.referenceCount) ||
    c.referenceCount < c.references.length ||
    !isVersion(c.filesVersion) ||
    !isFlag(c.empty) ||
    !isFlag(c.allowed) ||
    who === null
  )
    return null;
  return {
    key,
    from: c.from,
    to: c.to,
    files: [...c.files],
    fileCount: c.fileCount,
    images: c.images,
    documents: c.documents,
    other: c.other,
    bytes: c.bytes,
    ignoredCount: c.ignoredCount,
    localOnlyCount: c.localOnlyCount,
    references: [...c.references],
    referenceCount: c.referenceCount,
    filesVersion: c.filesVersion,
    empty: c.empty,
    allowed: c.allowed,
    allowedWho: who,
  };
}

function judge(action: ProjectAction, outcome: Outcome): ProjectsSkillResult | ProjectsError {
  const internal = new ProjectsError('internal', PROJECTS_CHANGE_MESSAGES.internal);
  if (outcome.failed) return internal;
  const reply = parseReply(outcome.stdout);
  if (reply === null) return internal;
  if (outcome.code === 0 && reply.ok === true) {
    if (REMOVE_KINDS.includes(action.kind)) {
      // Archive, unarchive, delete: the key is the project's own; a real run's version is '' (no card edit).
      if (reply.key !== undefined && reply.key !== (action as { key: ProjectKey }).key) return internal;
      if (reply.version !== undefined && reply.version !== '' && !isVersion(reply.version)) return internal;
      const key = (action as { key: ProjectKey }).key;
      if ((action as { check?: true }).check !== true) {
        if (reply.leftBehind === undefined) return { key, version: '' };
        const left = reply.leftBehind;
        const parsed = parseProjectKey(key);
        const m = typeof left === 'string' ? LEFT_BEHIND.exec(left) : null;
        if (
          action.kind !== 'delete' ||
          !parsed ||
          typeof left !== 'string' ||
          left.length > MOVE_PATH_MAX ||
          !m ||
          m[2] !== parsed.slug ||
          !deleteParentsOf(parsed).includes(m[1] as string)
        )
          return internal;
        return { key, version: '', leftBehind: left };
      }
      const removeCheck = removeCheckOf(reply.check, key);
      return removeCheck ? { key, version: '', removeCheck } : internal;
    }
    if (action.kind === 'ref') {
      // Project codes: `all` answers who was given what, no key; the one-card form answers key and version.
      if (action.all === true) return { version: '' };
      if (typeof reply.key !== 'string' || reply.key !== action.key || !isVersion(reply.version))
        return internal;
      return { key: reply.key, version: reply.version };
    }
    if (
      typeof reply.key !== 'string' ||
      typeof reply.version !== 'string' ||
      !/^[0-9a-f]{64}$/.test(reply.version)
    )
      return internal;
    if (action.kind === 'update') {
      // The entry's path is inside this project's own updates/ folder, named as the contract says.
      const file = reply.file;
      if (
        typeof file !== 'string' ||
        file.length > MOVE_PATH_MAX ||
        reply.key !== action.key ||
        !UPDATE_FILE.test(file) ||
        file.split('/').includes('..')
      )
        return internal;
      return { key: reply.key, version: reply.version, file };
    }
    if (action.kind === 'edit' && reply.updatesFailed === true)
      return { key: reply.key, version: reply.version, updatesFailed: true };
    if (action.kind !== 'move') return { key: reply.key, version: reply.version };
    // A move answers the new key, which is always `<client>/<the same slug>`.
    const slug = parseProjectKey(action.key)?.slug;
    if (!slug || reply.key !== `${action.client}/${slug}`) return internal;
    if (action.check !== true) return { key: reply.key, version: reply.version };
    const check = moveCheckOf(reply.check, reply.key);
    return check ? { key: reply.key, version: reply.version, check } : internal;
  }
  if (outcome.code === 2 && reply.ok === false) {
    const code = reply.error;
    // `ref` is the one action whose script may refuse with `internal` (git can't say which codes were used),
    // and its plain reason is shown (contract: "Couldn't check old codes just now. Try again in a moment.").
    const known =
      (CODES as readonly string[]).includes(code as string) || (action.kind === 'ref' && code === 'internal');
    if (typeof code === 'string' && known) {
      const c = code as ProjectsErrorCode;
      if (
        c === 'changed' &&
        (action.kind === 'move' || REMOVE_KINDS.includes(action.kind)) &&
        typeof reply.message === 'string' &&
        FILES_CHANGED_REASON.test(reply.message)
      )
        return new ProjectsError(c, PROJECTS_MOVE_FILES_CHANGED);
      const reason =
        SHOW_REASON.includes(c) || (action.kind === 'ref' && c === 'internal')
          ? reasonOf(reply.message)
          : null;
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

  const runOnce = async (action: ProjectAction): Promise<ProjectsSkillResult> => {
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
    const result = judge(action, outcome);
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
