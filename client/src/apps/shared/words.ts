/** "184 KB" below a megabyte, "2.4 MB" above. */
export function sizeWords(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1000));
  // Round first: 999,500 bytes is "1.0 MB", never "1000 KB".
  return kb < 1000 ? `${kb} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Nov 2026" from an ISO date or time, as the day reads in London. Empty when it is not a date. */
export function dateWords(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${part('day')} ${MONTHS[part('month') - 1]} ${part('year')}`;
}

/** "1 image", "24 images": the count with the right form of the noun. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n.toLocaleString('en-GB')} ${many}`;
}

/** "2 images selected", or with some out of sight "2 images selected, 1 hidden by your search". */
export function selectionWords(count: string, hidden: number, by = 'your search'): string {
  const base = `${count} selected`;
  return hidden > 0 ? `${base}, ${hidden} hidden by ${by}` : base;
}

/** True when every word of the search is somewhere in the text. */
export function matchesWords(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
