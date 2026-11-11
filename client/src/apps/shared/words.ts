/** "184 KB" below a megabyte, "2.4 MB" above. */
export function sizeWords(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1000));
  // Round first: 999,500 bytes is "1.0 MB", never "1000 KB".
  return kb < 1000 ? `${kb} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "3 Nov 2026" from "2026-11-03". */
export function dateWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    (m ?? 1) - 1
  ];
  return `${d} ${month} ${y}`;
}

/** "1 image", "24 images": the count with the right form of the noun. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n.toLocaleString('en-GB')} ${many}`;
}

/** "2 images selected", or with some out of sight "2 images selected, 1 hidden by the filter". */
export function selectionWords(count: string, hidden: number): string {
  const base = `${count} selected`;
  return hidden > 0 ? `${base}, ${hidden} hidden by the filter` : base;
}

export interface FolderGroup<T> {
  folder: string;
  items: T[];
}

/** Groups by folder in the given order; a folder it does not know goes last. Empty ones are left out. */
export function groupByFolder<T extends { folder: string }>(items: T[], order: string[]): FolderGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.folder);
    if (list) list.push(item);
    else groups.set(item.folder, [item]);
  }
  const rank = (folder: string) => {
    const i = order.indexOf(folder);
    return i === -1 ? order.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([folder, list]) => ({ folder, items: list }));
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
