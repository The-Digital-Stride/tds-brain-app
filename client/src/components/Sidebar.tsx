import { ATTENTION_LABEL, attentionFor } from '../../../shared/contract.ts';
import { useStore, type View } from '../store.tsx';

const MENU: { view: View; label: string }[] = [
  { view: 'skills', label: 'Skills' },
  { view: 'todos', label: 'To-dos' },
  { view: 'history', label: 'History' },
  { view: 'settings', label: 'Settings' },
];

const STATE_WORDS = {
  starting: ATTENTION_LABEL.working,
  working: ATTENTION_LABEL.working,
  waiting: ATTENTION_LABEL.asking,
  idle: ATTENTION_LABEL.ready,
  error: 'Stopped by a problem',
  closed: 'Ended',
} as const;

const ROLE_WORDS = { owner: 'Owner', scout: 'Scout', team: 'Team', unknown: 'Role not set' } as const;

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { boot, view, openView, newChat, startSkill, sessions, activeChat, openChat, requestClose } =
    useStore();
  if (!boot) return null;
  const byName = (name: string) => boot.skills.find((s) => s.name === name);
  const pinned = boot.prefs.pins.map(byName).filter((s) => s !== undefined);
  const often = boot.usedOften
    .map((u) => byName(u.name))
    .filter((s) => s !== undefined)
    .filter((s) => !boot.prefs.pins.includes(s.name));

  return (
    <div className="sidebar" id="sidebar" data-open={open}>
      <div className="brand">TDS Brain</div>
      <button
        type="button"
        className="btn btn-new"
        onClick={() => {
          newChat();
          onNavigate();
        }}
      >
        New chat
      </button>
      {sessions && sessions.live.length > 0 ? (
        <section className="side-section" aria-labelledby="open-h">
          <h3 id="open-h">Open chats</h3>
          <ul className="side-list">
            {sessions.live.map((c) => {
              const current = view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === c.id;
              return (
                <li key={c.id} className="chat-item">
                  <button
                    type="button"
                    className="side-link chat-link"
                    aria-current={current ? 'true' : undefined}
                    onClick={() => {
                      openChat(c.id);
                      onNavigate();
                    }}
                  >
                    <span className="chat-link-title">{c.title || 'New chat'}</span>
                    <span className="chat-link-state">
                      {attentionFor(c.state) ? (
                        <span
                          className="attn-dot"
                          data-attention={attentionFor(c.state)}
                          aria-hidden="true"
                        />
                      ) : null}
                      {c.state === 'waiting' ? (
                        <span className="badge" data-tone="waiting">
                          {ATTENTION_LABEL.asking}
                        </span>
                      ) : (
                        STATE_WORDS[c.state]
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-close"
                    aria-label={`Close chat: ${c.title || 'New chat'}`}
                    onClick={() => requestClose(c.id)}
                  >
                    {'\u00d7'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <nav aria-label="Main menu">
        <ul className="side-menu">
          {MENU.map((m) => (
            <li key={m.view}>
              <button
                type="button"
                className="side-link"
                aria-current={view === m.view ? 'page' : undefined}
                onClick={() => {
                  openView(m.view);
                  onNavigate();
                }}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="side-section" aria-labelledby="pinned-h">
        <h3 id="pinned-h">Pinned skills</h3>
        {pinned.length === 0 ? (
          <p className="side-empty">Pin a skill from the Skills page and it will show here.</p>
        ) : (
          <ul className="side-list">
            {pinned.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  className="side-link"
                  onClick={() => {
                    startSkill(s);
                    onNavigate();
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="side-section" aria-labelledby="often-h">
        <h3 id="often-h">Used often</h3>
        {often.length === 0 ? (
          <p className="side-empty">The skills you use most will show here.</p>
        ) : (
          <ul className="side-list">
            {often.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  className="side-link"
                  onClick={() => {
                    startSkill(s);
                    onNavigate();
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="who">
        <div>{boot.identity.name}</div>
        <div className="who-role">{ROLE_WORDS[boot.identity.role]}</div>
      </div>
    </div>
  );
}
