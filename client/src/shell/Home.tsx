import { useEffect, useRef, useState } from 'react';
import {
  attentionFor,
  type ClientGuessResponse,
  type SkillInfo,
  type TodoItem,
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { Composer } from '../components/Composer.tsx';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { sortChats } from '../state/chats.ts';
import { todoChatClient } from '../state/client-choice.ts';
import { isClearCommand } from '../state/close.ts';
import { greeting, needsYou, summary } from '../state/home.ts';
import { isNewToYou } from '../state/todo-new.ts';
import { useStore } from '../store.tsx';
import { ClientAsk } from './ClientAsk.tsx';
import type { DrawerName } from './contract.ts';
import { SheetBar } from './SheetBar.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, STATE_WORDS, starterSkills, todoChatDraft } from './words.ts';

/** Meta line parts, e.g. "overdue by 2 days", "Acme Heating". Joined with ", " in the text; only the overdue part is late. */
function metaParts(
  t: TodoItem,
  today: string,
  clientName: (slug: string | null) => string | null,
): { text: string; late?: boolean }[] {
  const parts: { text: string; late?: boolean }[] = [];
  if (t.due) parts.push({ text: dueInWords(t.due, today), late: isOverdue(t.due, today) });
  const name = clientName(t.client);
  if (name) parts.push({ text: name });
  return parts;
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
  } = useStore();
  const { dispatch } = useShell();
  const clients = boot?.clients ?? [];
  // The select's value: "auto", "none" or a slug. A chat opened with a client (palette, to-do) starts on it.
  const [picked, setPicked] = useState<{ key: number; value: string } | null>(null);
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

  if (!boot) return null;

  const today = todayIso();
  const live = sessions?.live ?? [];
  const mine = todos?.mine ?? [];
  const need = needsYou(mine, today);
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
  const skillsTitle = pinned.length === 0 && often.length > 0 ? 'Used often' : 'Pinned skills';
  const skillRows: SkillInfo[] = (pinned.length > 0 ? pinned : often).slice(0, 5);
  const openChats = sortChats(live).slice(0, 4);

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
                    <select
                      id="client-select"
                      className="field client-select"
                      value={choice}
                      disabled={busy}
                      onChange={(e) => setPicked({ key: activeChat.key, value: e.target.value })}
                    >
                      <option value={AUTO}>Auto</option>
                      <option value={NONE}>No client</option>
                      {clients.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </>
                }
                onSend={async (text, uploadIds) => {
                  // "/clear" on Home just empties the box; it is never sent.
                  if (isClearCommand(text)) return true;
                  if (choice === NONE) return send(text, null, uploadIds);
                  if (choice !== AUTO) return send(text, choice, uploadIds);
                  // The skill's name alone is not something to read a client from.
                  const name = activeChat.skill ? `/${activeChat.skill.name}` : null;
                  const message =
                    name && (text === name || text.startsWith(`${name} `))
                      ? text.slice(name.length).trim()
                      : text;
                  if (message.trim() === '') return send(text, null, uploadIds);
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
                        resolve(false);
                      };
                      cancelAsk.current = cancel;
                      setAsk({
                        options,
                        cancel,
                        choose: (slug) => {
                          done();
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

          <div className="tray">
            <section className="card" aria-labelledby="home-needs">
              <div className="card-head">
                <h2 id="home-needs">Needs you</h2>
                {todos ? <span className="count">{need.count}</span> : null}
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
              ) : need.rows.length === 0 ? (
                <p className="card-note">
                  {`Nothing due today or tomorrow.${
                    mine.length > 0 ? ` ${mine.length} other ${mine.length === 1 ? 'to-do' : 'to-dos'}.` : ''
                  }`}
                </p>
              ) : (
                need.rows.map((t) => (
                  <button key={t.key} type="button" className="line" onClick={() => openTodo(t)}>
                    <span className="line-text">
                      <span className="line-title">{t.title}</span>
                      <span className="line-meta">
                        {metaParts(t, today, clientName).map((part, i) => (
                          <span key={part.text}>
                            {i > 0 ? ', ' : ''}
                            <span className={part.late ? 'late' : undefined}>{part.text}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </section>

            <section className="card" aria-labelledby="home-chats">
              <div className="card-head">
                <h2 id="home-chats">Open chats</h2>
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
              ) : openChats.length === 0 ? (
                <p className="card-note">No open chats.</p>
              ) : (
                openChats.map((s) => (
                  <button key={s.id} type="button" className="line" onClick={() => openChat(s.id)}>
                    <span
                      className="dot"
                      data-attention={attentionFor(s.state) ?? undefined}
                      aria-hidden="true"
                    />
                    <span className="line-text">
                      <span className="line-title">{s.title}</span>
                      <span className="line-meta">{STATE_WORDS[s.state]}</span>
                    </span>
                  </button>
                ))
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
                <p className="card-note">Pin a skill to keep it here.</p>
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
