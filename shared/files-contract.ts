/**
 * Contract for deleting library files through the brain's `tdsapp-files` skill
 * (plan docs/plans/2026-11-15-delete-library-files.md). Both the script (brain-skills/tdsapp-files)
 * and the app build against this file; a test checks the script's constants match.
 */

/** Days a deleted file waits in the holding folder before `purge` erases it. */
export const PURGE_AFTER_DAYS = 30;

/** Holding folder, relative to the brain root. Outside every library scope. */
export const HOLDING_DIR = 'tdsapp-deleted';

/**
 * Action log folder, relative to the brain root, synced with the holding folder (no .gitignore change).
 * One `<member-slug>.<machine-id>.jsonl` per person per Mac, so two Macs never append to one file.
 * `machine-id` is 6 hex characters the script makes once and keeps outside the brain, in
 * `~/.config/tdsapp/machine-id`, so it never syncs. Purge never touches the log.
 */
export const ACTION_LOG_DIR = 'tdsapp-deleted/log';

/** A holding folder's name: `YYYYMMDD-HHMMSS-<6 hex>`. Anything else is refused and never purged. */
export const HOLDING_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** Base names the script refuses to delete anywhere, matched case-insensitively. */
export const PROTECTED_NAMES = ['claude.md', 'agents.md', 'readme.md'] as const;
/** Also refused: `clients/<slug>/profile.md`. */
export const PROTECTED_CLIENT_FILES = ['profile.md'] as const;

/** Capability the app needs before it shows any bin. */
export const FILES_CAPABILITY = 'files-delete-v1';

export type FilesAction = 'delete' | 'restore' | 'purge' | 'list-deleted' | 'capabilities';

export type FilesErrorCode = 'bad-request' | 'not-found' | 'not-allowed' | 'changed' | 'exists' | 'internal';

/** stdin for `delete`. `path` is relative to the brain root, forward slashes. */
export interface FilesDeleteInput {
  path: string;
  /** Library version (`versionOf(bytes, mtimeMs)`); refused with `changed` when it no longer matches. */
  expect?: string;
  /** Tool name, e.g. 'TDS Brain App'. */
  via?: string;
  /**
   * Never read: who did it (and their role) always comes from this Mac's git identity matched against
   * roles.json. Kept so older callers that send it still work. `by_name` is display text, used only for
   * a caller who isn't on the team (who can only purge and list).
   */
  by?: string;
  by_name?: string;
}

/** stdin for `restore`. */
export interface FilesRestoreInput {
  holding: string;
  via?: string;
  by?: string;
  by_name?: string;
}

/** stdin for `purge`. Tests set the clock through the script's injected `now`, never through stdin. */
export interface FilesPurgeInput {
  via?: string;
}

/** `tdsapp-deleted/<holding>/record.json`. */
export interface HoldingRecord {
  v: 1;
  path: string;
  scope: 'client' | 'templates';
  deleted_at: string; // ISO
  deleted_by: string;
  deleted_by_name: string;
  deleted_via: string;
  purge_after: string; // ISO, deleted_at + PURGE_AFTER_DAYS
  bytes: number;
}

/** One line of `<ACTION_LOG_DIR>/<member-slug>.<machine-id>.jsonl`. Readers skip unknown actions and fields. */
export interface ActionLogLine {
  v: 1;
  ts: string; // ISO
  action: 'delete' | 'restore' | 'purge';
  by: string;
  by_name: string;
  via: string;
  scope: 'client' | 'templates';
  path: string;
  bytes: number;
  holding: string;
}

export type FilesReply =
  /** `logged: false` when the file moved but its log line couldn't be written. */
  | { ok: true; action: 'delete'; holding: string; purge_after: string; logged?: false }
  | { ok: true; action: 'restore'; path: string; logged?: false }
  | { ok: true; action: 'purge'; erased: number }
  /** `changed_after_deletion`: the held file's size no longer matches `bytes` (an edit synced in after the delete). */
  | {
      ok: true;
      action: 'list-deleted';
      items: (HoldingRecord & { holding: string; changed_after_deletion?: boolean })[];
    }
  | { ok: true; action: 'capabilities'; version: string; features: string[] }
  | { ok: false; code: FilesErrorCode; error: string };

/** App route: see `ROUTES.libraryItem` in shared/contract.ts. */

/** The app's own words for each failure (UK English). The script's error texts are for developers and never shown. */
export const FILES_CHANGE_MESSAGES = {
  'bad-request': "That delete wasn't understood. Reload the page and try again.",
  'not-found': "That file couldn't be found. Someone may have moved or deleted it already.",
  'not-allowed': "You can't delete this file. Only an owner can delete templates.",
  changed: "Someone changed this file since you opened it, so it wasn't deleted. Have a look and try again.",
  exists: 'A file with that name is already there, so nothing was put back.',
  internal: "The file couldn't be deleted. Try again.",
} as const satisfies Record<FilesErrorCode, string>;

/** HTTP status for each code on `DELETE ROUTES.libraryItem` (`exists` only comes from restore, which has no route). */
export const FILES_CHANGE_STATUS = {
  'bad-request': 400,
  'not-allowed': 403,
  'not-found': 404,
  changed: 409,
  exists: 409,
  internal: 500,
} as const satisfies Record<FilesErrorCode, number>;

export class FilesChangeError extends Error {
  readonly code: FilesErrorCode;
  constructor(code: FilesErrorCode, message: string = FILES_CHANGE_MESSAGES[code]) {
    super(message);
    this.name = 'FilesChangeError';
    this.code = code;
  }
}

/** The notice after a delete is sent: names the file and says how to get it back (UX gate, 2026-11-15). */
export function filesDeletedNotice(name: string): string {
  return `${name} deleted. To get it back within 30 days, ask Claude.`;
}
