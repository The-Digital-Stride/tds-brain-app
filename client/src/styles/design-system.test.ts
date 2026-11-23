import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The design system's guard (docs/design-system.md; plan 2026-11-22-ux-consistency, decision 7). It scans the
 * stylesheets and the TSX for drift from what the doc lists: type sizes, radii, layers, raw colours, a class
 * defined twice, a class nothing uses, a class the eager code uses but only a lazy sheet defines, and loose
 * checkboxes and sizes.
 *
 * Each check has a NAMED allowlist of today's remaining offenders with counts ("file value": n). A new offender
 * or a higher count fails and is printed; fixing one fails too until the count is lowered, so the lists only shrink.
 */
const SRC = join(import.meta.dirname, '..');
const ROOT = join(SRC, '..', '..');

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, keep);
    return keep(name) ? [path] : [];
  });
}

const rel = (file: string) => relative(SRC, file);
const read = (file: string) => readFileSync(file, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Source text without its comments, so a class named only in prose does not count as used. */
const readCode = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

const cssFiles = walk(SRC, (n) => n.endsWith('.css'));
const sourceFiles = walk(SRC, (n) => /\.tsx?$/.test(n) && !n.includes('.test.'));
const tsxFiles = sourceFiles.filter((f) => f.endsWith('.tsx'));

type Rule = { selector: string; body: string; top: boolean };

/**
 * Every rule in a stylesheet (comments gone). `top` is false inside an @media, @container or @supports block;
 * an @layer block is not conditional, so it keeps the caller's `top`.
 */
function rules(css: string, top = true): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const at = css.slice(i).search(/\S/);
    if (at >= 0 && css[i + at] === '@') {
      // A statement at-rule (`@layer a, b;`, `@import …;`, `@charset …;`) has no block: skip it, not the next rule.
      const semi = css.indexOf(';', i + at);
      if (semi >= 0 && (open < 0 || semi < open)) {
        i = semi + 1;
        continue;
      }
    }
    if (open < 0) break;
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    const head = css.slice(i, open).trim();
    const body = css.slice(open + 1, end);
    if (head.startsWith('@')) {
      if (/^@layer\b/.test(head)) out.push(...rules(body, top));
      else if (/^@(media|container|supports)\b/.test(head)) out.push(...rules(body, false));
    } else out.push({ selector: head, body, top });
    i = end + 1;
  }
  return out;
}

const parsed = cssFiles.map((file) => ({ file: rel(file), rules: rules(stripComments(read(file))) }));
const notTokens = parsed.filter((p) => p.file !== 'styles/tokens.css');

/**
 * Allowlists hold counts ("file value" -> how many times). A count that rises (or a new key) fails and is
 * printed; a count that falls fails too, until the allowlist is lowered, so the numbers only ever shrink.
 */
type Allow = Record<string, number>;
function check(what: string, found: string[], allowed: Allow) {
  const counts: Allow = {};
  for (const x of found) counts[x] = (counts[x] ?? 0) + 1;
  const fresh = Object.entries(counts)
    .filter(([k, n]) => n > (allowed[k] ?? 0))
    .map(([k, n]) => `${k} ×${n} (allowed ${allowed[k] ?? 0})`)
    .sort();
  const fixed = Object.entries(allowed)
    .filter(([k, n]) => (counts[k] ?? 0) < n)
    .map(([k, n]) => `${k} ×${counts[k] ?? 0} (allowed ${n})`)
    .sort();
  expect({ [`new ${what}`]: fresh, 'fixed, lower the allowlist': fixed }).toEqual({
    [`new ${what}`]: [],
    'fixed, lower the allowlist': [],
  });
}

/** Declarations as [property, value] for every rule in the given sheets. */
function declarations(sheets: typeof parsed) {
  return sheets.flatMap((p) =>
    p.rules.flatMap((r) =>
      r.body
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !d.startsWith('--'))
        .map((d) => {
          const colon = d.indexOf(':');
          return { file: p.file, prop: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
        }),
    ),
  );
}
const allDeclarations = declarations(parsed);

const num = (n: string) => String(Number.parseFloat(n));

// What docs/design-system.md lists --------------------------------------------------------------------------
const TYPE_SIZES = ['11.5', '12', '12.5', '13', '13.5', '14', '15', '18', '26'];
const RADII = ['0', '5', '6', '8', '9', '10', '12', '14', '16', '18'];
const LAYERS = ['5', '8', '39', '40', '41', '45', '50', '60', '70', '71', '72', '80', '200'];

