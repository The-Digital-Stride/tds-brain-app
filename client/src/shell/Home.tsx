import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  attentionFor,
  type ClientGuessResponse,
  type ClientPickReported,
  type LibraryItemsResponse,
  type LibraryKind,
  type LibraryRecentResponse,
  type SkillInfo,
  type TodoItem,
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { Composer } from '../components/Composer.tsx';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { homeOrderKey } from '../state/card-order.ts';
import { projectIfClientMatches } from '../state/chat-project.ts';
import {
  clientForProject,
  clientSlugOf,
  projectChoice,
  projectPageRequest,
  useProjectChoice,
} from '../state/client-choice.ts';
import { isClearCommand } from '../state/close.ts';
import { greeting, summary } from '../state/home.ts';
import { isShown, resolveShortcut } from '../state/home-layout.ts';
import {
  PINNED_ROWS,
  type PinnedChat,
  pinnedChats,
  pinnedFileIds,
  pinnedTodos,
  RECENT_MAX,
  recentChats,
  recentProjects,
  recentTodos,
  todoArrival,
} from '../state/home-pins.ts';
import { ASYNC_RETRIES, ASYNC_RETRY_MS } from '../state/palette.ts';
import { filterOptions, projectText, todoPlaceParts, useProjects } from '../state/projects.ts';
import { todoProjectKey } from '../state/todo-filter.ts';
import { isNewToYou } from '../state/todo-new.ts';
import { useStore } from '../store.tsx';
import { ClientAsk } from './ClientAsk.tsx';
import type { DrawerName } from './contract.ts';
import { HomeMeetings } from './HomeMeetings.tsx';
import { SearchSelect } from './SearchSelect.tsx';
import { SheetBar } from './SheetBar.tsx';
import { useShell } from './ShellProvider.tsx';
import { ShowMore } from './ShowMore.tsx';
import { NO_FAVOURITES, StarButton, useStarFocus } from './StarButton.tsx';
import { StateNote } from './StateNote.tsx';
import { clientOptions } from './search-select.ts';
import { useCardOrder } from './useCardOrder.tsx';
import { useHomeShortcuts } from './useHomeShortcuts.ts';
import { WhatsNewCard } from './WhatsNewCard.tsx';
import { placeName, STATE_WORDS, starterSkills, whenWords } from './words.ts';

/** Meta line parts, e.g. "overdue by 2 days", "Acme Heating". Joined with ", " in the text; only the overdue part is late. */
function metaParts(
  t: TodoItem,
  today: string,
  clientName: (slug: string | null) => string | null,
  place?: string | null,
): { text: string; late?: boolean }[] {
  const parts: { text: string; late?: boolean }[] = [];
  if (t.due) parts.push({ text: dueInWords(t.due, today), late: isOverdue(t.due, today) });
  // "Client · Project" when the to-do is in a known project; else the client, as before.
  const name = place ?? clientName(t.client);
  if (name) parts.push({ text: name });
  return parts;
}

const ALL = 'all';

