/**
 * Dev-only, not in the test suite (plan 2026-11-16-todo-panel, Tests table). Runs every live to-do body
 * through the details round trip and reports counts, plus the FILE NAMES (never the text) of any failure.
 *
 *   node scripts/todo-roundtrip.ts [brain folder]     (default ~/agencybrain)
 *
 * READ-ONLY on the brain: it reads `todo/*.md` and `personal/todo/*.md` and writes nothing anywhere.
 * It imports the pure engine (`client/src/todo-doc/convert.ts`, `tasks.ts`), not `index.ts`, which needs
 * a DOM for the kept block's view.
 *
 * Checks per body (the trimmed text below the frontmatter, as `TodoItem.details`):
 * - faithful: `isFaithful` (exact round trip and every editable block survives a forced re-serialise);
 * - edit-safe: forcing each editable block to be written fresh loses nothing (the result reads back to
 *   the same blocks);
 * - neighbours: writing one block fresh, or deleting one, leaves every other block byte for byte and
 *   reading as the same block (no list joins its neighbour, no list swallows the code after it). The empty
 *   comments the engine adds to keep blocks apart are counted, not compared;
 * - tasks: `countTasks` equals the document's task items, and ticking each one changes exactly it.
 * A body that is not faithful opens read-only in the panel, so it is reported but is not a loss.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { JSONContent } from '@tiptap/core';
import { analyse, BLOCK_BREAK, isFaithful, toDoc, toMarkdown } from '../client/src/todo-doc/convert.ts';
import { countTasks, setTask } from '../client/src/todo-doc/tasks.ts';
import { parseFrontmatter } from '../server/brain/frontmatter.ts';

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);

async function bodies(brain: string): Promise<{ name: string; details: string }[]> {
  const out: { name: string; details: string }[] = [];
  for (const rel of ['todo', join('personal', 'todo')]) {
    let names: string[];
    try {
      names = (await fs.readdir(join(brain, rel), { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md') && !SKIP.has(e.name))
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      const text = await fs.readFile(join(brain, rel, name), 'utf8');
      out.push({ name: join(rel, name), details: parseFrontmatter(text).body.trim() });
    }
  }
  return out;
}

function taskStates(doc: JSONContent): boolean[] {
  const out: boolean[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'taskItem') out.push(n.attrs?.checked === true);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

const BREAK_SHAPE = `kept:${BLOCK_BREAK}`;

/** The blocks as the panel would hold them, without their origins or added breaks, for comparing readings. */
function shape(doc: JSONContent): string[] {
  return (doc.content ?? [])
    .map((n) => {
      if (n.type === 'keptBlock') return `kept:${String(n.attrs?.source ?? '')}`;
      const { md: _md, ...attrs } = n.attrs ?? {};
      return JSON.stringify({ ...n, attrs });
    })
    .filter((s) => s !== BREAK_SHAPE);
}

const breaks = (md: string) => md.split(BLOCK_BREAK).length - 1;

/** Each untouched block's exact source appears in `out`, in order. */
function sourcesKept(out: string, sources: string[]): boolean {
  let at = 0;
  for (const source of sources) {
    const i = out.indexOf(source, at);
    if (i < 0) return false;
    at = i + source.length;
  }
  return true;
}

const neighbourStats = { rewrites: 0, deletions: 0, rewriteBreaks: 0, deleteBreaks: 0 };

/** Forces block `i` to be written fresh (`rewrite`) or drops it (`delete`), then checks the rest. */
function neighboursSafe(details: string, i: number, how: 'rewrite' | 'delete'): boolean {
  const doc = toDoc(details);
  const nodes = doc.content ?? [];
  const content =
    how === 'delete'
      ? nodes.filter((_, j) => j !== i)
      : nodes.map((m, j) => (j === i ? { ...m, attrs: { ...m.attrs, md: null } } : m));
  const out = toMarkdown({ ...doc, content });
  const added = Math.max(0, breaks(out) - breaks(details));
  if (how === 'delete') neighbourStats.deleteBreaks += added;
  else neighbourStats.rewriteBreaks += added;
  const before = shape(doc);
  const want = how === 'delete' ? before.filter((_, j) => j !== i) : before;
  const after = shape(toDoc(out));
  if (after.length !== want.length || after.some((s, k) => s !== want[k])) return false;
  const untouched = analyse(details)
    .blocks.filter((_, j) => j !== i)
    .map((b) => b.source);
  return sourcesKept(out, untouched);
}

