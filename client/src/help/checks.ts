/** The help standard's checks (docs/help-standard.md), as pure functions. Each returns plain problem sentences; [] is a pass. */
import {
  HELP_CALLOUTS_MAX,
  HELP_FREEFORM_AREAS,
  HELP_FREEFORM_PAGES,
  HELP_GLOSSARY_MAX,
  HELP_GRADE_MAX,
  HELP_HEADINGS,
  HELP_IMAGE_MAX_BYTES,
  HELP_PAGE_MAX_WORDS,
  HELP_PAGE_MIN_WORDS,
  HELP_SENTENCE_MAX_WORDS,
  type HelpShot,
  type HelpTopic,
} from './contract.ts';
import { fkGrade, glossaryTerms, prose, sentences, words } from './readability.ts';

const stripCode = (md: string) =>
  md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`]*`/g, '');

export function checkTopicIds(fileIds: readonly string[], topicIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of fileIds) if (!topicIds.includes(id)) out.push(`Page "${id}" is not listed in topics.ts.`);
  for (const id of topicIds)
    if (!fileIds.includes(id)) out.push(`topics.ts lists "${id}" but help/${id}.md does not exist.`);
  return out;
}

/** Free-form: no fixed headings and no word range (reading, spelling and jargon are still checked). */
export const isFreeform = (topic: HelpTopic): boolean =>
  HELP_FREEFORM_AREAS.includes(topic.area) || HELP_FREEFORM_PAGES.includes(topic.id);

export function checkHeadings(topic: HelpTopic): string[] {
  if (isFreeform(topic)) return [];
  const found = [...stripCode(topic.body).matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1] as string);
  const ok = found.length >= 3 && found.length <= 5 && found.every((h, i) => h === HELP_HEADINGS[i]);
  if (ok) return [];
  return [
    `${topic.id}: headings are "${found.join('", "')}"; they must be ${HELP_HEADINGS.join(', ')} in order (the last two may be left out).`,
  ];
}

export function checkSentences(topic: HelpTopic): string[] {
  const out: string[] = [];
  for (const s of sentences(prose(topic.body))) {
    const n = words(s).length;
    if (n > HELP_SENTENCE_MAX_WORDS)
      out.push(
        `${topic.id}: a sentence has ${n} words (limit ${HELP_SENTENCE_MAX_WORDS}): "${s.slice(0, 60)}..."`,
      );
  }
  return out;
}

export function checkLength(topic: HelpTopic): string[] {
  if (isFreeform(topic)) return [];
  const n = words(prose(topic.body)).length;
  if (n < HELP_PAGE_MIN_WORDS || n > HELP_PAGE_MAX_WORDS)
    return [
      `${topic.id}: ${n} words of prose; a feature page needs ${HELP_PAGE_MIN_WORDS} to ${HELP_PAGE_MAX_WORDS}.`,
    ];
  return [];
}

/** `terms` are the glossary's: they count as one syllable each. */
export function checkGrade(topic: HelpTopic, terms: readonly string[] = []): string[] {
  const g = fkGrade(prose(topic.body), terms);
  return g > HELP_GRADE_MAX ? [`${topic.id}: reading grade ${g.toFixed(1)} is above ${HELP_GRADE_MAX}.`] : [];
}

/** The glossary may define at most HELP_GLOSSARY_MAX terms, so leaving them out of the score stays honest. */
export function checkGlossary(markdown: string): string[] {
  const n = glossaryTerms(markdown).length;
  return n > HELP_GLOSSARY_MAX ? [`glossary.md defines ${n} terms; the limit is ${HELP_GLOSSARY_MAX}.`] : [];
}

/** US spellings (UK is the rule for text people read). "license" is left out: it is right as a verb. */
export const US_SPELLINGS = [
  'color',
  'colors',
  'colored',
  'organize',
  'organizes',
  'organized',
  'organization',
  'organizations',
  'favorite',
  'favorites',
  'center',
  'centers',
  'centered',
  'behavior',
  'behaviors',
  'canceled',
  'canceling',
  'gray',
  'analyze',
  'analyzes',
  'analyzed',
  'customize',
  'customizes',
  'customized',
  'recognize',
  'recognizes',
  'recognized',
  'prioritize',
  'prioritizes',
  'prioritized',
  'optimize',
  'optimizes',
  'optimized',
  'labeled',
  'labeling',
  'catalog',
  'catalogs',
  'summarize',
  'summarizes',
  'summarized',
  'synchronize',
  'synchronized',
  'realize',
  'realized',
  'minimize',
  'maximize',
  'apologize',
  'authorize',
  'authorized',
  'initialize',
  'normalize',
  'personalize',
  'personalized',
  'utilize',
  'program',
  'defense',
  'neighbor',
  'honor',
  'flavor',
];
// "program" is a real UK word for software; keep it out of the list.
const US = US_SPELLINGS.filter((w) => w !== 'program');

