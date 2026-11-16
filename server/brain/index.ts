import type { BrainReaders, Identity } from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import { listClients } from './clients.ts';
import {
  createFilesSkillRunner,
  FILES_SKILL,
  type FilesSkillOptions,
  hasDeleteCapability,
} from './files-skill.ts';
import { checkHealth } from './health.ts';
import { defaultRunner, type Runner, readIdentity } from './identity.ts';
import { createLibrary, isProtectedFile, type LibraryOptions, scopeOfId } from './library.ts';
import { listSkills, skillAccess } from './skills.ts';
import { createSyncReader } from './sync.ts';
import { readMemberProfile } from './team-profile.ts';
import { createAskedTodos } from './todo-asked.ts';
import { createTodoHistory, type GitLogRunner, type GitRunner } from './todo-history.ts';
import { createTodoSkillRunner, type TodoSkillOptions } from './todo-skill.ts';
import { createTodoTimeline } from './todo-timeline.ts';
import { changeTodo, completeTodo, listTodos } from './todos.ts';
import { readUsage } from './usage.ts';
import { watchBrain } from './watch.ts';

export interface BrainDeps {
  /** Runs child processes (whoami, git). Tests inject a fake. */
  run?: Runner;
  now?: () => Date;
  /**
   * The app's own data folder, where the library keeps image sizes and titles. Never inside the
   * brain. Missing: they are kept in memory only.
   */
  dataDir?: string | null;
  /** Where Quick Look can draw documents: offer pictures of them (see `LibraryOptions.docThumbs`). */
  docThumbs?: boolean;
  /** How the brain's `todo` skill script is run. Tests pass an environment or a spawner. */
  todoSkill?: TodoSkillOptions;
  /** Runs git for the to-do handover fallback. Tests inject a fake. */
  todoGit?: GitRunner;
  /** Runs the read-only git logs behind "Asked of others" and to-do history. Tests inject a fake. */
  todoLog?: GitLogRunner;
  /** How the brain's `tdsapp-files` skill script is run. Tests pass an environment or a spawner. */
  filesSkill?: FilesSkillOptions;
  /** Answers `LibraryOptions.ignored`. Tests inject a fake; the default asks git in the brain. */
  libraryIgnored?: LibraryOptions['ignored'];
}

/** How long a read of who is using the app and what the files skill offers them is reused. */
const DELETE_ACCESS_MS = 10_000;

/** The real brain always has the library search. */
export type SearchableBrain = BrainReaders & Required<Pick<BrainReaders, 'librarySearch'>>;

export function createBrainReaders(
  root: string,
  deps: BrainDeps & { librarySearch?: LibraryOptions['search'] } = {},
): SearchableBrain {
  const run = deps.run ?? defaultRunner;
  const now = deps.now ?? (() => new Date());
  // One runner per brain, so deletes and purges run one at a time.
  const filesSkill = createFilesSkillRunner(root, deps.filesSkill);
  /** The person, when the files skill is there, its `roles:` allow them and it reports the delete feature. */
  let access: { at: number; who: Promise<Identity | null> } | null = null;
  const deleteAccess = (): Promise<Identity | null> => {
    if (access && now().getTime() - access.at < DELETE_ACCESS_MS) return access.who;
    const who = (async () => {
      const identity = await readIdentity(root, run);
      if ((await skillAccess(root, identity, FILES_SKILL)) !== 'allowed') return null;
      return (await hasDeleteCapability(filesSkill)) ? identity : null;
    })().catch(() => null);
    access = { at: now().getTime(), who };
    return who;
  };
  const library = createLibrary(root, {
    clients: () => listClients(root),
    dataDir: deps.dataDir ?? null,
    docThumbs: deps.docThumbs ?? false,
    search: deps.librarySearch,
    deletion: async () => {
      const who = await deleteAccess();
      return who ? { role: who.role } : null;
    },
    ignored: deps.libraryIgnored,
  });
  const syncReader = createSyncReader(root);
  // One runner per brain, so to-do changes run one at a time.
  const todoSkill = createTodoSkillRunner(root, deps.todoSkill);
  const todoHistory = createTodoHistory(deps.todoGit);
  const askedTodos = createAskedTodos(deps.todoLog);
  const todoTimeline = createTodoTimeline(deps.todoLog);
  return {
    root,
    health: () => checkHealth(root),
    identity: () => readIdentity(root, run),
    profile: (identity) => readMemberProfile(root, identity),
    skills: (identity) => listSkills(root, identity),
    skillAccess: (identity, name) => skillAccess(root, identity, name),
    todos: (identity) =>
      listTodos(root, identity, { history: todoHistory, capabilities: () => todoSkill.capabilities() }),
    completeTodo: (id, by) => completeTodo(root, id, by, now()),
    changeTodo: (action, identity) => changeTodo(root, action, identity, todoSkill, { history: todoHistory }),
    completePersonalTodo: async (id, expect, by) => {
      await changeTodo(root, { kind: 'tick', id, scope: 'personal', expect }, by, todoSkill, {
        history: todoHistory,
      });
    },
    askedTodos: (identity) => askedTodos.list(root, identity, now()),
    todoHistory: (key, identity) => todoTimeline.history(root, key, identity),
    clients: () => listClients(root),
    usedOften: async (identity, opts) => {
      const listed = new Set((await listSkills(root, identity)).map((s) => s.name));
      return readUsage(root, identity, listed, now(), opts);
    },
    libraryScopes: () => library.scopes(),
    librarySearch: (q, kind) => library.search(q, kind),
    library: (scope) => library.list(scope),
    libraryFile: (id) => library.file(id),
    libraryItemForPath: (rel) => library.itemForPath(rel),
    deleteLibraryFile: async (id, opts) => {
      const who = await deleteAccess();
      if (!who) throw new FilesChangeError('not-allowed');
      const scope = scopeOfId(id);
      // Refused early for a clear message; the script checks all of this again.
      if (scope === null || scope === 'personal') throw new FilesChangeError('not-allowed');
      if (scope === 'shared:templates' ? who.role !== 'owner' : who.role === 'unknown')
        throw new FilesChangeError('not-allowed');
      const file = await library.file(id);
      if (!file) throw new FilesChangeError('not-found');
      if (isProtectedFile(file.item.path)) throw new FilesChangeError('not-allowed');
      await filesSkill.delete({
        path: file.item.path,
        ...(opts.expect !== undefined ? { expect: opts.expect } : {}),
        by: { slug: who.slug, name: who.name },
      });
      library.changed(file.item.path);
    },
    purgeDeletedFiles: async () => {
      try {
        return (await deleteAccess()) ? await filesSkill.purge() : 0;
      } catch {
        return 0;
      }
    },
    sync: () => syncReader.read(),
    watch: (onChange) =>
      watchBrain(root, onChange, {
        onLibraryChange: (rel, folder) => library.changed(rel, folder),
        onLibraryLive: (folder, on) => library.setLive(folder, on),
      }),
  };
}

export type { Runner } from './identity.ts';