/** "24 Nov" (with the year when it isn't this one): the day a project was last worked on. */
function whenDate(iso: string): string {
  // A bare day ("2026-11-24") is read at midday so no time zone moves it to the day before.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * The app-wide picker (decision 11), as one control: "Working on [project]", every live project under its
 * client. Choosing a project narrows Home, the To-dos drawer, Images, Documents and search, and starts a new
 * chat's "Chat for" on that project's client. It sits in the message box beside Chat for, first because it
 * drives it (Ian, 2026-11-21). Shown once the brain has projects.
 */
function ProjectPicker({
  clients,
  disabled = false,
}: {
  clients: { slug: string; name: string; aliases?: string[] }[];
  /** While a client guess or question is pending, as Chat for: the project can't change the chat mid-send. */
  disabled?: boolean;
}) {
  const { list } = useProjects();
  const project = useProjectChoice();
  const cards = list?.projects ?? [];
  if (cards.length === 0 && !project) return null;
  return (
    <span className="scope-field">
      <label className="client-label" htmlFor="pick-project">
        Working on
      </label>
      <SearchSelect
        id="pick-project"
        className="project-select"
        value={project || ALL}
        options={[{ value: ALL, label: 'All projects' }, ...filterOptions(cards, clients)]}
        recentKey="projects"
        disabled={disabled}
        onChange={(v) => projectChoice.set(v === ALL ? '' : v)}
      />
    </span>
  );
}

/** Every Home card that can show, in the default order (Ads approvals only while something waits). */
const HOME_CARDS = [
  'meetings',
  'ads',
  'todos',
  'recent-todos',
  'projects',
  'chats',
  'recent-chats',
  'files',
  'recent-documents',
  'recent-images',
  'skills',
];

type RecentFiles = {
  /** The reply's files, for the project it was asked for. */
  files: LibraryRecentResponse['files'] | null;
  project: string;
  failed: boolean;
  /** A partial answer is being asked again. */
  waiting: boolean;
  /** A non-partial answer for this project has arrived, so an empty list really is empty. */
  complete: boolean;
};

/**
 * One Recent files card's list (plan 2026-11-25-home-recent-cards, decision 7). Skipped while the card is hidden;
 * redone when the library changes or Working on does. A reply for an older kind or project is dropped, old rows
 * stay while a new request for the same project runs, and a `partial` answer is asked again every second, up to
 * five more times.
 */
function useRecentFiles(kind: LibraryKind, project: string, hidden: boolean, libraryVersion: number) {
  const [state, setState] = useState<RecentFiles>({
    files: null,
    project,
    failed: false,
    waiting: false,
    complete: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `libraryVersion` refreshes after a change on disk
  useEffect(() => {
    if (hidden) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (retried: number) => {
      Promise.resolve()
        .then(() => api.libraryRecent(kind, project || undefined))
        .then((r) => {
          if (!current) return;
          const again = r.partial === true && retried < ASYNC_RETRIES;
          setState({ files: r.files ?? [], project, failed: false, waiting: again, complete: !r.partial });
          if (again) timer = setTimeout(() => attempt(retried + 1), ASYNC_RETRY_MS);
        })
        .catch(() => {
          if (!current) return;
          // Another project's rows are not kept under this one.
          setState((s) =>
            s.project === project
              ? { ...s, failed: true, waiting: false }
              : { files: null, project, failed: true, waiting: false, complete: false },
          );
        });
    };
    attempt(0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [kind, project, hidden, libraryVersion]);
  // Rows kept from another project are not shown under this one.
  const mine = state.project === project ? state.files : null;
  const here = state.project === project;
  return {
    files: mine,
    failed: here && state.failed,
    waiting: here && state.waiting,
    complete: here && state.complete,
  };
}

/** How long a star in a Recent card holds its row in place while Pinned files catches up. */
const HOLD_MS = 3000;

const AUTO = '@auto';
const NONE = '@none';
/** How much of the first message is used to work out the client. */
const GUESS_CHARS = 4000;
/** The "Working out the client…" note only appears when the guess is slow. */
const STATUS_DELAY_MS = 400;

/** The light dashboard shown for a new chat: greeting, composer, and three cards of what needs you. */
export function Home() {
  const {
    boot,
    todos,
    sessions,
    activeChat,
    send,
    composerFocus,
    startSkill,
    startChat,
    newChat,
    openChat,
    markTodosSeen,
    openPast,
    openView,
    libraryVersion,
    ads,
    homeHidden,
    homeShortcuts,
    openTool,
    revealTodo,
    toggleFavouriteTodo,
    toggleFavouriteChat,
    toggleFavouriteFile,
    togglePin,
  } = useStore();
  const { dispatch, openCustomiseHome } = useShell();
  const { sources: shortcutSources, hasGm, hasAds, hasSkills } = useHomeShortcuts();
  const clients = boot?.clients ?? [];
  const project = useProjectChoice();
  const { list: projectList } = useProjects();
  // The client picker's value: "auto", "none" or a slug. A chat opened with a client (palette, to-do) starts on it.
  const [picked, setPicked] = useState<{ key: number; value: string } | null>(null);
  // Pinned cards opened with "Show N more". Not saved: Home starts compact each visit.
  const [expanded, setExpanded] = useState<Record<PinnedCard, boolean>>({
    todos: false,
    projects: false,
    chats: false,
    files: false,
    recentTodos: false,
    recentChats: false,
    recentDocuments: false,
    recentImages: false,
  });
  const toggleCard = (c: PinnedCard) => setExpanded((e) => ({ ...e, [c]: !e[c] }));
  const rowsShown = (c: PinnedCard) => (expanded[c] ? undefined : PINNED_ROWS);
  const [ask, setAsk] = useState<{
    options: string[];
    choose: (slug: string | null) => void;
    cancel: () => void;
  } | null>(null);
  const [status, setStatus] = useState('');
  // True from Send (with auto) until the chat starts or the question is cancelled.
  const [busy, setBusy] = useState(false);
  const cancelAsk = useRef<(() => void) | null>(null);
  // A pending question ends (as "not sent") when Home goes away.
  useEffect(() => () => cancelAsk.current?.(), []);
  // So does opening another new chat.
  const chatKey = activeChat.kind === 'new' ? activeChat.key : -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chat changes
  useEffect(() => () => cancelAsk.current?.(), [chatKey]);
  const listed = (slug: string) => clients.some((c) => c.slug === slug);
  // Working on's project starts Chat for on its client (a personal project on No client); a client not in the list
  // leaves it on Auto. Worked out here, never stored, and never written back: picking Chat for by hand changes
  // nothing app-wide.
  const fromProject = (() => {
    if (!project) return null;
    const slug = clientSlugOf(clientForProject(project));
    if (slug === '') return NONE;
    return slug && listed(slug) ? slug : null;
  })();
  // A chat opened with a client (palette, to-do) starts on it; else on Working on's client; else Auto.
  const initial =
    activeChat.kind === 'new' && activeChat.client !== undefined
      ? (activeChat.client ?? NONE)
      : (fromProject ?? AUTO);
  // The project this chat is for: the one it was opened with (to-do, project page), else Working on's. It goes
  // with the chat only while the final client is still that project's own (plan decision 2).
  const presetProject = activeChat.kind === 'new' ? (activeChat.project ?? null) : null;
  const candidateProject = presetProject ?? (project || null);
  const projectFor = (client: string | null) =>
    projectIfClientMatches(candidateProject, projectList?.projects, clients, client);
  const presetCard = presetProject ? projectList?.projects.find((p) => p.key === presetProject) : undefined;
  const byHand = activeChat.kind === 'new' && picked?.key === activeChat.key;
  const choice = byHand ? (picked?.value ?? initial) : initial;
  const presetByChat = activeChat.kind === 'new' && activeChat.client !== undefined;
  // Said only when the project set it: not a hand pick, nor a to-do's or the palette's client that matches.
  // A preset project is shown as text while it will still be sent (Chat for hasn't been hand-picked away from it).
  const showPreset =
    presetProject !== null && choice !== AUTO && projectFor(choice === NONE ? null : choice) !== null;
  const setByProject = !byHand && !presetByChat && fromProject !== null;
  // Counted in the app's own data folder so we can see how often people are asked; never in the way.
  const report = (outcome: ClientPickReported) =>
    void Promise.resolve()
      .then(() => api.clientPickOutcome(outcome))
      .catch(() => {});

  const filesHidden = !isShown('files', homeHidden);
  const fileFavs = boot?.prefs.favouriteFiles;
  const fileKey = (fileFavs ?? []).join('\n');
  // The pinned files, looked up by id. The newest reply wins, old rows stay while a new lookup runs, and rows
  // are filtered by the current stars, so unpinning a file removes it at once.
  const [pinnedFiles, setPinnedFiles] = useState<LibraryItemsResponse['files'] | null>(null);
  const [filesFailed, setFilesFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fileKey` stands for the list; `libraryVersion` refreshes after a change on disk
  useEffect(() => {
    // A hidden Pinned files card needs no lookup.
    if (filesHidden) return;
    const ids = pinnedFileIds(fileKey === '' ? [] : fileKey.split('\n'));
    if (ids.length === 0) {
      setPinnedFiles([]);
      setFilesFailed(false);
      return;
    }
    let current = true;
    api
      .libraryItems(ids)
      .then((r) => {
        if (!current) return;
        setPinnedFiles(r.files);
        setFilesFailed(false);
      })
      .catch(() => {
        if (current) setFilesFailed(true);
      });
    return () => {
      current = false;
    };
  }, [fileKey, libraryVersion, filesHidden]);

  const recentDocsHidden = !isShown('recent-documents', homeHidden);
  const recentImagesHidden = !isShown('recent-images', homeHidden);
  const recentDocs = useRecentFiles('document', project, recentDocsHidden, libraryVersion);
  const recentImages = useRecentFiles('image', project, recentImagesHidden, libraryVersion);

  // Each card's star keeps focus when its row moves or goes (a favourite taken off leaves the card).
  const todoCard = useRef<HTMLElement>(null);
  const chatCard = useRef<HTMLElement>(null);
  const fileCard = useRef<HTMLElement>(null);
  const skillCard = useRef<HTMLElement>(null);
  const todoStar = useStarFocus(todoCard, boot?.prefs.favouriteTodos ?? NO_FAVOURITES);
  const chatStar = useStarFocus(chatCard, boot?.prefs.favouriteChats ?? NO_FAVOURITES);
  // A star in a Recent card must not move on screen: its Pinned twin can grow above it and push it down. The
  // pressed button and its top are kept, and the next render scrolls Home by however far it moved. A file star
  // waits for the Pinned files lookup (its new row only arrives with the reply), so the hold lasts until
  // `pinnedFiles` changes, the lookup fails, or HOLD_MS passes.
  const heldStar = useRef<{
    button: HTMLElement;
    top: number;
    files?: typeof pinnedFiles;
    until: number;
  } | null>(null);
  const holdPlace = (button: HTMLElement, waitForFiles = false) => {
    heldStar.current = {
      button,
      top: button.getBoundingClientRect().top,
      ...(waitForFiles && !filesHidden ? { files: pinnedFiles } : {}),
      until: Date.now() + HOLD_MS,
    };
  };
  useLayoutEffect(() => {
    const held = heldStar.current;
    if (!held) return;
    const waiting = 'files' in held && held.files === pinnedFiles && !filesFailed && Date.now() < held.until;
    if (!waiting) heldStar.current = null;
    if (!held.button.isConnected) {
      heldStar.current = null;
      return;
    }
    const shift = held.button.getBoundingClientRect().top - held.top;
    const scroller = held.button.closest('.home-scroll');
    if (shift === 0 || !scroller) return;
    scroller.scrollTop += shift;
    // Where it rests now (short of the mark when Home can't scroll that far), so a later render never scrolls twice.
    held.top = held.button.getBoundingClientRect().top;
  });
  const fileStar = useStarFocus(fileCard, boot?.prefs.favouriteFiles ?? NO_FAVOURITES);
  const skillStar = useStarFocus(skillCard, boot?.prefs.pins ?? NO_FAVOURITES);

  // The cards' order, as this person dragged it (kept in this browser, per person). Ads approvals only while
  // something waits; its saved place is kept while it's hidden.
  // Recent projects only while some project has been worked on; its saved place is kept while it's hidden.
  const projectsShown = recentProjects(projectList?.projects).length > 0;
  const adsShown = Boolean(ads?.visible && ads.waiting > 0);
  // A card the person hid is left out of the list (its saved place is kept, as for Ads and projects) and so isn't drawn.
  const cardList = [
    { id: 'meetings', title: 'Meetings', shown: isShown('meetings', homeHidden) },
    { id: 'ads', title: 'Ads approvals', shown: isShown('ads', homeHidden, adsShown) },
    { id: 'todos', title: 'Pinned tasks', shown: isShown('todos', homeHidden) },
    { id: 'recent-todos', title: 'Recent tasks', shown: isShown('recent-todos', homeHidden) },
    { id: 'projects', title: 'Recent projects', shown: isShown('projects', homeHidden, projectsShown) },
    { id: 'chats', title: 'Pinned chats', shown: isShown('chats', homeHidden) },
    { id: 'recent-chats', title: 'Recent chats', shown: isShown('recent-chats', homeHidden) },
    { id: 'files', title: 'Pinned files', shown: !filesHidden },
    { id: 'recent-documents', title: 'Recent documents', shown: !recentDocsHidden },
    { id: 'recent-images', title: 'Recent images', shown: !recentImagesHidden },
    // Owners and scouts only: the team doesn't start skills from Cortex's own buttons (Ian, 2026-11-25).
    { id: 'skills', title: 'Pinned skills', shown: isShown('skills', homeHidden, hasSkills) },
  ];
  const shownCards = cardList.filter((c) => c.shown);
  const order = useCardOrder(
    shownCards.map(({ id, title }) => ({ id, title })),
    boot ? homeOrderKey(boot.identity.slug) : null,
    HOME_CARDS,
  );
  if (!boot) return null;

  const today = todayIso();
  const live = sessions?.live ?? [];
  const mine = todos?.mine ?? [];
  // Only a chosen project narrows Home; a client alone behaves as it always has.
  const inProject = <T extends TodoItem>(t: T) => !project || todoProjectKey(t) === project;
  const recentProjectRows = recentProjects(projectList?.projects);
  const pinnedTodoRows = pinnedTodos(mine, todos?.open ?? [], boot.prefs.favouriteTodos ?? []).filter(
    inProject,
  );
  const recentTodoRows = recentTodos(mine, todos?.open ?? [], today, boot.identity.slug)
    .filter(inProject)
    .slice(0, RECENT_MAX);
  const recentChatRows = recentChats(live, sessions?.past ?? []).slice(0, RECENT_MAX);
  const favTodos = new Set(boot.prefs.favouriteTodos ?? []);
  const favChats = new Set(boot.prefs.favouriteChats ?? []);
  const pinnedChatRows = pinnedChats(live, sessions?.past ?? [], boot.prefs.favouriteChats ?? []);
  const starredFiles = new Set(boot.prefs.favouriteFiles ?? []);
  const pinnedFileRows = (pinnedFiles ?? []).filter(
    (f) => starredFiles.has(f.item.id) && (!project || (f.item.projects ?? []).includes(project)),
  );
  const openFile = (f: LibraryItemsResponse['files'][number]) =>
    dispatch({
      type: 'open-viewer',
      viewer: {
        item: f.item,
        place: f.scope.name,
        openIn: { app: f.item.kind === 'image' ? 'images' : 'documents', scope: f.scope.id },
      },
    });
  const chatStarFor = (
    chat: { sdkSessionId: string | null; title?: string | null },
    on = true,
    track = true,
  ) => (
    <StarButton
      id={chat.sdkSessionId ?? ''}
      title={chat.title || 'New chat'}
      on={on}
      onPress={(id, button) => {
        // A favourite chat always has its id; the guard is for the type's sake.
        if (!id) return;
        // Only the Pinned card moves rows when a star changes; a Recent row stays where it is.
        if (track) chatStar(id, button);
        else holdPlace(button);
        void toggleFavouriteChat(id);
      }}
    />
  );
  const chatRowNode = (row: PinnedChat, star: ReactNode) =>
    row.kind === 'live' ? (
      <HomeRow key={row.chat.sdkSessionId ?? row.chat.id} onOpen={() => openChat(row.chat.id)} star={star}>
        <span className="dot" data-attention={attentionFor(row.chat.state) ?? undefined} aria-hidden="true" />
        <span className="line-text">
          <span className="line-title">{row.chat.title}</span>
          <span className="line-meta">{STATE_WORDS[row.chat.state]}</span>
        </span>
      </HomeRow>
    ) : (
      <HomeRow key={row.chat.sdkSessionId} onOpen={() => void openPast(row.chat.sdkSessionId)} star={star}>
        <span className="line-text">
          <span className="line-title">{row.chat.title || 'New chat'}</span>
          <span className="line-meta">{whenWords(row.chat.lastModified)}</span>
        </span>
      </HomeRow>
    );
  const openDrawer = (drawer: DrawerName) => dispatch({ type: 'open-drawer', drawer });
  const clientName = (slug: string | null) => (slug ? placeName(slug, clients) : null);

  const openTodo = (todo: TodoItem) => {
    // Opening a to-do someone passed to you counts as seeing it.
    if (isNewToYou(todo, boot.identity.slug, boot.prefs.todoSeen ?? {}, new Date())) markTodosSeen([todo]);
    // A row opens the to-do in the to-do panel (read first), as search does; it never starts a chat. The chat
    // button inside the panel does that.
    openDrawer('todos');
    revealTodo(todo);
  };

  const fileFavs2 = new Set(boot.prefs.favouriteFiles ?? []);
  // Recent documents and Recent images: the same card, a different kind and wording.
  const recentFilesCard = (c: {
    id: 'recent-documents' | 'recent-images';
    title: string;
    list: ReturnType<typeof useRecentFiles>;
    expandedKey: PinnedCard;
    app: 'app:documents' | 'app:images';
    all: string;
    nouns: [string, string];
    empty: [string, string];
  }) => {
    const rows = (c.list.files ?? []).slice(0, RECENT_MAX);
    return (
      <section
        key={c.id}
        className="card"
        aria-labelledby={`home-${c.id}`}
        tabIndex={-1}
        {...order.cardProps(c.id)}
      >
        <div className="card-head">
          {order.grip(c.id)}
          <h2 id={`home-${c.id}`}>{c.title}</h2>
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            onClick={() => openView(c.app)}
          >
            {c.all}
          </button>
        </div>
        {rows.length === 0 &&
        (c.list.failed || (c.list.files !== null && !c.list.waiting && !c.list.complete)) ? (
          <StateNote kind="error">Couldn't load {c.title.toLowerCase()}.</StateNote>
        ) : c.list.files === null || (rows.length === 0 && c.list.waiting) ? (
          <StateNote kind="loading" />
        ) : rows.length === 0 ? (
          <StateNote kind="empty">{project ? c.empty[1] : c.empty[0]}</StateNote>
        ) : (
          <>
            <ul className="drawer-list">
              {rows.slice(0, rowsShown(c.expandedKey)).map((f) => (
                <HomeRow
                  key={f.item.id}
                  onOpen={() => openFile(f)}
                  star={
                    <StarButton
                      id={f.item.id}
                      title={f.item.title}
                      on={fileFavs2.has(f.item.id)}
                      onPress={(id, button) => {
                        holdPlace(button, true);
                        void toggleFavouriteFile(id);
                      }}
                    />
                  }
                >
                  <span className="line-text">
                    <span className="line-title">{f.item.title}</span>
                    <span className="line-meta">
                      Changed {whenDate(f.item.modified)}, {f.scope.name}
                    </span>
                  </span>
                </HomeRow>
              ))}
            </ul>
            <MoreLink
              total={rows.length}
              noun={c.nouns}
              expanded={expanded[c.expandedKey]}
              onToggle={() => toggleCard(c.expandedKey)}
            />
          </>
        )}
      </section>
    );
  };

  const favouriteSkills = new Set(boot.prefs.pins ?? []);
  const { pinned, often } = starterSkills(boot);
  const skillsTitle = pinned.length === 0 && often.length > 0 ? 'Used often' : 'Pinned skills';
  const skillRows: SkillInfo[] = (pinned.length > 0 ? pinned : often).slice(0, 5);

  // Start my day first (runs at once, as it always has), then the person's shortcuts. A target that is gone or
  // still loading draws nothing here; the panel says so.
  const shortcutButtons: { key: string; label: string; run: () => void }[] = [
    ...(hasGm && isShown('start-my-day', homeHidden)
      ? [
          {
            key: 'start-my-day',
            label: 'Start my day',
            run: () => void startChat('/gm', null, { open: true }),
          },
        ]
      : []),
    ...(homeShortcuts ?? []).flatMap((s) => {
      const r = resolveShortcut(s, shortcutSources);
      return r.state === 'ready' ? [{ key: r.key, label: r.label, run: r.run }] : [];
    }),
  ];
  // Cards a person could see if shown: Ads only with access, Recent projects only once there are some, Pinned
  // skills only for owners and scouts.
  const hiddenCount = cardList.filter(
    (c) =>
      !c.shown &&
      (homeHidden ?? []).includes(c.id) &&
      (c.id !== 'ads' || hasAds) &&
      (c.id !== 'projects' || projectsShown) &&
      (c.id !== 'skills' || hasSkills),
  ).length;

  const loaded = todos !== null && sessions !== null;
  const summaryText = loaded
    ? summary({
        overdue: mine.filter((t) => t.due !== null && isOverdue(t.due, today)).length,
        dueToday: mine.filter((t) => t.due === today).length,
        asking: live.filter((s) => attentionFor(s.state) === 'asking').length,
      })
    : '';

  return (
    <div className="home-view">
      <SheetBar title="Home" panel={homeHidden !== undefined ? 'Customise Home' : undefined} />
      <div className="home-scroll">
        <div className="home-in">
          <p className="home-greeting">{greeting(new Date(), boot.identity.name)}</p>
          <p className="home-sub">{summaryText}</p>
          {shortcutButtons.length > 0 ? (
            <ul className="home-shortcuts" aria-label="Shortcuts">
              {shortcutButtons.map((b) => (
                <li key={b.key}>
                  <button
                    type="button"
                    className="btn"
                    data-variant="quiet"
                    data-size="small"
                    onClick={b.run}
                  >
                    {b.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {isShown('whats-new', homeHidden) ? <WhatsNewCard /> : null}

          {activeChat.kind === 'new' ? (
            <div className="home-composer">
              {activeChat.skill ? (
                <div className="notice home-skill" data-shape="box" data-level="info">
                  <strong>{activeChat.skill.title}</strong>
                  {activeChat.skill.description ? <span>{activeChat.skill.description}</span> : null}
                  {activeChat.skill.argumentHint ? (
                    <span className="meta">Add after the name: {activeChat.skill.argumentHint}</span>
                  ) : null}
                </div>
              ) : null}
              {ask ? (
                <ClientAsk
                  clients={clients}
                  options={ask.options}
                  onChoose={ask.choose}
                  onCancel={ask.cancel}
                />
              ) : null}
              <p className="home-status" role="status" aria-live="polite">
                {status}
              </p>
              <Composer
                key={`new-${activeChat.key}`}
                initial={activeChat.draft}
                skill={activeChat.skill}
                disabledReason={null}
                autoFocus={true}
                focusSignal={composerFocus}
                attention={null}
                hint={ask ? 'Answer the question above, or Cancel to change your message.' : undefined}
                tools={
                  <>
                    <ProjectPicker clients={clients} disabled={busy} />
                    {/* Which client the new chat is about. "Chat for", not "Client", so it isn't read as a
                        second Working on picker (Ian, 2026-11-21). */}
                    <span className="scope-field">
                      <label className="client-label" htmlFor="client-select">
                        Chat for
                      </label>
                      <SearchSelect
                        id="client-select"
                        className="client-select"
                        value={choice}
                        options={[
                          { value: AUTO, label: 'Auto' },
                          { value: NONE, label: 'No client' },
                          ...clientOptions(clients),
                        ]}
                        recentKey="clients"
                        disabled={busy}
                        aria-describedby={setByProject ? 'client-select-why' : undefined}
                        onChange={(value) => setPicked({ key: activeChat.key, value })}
                      />
                      {setByProject ? (
                        <span className="visually-hidden" id="client-select-why">
                          Set by Working on
                        </span>
                      ) : null}
                    </span>
                    {showPreset ? (
                      <span className="line-meta" data-testid="home-project">
                        Project: {presetCard?.title || presetProject}
                      </span>
                    ) : null}
                  </>
                }
                onSend={async (text, uploadIds) => {
                  // "/clear" on Home just empties the box; it is never sent.
                  if (isClearCommand(text)) return true;
                  if (choice !== AUTO) {
                    // Chosen in the select, or set by a to-do or a search result.
                    report(
                      activeChat.kind === 'new' && picked?.key === activeChat.key ? 'by-hand' : 'preset',
                    );
                    {
                      const client = choice === NONE ? null : choice;
                      return send(text, client, uploadIds, projectFor(client));
                    }
                  }
                  // The skill's name alone is not something to read a client from.
                  const name = activeChat.skill ? `/${activeChat.skill.name}` : null;
                  const message =
                    name && (text === name || text.startsWith(`${name} `))
                      ? text.slice(name.length).trim()
                      : text;
                  if (message.trim() === '') {
                    report('skill-only');
                    return send(text, null, uploadIds, projectFor(null));
                  }
                  setBusy(true);
                  try {
                    const timer = setTimeout(() => setStatus('Working out the client…'), STATUS_DELAY_MS);
                    // Leaving this chat (or Home) while the guess is out drops it: nothing is sent or shown.
                    let gone = false;
                    cancelAsk.current = () => {
                      gone = true;
                      cancelAsk.current = null;
                      clearTimeout(timer);
                      setStatus('');
                      setAsk(null);
                      setBusy(false);
                    };
                    let guess: ClientGuessResponse = { kind: 'ask', options: [] };
                    try {
                      guess = await api.clientGuess({ text: message.slice(0, GUESS_CHARS) });
                    } catch {
                      // Any failure is a question with nothing to suggest.
                    }
                    if (gone) return false;
                    cancelAsk.current = null;
                    clearTimeout(timer);
                    setStatus('');
                    if (guess?.kind === 'sure' && listed(guess.client))
                      return await send(text, guess.client, uploadIds, projectFor(guess.client));
                    if (guess?.kind === 'none') return await send(text, null, uploadIds, projectFor(null));
                    const options =
                      guess?.kind === 'ask' && Array.isArray(guess.options) ? guess.options : [];
                    return await new Promise<boolean>((resolve) => {
                      const done = () => {
                        cancelAsk.current = null;
                        setAsk(null);
                      };
                      const cancel = () => {
                        done();
                        report('ask-cancelled');
                        resolve(false);
                      };
                      cancelAsk.current = cancel;
                      setAsk({
                        options,
                        cancel,
                        choose: (slug) => {
                          done();
                          report(
                            slug === null
                              ? 'ask-no-client'
                              : options.includes(slug)
                                ? 'ask-suggested'
                                : 'ask-other',
                          );
                          resolve(send(text, slug, uploadIds, projectFor(slug)));
                        },
                      });
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </div>
          ) : (
            <>
              <button type="button" className="btn" data-variant="primary" onClick={() => newChat()}>
                New chat
              </button>
              {/* No message box here (a chat is open elsewhere): Working on keeps its own line. */}
              <div className="home-scope">
                <ProjectPicker clients={clients} />
              </div>
            </>
          )}

          <div className="tray home-tray" data-odd={shownCards.length % 2 === 1} {...order.trayProps}>
            {order.place([
              {
                id: 'meetings',
                node: (
                  <HomeMeetings
                    key="meetings"
                    grip={order.grip('meetings')}
                    cardProps={order.cardProps('meetings')}
                  />
                ),
              },
              {
                id: 'ads',
                node:
                  adsShown && ads ? (
                    <section
                      key="ads"
                      className="card"
                      aria-labelledby="home-ads"
                      {...order.cardProps('ads')}
                    >
                      <div className="card-head">
                        {order.grip('ads')}
                        <h2 id="home-ads">Ads approvals</h2>
                        <span className="count">{ads.waiting}</span>
                        <button
                          type="button"
                          className="btn"
                          data-variant="quiet"
                          data-size="small"
                          onClick={() => openTool('workbench', 'ad-manager')}
                        >
                          Open Ads Manager
                        </button>
                      </div>
                      {ads.clients
                        .filter((c) => c.waiting > 0)
                        .map((c) => (
                          <button
                            key={c.slug}
                            type="button"
                            className="line"
                            onClick={() => openTool('workbench', 'ad-manager', c.slug)}
                          >
                            <span className="line-text">
                              <span className="line-title">{c.name}</span>
                              <span className="line-meta">{c.waiting} waiting for a decision</span>
                            </span>
                          </button>
                        ))}
                    </section>
                  ) : null,
              },
              {
                id: 'todos',
                node: (
                  <section
                    key="todos"
                    className="card"
                    aria-labelledby="home-todos"
                    ref={todoCard}
                    tabIndex={-1}
                    {...order.cardProps('todos')}
                  >
                    <div className="card-head">
                      {order.grip('todos')}
                      <h2 id="home-todos">Pinned tasks</h2>
                      {todos ? <span className="count">{pinnedTodoRows.length}</span> : null}
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openDrawer('todos')}
                      >
                        All tasks
                      </button>
                    </div>
                    {!todos ? (
                      <StateNote kind="loading" />
                    ) : pinnedTodoRows.length === 0 ? (
                      <StateNote kind="empty">
                        {project ? 'No pinned tasks in this project.' : 'Pin a task to keep it here.'}
                      </StateNote>
                    ) : (
                      <>
                        <ul className="drawer-list">
                          {pinnedTodoRows.slice(0, rowsShown('todos')).map((t) => (
                            <HomeRow
                              key={t.key}
                              onOpen={() => openTodo(t)}
                              star={
                                <StarButton
                                  id={t.key}
                                  title={t.title}
                                  on={true}
                                  onPress={(id, button) => {
                                    todoStar(id, button);
                                    void toggleFavouriteTodo(id);
                                  }}
                                />
                              }
                            >
                              <span className="line-text">
                                <span className="line-title">{t.title}</span>
                                <span className="line-meta">
                                  {metaParts(
                                    t,
                                    today,
                                    clientName,
                                    todoProjectKey(t)
                                      ? (todoPlaceParts(t, projectList?.projects, clients)[0] ?? null)
                                      : null,
                                  ).map((part, i) => (
                                    <span key={part.text}>
                                      {i > 0 ? ', ' : ''}
                                      <span className={part.late ? 'late' : undefined}>{part.text}</span>
                                    </span>
                                  ))}
                                </span>
                              </span>
                            </HomeRow>
                          ))}
                        </ul>
                        <MoreLink
                          total={pinnedTodoRows.length}
                          noun={['task', 'tasks']}
                          expanded={expanded.todos}
                          onToggle={() => toggleCard('todos')}
                        />
                      </>
                    )}
                  </section>
                ),
              },
              {
                id: 'recent-todos',
                node: (
                  <section
                    key="recent-todos"
                    className="card"
                    aria-labelledby="home-recent-todos"
                    tabIndex={-1}
                    {...order.cardProps('recent-todos')}
                  >
                    <div className="card-head">
                      {order.grip('recent-todos')}
                      <h2 id="home-recent-todos">Recent tasks</h2>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openDrawer('todos')}
                      >
                        All tasks
                      </button>
                    </div>
                    {!todos ? (
                      <StateNote kind="loading" />
                    ) : recentTodoRows.length === 0 ? (
                      <StateNote kind="empty">
                        {project ? 'No tasks in this project.' : 'No tasks yet.'}
                      </StateNote>
                    ) : (
                      <>
                        <ul className="drawer-list">
                          {recentTodoRows.slice(0, rowsShown('recentTodos')).map((t) => {
                            const arrived = todoArrival(t, today, boot.identity.slug);
                            const place = todoProjectKey(t)
                              ? (todoPlaceParts(t, projectList?.projects, clients)[0] ?? null)
                              : null;
                            return (
                              <HomeRow
                                key={t.key}
                                onOpen={() => openTodo(t)}
                                star={
                                  <StarButton
                                    id={t.key}
                                    title={t.title}
                                    on={favTodos.has(t.key)}
                                    onPress={(id, button) => {
                                      holdPlace(button);
                                      void toggleFavouriteTodo(id);
                                    }}
                                  />
                                }
                              >
                                <span className="line-text">
                                  <span className="line-title">{t.title}</span>
                                  <span className="line-meta">
                                    {arrived ? `${arrived.word} ${whenDate(arrived.date)}` : null}
                                    {metaParts(t, today, clientName, place).map((part, i) => (
                                      <span key={part.text}>
                                        {i > 0 || arrived ? ', ' : ''}
                                        <span className={part.late ? 'late' : undefined}>{part.text}</span>
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              </HomeRow>
                            );
                          })}
                        </ul>
                        <MoreLink
                          total={recentTodoRows.length}
                          noun={['task', 'tasks']}
                          expanded={expanded.recentTodos}
                          onToggle={() => toggleCard('recentTodos')}
                        />
                      </>
                    )}
                  </section>
                ),
              },
              {
                id: 'projects',
                node: (
                  <section
                    key="projects"
                    className="card"
                    aria-labelledby="home-projects"
                    tabIndex={-1}
                    {...order.cardProps('projects')}
                  >
                    <div className="card-head">
                      {order.grip('projects')}
                      <h2 id="home-projects">Recent projects</h2>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openView('app:projects')}
                      >
                        All projects
                      </button>
                    </div>

                    <ul className="drawer-list">
                      {recentProjectRows.slice(0, rowsShown('projects')).map((p) => (
                        <HomeRow
                          key={p.key}
                          onOpen={() => {
                            projectPageRequest.set(p.key);
                            openView('app:projects');
                          }}
                          star={null}
                        >
                          <span className="line-text">
                            <span className="line-title">{projectText(p, clients)}</span>
                            <span className="line-meta">
                              Last worked on {whenDate(p.lastChanged?.at ?? '')}
                            </span>
                          </span>
                        </HomeRow>
                      ))}
                    </ul>
                    <MoreLink
                      total={recentProjectRows.length}
                      noun={['project', 'projects']}
                      expanded={expanded.projects}
                      onToggle={() => toggleCard('projects')}
                    />
                  </section>
                ),
              },
              {
                id: 'chats',
                node: (
                  <section
                    key="chats"
                    className="card"
                    aria-labelledby="home-chats"
                    ref={chatCard}
                    tabIndex={-1}
                    {...order.cardProps('chats')}
                  >
                    <div className="card-head">
                      {order.grip('chats')}
                      <h2 id="home-chats">Pinned chats</h2>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openDrawer('chats')}
                      >
                        All chats
                      </button>
                    </div>
                    {!sessions ? (
                      <StateNote kind="loading" />
                    ) : pinnedChatRows.length === 0 ? (
                      <StateNote kind="empty">Pin a chat to keep it here.</StateNote>
                    ) : (
                      <>
                        <ul className="drawer-list">
                          {pinnedChatRows
                            .slice(0, rowsShown('chats'))
                            .map((row) => chatRowNode(row, chatStarFor(row.chat)))}
                        </ul>
                        <MoreLink
                          total={pinnedChatRows.length}
                          noun={['chat', 'chats']}
                          expanded={expanded.chats}
                          onToggle={() => toggleCard('chats')}
                        />
                      </>
                    )}
                  </section>
                ),
              },
              {
                id: 'recent-chats',
                node: (
                  <section
                    key="recent-chats"
                    className="card"
                    aria-labelledby="home-recent-chats"
                    tabIndex={-1}
                    {...order.cardProps('recent-chats')}
                  >
                    <div className="card-head">
                      {order.grip('recent-chats')}
                      <h2 id="home-recent-chats">Recent chats</h2>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openDrawer('chats')}
                      >
                        All chats
                      </button>
                    </div>
                    {!sessions ? (
                      <StateNote kind="loading" />
                    ) : recentChatRows.length === 0 ? (
                      <StateNote kind="empty">No chats yet.</StateNote>
                    ) : (
                      <>
                        <ul className="drawer-list">
                          {recentChatRows.slice(0, rowsShown('recentChats')).map((row) => {
                            const id = row.chat.sdkSessionId;
                            // A chat with no lasting id can't be pinned yet.
                            return chatRowNode(
                              row,
                              id ? chatStarFor(row.chat, favChats.has(id), false) : null,
                            );
                          })}
                        </ul>
                        <MoreLink
                          total={recentChatRows.length}
                          noun={['chat', 'chats']}
                          expanded={expanded.recentChats}
                          onToggle={() => toggleCard('recentChats')}
                        />
                      </>
                    )}
                  </section>
                ),
              },
              {
                id: 'files',
                node: (
                  <section
                    key="files"
                    className="card"
                    aria-labelledby="home-files"
                    ref={fileCard}
                    tabIndex={-1}
                    {...order.cardProps('files')}
                  >
                    <div className="card-head">
                      {order.grip('files')}
                      <h2 id="home-files">Pinned files</h2>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openView('app:documents')}
                      >
                        All files
                      </button>
                    </div>
                    {pinnedFiles === null && filesFailed ? (
                      <StateNote kind="error">Couldn't load your pinned files.</StateNote>
                    ) : pinnedFiles === null ? (
                      <StateNote kind="loading" />
                    ) : pinnedFileRows.length === 0 ? (
                      <StateNote kind="empty">
                        {project ? 'No pinned files in this project.' : 'Pin a file to keep it here.'}
                      </StateNote>
                    ) : (
                      <>
                        <ul className="drawer-list">
                          {pinnedFileRows.slice(0, rowsShown('files')).map((f) => (
                            <HomeRow
                              key={f.item.id}
                              onOpen={() => openFile(f)}
                              star={
                                <StarButton
                                  id={f.item.id}
                                  title={f.item.title}
                                  on={true}
                                  onPress={(id, button) => {
                                    fileStar(id, button);
                                    void toggleFavouriteFile(id);
                                  }}
                                />
                              }
                            >
                              <span className="line-text">
                                <span className="line-title">{f.item.title}</span>
                                <span className="line-meta">{f.scope.name}</span>
                              </span>
                            </HomeRow>
                          ))}
                        </ul>
                        <MoreLink
                          total={pinnedFileRows.length}
                          noun={['file', 'files']}
                          expanded={expanded.files}
                          onToggle={() => toggleCard('files')}
                        />
                      </>
                    )}
                  </section>
                ),
              },
              {
                id: 'recent-documents',
                node: recentFilesCard({
                  id: 'recent-documents',
                  title: 'Recent documents',
                  list: recentDocs,
                  expandedKey: 'recentDocuments',
                  app: 'app:documents',
                  all: 'All documents',
                  nouns: ['document', 'documents'],
                  empty: ['No documents yet.', 'No documents in this project.'],
                }),
              },
              {
                id: 'recent-images',
                node: recentFilesCard({
                  id: 'recent-images',
                  title: 'Recent images',
                  list: recentImages,
                  expandedKey: 'recentImages',
                  app: 'app:images',
                  all: 'All images',
                  nouns: ['image', 'images'],
                  empty: ['No images yet.', 'No images in this project.'],
                }),
              },
              {
                id: 'skills',
                node: (
                  <section
                    key="skills"
                    className="card"
                    aria-labelledby="home-skills"
                    ref={skillCard}
                    tabIndex={-1}
                    {...order.cardProps('skills')}
                  >
                    <div className="card-head">
                      {order.grip('skills', skillsTitle)}
                      <h2 id="home-skills">{skillsTitle}</h2>
                      {/* The card is only drawn for owners and scouts, who have the Skills drawer. */}
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        onClick={() => openDrawer('skills')}
                      >
                        All skills
                      </button>
                    </div>
                    {skillRows.length === 0 ? (
                      <StateNote kind="empty">Pin a skill to keep it here.</StateNote>
                    ) : (
                      <ul className="drawer-list">
                        {skillRows.map((s) => (
                          <HomeRow
                            key={s.name}
                            onOpen={() => startSkill(s)}
                            star={
                              <StarButton
                                id={s.name}
                                title={s.title}
                                on={favouriteSkills.has(s.name)}
                                onPress={(id, button) => {
                                  skillStar(id, button);
                                  void togglePin(id);
                                }}
                              />
                            }
                          >
                            <span className="line-text">
                              <span className="line-title">{s.title}</span>
                            </span>
                          </HomeRow>
                        ))}
                      </ul>
                    )}
                  </section>
                ),
              },
            ])}
            {shownCards.length === 0 ? (
              <p className="hint home-tray-empty">Your Home has no cards. Customise Home to add some.</p>
            ) : null}
          </div>
          {order.status}
          {hiddenCount > 0 || order.moved ? (
            <div className="home-tray-foot">
              {hiddenCount > 0 ? (
                <span className="tray-hidden">
                  <span className="hint">
                    {hiddenCount === 1 ? '1 card hidden.' : `${hiddenCount} cards hidden.`}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    data-variant="quiet"
                    data-size="small"
                    onClick={openCustomiseHome}
                  >
                    Show hidden cards
                  </button>
                </span>
              ) : null}
              {order.moved ? (
                <button
                  type="button"
                  className="btn"
                  data-variant="quiet"
                  data-size="small"
                  onClick={order.reset}
                >
                  Reset card order
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type PinnedCard =
  | 'todos'
  | 'projects'
  | 'chats'
  | 'files'
  | 'recentTodos'
  | 'recentChats'
  | 'recentDocuments'
  | 'recentImages';

/**
 * A Home card row: the open button and the star sit side by side (a button can't hold a button), so the
 * whole row still looks and lifts as one, as in the drawers. The star is the row's trailing edge (rule 2).
 */
function HomeRow({ onOpen, star, children }: { onOpen: () => void; star: ReactNode; children: ReactNode }) {
  return (
    <li className="line">
      <button type="button" className="line-main" onClick={onOpen}>
        {children}
      </button>
      {star}
    </li>
  );
}

/**
 * "Show N more" under a pinned card that holds more than it shows: expands the card in place, then reads
 * "Show fewer". (It used to open the drawer, which did nothing visible when that drawer was already open.)
 * The rows it reveals come before it, so Shift+Tab reaches them.
 */
function MoreLink({
  total,
  noun,
  expanded,
  onToggle,
}: {
  total: number;
  noun: [one: string, many: string];
  expanded: boolean;
  onToggle: () => void;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const hidden = total - PINNED_ROWS;
  if (hidden <= 0) return null;
  return (
    <span ref={wrap}>
      <ShowMore
        expanded={expanded}
        count={hidden}
        noun={{ one: noun[0], many: noun[1] }}
        wording="more"
        onToggle={() => {
          onToggle();
          // Folding a long card back removes rows above the button: keep it in view.
          const button = wrap.current?.querySelector('button');
          if (expanded) requestAnimationFrame(() => button?.scrollIntoView?.({ block: 'nearest' }));
        }}
      />
    </span>
  );
}
