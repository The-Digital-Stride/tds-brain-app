/**
 * Setup mode (setup-screen plan, decision 2): stand-ins for everything that would touch a brain or run
 * Claude, used while no checked brain has been chosen. The real readers, watcher, thumbnailer, upload
 * staging, session manager and permission-mode reader are never built, so Claude cannot be started and
 * no brain hook can load, by construction.
 */
import {
  type AppPermissionMode,
  type EngineHealth,
  type Identity,
  type Thumbnailer,
  TodoChangeError,
} from '../shared/contract.ts';
import type { SearchableBrain } from './brain/index.ts';
import { SessionError, type SessionManager } from './engine/session-manager.ts';
import { GONE_MESSAGE, UploadError, type UploadStaging } from './uploads/staging.ts';

const NO_BRAIN = 'No brain folder has been chosen yet.';
const NO_CHAT = 'That chat could not be found.';
const NO_UPLOADS = 'Choose your brain folder before attaching files.';

const UNKNOWN_PERSON: Identity = { name: '', slug: '', email: null, role: 'unknown', knownMember: false };

/** Every reader answers empty, the brain is not ok, every write is refused and nothing is watched. */
export function createSetupBrain(): SearchableBrain {
  return {
    root: '',
    health: async () => ({ ok: false, path: '', problems: [NO_BRAIN] }),
    identity: async () => ({ ...UNKNOWN_PERSON }),
    profile: async () => ({ title: null, departments: [], owns: null }),
    skills: async () => [],
    skillAccess: async () => 'unknown-skill',
    todos: async () => ({
      mine: [],
      open: [],
      othersCount: 0,
      team: [],
      changes: 'no-skill',
      canAddOpen: false,
      canUsePersonal: false,
    }),
    completeTodo: async () => {
      throw new Error(NO_BRAIN);
    },
    changeTodo: async () => {
      throw new TodoChangeError('not-allowed', NO_BRAIN);
    },
    completePersonalTodo: async () => {
      throw new TodoChangeError('not-allowed', NO_BRAIN);
    },
    clients: async () => [],
    usedOften: async () => [],
    libraryScopes: async () => [],
    library: async () => null,
    libraryFile: async () => null,
    librarySearch: async () => ({ hits: [], total: 0, partial: false }),
    sync: async () => ({ lastSync: null }),
    watch: () => () => {},
  };
}

/** No chats: starting one is `brain-missing`, any other chat action `not-found`. */
export function createSetupSessions(): SessionManager {
  const notFound = async (): Promise<never> => {
    throw new SessionError('not-found', NO_CHAT);
  };
  return {
    list: async () => ({ live: [], past: [] }),
    start: async () => {
      throw new SessionError('brain-missing', 'Choose your brain folder before starting a chat.');
    },
    send: notFound,
    replyPermission: notFound,
    replyQuestion: notFound,
    interrupt: notFound,
    close: notFound,
    closeAll: async () => {},
    subscribe: () => {
      throw new SessionError('not-found', NO_CHAT);
    },
    onChange: () => () => {},
    fileChanges: () => {
      throw new SessionError('not-found', NO_CHAT);
    },
    setEngineChoice: async () => {},
    engineChoices: async () => ({ models: [], claudeCode: { model: null } }),
  };
}

/** Makes no pictures (the library is empty in setup mode anyway). */
export function createSetupThumbs(): Thumbnailer {
  return { get: async () => null };
}

/** Takes no files and has no folder. */
export function createSetupUploads(): UploadStaging {
  const gone = (ids: string[]) => {
    if (ids.length > 0) throw new UploadError('gone', GONE_MESSAGE);
  };
  return {
    root: null,
    save: async () => {
      throw new UploadError('off', NO_UPLOADS);
    },
    discard: async () => {},
    peek: (ids) => {
      gone(ids);
      return [];
    },
    claim: (ids) => {
      gone(ids);
      return { files: [], release() {} };
    },
    sweep: async () => {},
    start() {},
    close() {},
  };
}

/**
 * `engineHealth` for the routes. With a checked brain the permission mode is read afresh on each call
 * (A18); in setup mode (`brainPath` null) it is `default` and no folder is read.
 */
export function createEngineHealth(
  brainPath: string | null,
  claudePath: string | null,
  home: string,
  resolveMode: (brainPath: string, home: string) => AppPermissionMode,
): () => EngineHealth {
  return () => {
    const permissionMode: AppPermissionMode = brainPath === null ? 'default' : resolveMode(brainPath, home);
    return claudePath
      ? { ok: true, permissionMode, claudePath, problem: null }
      : {
          ok: false,
          permissionMode,
          claudePath: null,
          problem: 'Claude Code is not installed on this computer, or the app cannot find it.',
        };
  };
}