/** Every source file main.tsx reaches through static relative imports (dynamic `import()` is a lazy chunk). */
function eagerFiles(): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readCode(file).matchAll(
      /\b(?:import|export)\s+(?:[^'"();]*?\sfrom\s+)?['"](\.[^'"]*)['"]/g,
    )) {
      const base = join(file, '..', m[1] as string);
      const hit = ['', '.tsx', '.ts', '/index.tsx', '/index.ts']
        .map((x) => base + x)
        .find((f) => sourceSet.has(f));
      if (hit) visit(hit);
    }
  };
  visit(join(SRC, 'main.tsx'));
  return [...seen];
}
const sourceSet = new Set(sourceFiles);

describe('the design system guard: the scanner', () => {
  it('sees a rule after a statement at-rule', () => {
    const r = rules('@charset "utf-8";\n@layer a, b;\n@import url(x.css);\n.x { color: red }');
    expect(r.map((x) => x.selector)).toEqual(['.x']);
  });
  it('treats @layer as top level but @media and @supports as conditional', () => {
    const r = rules(
      '@layer x { .a { color: red } }\n@media (min-width: 1px) { .b { color: red } }\n@supports (a: b) { .c { color: red } }',
    );
    expect(r.map((x) => [x.selector, x.top])).toEqual([
      ['.a', true],
      ['.b', false],
      ['.c', false],
    ]);
  });
  it('still sees a class defined in two layered sheets', () => {
    const sheets = ['@layer a, b;\n@layer a { .dup { color: red } }', '@layer b { .dup { color: blue } }'];
    const tops = sheets.flatMap((c) => rules(c)).filter((r) => r.top && r.selector === '.dup');
    expect(tops.length).toBe(2);
  });
});

describe('the design system guard: layers', () => {
  const LAYER_NAMES = ['tokens', 'primitives', 'patterns', 'features', 'tools'];

  it('tokens.css, the first sheet main.tsx imports, declares the layer order', () => {
    const first = [...read(join(SRC, 'main.tsx')).matchAll(/import '\.\/([^']+\.css)'/g)].map(
      (m) => m[1] as string,
    )[0] as string;
    expect(first).toBe('styles/tokens.css');
    expect(
      stripComments(read(join(SRC, first)))
        .trim()
        .startsWith(`@layer ${LAYER_NAMES.join(', ')};`),
    ).toBe(true);
  });

  it('every stylesheet keeps its rules in one named layer (only @font-face may sit outside)', () => {
    const found: string[] = [];
    for (const file of cssFiles) {
      let css = stripComments(read(file));
      css = css.replace(/@layer [a-z, ]+;/, '');
      // Top-level blocks: scan by depth.
      const heads: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < css.length; i++) {
        if (css[i] === '{') {
          if (depth === 0) heads.push(css.slice(start, i).trim());
          depth++;
        } else if (css[i] === '}' && --depth === 0) start = i + 1;
      }
      for (const head of heads) {
        const layer = head.match(/^@layer (\w+)$/)?.[1];
        if (!(layer && LAYER_NAMES.includes(layer)) && head !== '@font-face')
          found.push(`${rel(file)} ${head}`);
      }
      if (!heads.some((h) => h.startsWith('@layer ')) && css.trim() !== '')
        found.push(`${rel(file)} has no layer`);
    }
    check('unlayered rules', found, {});
  });
});

