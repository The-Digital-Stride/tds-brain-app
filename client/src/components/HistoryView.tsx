import { useStore } from '../store.tsx';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function HistoryView() {
  const { sessions, openPast } = useStore();
  return (
    <div className="page">
      <div>
        <h1>History</h1>
        <p className="lede">
          Earlier chats you can pick up again. Chats that are open now are in the side menu.
        </p>
      </div>
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
                    aria-label={`Open ${s.title || 'Untitled chat'}`}
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
