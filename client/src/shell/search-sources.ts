/**
 * The global search's sources, in the order their groups show (plan 2026-11-13-global-search, decisions 3
 * and 5). Contract: `SearchSource` and friends in `client/src/shell/contract.ts`.
 *
 * Built-ins first (Go to, To-dos, Open chats, Skills, Clients, Earlier chats), then each app's own
 * (`AppSlot.search`), with async sources last so a late answer never moves the highlight.
 */
import type { PastSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import { dueInWords } from '../format.ts';
import { matchRank } from '../state/search-match.ts';
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
import { placeName, todoPlaces, whenWords } from './words.ts';

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
): SearchResults {
  const scored: { item: T; rank: number }[] = [];
  for (const item of items) {
    const { title, fields } = describe(item);
    const rank = matchRank(query, title, fields);
    if (rank !== null) scored.push({ item, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || tie(a.item, b.item));
  return { hits: scored.slice(0, SEARCH_GROUP_MAX).map((s) => hit(s.item)), total: scored.length };
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
  run: (actions: SearchActions) => void;
}

/**
 * One entry per drawer: how "Go to" shows it and which source searches what is in it. A `Record`, so a
 * new `DrawerName` fails type-check until it says how it is searched.
 */
const DRAWERS: Record<DrawerName, { go: Omit<GoTo, 'run'>; source: SearchSource }> = {
  todos: {
    go: { id: 'go-todos', label: 'To-dos', hint: 'T', icon: 'todos' },
    source: {
      id: 'todos',
      title: 'To-dos',
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
            fields: [todo.details, ...todoPlaces(todo, ctx.clients)],
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
      search: (query, ctx) => {
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
      // Pinned skills, in pin order.
      idle: (ctx) =>
        ctx.pins.flatMap((name) => {
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
    todoPlaces(todo, ctx.clients)[0],
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

/** "Go to": Home, each drawer, Settings, then every app on the rail. Derived, never hard-coded per app. */
function goToEntries(): GoTo[] {
  const drawer = (name: DrawerName): GoTo => ({
    ...DRAWERS[name].go,
    run: (a) => a.openDrawer(name),
  });
  return [
    { id: 'go-home', label: 'Home', hint: null, icon: 'home', run: (a) => a.goHome() },
    drawer('todos'),
    drawer('chats'),
    drawer('skills'),
    {
      id: 'go-settings',
      label: 'Settings',
      hint: null,
      icon: 'settings',
      run: (a) => a.openView('settings'),
    },
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
  search: (query) => ranked(query, goToEntries(), (e) => ({ title: e.label, fields: [] }), goToHit),
  idle: () => goToEntries().map(goToHit),
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

/**
 * Every source, in group order: Go to, To-dos, Open chats, Skills, Clients, Earlier chats, then the apps'
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
    earlierChats,
    ...APPS.flatMap((a) => (a.search ? [a.search] : [])),
  ];
  return [...all.filter((s) => !s.searchAsync), ...all.filter((s) => s.searchAsync)];
}
