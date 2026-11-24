import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The wording guard (plan 2026-11-24-todos-to-tasks-wording, decision 9). From 30 November 2026 the team says
 * "task", not "to-do". This scans the text people read for the hyphenated word and fails on any new one.
 * Only the hyphenated word is the user word: `todo` (code names, the `todo/` folder, the tdsapp-todo skill) is fine.
 *
 * Comments: only WHOLE-LINE comments are skipped (`//`, a `/* ... *\/` block, `{/* ... *\/}`). A trailing comment
 * after code is scanned, so a miss fails loudly instead of hiding text.
 *
 * Allowlist: by file plus exact text (never line numbers), each with a reason. Keep it short.
 */
const ROOT = join(import.meta.dirname, '..');

const OLD_WORD = /to-?dos?\b/i;
// Hyphenated only: "to-do", "to-dos", "To-Do".
const HYPHENATED = /\bto-do(s)?\b/i;

type Allowed = { file: string; text: string; reason: string };

const ALLOWED: Allowed[] = [
  {
    file: 'server/engine/session-manager.ts',
    text: 'to-dos (through the tdsapp-todo skill, with this project set)',
    reason: 'Instruction to Claude only: names the brain skill tdsapp-todo, never shown to people.',
  },
  {
    file: 'server/engine/session-manager.ts',
    text: 'When you add a to-do for one of these projects, set its project.',
    reason: 'Instruction to Claude only: the brain keeps the word to-do; never shown to people.',
  },
  {
    file: 'server/engine/session-manager.ts',
    text: "calls to-dos 'tasks'",
    reason: 'TASKS_WORD_LINE: tells Claude the team word, and that a task is a to-do in the brain.',
  },
  {
    file: 'server/engine/session-manager.ts',
    text: 'a to-do in the brain',
    reason: 'TASKS_WORD_LINE: the same instruction to Claude.',
  },
  {
    file: 'server/engine/context-policy.ts',
    text: 'To-do for this chat: ',
    reason:
      'Instruction to Claude only: the head of a note naming the brain todo file; never shown to people.',
  },
  {
    file: 'client/src/shell/search-sources.ts',
    text: "terms: ['to-do', 'to-dos', 'todo', 'todos']",
    reason: 'Decision 3: the old word still finds the Tasks Go to entry.',
  },
  {
    file: 'shared/context-contract.ts',
    text: 'open questions and to-dos',
    reason: 'BRAIN_COMPACT_INSTRUCTIONS: read only by Claude, which keeps the brain word.',
  },
  {
    file: 'server/engine/chat-summary.ts',
    text: 'short enough to be a to-do title',
    reason: 'Chat-summary prompt read only by Claude; the length hint, not a word people see.',
  },
  {
    file: 'shared/kits-contract.ts',
    text: 'everyday agency work: clients, notes, to-dos, email, calendar, documents and meetings',
    reason:
      'Must equal the copy in brain-skills/tdsapp-kits (tdsapp-kits.test.ts); brain wording changes only with a full migration.',
  },
  {
    file: 'help/todos.md',
    text: 'Tasks used to be called to-dos.',
    reason: 'Tells people the old word so help search finds it.',
  },
  {
    file: 'help/glossary.md',
    text: 'Tasks used to be called to-dos.',
    reason: 'Glossary entry for task: tells people the old word.',
  },
];

/** Paths never scanned: Ad Manager stays as it is for now. */
const SKIPPED = (path: string) =>
  path.includes('ad-manager') ||
  path.includes('/ads-') ||
  path.startsWith('help/ads-') ||
  path === 'help/ad-manager.md';

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'node_modules' || name === 'whats-new' ? [] : walk(path, keep);
    return keep(name) ? [path] : [];
  });
}

const isTest = (name: string) => /\.test\.(ts|tsx)$/.test(name);
const rel = (file: string) => relative(ROOT, file).split('\\').join('/');

/** Whole-line comments removed; every other line (including code with a trailing comment) is kept. */
function stripWholeLineComments(text: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*') || t.startsWith('{/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    out.push(line);
  }
  return out;
}

function offenders(file: string, lines: string[]): string[] {
  return lines
    .filter((line) => HYPHENATED.test(line))
    .filter((line) => !ALLOWED.some((a) => a.file === file && line.includes(a.text)))
    .map((line) => `${file}: ${line.trim().slice(0, 160)}`);
}

function codeFiles(): string[] {
  const keep = (name: string) => /\.(ts|tsx|css)$/.test(name) && !isTest(name);
  return [
    ...walk(join(ROOT, 'client/src'), keep),
    ...walk(join(ROOT, 'server'), (n) => n.endsWith('.ts') && !isTest(n)),
    ...walk(join(ROOT, 'shared'), (n) => n.endsWith('.ts') && !isTest(n)),
  ];
}

function helpFiles(): string[] {
  return readdirSync(join(ROOT, 'help'))
    .filter((n) => n.endsWith('.md'))
    .map((n) => join(ROOT, 'help', n));
}

describe('wording: tasks, not to-dos', () => {
  it('the matcher flags the old word and ignores code names', () => {
    expect(HYPHENATED.test('Add a to-do')).toBe(true);
    expect(HYPHENATED.test('Your To-dos')).toBe(true);
    expect(HYPHENATED.test('todo/20261116-x.md and tdsapp-todo')).toBe(false);
    expect(OLD_WORD.test('todos')).toBe(true);
    expect(offenders('x.ts', ['label="Add a to-do"'])).toHaveLength(1);
    expect(
      stripWholeLineComments(['// a to-do', '/** a to-do', ' * more to-do', ' */', 'x'].join('\n')),
    ).toEqual(['x']);
    expect(stripWholeLineComments('const a = 1; // to-do')).toHaveLength(1);
  });

  it('scans a sensible number of files', () => {
    const scanned = [...codeFiles(), ...helpFiles()].filter((f) => !SKIPPED(rel(f)));
    expect(scanned.length).toBeGreaterThan(150);
  });

  it('has no "to-do" in code text people read', () => {
    const found = codeFiles()
      .filter((f) => !SKIPPED(rel(f)))
      .flatMap((f) => offenders(rel(f), stripWholeLineComments(readFileSync(f, 'utf8'))));
    expect(found).toEqual([]);
  });

  it('has no "to-do" in help pages', () => {
    const found = helpFiles()
      .filter((f) => !SKIPPED(rel(f)))
      .flatMap((f) => offenders(rel(f), readFileSync(f, 'utf8').split('\n')));
    expect(found).toEqual([]);
  });

  it('has no "to-do" in screenshot alt text', () => {
    const shots = JSON.parse(readFileSync(join(ROOT, 'help/shots.json'), 'utf8')) as unknown;
    const alts: string[] = [];
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (k === 'alt' && typeof x === 'string') alts.push(x);
          else visit(x);
        }
    };
    visit(shots);
    expect(alts.length).toBeGreaterThan(20);
    expect(alts.filter((a) => HYPHENATED.test(a))).toEqual([]);
  });
});
