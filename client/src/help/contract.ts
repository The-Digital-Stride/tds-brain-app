/**
 * TDS Cortex help: the types every help part builds against (plan docs/plans/2026-11-15-cortex-help-phase-1.md).
 * Help pages are Markdown files in /help at the repo root, bundled into the client; nothing here talks to the server.
 * Words for people follow docs/help-standard.md (UK English, readable by a 16-year-old).
 */
import type { DrawerName } from '../shell/contract.ts';

/** Areas, in the order the Help drawer and the Guide list them. */
export const HELP_AREAS = [
  'getting-started',
  'home',
  'chats',
  'todos',
  'team',
  'skills',
  'files',
  'getting-around',
  'settings',
  'help',
] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

export const HELP_AREA_LABELS: Record<HelpArea, string> = {
  'getting-started': 'Getting started',
  home: 'Home',
  chats: 'Chats',
  todos: 'To-dos',
  team: 'Working as a team',
  skills: 'Skills',
  files: 'Files',
  'getting-around': 'Getting around',
  settings: 'Settings',
  help: 'Help',
};

/** `all`, or the roles a page is written for (everyone can still read it: plan decision 11). */
export type HelpRoles = 'all' | readonly ('owner' | 'scout')[];

/** The frontmatter of one help file, parsed and checked. */
export interface HelpMeta {
  /** Kebab-case; equals the file name without `.md`. */
  id: string;
  title: string;
  area: HelpArea;
  /** Position within the area; lower first. */
  order: number;
  /** ≤ HELP_SUMMARY_MAX characters. Shown in lists and search. */
  summary: string;
  /** One sentence: why it helps. */
  benefit: string;
  roles: HelpRoles;
  /** Ids of other pages. */
  related: readonly string[];
  /** App version the page was added in, e.g. "0.36.0". */
  since: string;
  /** ISO date the page was last checked against the app. */
  reviewed: string;
}

export interface HelpTopic extends HelpMeta {
  /** Markdown after the frontmatter. Images use `images/<name>.webp`; links to other pages use `help:<id>`. */
  body: string;
}

export const HELP_SUMMARY_MAX = 90;
export const HELP_SENTENCE_MAX_WORDS = 25;
export const HELP_PAGE_MIN_WORDS = 120;
export const HELP_PAGE_MAX_WORDS = 350;
export const HELP_GRADE_MAX = 9;
export const HELP_IMAGE_MAX_BYTES = 150 * 1024;
export const HELP_CALLOUTS_MAX = 4;
/** The five headings of a feature page, in order. The last two may be left out. */
export const HELP_HEADINGS = [
  'What it does',
  'Why it helps',
  'How to use it',
  'Good to know',
  'Try this',
] as const;
/** Pages that are free-form (decision: "Getting started" pages keep the reading rules but not the headings). */
export const HELP_FREEFORM_AREAS: readonly HelpArea[] = ['getting-started'];
/** Where the Help drawer opens when nothing more specific fits. */
export const HELP_FALLBACK_ID = 'welcome';

/** parseHelpFile's answer. `errors` are plain sentences naming the file and the rule broken. */
export type ParseResult = { ok: true; topic: HelpTopic } | { ok: false; errors: string[] };
/** Parses one file's raw text. `fileName` is e.g. "todos.md". Pure. */
export type ParseHelpFile = (fileName: string, raw: string) => ParseResult;

export interface HelpGroup {
  area: HelpArea;
  label: string;
  topics: readonly HelpTopic[];
}

export interface HelpLibrary {
  /** All pages, by area order then `order` then title. */
  topics: readonly HelpTopic[];
  byId(id: string): HelpTopic | undefined;
  /** Non-empty areas only, in HELP_AREAS order. */
  groups(): readonly HelpGroup[];
  /** Case-insensitive; ranks title matches, then summary, then body. Empty query → []. */
  search(query: string, limit?: number): readonly HelpTopic[];
}

/**
 * Where the person is when they open Help. `view` is the store's View; `home` is the store's 'chat' view
 * with no active chat. `drawer` is the drawer Help replaced (if any).
 */
export interface HelpContext {
  view: 'home' | 'chat' | 'settings' | 'profile' | `app:${string}`;
  drawer: DrawerName | null;
  /** The active chat is waiting on an approval or a question → `approvals-and-questions`. */
  waiting: boolean;
}

/*
 * Modules and exports (builder A makes them; builder B imports them):
 *   library.ts     helpLibrary: HelpLibrary; helpImageUrl(src): string | null; parseHelpFile: ParseHelpFile
 *   context.ts     helpForContext: HelpForContext
 *   visibility.ts  helpVisible(role: Role): boolean        (Phase 1: owner only)
 *   render.ts      renderHelp: RenderHelp
 *   topics.ts      HELP_TOPIC_IDS: readonly string[]
 *   HelpArticle.tsx  HelpArticle({ topic, onOpen }: { topic: HelpTopic; onOpen: (id: string) => void })
 */

/** The page the Help drawer opens on. Always an id that exists in the library (else HELP_FALLBACK_ID). */
export type HelpForContext = (ctx: HelpContext, library: HelpLibrary) => string;

/**
 * One entry in help/shots.json. The screenshot script makes `help/images/<id>.webp`.
 * `scene` names a scripted scene in scripts/help-shots.ts; `crop` and callout `target`s are CSS selectors.
 */
export interface HelpShot {
  id: string;
  scene: string;
  crop: string;
  /** Extra space around the crop, CSS px. Default 16. */
  pad?: number;
  /** At most HELP_CALLOUTS_MAX. `n` is 1, 2, 3, 4 in order. */
  callouts?: readonly { n: number; target: string }[];
  /** One sentence, read aloud. Must match the alt text where the image is used. */
  alt: string;
}

/** Turns a help page body into safe HTML. `imageUrl` maps "images/x.webp" to the bundled URL (or null). */
export type RenderHelp = (body: string, imageUrl: (src: string) => string | null) => string;
/** The attribute renderHelp puts on a `help:<id>` link (`<a href="#help-<id>" data-help-id="<id>">`). */
export const HELP_LINK_ATTR = 'data-help-id';
