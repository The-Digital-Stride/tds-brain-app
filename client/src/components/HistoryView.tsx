import type { SessionState } from '../../../shared/contract.ts';
import { useStore } from '../store.tsx';

const STATE_WORDS: Record<SessionState, string> = {
  starting: 'Starting',
  working: 'Working',
  waiting: 'Waiting for you',
  idle: 'Ready',
  error: 'Hit a problem',
  closed: 'Ended',
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function HistoryView() {
  const { sessions, boot, openChat, openPast } = useStore();
  const clientName = (slug: string | null) =>
    slug ? (boot?.clients.find((c) => c.slug === slug)?.name ?? slug) : null;
  return (
    <div className="page">
      <div>
        <h1>History</h1>
        <p className="lede">Chats that are open now, and earlier ones you can pick up again.</p>
      </div>
      <section className="todo-group">
        <h3>Open now</h3>
        {!sessions || sessions.live.length === 0 ? (
          <p className="meta">No chats are open.</p>
        ) : (
          <ul className="list">
            {sessions.live.map((s) => (
              <li className="row" data-compact="false" key={s.id}>
                <span className="state-dot" data-state={s.state} aria-hidden="true" />
                <div className="row-main">
                  <div className="row-title">{s.title || 'New chat'}</div>
                  <div className="meta">
                    <span>{STATE_WORDS[s.state]}</span>
                    {clientName(s.client) ? <span>{clientName(s.client)}</span> : null}
                  </div>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn" data-size="small" onClick={() => openChat(s.id)}>
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="todo-group">
        <h3>Earlier chats</h3>
        {!sessions || sessions.past.length === 0 ? (
          <p className="meta">No earlier chats yet.</p>
        ) : (
          <ul className="list">
            {sessions.past.map((s) => (
              <li className="row" data-compact="false" key={s.sdkSessionId}>
                <span className="todo-bullet" aria-hidden="true" />
                <div className="row-main">
                  <div className="row-title">{s.title || 'Untitled chat'}</div>
                  <div className="meta">
                    <span>{when(s.lastModified)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    onClick={() => void openPast(s.sdkSessionId)}
                  >
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
