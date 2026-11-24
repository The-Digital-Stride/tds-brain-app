/**
 * One teammate's open TDS to-do, for reading (done-todos plan, decision 10). Reads `todo/<id>` only:
 * never `personal/`, never a rule file, never a symlink. Read only: writes nothing.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { TeamTodo } from '../../shared/contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import type { ProjectsIndex } from './projects.ts';
import { rosterName } from './todo-asked.ts';
import { createAttachmentReader, dueOf, lower, readTeam, SAFE_ID, todoTitle } from './todos.ts';
import { readBytes } from './util.ts';

export interface TeamTodoDeps {
  /** Fills `projectMatch`; without it, or if it fails, none is set. */
  projects?: () => Promise<ProjectsIndex>;
}

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);

/** `me` is the caller's slug, for their own personal attachments. Null when there is no such to-do. */
export async function readTeamTodo(
  root: string,
  id: string,
  me: string,
  deps: TeamTodoDeps = {},
): Promise<TeamTodo | null> {
  if (!SAFE_ID.test(id) || SKIP.has(id)) return null;
  const file = join(root, 'todo', id);
  try {
    const st = await fs.lstat(file);
    if (st.isSymbolicLink() || !st.isFile()) return null;
  } catch {
    return null;
  }
  const bytes = await readBytes(file);
  if (bytes === null) return null;
  const { data, body } = parseFrontmatter(bytes.toString('utf8'));
  const team = await readTeam(root);
  const written = lower(data.assignee);
  const assignee = written === '' || written === 'open' ? null : written;
  const project = asString(data.project).trim() || null;
  const client = asString(data.client).trim() || null;
  let index: ProjectsIndex | null = null;
  if (deps.projects) {
    try {
      index = await deps.projects();
    } catch {
      index = null;
    }
  }
  return {
    key: `team:todo/${id}`,
    id,
    path: `todo/${id}`,
    title: todoTitle(data, body, id),
    assignee,
    assigneeName: assignee === null ? null : (rosterName(team, assignee) ?? assignee),
    due: dueOf(data),
    details: body.trim(),
    version: createHash('sha256').update(bytes).digest('hex'),
    attachments: await createAttachmentReader(root, me)(body),
    client,
    project,
    stage: asString(data.stage).trim() || null,
    ...(index ? { projectMatch: index.resolve(project, client, 'tds') } : {}),
  };
}
