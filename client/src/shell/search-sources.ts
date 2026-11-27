/**
 * The global search's sources, in the order their groups show (plan 2026-11-13-global-search, decisions 3
 * and 5). Contract: `SearchSource` and friends in `client/src/shell/contract.ts`.
 *
 * Built-ins first (Go to, To-dos, Open chats, Skills, Clients, Earlier chats), then each app's own
 * (`AppSlot.search`) and each section tool's own (`ToolSlot.search`, which checks its own visibility from `ctx.ads`), with async sources last so a late answer never moves the highlight.
 */
import type { DoneTodo, PastSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import { foldRef, refCandidates } from '../../../shared/project-refs.ts';
import { isRestricted } from '../../../shared/project-visibility.ts';
import { dueInWords } from '../format.ts';
import { helpLibrary } from '../help/library.ts';
import { projectPageRequest } from '../state/client-choice.ts';
import { projectText, todoPlaceParts } from '../state/projects.ts';
import { matchRank } from '../state/search-match.ts';
import { doneStore } from '../state/todo-done.ts';
import { APPS } from './apps.ts';
import type {
  DrawerName,
  IconName,
  SearchActions,
  SearchContext,
  SearchHit,
  SearchResults,
  SearchSource,
} from './contract.ts';
import { SECTIONS } from './sections.ts';
import { visibleSettingsTabs } from './settings-tabs.ts';
import { placeName, shortDay, whenWords } from './words.ts';

/** The Projects app's id (`apps.ts`): a Projects hit opens its page there. */
const PROJECTS_APP_ID = 'projects';

/** Hits shown per group; the heading says "6 of N" when there are more. */
export const SEARCH_GROUP_MAX = 6;

/** The id of the "Go to" source. Its single-letter hints are keyboard shortcuts (shown only with single keys on). */
export const GO_TO_SOURCE = 'go';

// ── Ranking ────────────────────────────────────────────────────────────────────────────────────

interface Match {
  title: string;
  fields: string[];
}

/** Ranks `items` against `query` (best first, `tie` breaks equal ranks, then the order given) and caps them. */
function ranked<T>(
  query: string,
  items: readonly T[],
  describe: (item: T) => Match,
  hit: (item: T) => SearchHit,
  tie: (a: T, b: T) => number = () => 0,
  alsoHit?: (item: T) => SearchHit,
): SearchResults {
  const scored: { item: T; rank: number }[] = [];
  for (const item of items) {
    const { title, fields } = describe(item);
    const rank = matchRank(query, title, fields);
    if (rank !== null) scored.push({ item, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || tie(a.item, b.item));
  const top = scored.slice(0, SEARCH_GROUP_MAX);
  return {
    hits: top.flatMap((s) => (alsoHit ? [hit(s.item), alsoHit(s.item)] : [hit(s.item)])),
    total: scored.length,
  };
}

/** Soonest due first, undated last. */
const soonest = (a: { due: string | null }, b: { due: string | null }): number => {
  if (a.due === b.due) return 0;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  return a.due < b.due ? -1 : 1;
};

/** Newest first, from ISO times (an unreadable time counts as oldest). */
const newest = (a: string, b: string): number => (Date.parse(b) || 0) - (Date.parse(a) || 0);

// ── Go to ──────────────────────────────────────────────────────────────────────────────────────

interface GoTo {
  id: string;
  label: string;
  /** "T", "C", "S": the key that opens a drawer. */
  hint: string | null;
  icon: IconName;
  /** Other words that find this entry (an old name), never shown. */
  terms?: string[];
  run: (actions: SearchActions) => void;
}

/**
 * One entry per drawer: how "Go to" shows it and which source searches what is in it. A `Record`, so a
 * new `DrawerName` fails type-check until it says how it is searched.
 */
const DRAWERS: Record<
  Exclude<DrawerName, 'help' | 'section'>,
  { go: Omit<GoTo, 'run'>; source: SearchSource }
> = {
  todos: {
    go: {
      id: 'go-todos',
      label: 'Tasks',
      hint: 'T',
      icon: 'todos',
      // Tasks used to be called to-dos: the old word still jumps here.
      terms: ['to-do', 'to-dos', 'todo', 'todos'],
    },
    source: {
      id: 'todos',
      title: 'Tasks',
      search: (query, ctx) => {
        const { mine, open } = ctx.todos ?? { mine: [], open: [] };
        const all: { todo: TodoItem; isOpen: boolean }[] = [
          ...mine.map((todo) => ({ todo, isOpen: false })),
          ...open.map((todo) => ({ todo, isOpen: true })),
        ];
        return ranked(
          query,
          all,
          ({ todo }) => ({
            title: todo.title,
            // The words the row shows: client and project by name, never a folder name.
            fields: [todo.details, ...todoPlaceParts(todo, ctx.projects, ctx.clients)],
          }),
          ({ todo, isOpen }) => todoHit(todo, isOpen, ctx),
          (a, b) => soonest(a.todo, b.todo),
        );
      },
      // What the palette showed before: the first five of mine, soonest due first.
      idle: (ctx) =>
        [...(ctx.todos?.mine ?? [])]
          .sort(soonest)
          .slice(0, 5)
          .map((todo) => todoHit(todo, false, ctx)),
    },
  },
  chats: {
    go: { id: 'go-chats', label: 'Chats', hint: 'C', icon: 'chat' },
    source: {
      id: 'chats',
      title: 'Open chats',
      search: (query, ctx) =>
        ranked(
          query,
          ctx.live,
          (s) => ({ title: s.title, fields: s.client ? [placeName(s.client, ctx.clients)] : [] }),
          (s) => ({
            id: s.id,
            label: s.title,
            hint: s.client ? placeName(s.client, ctx.clients) : null,
            icon: 'chat',
            run: (a) => a.openChat(s.id),
          }),
          (a, b) => newest(a.lastActivityAt, b.lastActivityAt),
        ),
      idle: (ctx) =>
        ctx.live.slice(0, SEARCH_GROUP_MAX).map((s) => ({
          id: s.id,
          label: s.title,
          hint: s.client ? placeName(s.client, ctx.clients) : null,
          icon: 'chat',
          run: (a) => a.openChat(s.id),
        })),
    },
  },
  skills: {
    go: { id: 'go-skills', label: 'Skills', hint: 'S', icon: 'skills' },
    source: {
      id: 'skills',
      title: 'Skills',
      // Owners and scouts only (`skillsHidden`): the team doesn't start skills from Cortex's own buttons (Ian, 2026-11-25).
      search: (query, ctx) => {
        if (ctx.skillsHidden) return { hits: [], total: 0 };
        const pinRank = (s: SkillInfo) => {
          const i = ctx.pins.indexOf(s.name);
          return i === -1 ? Number.POSITIVE_INFINITY : i;
        };
        return ranked(
          query,
          ctx.skills,
          (s) => ({ title: s.title, fields: [s.description, s.name] }),
          skillHit,
          (a, b) => (pinRank(a) === pinRank(b) ? 0 : pinRank(a) < pinRank(b) ? -1 : 1),
        );
      },
      // Favourite skills, in the order they were starred (kept as the prefs' `pins`).
      idle: (ctx) =>
        (ctx.skillsHidden ? [] : ctx.pins).flatMap((name) => {
          const skill = ctx.skills.find((s) => s.name === name);
          return skill ? [skillHit(skill)] : [];
        }),
    },
  },
};

const skillHit = (skill: SkillInfo): SearchHit => ({
  id: skill.name,
  label: skill.title,
  hint: null,
  icon: 'skills',
  run: (a) => a.startSkill(skill),
});

function todoHit(todo: TodoItem, isOpen: boolean, ctx: SearchContext): SearchHit {
  const hint = [
    todoPlaceParts(todo, ctx.projects, ctx.clients)[0],
    isOpen ? 'Open to anyone' : null,
    todo.due ? dueInWords(todo.due) : null,
    todo.scope === 'personal' ? 'Personal' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: todo.key,
    label: todo.title,
    hint: hint || null,
    icon: 'todos',
    run: (a) => a.revealTodo(todo),
  };
}

/** "5 Nov", with the year when it isn't this year ("5 Nov 2025"), so an old finished to-do doesn't look recent. */
function doneDay(iso: string, now: Date): string {
  const day = shortDay(iso);
  const year = new Date(iso).getFullYear();
  return day && year !== now.getFullYear() ? `${day} ${year}` : day;
}

function doneHit(todo: DoneTodo, ctx: SearchContext): SearchHit {
  const day = todo.done ? doneDay(todo.done.at, new Date()) : '';
  const hint = [
    day ? `Done ${day}` : 'Done, date not known',
    todoPlaceParts(todo, ctx.projects, ctx.clients)[0],
    todo.scope === 'personal' ? 'Personal' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: todo.key,
    label: todo.title,
    hint,
    icon: 'todos',
    run: (a) => a.revealDone?.(todo.key),
  };
}

/**
 * Finished to-dos (done-todos plan, decision 8): their own group, last, with its own cap. Reads the shared
 * done store's loaded list (the palette starts the load and re-runs this when it arrives), so it needs
 * the client and project names from the context, which an async source is not given. Only with a query.
 */
const doneTodos: SearchSource = {
  id: 'done-todos',
  title: 'Done tasks',
  search: (query, ctx) => {
    const items = doneStore.get().list?.items ?? [];
    return ranked(
      query,
      items,
      (todo) => ({
        title: todo.title,
        fields: [todo.details, ...todoPlaceParts(todo, ctx.projects, ctx.clients)],
      }),
      (todo) => doneHit(todo, ctx),
    );
  },
};

/** A project code typed with brackets, spaces or in lower case reads as the folded code; any other text is left alone. */
function codeQuery(query: string): string {
  const bare = query.replace(/[[\]\s]/g, '');
  const words = refCandidates(query.replace(/[[\]]/g, ' '));
  return words.length === 1 && words[0]?.length === bare.length ? foldRef(bare) : query;
}

/**
 * Projects (decision 14): matched on title, the client's name and aliases, and the slug. Archived projects
 * are left out. Choosing one sets the picker ("Filter to this project"), which narrows Home, To-dos,
 * Images, Documents and search.
 */
const projects: SearchSource = {
  id: 'projects',
  title: 'Projects',
  search: (rawQuery, ctx) =>
    ranked(
      codeQuery(rawQuery),
      (ctx.projects ?? []).filter((p) => !p.archived),
      (p) => {
        const client = ctx.clients.find((c) => c.slug === p.client);
        return {
          title: p.title || p.slug,
          fields: [
            p.slug,
            p.slug.replace(/-/g, ' '),
            client?.name ?? p.client ?? '',
            ...(client?.aliases ?? []),
            // The project code, as written and folded (O/0, I/1 in the client part).
            ...(p.ref ? [p.ref, foldRef(p.ref)] : []),
          ],
        };
      },
      (p) => ({
        id: p.key,
        label: projectText(p, ctx.clients),
        hint: 'Open project',
        icon: 'bullets',
        ...(isRestricted(p) ? { restricted: true } : {}),
        run: (a) => {
          // The Projects app reads the request when it shows (or is already showing).
          projectPageRequest.set(p.key);
          a.openView(`app:${PROJECTS_APP_ID}`);
        },
      }),
      (a, b) => b.openTodos - a.openTodos,
      // The second action, as its own row straight after the first.
      (p) => ({
        id: `${p.key}#filter`,
        label: projectText(p, ctx.clients),
        hint: 'Filter to this project',
        icon: 'bullets',
        ...(isRestricted(p) ? { restricted: true } : {}),
        run: (a) => a.filterToProject?.(p.key),
      }),
    ),
};

/**
 * Help is a drawer with nothing inside to search, so it has a "Go to" entry and no source. Shown only where Help is
 * switched on for the person (`SearchContext.helpVisible`).
 */
const HELP_GO: Omit<GoTo, 'run'> = { id: 'go-help', label: 'Help', hint: 'H', icon: 'help' };

/** The Cortex Guide sheet: shown with Help, to the same people. */
const GUIDE_GO: Omit<GoTo, 'run'> = { id: 'go-guide', label: 'Cortex Guide', hint: null, icon: 'help' };

/** "Go to": Home, each drawer, Help (where it is on), Settings, then every app on the rail. Derived, never hard-coded per app. */
function goToEntries(ctx?: SearchContext): GoTo[] {
  const drawer = (name: Exclude<DrawerName, 'help' | 'section'>): GoTo => ({
    ...DRAWERS[name].go,
    run: (a) => a.openDrawer(name),
  });
  return [
    { id: 'go-home', label: 'Home', hint: null, icon: 'home', run: (a) => a.goHome() },
    drawer('todos'),
    drawer('chats'),
    ...(ctx?.skillsHidden ? [] : [drawer('skills')]),
    ...(ctx?.helpVisible
      ? [
          { ...HELP_GO, run: (a: SearchActions) => a.openDrawer('help') },
          { ...GUIDE_GO, run: (a: SearchActions) => a.openView('guide') },
        ]
      : []),
    {
      id: 'go-settings',
      label: 'Settings',
      hint: null,
      icon: 'settings',
      run: (a) => a.openView('settings'),
    },
    ...visibleSettingsTabs({ hasSkillLevels: Boolean(ctx?.hasSkillLevels) }).map(
      (t): GoTo => ({
        id: `go-settings-${t.id}`,
        label: `Settings: ${t.label}`,
        hint: null,
        icon: 'settings',
        // An older palette without the tab action opens Settings on the tab it remembers.
        run: (a) => (a.openSettings ? a.openSettings(t.id) : a.openView('settings')),
      }),
    ),
    ...APPS.map(
      (app): GoTo => ({
        id: `go-app-${app.id}`,
        label: app.title,
        hint: null,
        icon: app.icon,
        run: (a) => a.openView(`app:${app.id}`),
      }),
    ),
  ];
}

function goToHit(entry: GoTo): SearchHit {
  return {
    id: entry.id,
    label: entry.label,
    hint: entry.hint,
    icon: entry.icon,
    run: (a) => entry.run(a),
  };
}

const goTo: SearchSource = {
  id: GO_TO_SOURCE,
  title: 'Go to',
  search: (query, ctx) =>
    ranked(query, goToEntries(ctx), (e) => ({ title: e.label, fields: e.terms ?? [] }), goToHit),
  idle: (ctx) => goToEntries(ctx).map(goToHit),
};

// ── The other built-ins ────────────────────────────────────────────────────────────────────────

const clients: SearchSource = {
  id: 'clients',
  title: 'Clients',
  search: (query, ctx) =>
    ranked(
      query,
      ctx.clients,
      (c) => ({ title: c.name, fields: [c.slug.replace(/-/g, ' ')] }),
      (c) => ({
        id: c.slug,
        label: c.name,
        hint: null,
        icon: 'person',
        run: (a) => a.chooseClient(c.slug),
      }),
    ),
};

const earlierChats: SearchSource = {
  id: 'earlier',
  title: 'Earlier chats',
  // Title only: an earlier chat has no client to match on.
  search: (query, ctx) =>
    ranked(
      query,
      ctx.past.filter((s) => s.title.trim() !== ''),
      (s: PastSession) => ({ title: s.title, fields: [] }),
      (s) => ({
        id: s.sdkSessionId,
        label: s.title,
        hint: whenWords(s.lastModified) || null,
        icon: 'chat',
        run: (a) => a.openPast(s.sdkSessionId),
      }),
      (a, b) => newest(a.lastModified, b.lastModified),
    ),
};

/** Help pages (where `SearchContext.helpVisible`, which is everyone): the best five, each opening the Help drawer on its page. */
const help: SearchSource = {
  id: 'help',
  title: 'Help',
  search: (query, ctx) => {
    if (!ctx.helpVisible) return { hits: [], total: 0 };
    const hits = helpLibrary.search(query, 5).map(
      (t): SearchHit => ({
        id: t.id,
        label: t.title,
        hint: t.summary,
        icon: 'help',
        run: (a) => a.openHelp(t.id),
      }),
    );
    return { hits, total: hits.length };
  },
};

/**
 * Every source, in group order: Go to, To-dos, Open chats, Skills, Clients, Projects, Earlier chats, Help, then the apps'
 * (`AppSlot.search`). Async sources go last whatever their place, so a late answer never moves the highlight.
 * Built each time it is called, so it follows `APPS`.
 */
export function searchSources(): SearchSource[] {
  const all = [
    goTo,
    DRAWERS.todos.source,
    DRAWERS.chats.source,
    DRAWERS.skills.source,
    clients,
    projects,
    earlierChats,
    help,
    ...APPS.flatMap((a) => (a.search ? [a.search] : [])),
    ...SECTIONS.flatMap((s) => s.tools.flatMap((t) => (t.search ? [t.search] : []))),
    doneTodos,
  ];
  return [...all.filter((s) => !s.searchAsync), ...all.filter((s) => s.searchAsync)];
}
