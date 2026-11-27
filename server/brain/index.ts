import type { BrainReaders, DoneTodoList, Identity, TeamTodo } from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import { MEETINGS_MERGE_EVERY_MS } from '../../shared/project-meetings-contract.ts';
import { LEGACY_PROJECTS_SCOPE, ProjectsError } from '../../shared/projects-contract.ts';
import { createMeetingHistoryStore } from '../store/meeting-history.ts';
import { createProjectSeenStore } from '../store/project-seen.ts';
import { type AdsService, type AdsServiceOptions, createAdsService } from './ads-skill.ts';
import { listClients } from './clients.ts';
import { createEmailDrafts, type EmailDraftsService } from './email-drafts.ts';
import {
  createFilesSkillRunner,
  FILES_SKILL,
  type FilesSkillOptions,
  hasDeleteCapability,
} from './files-skill.ts';
import { checkHealth } from './health.ts';
import { defaultRunner, type Runner, readIdentity, readMembers } from './identity.ts';
import { createLibrary, isProtectedFile, type LibraryOptions, scopeOfId } from './library.ts';
import { createLibraryUpload, type LibraryUploadService } from './library-upload.ts';
import { createMyChanges } from './my-changes.ts';
import { createProjectActivity, type ProjectActivityService, readDoneInfo } from './project-activity.ts';
import { createProjectArtifact, type ProjectArtifactService } from './project-artifact.ts';
import { createProjectBusiness, type ProjectBusinessService } from './project-business.ts';
import { createProjectMeetings, type ProjectMeetingsService } from './project-meetings.ts';
import { createProjectUpdates, type ProjectUpdatesService } from './project-updates.ts';
import { createProjects, type TaskPlace } from './projects.ts';
import { createProjectsSkillRunner, PROJECTS_SKILL, type ProjectsSkillOptions } from './projects-skill.ts';
import { createQueue } from './skill-runner.ts';
import { listSkills, skillAccess } from './skills.ts';
import { createSyncReader } from './sync.ts';
import { readMemberProfile } from './team-profile.ts';
import { createAskedLog, createAskedTodos, doneLogArgs } from './todo-asked.ts';
import { listDoneTodos } from './todo-done.ts';
import { createTodoHistory, type GitLogRunner, type GitRunner } from './todo-history.ts';
import { createTodoSkillRunner, type TodoSkillOptions } from './todo-skill.ts';
import { readTeamTodo } from './todo-team.ts';
import { createTodoTimeline } from './todo-timeline.ts';
import { canUpdateTodos, changeTodo, completeTodo, listTodos, readTeam, uploadTodoFile } from './todos.ts';
import { readUsage } from './usage.ts';
import { memberSlug } from './util.ts';
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
  /** How the brain's `tdsapp-ads` bridge is run (Ad Manager). Its in-flight file goes in `dataDir`. */
  adsSkill?: Omit<AdsServiceOptions, 'dataDir'>;
  /** How the brain's `tdsapp-projects` skill script is run (Projects). Tests pass an environment or a spawner. */
  projectsSkill?: ProjectsSkillOptions;
}

/** How long a read of who is using the app and what the files skill offers them is reused. */
const DELETE_ACCESS_MS = 10_000;

/**
 * The real brain always has the library search. `ads` is Ad Manager's bridge (plan 2026-11-16-workbench-ad-manager):
 * the real brain always has it; setup mode's stand-in and older test fakes don't. It sits beside the BrainReaders
 * contract so they need nothing new.
 */