function editSafe(details: string): boolean {
  if (details === '') return true;
  const nodes = toDoc(details).content ?? [];
  for (let i = 0; i < nodes.length; i++) {
    if ((nodes[i] as JSONContent).type === 'keptBlock') continue;
    neighbourStats.rewrites++;
    if (!neighboursSafe(details, i, 'rewrite')) return false;
  }
  return true;
}

function deleteSafe(details: string): boolean {
  const nodes = toDoc(details).content ?? [];
  // Deleting the only block leaves nothing to check.
  if (nodes.length < 2) return true;
  for (let i = 0; i < nodes.length; i++) {
    neighbourStats.deletions++;
    if (!neighboursSafe(details, i, 'delete')) return false;
  }
  return true;
}

function tasksAgree(details: string): boolean {
  const states = taskStates(toDoc(details));
  if (countTasks(details) !== states.length) return false;
  for (let i = 0; i < states.length; i++) {
    const flipped = setTask(details, i, !states[i]);
    if (flipped.length !== details.length) return false;
    let diff = 0;
    for (let c = 0; c < details.length; c++) if (flipped[c] !== details[c]) diff++;
    if (diff !== 1) return false;
    const expected = states.slice();
    expected[i] = !states[i];
    if (JSON.stringify(taskStates(toDoc(flipped))) !== JSON.stringify(expected)) return false;
    if (setTask(flipped, i, states[i] as boolean) !== details) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const brain = resolve(process.argv[2] ?? join(homedir(), 'agencybrain'));
  const list = await bodies(brain);
  const notFaithful: string[] = [];
  const notEditSafe: string[] = [];
  const notDeleteSafe: string[] = [];
  const tasksWrong: string[] = [];
  const crashed: string[] = [];
  const keptByKind = new Map<string, number>();
  const keptByReason = new Map<string, number>();
  let blocks = 0;
  let editable = 0;
  let tasks = 0;
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const { name, details } of list) {
    try {
      const a = analyse(details);
      for (const b of a.blocks) {
        blocks++;
        if (b.node) editable++;
        else {
          bump(keptByKind, b.kind);
          bump(keptByReason, b.kept ?? b.kind);
        }
      }
      tasks += countTasks(details);
      if (!isFaithful(details)) notFaithful.push(name);
      if (!editSafe(details)) notEditSafe.push(name);
      if (!deleteSafe(details)) notDeleteSafe.push(name);
      if (!tasksAgree(details)) tasksWrong.push(name);
    } catch {
      crashed.push(name);
    }
  }

  const fmt = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none';
  console.log(`Bodies: ${list.length} (from ${brain})`);
  console.log(`Blocks: ${blocks}, editable ${editable}, kept ${blocks - editable}; task items ${tasks}`);
  console.log(`Kept by block type: ${fmt(keptByKind)}`);
  console.log(`Kept by reason: ${fmt(keptByReason)}`);
  const report = (label: string, names: string[]) => {
    console.log(`${label}: ${names.length}`);
    for (const n of names) console.log(`  ${n}`);
  };
  report('Not faithful (open read-only)', notFaithful);
  console.log(
    `Neighbour checks: ${neighbourStats.rewrites} blocks written fresh (${neighbourStats.rewriteBreaks} needed an ` +
      `empty comment to keep blocks apart), ${neighbourStats.deletions} deleted (${neighbourStats.deleteBreaks} needed one)`,
  );
  report('Not edit-safe (a block written fresh changed it or a neighbour)', notEditSafe);
  report('Not delete-safe (deleting a block changed a neighbour)', notDeleteSafe);
  report('Task count or toggle wrong', tasksWrong);
  report('Crashed', crashed);
  const failures =
    notEditSafe.length + notDeleteSafe.length + tasksWrong.length + crashed.length + notFaithful.length;
  console.log(failures === 0 ? 'Result: 0 failures' : `Result: ${failures} failure(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