describe('the design system guard: scales', () => {
  it('finds the stylesheets and declarations (so the scan itself still works)', () => {
    expect(cssFiles.length).toBeGreaterThan(15);
    expect(allDeclarations.length).toBeGreaterThan(2000);
    expect(allDeclarations.some((d) => d.prop === 'font-size' && d.value === 'var(--fs-body)')).toBe(true);
  });

  // Sheets swept onto the tokens in Release 4 (plan 2026-11-22-ux-consistency, decision 24): a raw size here,
  // even one on the scale, fails. base.css and todo-panel.css still hold one-off colours, so they aren't locked.
  const LOCKED = [
    'styles/primitives.css',
    'styles/patterns.css',
    'styles/library-shared.css',
    'styles/viewer.css',
    'styles/projects.css',
    'styles/ad-manager.css',
    'styles/command.css',
    'styles/summary.css',
    'apps/shared/library.css',
    'apps/documents/documents.css',
    'styles/chat.css',
    'styles/shell.css',
    'styles/drawers.css',
    'styles/home.css',
    'styles/palette.css',
    'styles/search-select.css',
    'styles/help.css',
    'styles/guide.css',
    'styles/tour.css',
    'styles/sections.css',
    'styles/settings.css',
  ];
  it('locked sheets take font sizes, radii and layers from tokens only', () => {
    const locked = allDeclarations.filter((d) => LOCKED.includes(d.file));
    expect(new Set(locked.map((d) => d.file)).size).toBe(LOCKED.length);
    const found = locked.flatMap((d) => {
      if (d.prop === 'font-size' || d.prop === 'font')
        // The `/ line-height` part of the shorthand isn't a size.
        return (d.value.replace(/\/\s*\S+/, '').match(/(?<![\w.-])[\d.]+px/g) ?? []).map(
          (v) => `${d.file} font ${v}`,
        );
      if (/^border(-[a-z]+)*-radius$/.test(d.prop))
        return (d.value.match(/(?<![\w.-])[\d.]+px/g) ?? [])
          .filter((v) => Number.parseFloat(v) < 100)
          .map((v) => `${d.file} radius ${v}`);
      if (d.prop === 'z-index' && /^\d+$/.test(d.value) && Number(d.value) > 3)
        return [`${d.file} z-index ${d.value}`];
      return [];
    });
    expect(found).toEqual([]);
  });

  it('font sizes are on the type scale', () => {
    const found = allDeclarations
      .filter((d) => d.prop === 'font-size' || d.prop === 'font')
      .flatMap((d) => {
        const px =
          d.prop === 'font'
            ? (d.value.match(/(?<![\d.])([\d.]+)px/) ?? []).slice(1, 2)
            : [d.value.match(/^([\d.]+)px$/)?.[1]];
        return px
          .filter((v): v is string => Boolean(v) && !TYPE_SIZES.includes(num(v as string)))
          .map((v) => `${d.file} ${num(v)}px`);
      });
    check('font sizes', found, ALLOW_FONT_SIZE);
  });

  it('radii are on the radius list', () => {
    const found = allDeclarations
      .filter((d) => /^border(-[a-z]+)*-radius$/.test(d.prop))
      .flatMap((d) =>
        (d.value.match(/[\d.]+(?:px)?(?![\d.%a-z])|[\d.]+px/g) ?? [])
          .filter((v) => v.endsWith('px') || v === '0')
          .map((v) => num(v))
          .filter((v) => !RADII.includes(v) && Number(v) < 100)
          .map((v) => `${d.file} ${v}px`),
      );
    check('radii', found, ALLOW_RADIUS);
  });

  it('z-index values are on the layers list', () => {
    const found = allDeclarations
      .filter((d) => d.prop === 'z-index' && /^-?\d+$/.test(d.value))
      .filter((d) => !LAYERS.includes(d.value) && !['-1', '0', '1', '2', '3'].includes(d.value))
      .map((d) => `${d.file} ${d.value}`);
    check('z-index values', found, ALLOW_Z_INDEX);
  });

  it('colours come from tokens.css, not raw hex or rgb', () => {
    const found = declarations(notTokens).flatMap((d) =>
      (d.value.replace(/url\([^)]*\)/g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).map(
        (c) => `${d.file} ${c.toLowerCase().replace(/\s+/g, '')}`,
      ),
    );
    check('raw colours', found, ALLOW_RAW_COLOUR);
  });
});