export type SearchableBrain = BrainReaders &
  Required<Pick<BrainReaders, 'librarySearch'>> & {
    ads?: AdsService;
    /** Projects R2 phase 3: activity on the project home. Beside the contract like `ads`; the real brain always has them. */
    projectActivity?: ProjectActivityService['read'];
    projectSeen?: ProjectActivityService['seen'];
    /** Claude artifacts in projects (decision 8): "Add a claude.ai page". The real brain always has it. */
    projectArtifact?: ProjectArtifactService;
    /** Library uploads (plan 2026-11-26-file-types-and-uploads): Upload in Documents, Images and a project's Files. */
    libraryUpload?: LibraryUploadService;
    /** Projects R2 phase 4: this Mac's own meetings for a project (the cache /gm writes, read only). */
    projectMeetings?: ProjectMeetingsService['read'];
    /** Client background on a project's Overview (read only). */
    projectBusiness?: ProjectBusinessService['read'];
    /** Home meetings: every upcoming meeting in this Mac's cache, project or not. */
    homeMeetings?: ProjectMeetingsService['home'];
    /** Projects R2 phase 5: email drafts waiting for their inbox owner's OK (this Mac's gitignored files, via the script). */
    emailDrafts?: EmailDraftsService;
    /** Done-todos plan: every finished to-do this person may see. Beside the contract like `ads`. */
    doneTodos?: (identity: Identity) => Promise<DoneTodoList>;
    /** Done-todos plan, decision 10: one teammate's open to-do, read only. Null when it has gone. */
    teamTodo?: (id: string, identity: Identity) => Promise<TeamTodo | null>;
    /** Chat summaries: this person's `chat` entries for one chat on a project (whole log, newest first). */
    chatEntries?: ProjectUpdatesService['chatEntries'];
    myChatEntries?: ProjectUpdatesService['myChatEntries'];
    /**
     * Chat summaries: which chats this Mac holds, for "Open chat" on a `chat` entry. The session manager is made
     * after the brain, so it is handed in later (routes.ts binds it); until then no entry is openable.
     */
    setHoldsChat?: (fn: ((chatId: string) => Promise<boolean>) | null) => void;
  };

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
  // One runner per brain, so to-do changes run one at a time.
  const todoSkill = createTodoSkillRunner(root, deps.todoSkill);
  // The projects service reads the brain itself; its writes (and the tidy-up's to-do changes) are scripts'.
  // One queue for every tdsapp-projects call, email drafts included.
  const projectsQueue = createQueue();
  const projectsSkill = createProjectsSkillRunner(root, { ...deps.projectsSkill, queue: projectsQueue });
  // `edit` can answer `updatesFailed` (an auto log entry wasn't written); the service drops the script's answer,
  // so it is kept here, keyed by the action object the service passes on (Projects R2 phase 2).
  const editAnswers = new WeakMap<object, { updatesFailed?: true }>();
  // One `todo/` git log per HEAD, shared by the Asked and Done lists.
  const askedLog = createAskedLog(deps.todoLog);
  // The files this person changed (git authorship + uncommitted), for Home's Recent cards and project cards.
  const myChanges = createMyChanges(deps.todoLog);
  // The Done list's own log: Asked's only lists commits touching `assignee:`, so it misses to-dos open to anyone.
  const doneLog = createAskedLog(deps.todoLog, doneLogArgs);
  const projects = createProjects(root, {
    skill: {
      capabilities: () => projectsSkill.capabilities(),
      run: async (action) => {
        const result = await projectsSkill.run(action);
        if (result.updatesFailed) editAnswers.set(action, { updatesFailed: true });
        return result;
      },
    },
    todoSkill,
    clients: () => listClients(root),
    dataDir: deps.dataDir ?? null,
    // Review fix (release 1): changing projects follows the skill's `roles:`, like the other skills.
    mayChange: async (identity) => (await skillAccess(root, identity, PROJECTS_SKILL)) === 'allowed',
    // A project's to-dos say which ones this person's to-do panel can open (in `mine` or `open`).
    todoList: (identity) => listTodos(root, identity, { capabilities: () => todoSkill.capabilities() }),
    // A project's finished to-dos (Done section): the same reader as the Done tab.
    doneTodos: (identity) =>
      listDoneTodos(root, identity, { log: doneLog, projects: () => projects.index() }),
    // A moved folder's files leave one library scope and join another.
    onMoved: (from, to) => {
      library.changed(from);
      library.changed(to);
    },
    // Restricted projects (plan 2026-11-27, decision 3): the one person this server serves, and the roster.
    viewer: () => readIdentity(root, run),
    members: async () =>
      (await readMembers(root)).flatMap((m) => {
        if (typeof m.name !== 'string' || m.name.trim() === '') return [];
        const own = (m as { slug?: unknown }).slug;
        const slug = typeof own === 'string' && own.trim() !== '' ? own.trim() : memberSlug(m.name);
        return [{ name: m.name, slug, role: typeof m.role === 'string' ? m.role : '' }];
      }),
  });
  // Chat summaries: bound to the session manager's ownsChat once it exists (setHoldsChat below).
  let holdsChat: ((chatId: string) => Promise<boolean>) | null = null;
  const projectUpdates = createProjectUpdates(root, {
    index: () => projects.index(),
    skill: projectsSkill,
    mayChange: async (identity) => (await skillAccess(root, identity, PROJECTS_SKILL)) === 'allowed',
    holdsChat: (chatId) => (holdsChat ? holdsChat(chatId).catch(() => false) : false),
  });
  // Activity on the project home: reuses the To-dos, Files and Updates reads; the snapshot lives in the data folder.
  const emailDrafts = createEmailDrafts(root, {
    index: () => projects.index(),
    clients: () => listClients(root),
    identity: () => readIdentity(root, run),
    capabilities: () => projectsSkill.capabilities(),
    mayChange: async (identity) => (await skillAccess(root, identity, PROJECTS_SKILL)) === 'allowed',
    ignored: deps.libraryIgnored,
    onChanged: () => projects.changed(),
    queue: projectsQueue,
    script: deps.projectsSkill,
    now,
  });
  const projectActivity = createProjectActivity({
    index: () => projects.index(),
    todos: (key, identity) => projects.projectTodos(key, identity),
    files: async (card) => {
      const [images, documents] = await Promise.all([
        library.projectFiles(card, 'image'),
        library.projectFiles(card, 'document'),
      ]);
      return { items: [...images.items, ...documents.items], hidden: images.hidden + documents.hidden };
    },
    updates: (key, identity) => projectUpdates.read(key, null, identity),
    done: (id) => readDoneInfo(root, id),
    roster: async () => {
      // The script writes `by` as memberSlug(name); the to-do roster uses another slug form. Know both.
      const roster = new Map<string, string>();
      for (const m of await readTeam(root).catch(() => [])) {
        roster.set(m.slug, m.name);
        const alt = memberSlug(m.name);
        if (alt && !roster.has(alt)) roster.set(alt, m.name);
      }
      return roster;
    },
    store: createProjectSeenStore(deps.dataDir ?? null),
    now,
  });
  // Meetings on the project home: the /gm cache (read only, only when git ignores it) plus a small private history.
  const projectMeetings = createProjectMeetings({
    root,
    index: () => projects.index(),
    clients: () => listClients(root),
    store: createMeetingHistoryStore(deps.dataDir ?? null),
    selfEmail: async () => (await readIdentity(root, run)).email,
    ignored: deps.libraryIgnored,
    now,
  });
  // Keep ended meetings: once at start-up, then every 30 minutes (no watcher on briefing/). Cleared by the stop
  // function `watch` returns, which the server calls when it stops.
  void projectMeetings.merge();
  const mergeTimer = setInterval(() => void projectMeetings.merge(), MEETINGS_MERGE_EVERY_MS);
  mergeTimer.unref();
  const projectBusiness = createProjectBusiness({
    root,
    index: () => projects.index(),
    clients: () => listClients(root),
  });
  const library = createLibrary(root, {
    projects: () => projects.index(),
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
  const todoHistory = createTodoHistory(deps.todoGit);
  const askedTodos = createAskedTodos(deps.todoLog, askedLog);
  // One bridge per brain, so ads changes run one at a time; the in-flight file lives in the app's data folder.
  const ads = createAdsService(root, { ...deps.adsSkill, dataDir: deps.dataDir ?? null });
  const todoTimeline = createTodoTimeline(deps.todoLog);
  // Restricted projects (contract, S2): a change builds its own list, so it gets the index too, and the
  // assign block asks the projects service, which reads every card and ignores who is asking.
  const todoChangeDeps = {
    history: todoHistory,
    projects: () => projects.index(),
    assignCheck: (place: TaskPlace, assignee: string | null) => projects.assignCheck(place, assignee),
    // Task updates: `update` (only) may reach a task this person passed on that is still waiting.
    asked: (who: Identity) => askedTodos.list(root, who, now(), () => projects.index()),
  };
  const changeProject: NonNullable<SearchableBrain['changeProject']> = async (action, identity) => {
    if (action.kind === 'update' || action.kind === 'update-remove') {
      try {
        const answer = await projectUpdates.change(action, identity);
        return { ...(await projects.list(identity)), ...answer };
      } finally {
        projects.changed();
      }
    }
    const list = await projects.change(action, identity);
    // A card or its links changed: files listed in any scope may now belong elsewhere.
    projects.changed();
    return { ...list, ...editAnswers.get(action) };
  };
  // A saved upload's listing refreshes and the project lists recount, as for a to-do upload.
  const onFileSaved = (path: string) => {
    library.changed(path);
    projects.changed(path);
  };
  return {
    root,
    ads,
    projectActivity: projectActivity.read,
    projectSeen: projectActivity.seen,
    projectArtifact: createProjectArtifact(root, {
      files: filesSkill,
      onSaved: onFileSaved,
    }),
    // Saved by `tdsapp-files add`, then linked through the same `changeProject` as "Add files".
    libraryUpload: createLibraryUpload(root, {
      files: filesSkill,
      scopes: () => library.scopes(),
      projects: (identity) => projects.list(identity),
      link: (action, identity) => changeProject(action, identity),
      onSaved: onFileSaved,
    }),
    projectMeetings: projectMeetings.read,
    projectBusiness: projectBusiness.read,
    homeMeetings: projectMeetings.home,
    emailDrafts,
    chatEntries: (key, chatId, identity) => projectUpdates.chatEntries(key, chatId, identity),
    myChatEntries: (key, identity) => projectUpdates.myChatEntries(key, identity),
    setHoldsChat: (fn) => {
      holdsChat = fn;
    },
    health: () => checkHealth(root),
    identity: () => readIdentity(root, run),
    profile: (identity) => readMemberProfile(root, identity),
    skills: (identity) => listSkills(root, identity),
    skillAccess: (identity, name) => skillAccess(root, identity, name),
    todos: (identity) =>
      listTodos(root, identity, {
        history: todoHistory,
        capabilities: () => todoSkill.capabilities(),
        filesCapabilities: () => filesSkill.capabilities(),
        projects: () => projects.index(),
      }),
    // Restricted projects: ticking reads the index too, so a hidden project's task that isn't theirs is not found.
    completeTodo: (id, by) => completeTodo(root, id, by, now(), { projects: () => projects.index() }),
    changeTodo: async (action, identity) => {
      const outcome = await changeTodo(root, action, identity, todoSkill, todoChangeDeps);
      // A to-do's project or stage moves its counts.
      projects.changed();
      return outcome;
    },
    completePersonalTodo: async (id, expect, by) => {
      await changeTodo(root, { kind: 'tick', id, scope: 'personal', expect }, by, todoSkill, todoChangeDeps);
    },
    completeTodoWithNote: async ({ id, scope, note, expect }, by) => {
      const tick = { kind: 'tick' as const, id, scope, note, ...(expect !== undefined ? { expect } : {}) };
      await changeTodo(root, tick, by, todoSkill, todoChangeDeps);
    },
    uploadTodoFile: (req, identity) =>
      uploadTodoFile(root, req, identity, todoSkill, {
        history: todoHistory,
        projects: () => projects.index(),
        clients: () => listClients(root),
        files: filesSkill,
        onSaved: (path) => {
          library.changed(path);
          projects.changed(path);
        },
      }),
    askedTodos: async (identity) =>
      askedTodos.list(
        root,
        identity,
        now(),
        () => projects.index(),
        await canUpdateTodos(root, identity, () => todoSkill.capabilities()),
      ),
    doneTodos: (identity) =>
      listDoneTodos(root, identity, { log: doneLog, projects: () => projects.index() }),
    teamTodo: (id, identity) => readTeamTodo(root, id, identity.slug, { projects: () => projects.index() }),
    todoHistory: (key, identity) =>
      todoTimeline.history(root, key, identity, {
        projects: () => projects.index(),
        asked: (who) => askedTodos.list(root, who, now(), () => projects.index()),
      }),
    clients: () => listClients(root),
    usedOften: async (identity, opts) => {
      const listed = new Set((await listSkills(root, identity)).map((s) => s.name));
      return readUsage(root, identity, listed, now(), opts);
    },
    libraryScopes: () => library.scopes(),
    librarySearch: (q, kind) => library.search(q, kind),
    libraryRecent: async (kind, project, identity) =>
      library.recent(kind, project, await myChanges.read(root, identity)),
    myChanges: (identity) => myChanges.read(root, identity),
    library: (scope) => library.list(scope),
    libraryFile: (id) => library.file(id),
    libraryItemForPath: (rel) => library.itemForPath(rel),
    projects: (identity) => projects.list(identity),
    projectsIndex: () => projects.index(),
    changeProject,
    projectUpdates: (key, before, identity) => projectUpdates.read(key, before, identity),
    // The service drops its own caches after a move; onMoved (above) drops the library's.
    moveProject: (req, identity, opts) => projects.move(req, identity, opts),
    removeProject: (req, identity, opts) => projects.remove(req, identity, opts),
    projectFiles: async (key, kind) => {
      const card = (await projects.index()).byKey(key);
      if (!card)
        throw new ProjectsError('not-found', "That project couldn't be found. It may have been moved.");
      return library.projectFiles(card, kind);
    },
    projectTodos: (key, identity) => projects.projectTodos(key, identity),
    tidy: (identity) => projects.tidy(identity),
    applyTidy: async (apply, identity) => {
      const list = await projects.applyTidy(apply, identity);
      projects.changed();
      return list;
    },
    deleteLibraryFile: async (id, opts) => {
      const who = await deleteAccess();
      if (!who) throw new FilesChangeError('not-allowed');
      const scope = scopeOfId(id);
      // Refused early for a clear message; the script checks all of this again.
      if (scope === null || scope === 'personal' || scope === LEGACY_PROJECTS_SCOPE)
        throw new FilesChangeError('not-allowed');
      if (
        scope === 'shared:templates' ? who.role !== 'owner' && who.role !== 'scout' : who.role === 'unknown'
      )
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
      projects.changed(file.item.path);
    },
    purgeDeletedFiles: async () => {
      try {
        return (await deleteAccess()) ? await filesSkill.purge() : 0;
      } catch {
        return 0;
      }
    },
    sync: () => syncReader.read(),
    watch: (onChange) => {
      const stop = watchBrain(root, onChange, {
        onLibraryChange: (rel, folder) => library.changed(rel, folder),
        onProjectsChange: (rel) => projects.changed(rel ?? undefined),
        onLibraryLive: (folder, on) => library.setLive(folder, on),
        onAdsChange: () => ads.changed(),
      });
      return () => {
        clearInterval(mergeTimer);
        stop();
      };
    },
  };
}

export type { Runner } from './identity.ts';
