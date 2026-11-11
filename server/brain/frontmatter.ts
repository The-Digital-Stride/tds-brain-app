export type FrontmatterValue = string | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  /** Everything after the frontmatter block, with line ends normalised to \n. */
  body: string;
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function splitInlineList(v: string): string[] {
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of v) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') {
      items.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  items.push(cur.trim());
  return items.filter((x) => x !== '');
}

/**
 * A small tolerant reader for the YAML-ish frontmatter the brain uses: `key: value` lines, quoted
 * values, `[a, b]` lists, `- item` lists and `>` / `|` block text. Anything it cannot read is
 * skipped. It never throws.
 */
export function parseFrontmatter(text: string): Frontmatter {
  try {
    const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    if (lines[0]?.trim() !== '---') return { data: {}, body: src };
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === '---') {
        end = i;
        break;
      }
    }
    if (end === -1) return { data: {}, body: src };
    const body = lines.slice(end + 1).join('\n');
    const data: Record<string, FrontmatterValue> = {};
    for (let i = 1; i < end; i++) {
      const line = lines[i] ?? '';
      const m = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1] as string;
      const rest = (m[2] ?? '').trim();
      if (rest === '' || /^[>|][+-]?$/.test(rest)) {
        const folded = rest.startsWith('>');
        const items: string[] = [];
        const textLines: string[] = [];
        while (i + 1 < end) {
          const next = lines[i + 1] ?? '';
          if (next.trim() !== '' && !/^\s/.test(next) && !/^-\s/.test(next)) break;
          i++;
          const t = next.trim();
          if (/^-\s/.test(t) && rest === '') items.push(unquote(t.slice(1)));
          else if (t !== '') textLines.push(t);
        }
        if (items.length > 0) data[key] = items;
        else data[key] = textLines.join(folded || rest === '' ? ' ' : '\n');
      } else if (rest.startsWith('[') && rest.endsWith(']')) {
        data[key] = splitInlineList(rest.slice(1, -1));
      } else {
        data[key] = unquote(rest);
      }
    }
    return { data, body };
  } catch {
    return { data: {}, body: String(text) };
  }
}

/** The value as a single string ('' when absent; lists are joined with commas). */
export function asString(v: FrontmatterValue | undefined): string {
  if (v === undefined) return '';
  return Array.isArray(v) ? v.join(', ') : v;
}