export function checkSpelling(topic: HelpTopic): string[] {
  const text = stripCode(topic.body).toLowerCase();
  const hits = new Set<string>();
  for (const w of US) if (new RegExp(`\\b${w}\\b`).test(text)) hits.add(w);
  return [...hits].map((w) => `${topic.id}: "${w}" is US spelling; use UK English.`);
}

/** docs/help-standard.md section 1, plus the banned names. */
export const BANNED_JARGON = [
  'API',
  'endpoint',
  'SDK',
  'frontmatter',
  'repo',
  'cache',
  'session id',
  'token',
  'tokens',
  'Brain app',
  'Cortex brain',
];

export function checkJargon(topic: HelpTopic): string[] {
  const out: string[] = [];
  const text = stripCode(topic.body);
  for (const term of BANNED_JARGON) {
    const re = new RegExp(`(?<![A-Za-z-])${term.replace(/ /g, '\\s+')}(?![A-Za-z-])`, 'i');
    if (!re.test(text)) continue;
    // "token" is allowed only for how full a chat is, for the Settings heading "Tokens saved", and in the glossary.
    if (
      /^tokens?$/.test(term) &&
      (/how full/i.test(text) || /tokens saved/i.test(text) || topic.id === 'glossary')
    )
      continue;
    out.push(`${topic.id}: "${term}" is on the banned list.`);
  }
  return out;
}

/** Bold text that is not a button label: keyboard words. */
export const KEYBOARD_ALLOW = [
  'Enter',
  'Return',
  'Esc',
  'Escape',
  'Shift',
  'Ctrl',
  'Control',
  'Cmd',
  'Command',
  'Option',
  'Alt',
  'Tab',
  'Space',
  'Delete',
];

const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&apos;|&#39;|\\'/g, "'");

export function boldLabels(body: string): string[] {
  return [...stripCode(body).matchAll(/\*\*([^*\n]+?)\*\*/g)]
    .map((m) => (m[1] as string).trim())
    .filter((l) => words(l).length <= 6 && !/[.:;!]$/.test(l));
}

/** Every bold button label must appear in the app's text (`appText` is the joined client source, minus help and tests). */
export function checkBoldLabels(
  topic: HelpTopic,
  appText: string,
  allow: readonly string[] = KEYBOARD_ALLOW,
): string[] {
  const hay = norm(appText);
  const out: string[] = [];
  for (const label of new Set(boldLabels(topic.body))) {
    if (allow.includes(label) || label.length === 1) continue;
    if (!hay.includes(norm(label))) out.push(`${topic.id}: bold "${label}" is not a label found in the app.`);
  }
  return out;
}

export function checkRelated(topic: HelpTopic, ids: readonly string[]): string[] {
  return topic.related
    .filter((r) => !ids.includes(r))
    .map((r) => `${topic.id}: related page "${r}" does not exist.`);
}

export interface ImageInfo {
  bytes: number;
}

/** Every `images/x.webp` the page uses: exists, has alt text, is a listed shot with the same alt, is small, has few callouts. */
export function checkImages(
  topic: HelpTopic,
  files: ReadonlyMap<string, ImageInfo>,
  shots: readonly HelpShot[],
): string[] {
  const out: string[] = [];
  for (const m of stripCode(topic.body).matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const alt = (m[1] as string).trim();
    const src = m[2] as string;
    const name = /^images\/([^/]+\.webp)$/.exec(src)?.[1];
    if (!name) {
      out.push(`${topic.id}: image "${src}" must be images/<name>.webp.`);
      continue;
    }
    const id = name.replace(/\.webp$/, '');
    if (!alt) out.push(`${topic.id}: image ${name} has no alt text.`);
    const file = files.get(name);
    if (!file) out.push(`${topic.id}: image ${name} does not exist in help/images.`);
    else if (file.bytes > HELP_IMAGE_MAX_BYTES)
      out.push(`${topic.id}: image ${name} is ${file.bytes} bytes; the limit is ${HELP_IMAGE_MAX_BYTES}.`);
    const shot = shots.find((s) => s.id === id);
    if (!shot) out.push(`${topic.id}: image ${name} is not listed in help/shots.json.`);
    else {
      if (alt && shot.alt !== alt)
        out.push(`${topic.id}: alt text of ${name} differs from its shots.json alt.`);
      if ((shot.callouts?.length ?? 0) > HELP_CALLOUTS_MAX)
        out.push(
          `${topic.id}: shot ${id} has ${shot.callouts?.length} callouts; the limit is ${HELP_CALLOUTS_MAX}.`,
        );
    }
  }
  return out;
}
