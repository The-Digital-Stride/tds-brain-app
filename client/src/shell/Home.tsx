import { useEffect, useRef, useState } from 'react';
import {
  attentionFor,
  type ClientGuessResponse,
  type ClientPickReported,
  type LibraryItemsResponse,
  type SkillInfo,
  type TodoItem,
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { Composer } from '../components/Composer.tsx';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import {
  clientChoice,
  NO_CLIENT,
  projectChoice,
  todoChatClient,
  useClientChoice,
  useProjectChoice,
} from '../state/client-choice.ts';
import { isClearCommand } from '../state/close.ts';
import { greeting, summary } from '../state/home.ts';
import { PINNED_ROWS, pinnedChats, pinnedFileIds, pinnedTodos } from '../state/home-pins.ts';
import { filterOptions, todoPlaceParts, useProjects } from '../state/projects.ts';
import { todoProjectKey } from '../state/todo-filter.ts';
import { isNewToYou } from '../state/todo-new.ts';
import { useStore } from '../store.tsx';
import { ClientAsk } from './ClientAsk.tsx';
import type { DrawerName } from './contract.ts';
import { SearchSelect } from './SearchSelect.tsx';
import { SheetBar } from './SheetBar.tsx';
import { useShell } from './ShellProvider.tsx';
import { clientOptions } from './search-select.ts';
import { WhatsNewCard } from './WhatsNewCard.tsx';
import { placeName, STATE_WORDS, starterSkills, todoChatDraft, whenWords } from './words.ts';

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

/**
 * The app-wide picker (decision 11): Client, then Project. Choosing a project narrows Home, the To-dos
 * drawer, Images, Documents and search; choosing only a client changes nothing here. Shown once the
 * brain has projects.
 */
function ProjectPicker({ clients }: { clients: { slug: string; name: string; aliases?: string[] }[] }) {
  const { list } = useProjects();
  const choice = useClientChoice();
  const project = useProjectChoice();
  const cards = list?.projects ?? [];
  if (cards.length === 0 && !project) return null;
  const clientValue =
    choice === '' || choice === NO_CLIENT
      ? ALL
      : choice === 'personal'
        ? 'personal'
        : choice.slice('client:'.length);
  const hasPersonal = cards.some((c) => c.space === 'personal');
  // No client yet: only personal projects can be picked (and only if there are any).
  const forClient = filterOptions(
    cards.filter((c) =>
      clientValue === ALL
        ? c.space === 'personal'
        : clientValue === 'personal'
          ? c.space === 'personal'
          : c.client === clientValue,
    ),
    clients,
  );
  const needClient = clientValue === ALL && !hasPersonal && !project;
  const locked = needClient || (forClient.length === 0 && !project);
  const slot = { flex: '0 1 200px', minWidth: 0 } as const;
  return (
    // One compact row: "Working on [Client] [Project]", wrapping on a narrow sheet.
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <label className="client-label" htmlFor="pick-client">
        Working on
      </label>
      <span style={slot}>
        <SearchSelect
          id="pick-client"
          className="client-select"
          value={clientValue}
          options={[
            { value: ALL, label: 'All clients' },
            ...(hasPersonal ? [{ value: 'personal', label: 'My personal projects' }] : []),
            ...clientOptions(clients),
          ]}
          recentKey="clients"
          onChange={(v) => clientChoice.set(v === ALL ? '' : v === 'personal' ? 'personal' : `client:${v}`)}
        />
      </span>
      <label className="visually-hidden" htmlFor="pick-project">
        Project
      </label>
      <span style={slot}>
        <SearchSelect
          id="pick-project"
          className="client-select"
          value={needClient ? 'need' : project || ALL}
          options={
            needClient
              ? [{ value: 'need', label: 'Pick a client first' }]
              : [{ value: ALL, label: 'All projects' }, ...forClient]
          }
          recentKey="projects"
          disabled={locked}
          onChange={(v) => projectChoice.set(v === ALL ? '' : v)}
        />
      </span>
    </div>
  );
}

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
    newChat,
    openChat,
    markTodosSeen,
    openPast,
    openView,
    libraryVersion,
    ads,
    openTool,
  } = useStore();
  const { dispatch } = useShell();
  const clients = boot?.clients ?? [];
  const project = useProjectChoice();
  const { list: projectList } = useProjects();
  // The client picker's value: "auto", "none" or a slug. A chat opened with a client (palette, to-do) starts on it.
  const [picked, setPicked] = useState<{ key: number; value: string } | null>(null);
  // Pinned cards opened with "Show N more". Not saved: Home starts compact each visit.
  const [expanded, setExpanded] = useState<Record<PinnedCard, boolean>>({
    todos: false,
    chats: false,
    files: false,
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
  const initial =
    activeChat.kind === 'new' && activeChat.client !== undefined ? (activeChat.client ?? NONE) : AUTO;
  const choice = activeChat.kind === 'new' && picked?.key === activeChat.key ? picked.value : initial;
  const listed = (slug: string) => clients.some((c) => c.slug === slug);
  // Counted in the app's own data folder so we can see how often people are asked; never in the way.
  const report = (outcome: ClientPickReported) =>
    void Promise.resolve()
      .then(() => api.clientPickOutcome(outcome))
      .catch(() => {});

  const fileFavs = boot?.prefs.favouriteFiles;
  const fileKey = (fileFavs ?? []).join('\n');
  // The pinned files, looked up by id. The newest reply wins, old rows stay while a new lookup runs, and rows
  // are filtered by the current stars, so unpinning a file removes it at once.
  const [pinnedFiles, setPinnedFiles] = useState<LibraryItemsResponse['files'] | null>(null);
  const [filesFailed, setFilesFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fileKey` stands for the list; `libraryVersion` refreshes after a change on disk
  useEffect(() => {
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
  }, [fileKey, libraryVersion]);

  if (!boot) return null;

  const today = todayIso();
  const live = sessions?.live ?? [];
  const mine = todos?.mine ?? [];
  // Only a chosen project narrows Home; a client alone behaves as it always has.
  const inProject = <T extends TodoItem>(t: T) => !project || todoProjectKey(t) === project;
  const pinnedTodoRows = pinnedTodos(mine, todos?.open ?? [], boot.prefs.favouriteTodos ?? []).filter(
    inProject,
  );
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
  const openDrawer = (drawer: DrawerName) => dispatch({ type: 'open-drawer', drawer });
  const clientName = (slug: string | null) => (slug ? placeName(slug, clients) : null);

  const openTodo = (todo: TodoItem) => {
    // Opening a to-do someone passed to you counts as seeing it.
    if (isNewToYou(todo, boot.identity.slug, boot.prefs.todoSeen ?? {}, new Date())) markTodosSeen([todo]);
    const chat = chatForTodo(todo.key, live);
    if (chat) openChat(chat.id);
    else {
      const client = todoChatClient(todo, clients);
      newChat({ draft: todoChatDraft(todo), todoId: todo.key, ...(client !== undefined ? { client } : {}) });
    }
  };

  const { pinned, often } = starterSkills(boot);
  const skillsTitle = pinned.length === 0 && often.length > 0 ? 'Used often' : 'Favourite skills';
  const skillRows: SkillInfo[] = (pinned.length > 0 ? pinned : often).slice(0, 5);

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
      <SheetBar title="Home" />
      <div className="home-scroll">
        <div className="home-in">
          <p className="home-greeting">{greeting(new Date(), boot.identity.name)}</p>
          <p className="home-sub">{summaryText}</p>
          <WhatsNewCard />

          {activeChat.kind === 'new' ? (
            <div className="home-composer">
              {activeChat.skill ? (
                <div className="home-skill">
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
                    <label className="client-label" htmlFor="client-select">
                      Client
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
                      onChange={(value) => setPicked({ key: activeChat.key, value })}
                    />
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
                    return send(text, choice === NONE ? null : choice, uploadIds);
                  }
                  // The skill's name alone is not something to read a client from.
                  const name = activeChat.skill ? `/${activeChat.skill.name}` : null;
                  const message =
                    name && (text === name || text.startsWith(`${name} `))
                      ? text.slice(name.length).trim()
                      : text;
                  if (message.trim() === '') {
                    report('skill-only');
                    return send(text, null, uploadIds);
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
                      return await send(text, guess.client, uploadIds);
                    if (guess?.kind === 'none') return await send(text, null, uploadIds);
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
                          resolve(send(text, slug, uploadIds));
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
            <button type="button" className="btn" data-variant="primary" onClick={() => newChat()}>
              New chat
            </button>
          )}

          <ProjectPicker clients={clients} />

          <div className="tray">
            {ads?.visible && ads.waiting > 0 ? (
              <section className="card" aria-labelledby="home-ads">
                <div className="card-head">
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
            ) : null}
            <section className="card" aria-labelledby="home-todos">
              <div className="card-head">
                <h2 id="home-todos">Pinned to-dos</h2>
                {todos ? <span className="count">{pinnedTodoRows.length}</span> : null}
                <button
                  type="button"
                  className="btn"
                  data-variant="quiet"
                  data-size="small"
                  onClick={() => openDrawer('todos')}
                >
                  All to-dos
                </button>
              </div>
              {!todos ? (
                <p className="card-note">Loading</p>
              ) : pinnedTodoRows.length === 0 ? (
                <p className="card-note">
                  {project ? 'No pinned to-dos in this project.' : 'Star a to-do to keep it here.'}
                </p>
              ) : (
                <>
                  {pinnedTodoRows.slice(0, rowsShown('todos')).map((t) => (
                    <button key={t.key} type="button" className="line" onClick={() => openTodo(t)}>
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
                    </button>
                  ))}
                  <MoreLink
                    total={pinnedTodoRows.length}
                    noun={['to-do', 'to-dos']}
                    expanded={expanded.todos}
                    onToggle={() => toggleCard('todos')}
                  />
                </>
              )}
            </section>

            <section className="card" aria-labelledby="home-chats">
              <div className="card-head">
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
                <p className="card-note">Loading</p>
              ) : pinnedChatRows.length === 0 ? (
                <p className="card-note">Star a chat to keep it here.</p>
              ) : (
                <>
                  {pinnedChatRows.slice(0, rowsShown('chats')).map((row) =>
                    row.kind === 'live' ? (
                      <button
                        key={row.chat.sdkSessionId}
                        type="button"
                        className="line"
                        onClick={() => openChat(row.chat.id)}
                      >
                        <span
                          className="dot"
                          data-attention={attentionFor(row.chat.state) ?? undefined}
                          aria-hidden="true"
                        />
                        <span className="line-text">
                          <span className="line-title">{row.chat.title}</span>
                          <span className="line-meta">{STATE_WORDS[row.chat.state]}</span>
                        </span>
                      </button>
                    ) : (
                      <button
                        key={row.chat.sdkSessionId}
                        type="button"
                        className="line"
                        onClick={() => void openPast(row.chat.sdkSessionId)}
                      >
                        <span className="line-text">
                          <span className="line-title">{row.chat.title || 'New chat'}</span>
                          <span className="line-meta">{whenWords(row.chat.lastModified)}</span>
                        </span>
                      </button>
                    ),
                  )}
                  <MoreLink
                    total={pinnedChatRows.length}
                    noun={['chat', 'chats']}
                    expanded={expanded.chats}
                    onToggle={() => toggleCard('chats')}
                  />
                </>
              )}
            </section>

            <section className="card" aria-labelledby="home-files">
              <div className="card-head">
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
                <p className="card-note">Couldn't load your pinned files.</p>
              ) : pinnedFiles === null ? (
                <p className="card-note">Loading</p>
              ) : pinnedFileRows.length === 0 ? (
                <p className="card-note">
                  {project ? 'No pinned files in this project.' : 'Star a file to keep it here.'}
                </p>
              ) : (
                <>
                  {pinnedFileRows.slice(0, rowsShown('files')).map((f) => (
                    <button key={f.item.id} type="button" className="line" onClick={() => openFile(f)}>
                      <span className="line-text">
                        <span className="line-title">{f.item.title}</span>
                        <span className="line-meta">{f.scope.name}</span>
                      </span>
                    </button>
                  ))}
                  <MoreLink
                    total={pinnedFileRows.length}
                    noun={['file', 'files']}
                    expanded={expanded.files}
                    onToggle={() => toggleCard('files')}
                  />
                </>
              )}
            </section>

            <section className="card" aria-labelledby="home-skills">
              <div className="card-head">
                <h2 id="home-skills">{skillsTitle}</h2>
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
                <p className="card-note">Star a skill to keep it here.</p>
              ) : (
                skillRows.map((s) => (
                  <button key={s.name} type="button" className="line" onClick={() => startSkill(s)}>
                    <span className="line-text">
                      <span className="line-title">{s.title}</span>
                    </span>
                  </button>
                ))
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

type PinnedCard = 'todos' | 'chats' | 'files';

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
  const hidden = total - PINNED_ROWS;
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      className="btn"
      data-variant="quiet"
      data-size="small"
      aria-expanded={expanded}
      onClick={(e) => {
        const button = e.currentTarget;
        onToggle();
        // Folding a long card back removes rows above the button: keep it in view.
        if (expanded) requestAnimationFrame(() => button.scrollIntoView?.({ block: 'nearest' }));
      }}
    >
      {expanded ? (
        <>
          Show fewer<span className="visually-hidden"> {noun[1]}</span>
        </>
      ) : (
        `Show ${hidden} more ${hidden === 1 ? noun[0] : noun[1]}`
      )}
    </button>
  );
}
