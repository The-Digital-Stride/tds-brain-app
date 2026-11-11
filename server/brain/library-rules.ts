/**
 * The library's rules (plan decisions 1 to 3): which files are listed, what kind each is, which card
 * it goes in, and the places that are never listed. Pure functions only, so every rule can be tested
 * without a disk. Paths here use forward slashes.
 */
import type { DocFormat, LibraryKind, LibraryScope, LibraryView } from '../../shared/contract.ts';
import { keepAcronyms } from '../../shared/words.ts';
import { humanise } from './util.ts';

export interface GroupRule {
  /** A folder path inside a scope, lower case, ending in a slash. */
  prefix: string;
  group: string;
}

/** Ordered: the first matching prefix wins, and the cards are shown in this order. */
export const RULES: readonly GroupRule[] = [
  { prefix: 'reports/', group: 'Reports' },
  { prefix: 'plans/', group: 'Plans' },
  { prefix: 'briefs/', group: 'Briefs' },
  { prefix: 'call-notes/', group: 'Call notes' },
  { prefix: 'notes/', group: 'Notes' },
  { prefix: 'context/brand/', group: 'Brand' },
  { prefix: 'context/reference/', group: 'Reference' },
  { prefix: 'context/analysis/', group: 'Analysis' },
  { prefix: 'landing-pages/', group: 'Landing pages' },
  { prefix: 'created/', group: 'Ad builds' },
  { prefix: 'website/', group: 'Website' },
  // A client's CRM work (field maps, scripts). `crm/data/` itself is never listed.
  { prefix: 'crm/', group: 'CRM' },
];

export const OTHER_GROUP = 'Other';

export interface FileClass {
  kind: LibraryKind;
  format: DocFormat | null;
  view: LibraryView | null;
}

const IMAGE: FileClass = { kind: 'image', format: null, view: 'image' };

const CLASSES: Readonly<Record<string, FileClass>> = {
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  webp: IMAGE,
  gif: IMAGE,
  avif: IMAGE,
  svg: IMAGE,
  pdf: { kind: 'document', format: 'pdf', view: 'pdf' },
  md: { kind: 'document', format: 'doc', view: 'text' },
  txt: { kind: 'document', format: 'doc', view: 'text' },
  docx: { kind: 'document', format: 'doc', view: null },
  html: { kind: 'document', format: 'doc', view: 'page' },
  htm: { kind: 'document', format: 'doc', view: 'page' },
  csv: { kind: 'document', format: 'sheet', view: null },
  xlsx: { kind: 'document', format: 'sheet', view: null },
  pptx: { kind: 'document', format: 'deck', view: null },
};

/** What a file is, from its extension (no dot, any case). Null: not listed. */
export function classify(ext: string): FileClass | null {
  const key = ext.toLowerCase();
  return Object.hasOwn(CLASSES, key) ? (CLASSES[key] ?? null) : null;
}

/** "Report.PDF" gives "pdf"; a name with no dot, or only a leading one, gives ''. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * True for a path (from the brain's root) that must never be listed or served: any empty, `.` or
 * `..` segment, any name starting with a dot, `node_modules`, `clients/_*`, and inside a client a
 * `config/`, `crm/data/` or `context/google-ads/data/` folder. Case is ignored throughout.
 */
export function isNeverListed(relFromRoot: string): boolean {
  if (relFromRoot === '' || relFromRoot.includes('\\') || relFromRoot.includes('\0')) return true;
  const segs = relFromRoot.toLowerCase().split('/');
  for (const s of segs) {
    if (s === '' || s.startsWith('.') || s === 'node_modules') return true;
  }
  if (segs[0] === 'clients') {
    if (segs[1]?.startsWith('_')) return true;
    // The folders themselves count too, so a walk never goes into them.
    const [a, b, c] = segs.slice(2);
    if (a === 'config') return true;
    if (a === 'crm' && b === 'data') return true;
    if (a === 'context' && b === 'google-ads' && c === 'data') return true;
  }
  return false;
}

/**
 * The card for a file, from its path inside the scope. Clients use the rules first; personal files
 * are always grouped by their first folder. A file loose in the scope's root goes in "Other".
 */
export function groupFor(relInScope: string, kind: LibraryScope['kind']): string {
  const lower = relInScope.toLowerCase();
  if (kind !== 'personal') {
    for (const r of RULES) if (lower.startsWith(r.prefix)) return r.group;
  }
  const slash = relInScope.indexOf('/');
  if (slash <= 0) return OTHER_GROUP;
  return humanise(relInScope.slice(0, slash));
}

/** The cards in display order: rule cards in rule order, then the rest A to Z, then "Other". */
export function orderGroups(groups: Iterable<string>, kind: LibraryScope['kind']): string[] {
  const present = new Set(groups);
  const ruled = kind === 'personal' ? [] : RULES.map((r) => r.group).filter((g) => present.has(g));
  const ruledSet = new Set(ruled);
  const rest = [...present]
    .filter((g) => g !== OTHER_GROUP && !ruledSet.has(g))
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return [...ruled, ...rest, ...(present.has(OTHER_GROUP) ? [OTHER_GROUP] : [])];
}

/** "2026-11-02-keywords.csv" becomes "Keywords"; a name that is only a date keeps it. */
export function tidyFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : name;
  base = base.replace(/^(\d{4}-\d{2}-\d{2}|\d{8})[-_ ]+(?=\S)/, '');
  if (/^(\d{4}-\d{2}-\d{2}|\d{8})$/.test(base)) return base;
  const s = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? name : keepAcronyms(s.charAt(0).toUpperCase() + s.slice(1));
}
