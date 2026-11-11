import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Identity, TodoItem, TodoList } from '../../shared/contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { humanise, readText } from './util.ts';

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function surfaceDate(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

async function readAll(root: string): Promise<TodoItem[]> {
  const dir = join(root, 'todo');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: TodoItem[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || SKIP.has(e.name)) continue;
    const text = await readText(join(dir, e.name));
    if (text === null) continue;
    const { data, body } = parseFrontmatter(text);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const due = asString(data.due).trim();
    items.push({
      id: e.name,
      title: asString(data.title).trim() || heading || humanise(e.name),
      assignee: asString(data.assignee).trim().toLowerCase() || null,
      due: DATE.test(due) ? due : null,
      surfaceDate: surfaceDate(e.name),
      project: asString(data.project).trim() || null,
      client: asString(data.client).trim() || null,
    });
  }
  return items;
}

const sortKey = (t: TodoItem) => t.due ?? t.surfaceDate;

function bySoonest(a: TodoItem, b: TodoItem): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka === kb) return a.id.localeCompare(b.id);
  if (ka === null) return 1;
  if (kb === null) return -1;
  return ka < kb ? -1 : 1;
}

export async function listTodos(root: string, identity: Identity): Promise<TodoList> {
  const items = await readAll(root);
  const mine = items.filter((t) => t.assignee !== null && t.assignee === identity.slug).sort(bySoonest);
  const open = items.filter((t) => t.assignee === null).sort(bySoonest);
  return { mine, open, othersCount: items.length - mine.length - open.length };
}

export async function completeTodo(root: string, id: string): Promise<void> {
  if (typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('That is not a to-do the app can tick off.');
  const live = await readAll(root);
  if (!live.some((t) => t.id === id))
    throw new Error('That to-do could not be found. It may already be done.');
  const doneDir = join(root, 'todo', 'done');
  const target = join(doneDir, id);
  await fs.mkdir(doneDir, { recursive: true });
  try {
    await fs.access(target);
    throw new Error('A finished to-do with that name already exists, so nothing was moved.');
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('A finished')) throw err;
  }
  await fs.rename(join(root, 'todo', id), target);
}
