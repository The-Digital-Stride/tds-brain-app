/**
 * Client background on a project's Overview (plan docs/plans/2026-11-24-project-business-context.md).
 *
 * READ ONLY. The app reads `clients/<client>/context/business.md` (and `clients/<client>/profile.md` for the
 * fallbacks below) and never writes either file, nor copies them into the project card. Ian's rule
 * (2026-11-24): business.md is changed only in the brain, never from a project, a to-do or any app screen.
 * Each open re-reads the file, so the page always shows what the brain says now.
 *
 * Safe read (security gate): both files go through one helper. `lstat` must say a regular file, size ≤
 * BUSINESS_MAX_BYTES, and `realpath(file)` must equal `join(realpath(root), 'clients', slug, ...)` (the
 * check in server/brain/todos.ts `isListableFile`), so a linked client or `context/` folder never reads
 * outside the brain. Any failure → that file counts as unreadable.
 */

import type { ProjectKey } from './projects-contract.ts';

/** Brain-relative, under the client folder. */
export const BUSINESS_FILE = 'context/business.md';
export const PROFILE_FILE = 'profile.md';

/** Larger files are refused. The biggest today (urban-cooling) is ~93 KB. */
export const BUSINESS_MAX_BYTES = 256 * 1024;

/** A section's markdown is cut at this many characters (at a line end), with `cut: true`. */
export const SECTION_MAX_CHARS = 2500;

/** A key fact's value is cut at this many characters, at a word, with an ellipsis. */
export const FACT_MAX_CHARS = 200;

/**
 * Reading a fact line (overseer B1, S2):
 * - A label line is `**<label>:** value`, optionally after a `- ` or `* ` list marker. The WHOLE label must
 *   match (case-insensitive): `**Target area:**` never matches `Target`.
 * - The value runs on over the following lines until a blank line, another `**…:**` label line, a heading,
 *   a list item or a table row; the lines are joined with spaces, markdown emphasis/links/code marks removed,
 *   then cut at FACT_MAX_CHARS. Plain text only, never HTML.
 * - First match in the file wins; then profile.md where `profileLabel` is set.
 * - Missing when empty, a template placeholder (contains `{` and `}`), or when it STARTS WITH (case-insensitive)
 *   one of PLACEHOLDER_STARTS. A missing fact is left out of the strip (never "Not set").
 * - `when`: 'always', or the card's `service` must include one of these. Budget is PPC only, so the strip
 *   never shows our own fees on an SEO, website or hosting project (overseer B3).
 */
export const PLACEHOLDER_STARTS = [
  'not provided',
  'not supplied',
  'not set',
  'not known',
  'n/a',
  'not applicable',
  'tbc',
  'unknown',
] as const;

export const KEY_FACTS = [
  {
    id: 'contact',
    words: 'Main contact',
    labels: ['Main contact'],
    profileLabel: 'Main contact',
    when: 'always',
  },
  { id: 'comms', words: 'Prefers', labels: ['Preferred comms'], profileLabel: null, when: 'always' },
  {
    id: 'services',
    words: 'We do',
    labels: ['Services we provide'],
    profileLabel: 'Services',
    when: 'always',
  },
  { id: 'kpi', words: 'Judged on', labels: ['Primary KPI'], profileLabel: null, when: 'always' },
  { id: 'target', words: 'Target', labels: ['Target'], profileLabel: null, when: 'always' },
  { id: 'budget', words: 'Monthly budget', labels: ['Monthly budget'], profileLabel: null, when: ['ppc'] },
  { id: 'reporting', words: 'Reporting', labels: ['Reporting'], profileLabel: null, when: 'always' },
] as const satisfies readonly {
  id: string;
  words: string;
  labels: readonly string[];
  profileLabel: string | null;
  when: 'always' | readonly string[];
}[];

export type KeyFactId = (typeof KEY_FACTS)[number]['id'];

export interface KeyFact {
  id: KeyFactId;
  /** The strip's label (UK English, from KEY_FACTS.words). */
  words: string;
  /** Plain text. Never HTML. */
  value: string;
  from: 'business' | 'profile';
}

/**
 * Which sections a project shows, by heading text (case-insensitive, whole heading, `##` or `###`; a heading
 * may carry trailing text in brackets, e.g. "Budget (updated 2026-10)", which is ignored for matching).
 * `always` shows for every client project; a list shows when the card's `service` includes one of them.
 * `file` says which file the heading is looked for in.
 * - A `###` heading takes its own body, up to the next `###` or `##`.
 * - A `##` heading takes its body up to the next `##`, LEAVING OUT any `###` subsection whose heading starts
 *   with "Contract" (overseer B2: contract terms, fees and notice periods sit under Working Relationship in
 *   6 files).
 * - Headings inside a body become bold lines. HTML comments are removed.
 * - A section whose every non-empty line is a placeholder (see PLACEHOLDER_STARTS) is skipped.
 * - Page order follows this list, not the file. Sections not found are skipped silently.
 * `open`: shown unfolded (only "Where they stand", often the only content there is).
 */
