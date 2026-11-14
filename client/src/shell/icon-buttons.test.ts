import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The tooltip standard (docs/design-system.md, "Tooltips"): every button that shows only an icon gets a tooltip
 * from the shared layer (`Tooltips.tsx`). That needs an `aria-label` plus the `icon-btn` or `chip-remove` class,
 * or a `data-tip`; and no native `title`, which would show a second, browser-drawn tooltip.
 */
const SRC = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : [];
  });
}

/** The `<button …>` opening tag and what is between it and `</button>`, for every button in a file. */
function buttons(text: string): { open: string; inner: string; line: number }[] {
  const out: { open: string; inner: string; line: number }[] = [];
  const start = /<button\b/g;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    // The opening tag ends at the first `>` outside braces.
    let depth = 0;
    let i = m.index;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const close = text.indexOf('</button>', i);
    if (close < 0) continue;
    out.push({
      open: text.slice(m.index, i + 1),
      inner: text.slice(i + 1, close),
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** Only an icon: an `<Icon … />` and nothing a person can read. */
function iconOnly(inner: string): boolean {
  if (!/<Icon\b/.test(inner)) return false;
  const rest = inner
    .replace(/<Icon\b[^>]*\/>/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\s+/g, '');
  return rest === '';
}

describe('icon-only buttons', () => {
  const found = sources(SRC).flatMap((file) =>
    buttons(readFileSync(file, 'utf8'))
      .filter((b) => iconOnly(b.inner))
      .map((b) => ({ ...b, where: `${relative(SRC, file)}:${b.line}` })),
  );

  it('finds the ones the app has (so the scan itself still works)', () => {
    expect(found.length).toBeGreaterThan(15);
  });

  it('each gets a tooltip from the shared layer: a label and the icon-button class, or data-tip', () => {
    const missing = found
      .filter((b) => {
        const named = /\baria-label=/.test(b.open);
        const styled = /className=["{`][^"}`]*\b(icon-btn|chip-remove)\b/.test(b.open);
        return !(/\bdata-tip=/.test(b.open) || (named && styled));
      })
      .map((b) => b.where);
    expect(missing).toEqual([]);
  });

  it('every icon button has a name for its tooltip, whatever is inside it', () => {
    const unnamed = sources(SRC).flatMap((file) =>
      buttons(readFileSync(file, 'utf8'))
        .filter((b) => /className=["{`][^"}`]*\b(icon-btn|chip-remove)\b/.test(b.open))
        .filter((b) => !/\b(aria-label|data-tip)=/.test(b.open))
        .map((b) => `${relative(SRC, file)}:${b.line}`),
    );
    expect(unnamed).toEqual([]);
  });

  it('none uses the native title, which would show a second tooltip', () => {
    expect(found.filter((b) => /\stitle=/.test(b.open)).map((b) => b.where)).toEqual([]);
  });
});
