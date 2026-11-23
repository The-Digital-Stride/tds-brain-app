/**
 * "Add a claude.ai page" in a project (plan docs/plans/2026-11-23-claude-artifacts-in-projects.md, decision 8).
 * The route checks the request and the project; this builds the target path (never taken from the browser) and
 * files a link card through `tdsapp-files`' `add-artifact`. Nothing here writes a file or fetches claude.ai.
 */
import type { Identity } from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import type { ProjectArtifactResponse, ProjectCard } from '../../shared/projects-contract.ts';
import { FILES_SKILL, type FilesSkillRunner, findFilesSkill, hasArtifactCapability } from './files-skill.ts';
import { skillAccess } from './skills.ts';

export const ARTIFACT_TITLE_MAX = 200;
export const ARTIFACT_DESCRIPTION_MAX = 300;
const SLUG_MAX = 60;
const SLUG_FALLBACK = 'claude-page';

/** `clients/<client>/projects/<slug>` or `personal/projects/<slug>`; not the older `projects/<slug>`, and no archive. */
const LIVE_PROJECT_FOLDER = /^(?:clients\/[a-z0-9][a-z0-9-]*|personal)\/projects\/[a-z0-9][a-z0-9-]*$/;

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** A title: 1-200 characters once trimmed, no control characters. The trimmed title, or null. */
export function cleanArtifactTitle(input: unknown): string | null {
  if (typeof input !== 'string' || hasControl(input)) return null;
  const t = input.trim();
  return t.length >= 1 && t.length <= ARTIFACT_TITLE_MAX ? t : null;
}

/** A description: at most 300 characters once trimmed, no control characters. '' stands for none; null is refused. */
export function cleanArtifactDescription(input: unknown): string | null {
  if (typeof input !== 'string' || hasControl(input)) return null;
  const t = input.trim();
  return t.length <= ARTIFACT_DESCRIPTION_MAX ? t : null;
}

/** File name stem from a title: lower-case a-z, 0-9 and hyphens, at most 60 characters, "claude-page" when empty. */
export function artifactSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug === '' ? SLUG_FALLBACK : slug;
}

export type ArtifactRefusal = 'no-card' | 'archived' | 'legacy';

/** Why a project can't take a page, or null when it can. */
export function artifactRefusal(
  card: Pick<ProjectCard, 'card' | 'archived' | 'folder'>,
): ArtifactRefusal | null {
  if (card.archived) return 'archived';
  if (card.card !== 'ok') return 'no-card';
  return LIVE_PROJECT_FOLDER.test(card.folder) ? null : 'legacy';
}

/** The brain-relative target, built only here: `<card folder>/files/<slug>.html`. */
export function artifactTarget(card: Pick<ProjectCard, 'folder'>, title: string): string {
  return `${card.folder}/files/${artifactSlug(title)}.html`;
}

export interface ProjectArtifactService {
  /** The `tdsapp-files` skill is here, its `roles:` allow this person and it lists `files-artifact-v1`. */
  canAdd(identity: Identity): Promise<boolean>;
  /** Files a link card in the project. Throws FilesChangeError. The card must already have passed `artifactRefusal`. */
  add(
    card: Pick<ProjectCard, 'folder'>,
    req: { url: string; title: string; description?: string },
    identity: Identity,
  ): Promise<ProjectArtifactResponse>;
}

/** The `tdsapp-files` skill is here (script usable) and its `roles:` allow this person. */
export async function mayUseFilesSkill(root: string, identity: Identity): Promise<boolean> {
  try {
    const found = await findFilesSkill(root);
    if (!found || found.script === null) return false;
    return (await skillAccess(root, identity, FILES_SKILL)) === 'allowed';
  } catch {
    return false;
  }
}

export function createProjectArtifact(
  root: string,
  deps: {
    files: Pick<FilesSkillRunner, 'capabilities' | 'addArtifact'>;
    onSaved?: (path: string) => void;
    /** Injectable for tests. Default: `mayUseFilesSkill`. */
    mayUseFiles?: (identity: Identity) => Promise<boolean>;
  },
): ProjectArtifactService {
  const mayUseFiles = deps.mayUseFiles ?? ((identity: Identity) => mayUseFilesSkill(root, identity));
  const canAdd = async (identity: Identity): Promise<boolean> => {
    try {
      return (await mayUseFiles(identity)) && (await hasArtifactCapability(deps.files));
    } catch {
      return false;
    }
  };
  return {
    canAdd,
    async add(card, req, identity) {
      if (!(await canAdd(identity))) throw new FilesChangeError('not-allowed');
      const path = artifactTarget(card, req.title);
      const folder = path.slice(0, path.lastIndexOf('/') + 1);
      const saved = await deps.files.addArtifact({
        url: req.url,
        path,
        title: req.title,
        ...(req.description ? { description: req.description } : {}),
        by: { name: identity.name, slug: identity.slug },
      });
      // The script may pick a free name, never another folder.
      if (!saved.path.startsWith(folder) || saved.path.slice(folder.length).includes('/'))
        throw new FilesChangeError('internal');
      deps.onSaved?.(saved.path);
      return { path: saved.path, kind: saved.kind };
    },
  };
}
