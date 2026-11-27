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
import {
  createAttachmentReader,
  dueOf,
  hiddenPathOf,
  lower,
  maskTask,
  readTaskIndex,
  readTeam,
  SAFE_ID,
  taskRule,
  timelineFields,
  todoTitle,
  usableIndex,
} from './todos.ts';
import { readBytes } from './util.ts';

export interface TeamTodoDeps {
  /** Fills `projectMatch` and applies THE task rule; without it none is set, and if it fails project-labelled tasks that aren't theirs are not found. */
  projects?: () => Promise<ProjectsIndex>;
}

const SKIP = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md']);

/**
 * `me` is the caller's slug, for their own personal attachments and THE task rule. Null when there is no
 * such to-do, or it is in a project hidden from them and isn't theirs.
 */
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
  const read = await readTaskIndex(deps.projects);
  const index = usableIndex(read);
  const projectMatch = index ? index.resolve(project, client, 'tds') : undefined;
  // THE task rule: a hidden project's task is not found unless it is this person's.
  const seen = taskRule(read, { project, projectMatch }, assignee !== null && assignee === me);
  if (seen === 'hide') return null;
  const item: TeamTodo = {
    key: `team:todo/${id}`,
    id,
    path: `todo/${id}`,
    title: todoTitle(data, body, id),
    assignee,
    assigneeName: assignee === null ? null : (rosterName(team, assignee) ?? assignee),
    due: dueOf(data),
    details: body.trim(),
    version: createHash('sha256').update(bytes).digest('hex'),
    attachments: await createAttachmentReader(root, me, hiddenPathOf(read))(body),
    client,
    project,
    stage: asString(data.stage).trim() || null,
    ...(projectMatch ? { projectMatch } : {}),
    ...timelineFields(data, body, team),
  };
  return seen === 'mask' ? maskTask(item) : item;
}
