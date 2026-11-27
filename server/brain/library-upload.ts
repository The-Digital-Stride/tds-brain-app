/**
 * Uploads into the library from Documents, Images and a project's Files tab (plan
 * docs/plans/2026-11-26-file-types-and-uploads.md, decisions 3-5, 7 and 9; overseer rulings 3, 4, 5 and 7).
 *
 * `decideUpload` is the one rule for where a file may go and whether this person may put it there. The
 * listing's `canUpload`, the project list's `canUploadFiles` and both request shapes all use it. The client's
 * slug comes from the listed scope or the card's own folder, never from the browser or the card's `client:`.
 *
 * The app writes nothing itself: the brain's `tdsapp-files` skill saves the file (`add`) and, for a project,
 * the projects skill links it (`link`, through the brain's `changeProject`).
 */
import type { Identity, LibraryKind, LibraryScope } from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import {
  LIBRARY_UPLOAD_MESSAGES,
  LIBRARY_UPLOAD_TYPES,
  type LibraryUploadResponse,
} from '../../shared/library-upload-contract.ts';
import {
  PROJECT_LINKS_MAX,
  type ProjectAction,
  type ProjectCard,
  type ProjectKey,
  type ProjectList,
} from '../../shared/projects-contract.ts';
import { type FilesSkillRunner, hasAddCapability, savedOnlyRenamed } from './files-skill.ts';
import { classify, extOf, isNeverListed } from './library-rules.ts';
import { artifactRefusal, mayUseFilesSkill } from './project-artifact.ts';
import { cleanUploadName } from './todos.ts';

/** A client slug the app will file under: lower-case letters, digits and hyphens, not starting with a hyphen. */
const CLIENT_SCOPE = /^client:([a-z0-9][a-z0-9-]*)$/;
/** A live client project's folder (after LIVE_PROJECT_FOLDER passed): the slug is the second segment. */
const CLIENT_PROJECT = /^clients\/([a-z0-9][a-z0-9-]*)\/projects\/[^/]+$/;
const PERSONAL_PROJECT = /^personal\/projects\/[^/]+$/;
const PERSONAL_WHERE = 'your personal files';

/** Where an upload is aimed: a LibraryScope.id, or a project's card. */
export type UploadTarget =
  | { scope: string }
  | { card: Pick<ProjectCard, 'folder' | 'space' | 'archived' | 'card'> };

export type UploadRefusal = 'bad-type' | 'not-allowed' | 'no-such-place' | 'project-closed';

export type UploadDecision =
  | {
      ok: true;
      /** 'personal' or 'client:<slug>'. */
      scope: string;
      personal: boolean;
      /** Brain-relative destination; null when no file name was given (the flags). */
      path: string | null;
      kind: LibraryKind | null;
      /** "Acme Heating's Documents" or "your personal files"; null without a file name. */
      where: string | null;
    }
  | { ok: false; refusal: UploadRefusal };

/** The scope a target files into, or why it can't take uploads. Permission has already been checked. */
function placeFor(
  target: UploadTarget,
  scopes: readonly LibraryScope[],
  onTeam: boolean,
): { scope: LibraryScope; base: string } | UploadRefusal {
  const listed = (id: string, kind: LibraryScope['kind']) =>
    scopes.find((s) => s.id === id && s.kind === kind);
  if ('scope' in target) {
    if (!scopes.some((s) => s.id === target.scope)) return 'no-such-place';
    if (target.scope === 'personal') {
      const scope = listed('personal', 'personal');
      return scope ? { scope, base: 'personal' } : 'not-allowed';
    }
    // The script refuses a client file from someone not on the team list, so it is never offered.
    if (!onTeam) return 'not-allowed';
    const slug = CLIENT_SCOPE.exec(target.scope)?.[1];
    const scope = slug ? listed(target.scope, 'client') : undefined;
    if (!slug || !scope || isNeverListed(`clients/${slug}`)) return 'not-allowed';
    return { scope, base: `clients/${slug}` };
  }
  const { card } = target;
  if (artifactRefusal(card)) return 'project-closed';
  // ProjectList.canUploadFiles is one flag for every card, so no project upload for them at all.
  if (!onTeam) return 'not-allowed';
  const slug = CLIENT_PROJECT.exec(card.folder)?.[1];
  if (slug) {
    const scope = card.space === 'client' ? listed(`client:${slug}`, 'client') : undefined;
    return scope && !isNeverListed(`clients/${slug}`) ? { scope, base: `clients/${slug}` } : 'not-allowed';
  }
  // A shared (client) project never files under personal/.
  if (PERSONAL_PROJECT.test(card.folder) && card.space === 'personal') {
    const scope = listed('personal', 'personal');
    return scope ? { scope, base: 'personal' } : 'not-allowed';
  }
  return 'not-allowed';
}

