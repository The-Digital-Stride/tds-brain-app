import { useEffect, useRef, useState } from 'react';
import { ChatView } from './components/Chat.tsx';
import { BootProblem, GateScreen, Loading } from './components/Gates.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SkillsView } from './components/SkillsView.tsx';
import { TodoPanel, TodosView } from './components/Todos.tsx';
import { initialChatState, pendingCard } from './state/chat-reducer.ts';
import { StoreProvider, useStore } from './store.tsx';

/** Says what changed, for screen readers. Nothing visible. */
function Announcer() {
  const { activeChat, chats } = useStore();
  const chat = activeChat.kind === 'live' ? (chats[activeChat.sessionId] ?? initialChatState) : null;
  const prev = useRef<string | null>(null);
  const card = chat ? pendingCard(chat) : null;
  const state = chat?.sessionState ?? null;
  let text = '';
  if (card?.kind === 'question') text = 'Claude has a question for you';
  else if (card?.kind === 'permission') text = 'Claude needs your approval';
  else if (state === 'working' || state === 'starting') text = 'Claude is working';
  else if (state === 'idle' && prev.current === 'Claude is working') text = 'Claude has finished';
  else if (state === 'error') text = 'Something went wrong in this chat';
  const last = useRef(text);
  useEffect(() => {
    prev.current = last.current;
    last.current = text;
  });
  return (
    <div className="visually-hidden" aria-live="polite" role="status">
      {text}
    </div>
  );
}

function Shell() {
  const { boot, view, streamUp, updatePrefs } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!boot) return null;
  const panelOpen = boot.prefs.todoPanelOpen && view !== 'todos';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
      <header className="topbar">
        <span className="brand">TDS Brain</span>
        <button
          type="button"
          className="btn"
          data-size="small"
          aria-expanded={menuOpen}
          aria-controls="sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? 'Close menu' : 'Menu'}
        </button>
      </header>
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <main className="main" id="main" tabIndex={-1}>
        {streamUp ? null : (
          <div className="offline-banner" role="status">
            Lost touch with TDS Brain. Trying to reconnect.
          </div>
        )}
        {!boot.prefs.todoPanelOpen && view !== 'todos' ? (
          <div className="main-head toggle-panel">
            <span />
            <button
              type="button"
              className="btn"
              data-size="small"
              onClick={() => void updatePrefs({ todoPanelOpen: true })}
            >
              Show to-dos
            </button>
          </div>
        ) : null}
        <div className="main-body">
          {view === 'chat' ? <ChatView /> : null}
          {view === 'skills' ? <SkillsView /> : null}
          {view === 'todos' ? <TodosView /> : null}
          {view === 'history' ? <HistoryView /> : null}
          {view === 'settings' ? <SettingsView /> : null}
        </div>
      </main>
      {panelOpen ? <TodoPanel /> : null}
      <Announcer />
    </div>
  );
}

function Root() {
  const { gate, boot, retry } = useStore();
  if (gate === 'loading') return <Loading />;
  if (gate === 'not-signed-in' || gate === 'unreachable') return <GateScreen gate={gate} retry={retry} />;
  if (!boot) return <Loading />;
  if (!boot.brain.ok || !boot.engine.ok) return <BootProblem boot={boot} retry={retry} />;
  return <Shell />;
}

export function App() {
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  );
}
