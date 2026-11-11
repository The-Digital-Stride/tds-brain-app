import type { BrainReaders } from '../../shared/contract.ts';
import { listClients } from './clients.ts';
import { checkHealth } from './health.ts';
import { defaultRunner, type Runner, readIdentity } from './identity.ts';
import { listSkills, skillAccess } from './skills.ts';
import { completeTodo, listTodos } from './todos.ts';
import { readUsage } from './usage.ts';
import { watchBrain } from './watch.ts';

export interface BrainDeps {
  /** Runs child processes (whoami, git). Tests inject a fake. */
  run?: Runner;
  now?: () => Date;
}

export function createBrainReaders(root: string, deps: BrainDeps = {}): BrainReaders {
  const run = deps.run ?? defaultRunner;
  const now = deps.now ?? (() => new Date());
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
    watch: (onChange) => watchBrain(root, onChange),
  };
}

export type { Runner } from './identity.ts';
