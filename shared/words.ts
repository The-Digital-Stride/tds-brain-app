/**
 * Wording shared by the server and the screens: how a folder or file name is shown as words.
 */

/** Short forms shown in capitals, or in a spelling of their own, wherever a name becomes words. */
const SPELLINGS: ReadonlyMap<string, string> = new Map(
  [
    'AEO',
    'AI',
    'API',
    'CMS',
    'CPA',
    'CRM',
    'CSV',
    'GA4',
    'GBP',
    'HTML',
    'KPI',
    'LP',
    'MCC',
    'OS',
    'PDF',
    'PMax',
    'PPC',
    'QA',
    'R4R',
    'ROI',
    'RSA',
    'SEO',
    'TDS',
    'UC',
    'UI',
    'URL',
    'UX',
  ].map((w) => [w.toLowerCase(), w]),
);

/** "Tds doc" becomes "TDS doc". Whole words only, so "email" and "costs" are left alone. */
export function keepAcronyms(text: string): string {
  return text.replace(/[A-Za-z0-9]+/g, (w) => SPELLINGS.get(w.toLowerCase()) ?? w);
}

/** A folder name as words: "uc-ai-search" becomes "UC AI search". */
export function slugWords(slug: string): string {
  const s = slug.replace(/[-_]+/g, ' ').trim();
  return s === '' ? slug : keepAcronyms(s.charAt(0).toUpperCase() + s.slice(1));
}
