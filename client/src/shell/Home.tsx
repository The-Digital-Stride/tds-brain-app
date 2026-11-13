import { attentionFor, type SkillInfo, type TodoItem } from '../../../shared/contract.ts';
import { Composer } from '../components/Composer.tsx';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { sortChats } from '../state/chats.ts';
import { clientChoice, clientSlugOf, scopeForClient, useClientChoice } from '../state/client-choice.ts';
import { isClearCommand } from '../state/close.ts';
import { greeting, needsYou, summary } from '../state/home.ts';
import { isNewToYou } from '../state/todo-new.ts';
import { useStore } from '../store.tsx';
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
  // The client chosen here or in an app; until one is, the last client a chat was started for.
  const listed = (slug: string | null | undefined): slug is string =>
    typeof slug === 'string' && clients.some((c) => c.slug === slug);
  const picked = clientSlugOf(useClientChoice());
  const last = boot?.prefs.lastClient;
  const client = picked === '' || listed(picked) ? picked : listed(last) ? last : '';
  const setClient = (slug: string) => clientChoice.set(scopeForClient(slug));

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
    else newChat({ draft: todoChatDraft(todo), todoId: todo.key });
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
              <div className="home-client">
                <label htmlFor="client-select">Client</label>
                <select
                  id="client-select"
                  className="field"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {activeChat.skill ? (
                <div className="home-skill">
                  <strong>{activeChat.skill.title}</strong>
                  {activeChat.skill.description ? <span>{activeChat.skill.description}</span> : null}
                  {activeChat.skill.argumentHint ? (
                    <span className="meta">Add after the name: {activeChat.skill.argumentHint}</span>
                  ) : null}
                </div>
              ) : null}
              <Composer
                key={`new-${activeChat.key}`}
                initial={activeChat.draft}
                skill={activeChat.skill}
                disabledReason={null}
                autoFocus={true}
                focusSignal={composerFocus}
                attention={null}
                onSend={async (text, uploadIds) => {
                  // "/clear" on Home just empties the box; it is never sent.
                  if (isClearCommand(text)) return true;
                  return send(text, client || null, uploadIds);
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
                  onClick={() => openDrawer('todos')}
                >
                  All to-dos
                </button>
              </div>
              {!todos ? (
                <p className="card-note">Loading</p>
              ) : need.rows.length === 0 ? (
                <>
                  <p className="card-note">Nothing due today or tomorrow.</p>
                  {mine.length > 0 ? (
                    <button type="button" className="card-more" onClick={() => openDrawer('todos')}>
                      See all {mine.length} {mine.length === 1 ? 'to-do' : 'to-dos'}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {need.rows.map((t) => (
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
                  ))}
                  {need.more > 0 ? (
                    <button type="button" className="card-more" onClick={() => openDrawer('todos')}>
                      {need.more} more {need.more === 1 ? 'to-do' : 'to-dos'}
                    </button>
                  ) : null}
                </>
              )}
            </section>

            <section className="card" aria-labelledby="home-chats">
              <div className="card-head">
                <h2 id="home-chats">Open chats</h2>
                <button
                  type="button"
                  className="btn"
                  data-variant="quiet"
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