/**
 * The one rule (overseer ruling 5). In order: the file's type (when `name` is given), this person's permission
 * (`mayAdd`: the files skill is there, its `roles:` allow them and it lists 'files-add-v1'), then the place. The
 * folder is picked by the file's own kind, whichever screen sent it (ruling 7). `onTeam` (default true) is
 * false for someone not on the team list (`role: 'unknown'`): only their personal files take uploads.
 */
export function decideUpload(
  target: UploadTarget,
  name: string | null,
  ctx: { scopes: readonly LibraryScope[]; mayAdd: boolean; onTeam?: boolean },
): UploadDecision {
  let kind: LibraryKind | null = null;
  if (name !== null) {
    const ext = extOf(name);
    kind = LIBRARY_UPLOAD_TYPES.includes(ext) ? (classify(ext)?.kind ?? null) : null;
    if (!kind) return { ok: false, refusal: 'bad-type' };
  }
  if (!ctx.mayAdd) return { ok: false, refusal: 'not-allowed' };
  const place = placeFor(target, ctx.scopes, ctx.onTeam ?? true);
  if (typeof place === 'string') return { ok: false, refusal: place };
  const personal = place.base === 'personal';
  if (name === null || kind === null)
    return { ok: true, scope: place.scope.id, personal, path: null, kind: null, where: null };
  const path = `${place.base}/${kind === 'image' ? 'images' : 'files'}/${cleanUploadName(name)}`;
  if (isNeverListed(path)) return { ok: false, refusal: 'not-allowed' };
  const where = personal
    ? PERSONAL_WHERE
    : `${place.scope.name}'s ${kind === 'image' ? 'Images' : 'Documents'}`;
  return { ok: true, scope: place.scope.id, personal, path, kind, where };
}

export type LibraryUploadErrorCode = 'bad-request' | 'not-allowed' | 'not-found' | 'changed' | 'internal';

/** A refusal with the contract's code and plain UK-English words (LIBRARY_UPLOAD_MESSAGES). */
export class LibraryUploadError extends Error {
  readonly code: LibraryUploadErrorCode;
  constructor(code: LibraryUploadErrorCode, message: string) {
    super(message);
    this.name = 'LibraryUploadError';
    this.code = code;
  }
}

const REFUSALS: Record<UploadRefusal, () => LibraryUploadError> = {
  'bad-type': () => new LibraryUploadError('bad-request', LIBRARY_UPLOAD_MESSAGES.badType),
  'not-allowed': () => new LibraryUploadError('not-allowed', LIBRARY_UPLOAD_MESSAGES.notAllowed),
  'no-such-place': () => new LibraryUploadError('not-found', LIBRARY_UPLOAD_MESSAGES.noSuchPlace),
  'project-closed': () => new LibraryUploadError('not-allowed', LIBRARY_UPLOAD_MESSAGES.projectClosed),
};

/** The files skill's refusal of an add, in the app's words; the script's own text is never passed on. */
function saveError(err: unknown): LibraryUploadError {
  if (err instanceof FilesChangeError && err.code === 'not-allowed')
    return new LibraryUploadError('not-allowed', LIBRARY_UPLOAD_MESSAGES.saveRefused);
  if (err instanceof FilesChangeError && err.code === 'bad-request')
    return new LibraryUploadError('bad-request', LIBRARY_UPLOAD_MESSAGES.saveFailed);
  return new LibraryUploadError('internal', LIBRARY_UPLOAD_MESSAGES.saveFailed);
}

/** A staged upload (its real path, outside the brain, and its name) and where it is aimed. */
export type LibraryUploadInput = { stagedPath: string; name: string } & (
  | { scope: string }
  | { project: ProjectKey; expect: string }
);

export interface LibraryUploadDeps {
  files: Pick<FilesSkillRunner, 'add' | 'capabilities'>;
  /** The listed library scopes (BrainReaders.libraryScopes). */
  scopes: () => Promise<LibraryScope[]>;
  /** The project list as this person sees it (BrainReaders.projects). */
  projects: (identity: Identity) => Promise<ProjectList>;
  /** The brain's existing `changeProject` for a `link`. */
  link: (action: Extract<ProjectAction, { kind: 'link' }>, identity: Identity) => Promise<ProjectList>;
  /** Called with the saved path once the file is in the library (library.changed, projects.changed). */
  onSaved?: (path: string) => void;
  /** Injectable for tests. Default: `mayUseFilesSkill` (the skill's script is there and its `roles:` allow them). */
  mayUseFiles?: (identity: Identity) => Promise<boolean>;
}

