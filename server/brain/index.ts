import type { BrainReaders } from '../../shared/contract.ts';
import { listClients } from './clients.ts';
import { checkHealth } from './health.ts';
import { defaultRunner, type Runner, readIdentity } from './identity.ts';
import { createLibrary } from './library.ts';
import { listSkills, skillAccess } from './skills.ts';
import { createSyncReader } from './sync.ts';
import { completeTodo, listTodos } from './todos.ts';
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
}

export function createBrainReaders(root: string, deps: BrainDeps = {}): BrainReaders {
  const run = deps.run ?? defaultRunner;
  const now = deps.now ?? (() => new Date());
  const library = createLibrary(root, {
    clients: () => listClients(root),
    dataDir: deps.dataDir ?? null,
    docThumbs: deps.docThumbs ?? false,
  });
  const syncReader = createSyncReader(root);
  return {
    root,
    health: () => checkHealth(root),
    identity: () => readIdentity(root, run),
    skills: (identity) => listSkills(root, identity),
    skillAccess: (identity, name) => skillAccess(root, identity, name),
    todos: (identity) => listTodos(root, identity),
    completeTodo: (id, by) => completeTodo(root, id, by, now()),
    clients: () => listClients(root),
    usedOften: async (identity, opts) => {
      const listed = new Set((await listSkills(root, identity)).map((s) => s.name));
      return readUsage(root, identity, listed, now(), opts);
    },
    libraryScopes: () => library.scopes(),
    library: (scope) => library.list(scope),
    libraryFile: (id) => library.file(id),
    sync: () => syncReader.read(),
    watch: (onChange) =>
      watchBrain(root, onChange, {
        onLibraryChange: (rel, folder) => library.changed(rel, folder),
        onLibraryLive: (folder, on) => library.setLive(folder, on),
      }),
  };
}

export type { Runner } from './identity.ts';