export const SECTION_RULES: {
  heading: string;
  title: string;
  when: 'always' | string[];
  file: 'business' | 'profile';
  open?: boolean;
}[] = [
  { heading: 'Where they stand', title: 'Where they stand', when: 'always', file: 'profile', open: true },
  { heading: 'What We Sell', title: 'What they sell', when: 'always', file: 'business' },
  { heading: 'Who We Sell To', title: 'Who they sell to', when: 'always', file: 'business' },
  { heading: 'Primary Focus', title: 'Current focus', when: 'always', file: 'business' },
  { heading: 'Performance Targets', title: 'Targets', when: ['ppc', 'seo'], file: 'business' },
  { heading: 'Budget', title: 'Budget', when: ['ppc'], file: 'business' },
  {
    heading: 'Marketing strategy',
    title: 'Marketing strategy',
    when: ['ppc', 'seo', 'social-email'],
    file: 'business',
  },
  { heading: 'Market & Niche', title: 'Market and niche', when: ['ppc', 'seo'], file: 'business' },
  { heading: 'Competitive Landscape', title: 'Competitors', when: ['ppc', 'seo'], file: 'business' },
  { heading: 'Brand & Voice', title: 'Brand and voice', when: ['seo', 'social-email'], file: 'business' },
  { heading: 'Working Relationship', title: 'Working with them', when: 'always', file: 'business' },
];

export interface BusinessSection {
  /** From SECTION_RULES.title. */
  title: string;
  /** The heading as matched in SECTION_RULES (for later deep links). */
  heading: string;
  /** The section's own markdown. Shown through the sanitised Markdown component. */
  markdown: string;
  cut: boolean;
  open: boolean;
  from: 'business' | 'profile';
}

/**
 * Who an email from the project can go to ("Write an email", 2026-11-25). Read from the same two files, read
 * only, every time the project opens; nothing is stored or copied.
 *
 * Where the reader looks (business.md first, then profile.md):
 * - a label line whose label ends with "contact" or "contacts" (`**Main contact:**`, `- **Other contacts:**`),
 *   with its wrapped value; a label with no value of its own takes the list or table straight under it;
 * - a `##`, `###` or `####` section whose heading ends with "contact" or "contacts", or is "People" or
 *   "Key people", up to the next heading of its level or above: each list item, table row and paragraph.
 * An email address anywhere else in the files is never picked up.
 *
 * One contact per address (compared without case; the first spelling is kept). The name is the bold name or
 * the leading words of the line, list item or table row the address sits in; null when none reads as a name,
 * and the picker then shows the address alone. A list item or table row whose name is struck through
 * (`~~Name~~`: they have left) is skipped. `main` is true for a "Main contact" or "Primary contact" label, or
 * a line that says "main contact" or "primary contact". Main contacts come first, then file order, cut at
 * BUSINESS_CONTACTS_MAX. Addresses at `example.com`, `example.org` and `example.net`, and any ending `.test`,
 * `.example` or `.invalid`, are template text and are left out.
 */
export interface BusinessContact {
  /** Plain text, at most CONTACT_NAME_MAX characters. Never HTML or markdown. */
  name: string | null;
  /** One address in a strict shape (letters, digits and `._%+-` before the @, a dotted host after). */
  email: string;
  main: boolean;
}

/** The picker is a short list (a native select). */
export const BUSINESS_CONTACTS_MAX = 12;
export const CONTACT_NAME_MAX = 60;

/** `GET ROUTES.projectBusiness?key=<ProjectKey>` → this. */
export interface ProjectBusinessResponse {
  /**
   * 'none': not a live client project (INTERNAL_CLIENT, personal, legacy, archived) → the page shows no card.
   * 'missing': a client project whose client has no business.md and profile.md gave nothing either.
   * 'unreadable': business.md exists but failed the safe read (too big, a link, outside the brain, unreadable).
   * 'ok' with no facts and no sections is valid (overseer B4): the file isn't in the usual layout; the page
   * says so and offers "Open the business file".
   */
  state: 'ok' | 'none' | 'missing' | 'unreadable';
  /**
   * The client (null for 'none'). `status` is profile.md's frontmatter `status:` (active, prospect, ended…)
   * when present, for the CRM later; not shown yet.
   */
  client: { slug: string; name: string; status: string | null } | null;
  /** Brain-relative path of business.md, for "Open the business file", when it exists and passed the safe read. */
  path: string | null;
  facts: KeyFact[];
  sections: BusinessSection[];
  /**
   * The client's contacts that have an email address (see BusinessContact). Optional: an older server sends
   * none, and the page then offers "Write an email" with nobody filled in, as before. Read from whichever of
   * the two files passed the safe read, so 'missing' and 'unreadable' can still carry profile.md's contacts;
   * always empty for 'none'.
   */
  contacts?: BusinessContact[];
}

// ROUTES addition (shared/contract.ts): projectBusiness: '/api/projects/business' (GET).
// Brain service (server/brain/index.ts): projectBusiness?: ProjectBusinessRead.
export type ProjectBusinessRead = (key: ProjectKey) => Promise<ProjectBusinessResponse>;