export interface LibraryUploadService {
  /** `LibraryListing.canUpload`: this person may upload into this scope. */
  canUpload(scope: string, identity: Identity): Promise<boolean>;
  /** The files half of `ProjectList.canUploadFiles` (the route adds `canChange`): this person may add files. */
  canUploadFiles(identity: Identity): Promise<boolean>;
  /**
   * Files a staged upload; for a project, then links it. Throws LibraryUploadError for every refusal, all of them
   * before `add` runs. A link failure after the save answers `linked: false` with `problem`, never throws.
   * `opts.onSaved` runs once the file is saved, before the link (the route's library publish).
   */
  save(
    input: LibraryUploadInput,
    identity: Identity,
    opts?: { onSaved?: (path: string) => void },
  ): Promise<LibraryUploadResponse>;
}

export function createLibraryUpload(root: string, deps: LibraryUploadDeps): LibraryUploadService {
  const mayUseFiles = deps.mayUseFiles ?? ((identity: Identity) => mayUseFilesSkill(root, identity));
  // Read afresh on every call: the skill's `roles:` is the only gate (ruling 5).
  const mayAdd = async (identity: Identity): Promise<boolean> => {
    try {
      return (await mayUseFiles(identity)) && (await hasAddCapability(deps.files));
    } catch {
      return false;
    }
  };
  const scopes = () => deps.scopes().catch(() => [] as LibraryScope[]);
  const tell = (fn: ((path: string) => void) | undefined, path: string) => {
    try {
      fn?.(path);
    } catch {
      // A refresh that fails must not lose a saved file's answer.
    }
  };

  const onTeam = (identity: Identity) => identity.role !== 'unknown';

  return {
    async canUpload(scope, identity) {
      if (typeof scope !== 'string') return false;
      const allowed = await mayAdd(identity);
      return decideUpload({ scope }, null, {
        scopes: await scopes(),
        mayAdd: allowed,
        onTeam: onTeam(identity),
      }).ok;
    },

    canUploadFiles: async (identity) => onTeam(identity) && (await mayAdd(identity)),

    async save(input, identity, opts = {}) {
      const ext = extOf(input.name);
      if (!LIBRARY_UPLOAD_TYPES.includes(ext) || !classify(ext)) throw REFUSALS['bad-type']();
      const allowed = await mayAdd(identity);
      if (!allowed) throw REFUSALS['not-allowed']();
      if ('project' in input && !onTeam(identity)) throw REFUSALS['not-allowed']();
      let card: ProjectCard | null = null;
      if ('project' in input) {
        let list: ProjectList;
        try {
          list = await deps.projects(identity);
        } catch {
          throw new LibraryUploadError('internal', LIBRARY_UPLOAD_MESSAGES.saveFailed);
        }
        if (list.canChange !== true) throw REFUSALS['not-allowed']();
        card = list.projects.find((c) => c.key === input.project) ?? null;
        if (!card) throw new LibraryUploadError('not-found', LIBRARY_UPLOAD_MESSAGES.noSuchProject);
      }
      const decision = decideUpload(
        card ? { card } : { scope: (input as { scope: string }).scope },
        input.name,
        {
          scopes: await scopes(),
          mayAdd: allowed,
          onTeam: onTeam(identity),
        },
      );
      if (!decision.ok) throw REFUSALS[decision.refusal]();
      const { path, kind, where } = decision;
      if (path === null || kind === null || where === null)
        throw new LibraryUploadError('internal', LIBRARY_UPLOAD_MESSAGES.saveFailed);
      if (card && 'expect' in input) {
        if (input.expect !== card.version)
          throw new LibraryUploadError('changed', LIBRARY_UPLOAD_MESSAGES.projectChanged);
        if (card.links.length >= PROJECT_LINKS_MAX)
          throw new LibraryUploadError('not-allowed', LIBRARY_UPLOAD_MESSAGES.projectFull);
      }

      let saved: string;
      try {
        saved = await deps.files.add({
          source: input.stagedPath,
          path,
          by: { slug: identity.slug, name: identity.name },
        });
      } catch (err) {
        throw saveError(err);
      }
      // The script may only change the name: same folder, same extension, somewhere the library lists.
      if (!savedOnlyRenamed(path, saved) || extOf(saved) !== extOf(path) || isNeverListed(saved))
        throw new LibraryUploadError('internal', LIBRARY_UPLOAD_MESSAGES.saveFailed);
      tell(deps.onSaved, saved);
      tell(opts.onSaved, saved);

      const answer: LibraryUploadResponse = {
        path: saved,
        kind,
        scope: decision.scope,
        personal: saved.startsWith('personal/'),
      };
      if (!card || !('expect' in input)) return answer;
      try {
        const list = await deps.link(
          { kind: 'link', key: card.key, path: saved, expect: input.expect },
          identity,
        );
        return { ...answer, linked: true, list };
      } catch {
        // Saved but not linked: never an error, so the client can't offer a retry that saves a second copy.
        return { ...answer, linked: false, problem: LIBRARY_UPLOAD_MESSAGES.savedNotLinked(where) };
      }
    },
  };
}
