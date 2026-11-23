/**
 * Contract for plan 2026-11-23-claude-artifacts-in-projects. Builders build against these shapes; the real
 * declarations go in the files named beside each one.
 */

// shared/pages.ts ------------------------------------------------------------------------------------

/** How much of an HTML file's start is read for the tags (decision 3). */
export const ARTIFACT_HEAD_BYTES = 64 * 1024;

/** The `<meta name>` values (decision 2). */
export const ARTIFACT_META = {
  source: 'tds-artifact-source',
  copied: 'tds-artifact-copied',
  kind: 'tds-artifact-kind',
  live: 'tds-artifact-live',
} as const;

/** What a page says about the claude.ai artifact it came from. */
export interface ArtifactSource {
  /** Passes `isArtifactUrl`; nothing else is ever returned. */
  url: string;
  /** `YYYY-MM-DD`, or null when missing or not a real date. */
  copied: string | null;
  /** `copy`: the artifact's own page. `link`: a link card (decision 6). Missing or unknown reads as `copy`. */
  kind: 'copy' | 'link';
  /** True when `tds-artifact-live` is `partial`: some parts only work on claude.ai. */
  partial: boolean;
}

/**
 * The exact block the skill writes at `linkScriptOffset(html)` (decision 2), and the only form the reader accepts.
 * `url` already passes `isArtifactUrl`; `copied` is YYYY-MM-DD. The `.cjs` copy must produce byte-identical output
 * (proved by the writer-reader test).
 */
export declare function artifactMetaBlock(meta: {
  url: string;
  copied: string;
  kind: 'copy' | 'link';
  partial: boolean;
}): string;
// e.g. '<meta name="tds-artifact-source" content="https://claude.ai/artifact/AbC123">\n'
//    + '<meta name="tds-artifact-copied" content="2026-11-23">\n'
//    + '<meta name="tds-artifact-kind" content="copy">\n'          (+ the live tag only when partial)

/**
 * Trim, drop any query or fragment, then `isArtifactUrl`. Returns the clean address or null. Used by the server
 * route; the skill has its own copy, fed by the same table test.
 */
export declare function cleanArtifactUrl(input: string): string | null;

/** Pure. Null unless a valid `tds-artifact-source` is found in the first ARTIFACT_HEAD_BYTES of `head`. */
export declare function artifactSource(head: string): ArtifactSource | null;

// shared/contract.ts ---------------------------------------------------------------------------------

/** Added to `LibraryItem` (decision 4). Absent, never null, when the file isn't an artifact. */
export interface LibraryItemArtifactField {
  artifact?: ArtifactSource;
}

/** `POST ROUTES.projectArtifact(key)` (decision 8). JSON only; the server builds the target path. */
export interface ProjectArtifactRequest {
  url: string;
  /** 1-200 characters, no control characters. */
  title: string;
  /** At most 300 characters. */
  description?: string;
  // No file field in Phase 1 (plan Phase 0, P3): the route always files a link card.
}

export interface ProjectArtifactResponse {
  /** Brain-relative path the skill saved it at (a number added when the name was taken). */
  path: string;
  kind: 'copy' | 'link';
}

// brain-skills/tdsapp-files (decision 7) ---------------------------------------------------------------

export interface AddArtifactInput {
  action: 'add-artifact';
  url: string;
  /**
   * Brain-relative `.html` target: exactly clients/<client>/projects/<slug>/files/<name>.html or
   * personal/projects/<slug>/files/<name>.html (its own rule; `add`'s rule is unchanged).
   */
  path: string;
  /** Full path of an .html/.htm file outside the brain, at most 5 MB, no UTF-16 BOM. Without it, a link card. */
  source?: string;
  /** 1-200 characters, no control characters. Required only without `source`. */
  title?: string;
  description?: string;
  /** Writes the tds-artifact-live tag. Only with `source`. */
  partial?: boolean;
  /** `YYYY-MM-DD`; defaults to today. */
  copied?: string;
  via?: string;
  by_name?: string;
}

export interface AddArtifactReply {
  ok: true;
  action: 'add-artifact';
  path: string;
  kind: 'copy' | 'link';
}

/** Added to `capabilities().features` (script 0.4); also `FILES_ARTIFACT_CAPABILITY` in files-skill.ts. */
export const FILES_ARTIFACT_FEATURE = 'files-artifact-v1';
