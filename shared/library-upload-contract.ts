/**
 * Contract for uploading files into the library from Documents, Images and a project's Files tab
 * (plan docs/plans/2026-11-26-file-types-and-uploads.md). The server and the client both build against
 * this file. Nothing here changes the brain's `tdsapp-files` script: the app only runs its existing
 * `add` (v0.2, 'files-add-v1') and, for a project, the projects skill's existing `link`.
 *
 * The flow is two requests, as for a to-do upload:
 * 1. `POST ROUTES.uploads` (raw bytes) stages the file outside the brain and answers an UploadInfo.
 * 2. `POST ROUTES.libraryUpload` (JSON, a LibraryUploadRequest) files that staged upload.
 */
import { type LibraryKind, TODO_UPLOAD_TYPES } from './contract.ts';
import { PROJECT_LINKS_MAX, type ProjectKey, type ProjectList } from './projects-contract.ts';

/**
 * The extensions a library upload may have: the same list as a to-do upload (the script's own `add`
 * list; no svg, html or htm, which can carry code). Lower case, no dot.
 */
export const LIBRARY_UPLOAD_TYPES: readonly string[] = TODO_UPLOAD_TYPES;

/**
 * `POST ROUTES.libraryUpload`. Exactly one of these shapes, no other fields. Where the file goes is
 * the server's choice, never the browser's: the browser names a library or a project, never a path.
 *
 * - `scope`: a LibraryScope.id. `client:<slug>` saves in `clients/<slug>/files/` (a document) or
 *   `clients/<slug>/images/` (an image); `personal` saves in `personal/files/` or `personal/images/`.
 *   Any other scope (`shared:templates`, an unlisted client) is refused.
 * - `project`: a ProjectKey. A client project saves in that client's `files/` or `images/` folder, a
 *   personal project in `personal/…`, and the saved file is then linked to the project's card
 *   (`link`, with `expect` = ProjectCard.version). An archived, card-less or legacy project is refused, and so
 *   is one whose card already holds PROJECT_LINKS_MAX links. The client folder comes from the card's own
 *   folder, never from its `client:` text.
 *
 * The folder is picked by the file's own type (the library's kind for its extension), whichever screen
 * the upload came from. A name already taken gets " (2)", " (3)"… before the extension.
 */
export type LibraryUploadRequest =
  | { upload: string; scope: string }
  | { upload: string; project: ProjectKey; expect: string };

export interface LibraryUploadResponse {
  /** Where the file was saved, brain-relative, with the name the script used. */
  path: string;
  /** What it was filed as. */
  kind: LibraryKind;
  /** The LibraryScope.id it landed in: 'personal' or 'client:<slug>'. */
  scope: string;
  /** True when it went to `personal/` (only this Mac has it). */
  personal: boolean;
  /**
   * Project uploads only. True: linked, and `list` is the fresh list (as `projectsChange` answers). False: the
   * file is saved at `path` but the link failed; `problem` is LIBRARY_UPLOAD_MESSAGES.savedNotLinked and `list`
   * is absent.
   */
  linked?: boolean;
  problem?: string;
  list?: ProjectList;
}

/**
 * Errors on ROUTES.libraryUpload, each with a plain UK-English `error`:
 * 400 `bad-request` (a body that is not a LibraryUploadRequest, an unknown or used upload id, a type not in
 * LIBRARY_UPLOAD_TYPES, a staged kind that differs from the library's kind for the extension),
 * 403 `not-allowed` (the files skill is missing, its `roles:` refuse this person, it lacks 'files-add-v1',
 * the scope or project can't take uploads, or the script refuses), 404 `not-found` (no such scope or
 * project), 409 `changed` (the project card changed since `expect`), 500 `internal`.
 *
 * The staged upload is used up by the request whatever happens next, so it can never be filed twice.
 * An error other than 500 means nothing was filed. When the link fails after the save worked the answer is 200
 * with `linked: false`, never an error: the client must not offer a blind retry (it would save a second copy).
 *
 * The server's order (overseer ruling 4): claim the upload; type and kind; the person's permission; then for a
 * project: found, not archived, card ok, not legacy, `expect`, links not full. Only then `add`, the check that the
 * script changed nothing but the name, the library `brain-changed` publish, and `link`.
 */
export const LIBRARY_UPLOAD_MESSAGES = {
  badRequest: "That upload wasn't understood. Reload the page and try again.",
  badType:
    "That type of file can't be added. Only PNG, JPG, WebP, GIF, PDF, Word, Excel, PowerPoint, CSV, Markdown and text files can be added.",
  notAllowed: "You can't add files here.",
  noSuchPlace: "That library couldn't be found. Reload the page and try again.",
  noSuchProject: "That project couldn't be found. It may have been moved.",
  projectClosed: "Files can't be added to this project.",
  projectFull: `This project already has ${PROJECT_LINKS_MAX} added files. Remove one first.`,
  projectChanged: "Someone changed this project just now, so the file wasn't added. Try again.",
  saveRefused: "The file couldn't be saved here. You may not have access to this client's folder.",
  saveFailed: "The file couldn't be saved. Try again.",
  /** `{where}` is "Acme Heating's Documents" or "your personal files". */
  savedNotLinked: (where: string) =>
    `The file was saved in ${where}, but couldn't be added to the project. Add it from the project's Files tab with Add files.`,
} as const;