describe('the design system guard: classes', () => {
  /** Every class named in a rule's selector, with the sheet it is in. */
  const defined = parsed.flatMap((p) =>
    p.rules.flatMap((r) =>
      [...r.selector.replace(/\[[^\]]*\]|"[^"]*"/g, '').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => ({
        file: p.file,
        cls: m[1] as string,
      })),
    ),
  );

  it('a bare class is defined at the top level of one sheet only', () => {
    const where = new Map<string, Set<string>>();
    for (const p of parsed)
      for (const r of p.rules)
        if (r.top)
          for (const part of r.selector.split(',').map((s) => s.trim())) {
            const m = part.match(/^\.(-?[A-Za-z_][\w-]*)$/);
            if (m) where.set(m[1] as string, (where.get(m[1] as string) ?? new Set()).add(p.file));
          }
    const found = [...where]
      .filter(([, files]) => files.size > 1)
      .map(([cls, files]) => `.${cls}: ${[...files].sort().join(', ')}`);
    check('duplicated classes', found, ALLOW_DUPLICATE_CLASS);
  });

  /** The words the code, the help pictures and the tour mention; and the prefixes it builds names from. */
  const usedText = [...sourceFiles.map(readCode), read(join(ROOT, 'help', 'shots.json'))].join('\n');
  const words = new Set(usedText.match(/[A-Za-z_][\w-]*/g));
  const prefixes = [...usedText.matchAll(/([A-Za-z][\w-]*-)(?:\$\{|['"`]\s*\+)/g)].map((m) => m[1] as string);
  const runtime = /^(ProseMirror|tiptap|Tiptap)/;

  it('sees the classes and the code that uses them (so the scan itself still works)', () => {
    expect(defined.length).toBeGreaterThan(1500);
    expect(words.has('icon-btn')).toBe(true);
    expect(prefixes.length).toBeGreaterThan(0);
  });

  it('every class in a stylesheet is used somewhere (the code, help/shots.json, the tour)', () => {
    const found = defined
      .filter(({ cls }) => !words.has(cls) && !prefixes.some((p) => cls.startsWith(p)) && !runtime.test(cls))
      .map(({ file, cls }) => `${file} .${cls}`);
    check('unused classes', found, ALLOW_UNUSED_CLASS);
  });

  it('classes the eager code uses are not defined only in a lazy stylesheet', () => {
    const lazySheets = new Set(
      walk(SRC, (n) => n === 'ui.ts').flatMap((ui) =>
        [...read(ui).matchAll(/import '([^']+\.css)'/g)].map((m) => rel(join(ui, '..', m[1] as string))),
      ),
    );
    const eagerSheets = new Set(
      [...read(join(SRC, 'main.tsx')).matchAll(/import '\.\/([^']+\.css)'/g)].map((m) => m[1] as string),
    );
    expect(lazySheets.size).toBeGreaterThan(5);
    expect(eagerSheets.has('styles/viewer.css')).toBe(true);
    const eagerCode = eagerFiles();
    expect(eagerCode.length).toBeGreaterThan(20);
    const eagerWords = new Set(
      eagerCode
        .map(readCode)
        .join('\n')
        .match(/[A-Za-z_][\w-]*/g),
    );
    const found = [...new Set(defined.filter(({ file }) => lazySheets.has(file)).map((d) => d.cls))]
      .filter((cls) => eagerWords.has(cls) && !defined.some((d) => d.cls === cls && eagerSheets.has(d.file)))
      .map((cls) => `.${cls}`);
    check('lazy-only classes', found, ALLOW_LAZY_ONLY_CLASS);
  });
});

describe('the design system guard: markup', () => {
  /** The opening tag of every `<name …>` in a file (braces respected). */
  function tags(text: string, name: string): { open: string; line: number }[] {
    const out: { open: string; line: number }[] = [];
    const start = new RegExp(`<${name}\\b`, 'g');
    for (let m = start.exec(text); m; m = start.exec(text)) {
      let depth = 0;
      let i = m.index;
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) break;
      }
      out.push({ open: text.slice(m.index, i + 1), line: text.slice(0, m.index).split('\n').length });
    }
    return out;
  }

  it('data-size is only "small"', () => {
    let seen = 0;
    const found = tsxFiles.flatMap((f) =>
      [...read(f).matchAll(/data-size=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((m) => {
        seen++;
        const values =
          m[1] !== undefined
            ? [m[1]]
            : [...(m[2] as string).matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1] as string);
        return values.filter((v) => v !== 'small').map((v) => `${rel(f)} ${v}`);
      }),
    );
    expect(seen).toBeGreaterThan(100);
    check('data-size values', found, {});
  });

  it('every checkbox and radio is a .tick or a .switch', () => {
    let seen = 0;
    const found = tsxFiles.flatMap((f) =>
      tags(read(f), 'input')
        .filter((t) => /\btype=["{']?(checkbox|radio)\b/.test(t.open))
        .filter((t) => {
          seen++;
          return !/className=["{`'][^"}`']*\b(tick|switch)\b/.test(t.open) && !/role="switch"/.test(t.open);
        })
        .map((t) => `${rel(f)}:${t.line}`),
    );
    expect(seen).toBeGreaterThan(5);
    check('plain checkboxes', found, ALLOW_PLAIN_CHECKBOX);
  });
});

// Today's remaining offenders ("file value": count). Lower or delete an entry when you fix it. ------------
const ALLOW_FONT_SIZE: Allow = {};
const ALLOW_RADIUS: Allow = {};
const ALLOW_Z_INDEX: Allow = {};
const ALLOW_RAW_COLOUR: Allow = {
  'styles/base.css rgba(2,27,67,0.08)': 1,
  'styles/base.css rgba(2,27,67,0.24)': 1,
  'styles/base.css rgba(2,27,67,0.3)': 1,
  'styles/base.css rgba(24,137,255,0.2)': 1,
  'styles/base.css rgba(24,137,255,0.42)': 1,
  'styles/base.css rgba(255,255,255,0.55)': 1,
  'styles/todo-panel.css rgba(11,92,181,0.2)': 1,
};
const ALLOW_DUPLICATE_CLASS: Allow = {
  '.drawer-scroll: styles/drawers.css, styles/shell.css': 1,
  '.home-scroll: styles/home.css, styles/shell.css': 1,
  '.jump: styles/base.css, styles/shell.css': 1,
  '.thread: styles/chat.css, styles/shell.css': 1,
};
const ALLOW_UNUSED_CLASS: Allow = {};
const ALLOW_LAZY_ONLY_CLASS: Allow = {
  // apps/shared/parts.tsx is eager but holds the library parts too; the scan is per file, so these are
  // flagged.
};
const ALLOW_PLAIN_CHECKBOX: Allow = {};
