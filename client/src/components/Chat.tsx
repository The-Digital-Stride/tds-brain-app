import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { initialChatState, pendingCard } from '../state/chat-reducer.ts';
import { useStore } from '../store.tsx';
import { Transcript } from './Transcript.tsx';

function Composer({
  initial,
  disabledReason,
  onSend,
  autoFocus,
}: {
  initial: string;
  disabledReason: string | null;
  onSend: (text: string) => Promise<boolean>;
  autoFocus: boolean;
}) {
  const [text, setText] = useState(initial);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const disabled = disabledReason !== null || sending;

  useEffect(() => {
    if (autoFocus && area.current) {
      area.current.focus();
      const n = area.current.value.length;
      area.current.setSelectionRange(n, n);
    }
  }, [autoFocus]);

  const submit = async () => {
    if (disabled || !text.trim()) return;
    setSending(true);
    const ok = await onSend(text);
    setSending(false);
    if (ok) setText('');
  };

  return (
    <div className="composer">
      <textarea
        ref={area}
        className="field"
        rows={1}
        value={text}
        disabled={disabled}
        aria-label="Message to Claude"
        aria-describedby={disabledReason ? 'composer-reason' : 'composer-hint'}
        placeholder="Ask Claude anything about your work"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <button
        type="button"
        className="btn"
        data-variant="primary"
        disabled={disabled || !text.trim()}
        onClick={() => void submit()}
      >
        Send
      </button>
      {disabledReason ? (
        <p className="composer-hint" id="composer-reason">
          {disabledReason}
        </p>
      ) : (
        <p className="composer-hint" id="composer-hint">
          Enter to send, Shift and Enter for a new line.
        </p>
      )}
    </div>
  );
}

const REASONS = {
  working: 'Claude is working. You can stop it with the Stop button.',
  waiting: 'Claude is waiting for your answer above.',
  closed: 'This chat has ended. Start a new chat to carry on.',
} as const;

export function ChatView() {
  const { boot, activeChat, chats, sessions, send, run, actionError, clearError, newChat } = useStore();

  const sessionId = activeChat.kind === 'live' ? activeChat.sessionId : null;
  const chat = sessionId ? (chats[sessionId] ?? initialChatState) : initialChatState;
  const live = sessionId ? sessions?.live.find((s) => s.id === sessionId) : undefined;
  const clients = boot?.clients ?? [];
  const pinned = (boot?.prefs.pins ?? [])
    .map((name) => boot?.skills.find((s) => s.name === name))
    .filter((s) => s !== undefined);

  const [client, setClient] = useState<string>(() => {
    const last = boot?.prefs.lastClient;
    return last && clients.some((c) => c.slug === last) ? last : '';
  });

  const waiting = pendingCard(chat) !== null;
  const state = chat.sessionState;
  let reason: string | null = null;
  if (sessionId) {
    if (waiting || state === 'waiting') reason = REASONS.waiting;
    else if (state === 'working' || state === 'starting') reason = REASONS.working;
    else if (state === 'closed') reason = REASONS.closed;
  }
  const working = sessionId !== null && (state === 'working' || state === 'starting');
  const sdkId = chat.sdkSessionId ?? live?.sdkSessionId ?? null;
  const clientName = (slug: string | null) =>
    slug ? (clients.find((c) => c.slug === slug)?.name ?? slug) : null;

  const composerKey = activeChat.kind === 'new' ? `new-${activeChat.key}` : activeChat.sessionId;
  const skill = activeChat.kind === 'new' ? activeChat.skill : null;
  const showEmpty = activeChat.kind === 'new' || chat.items.length === 0;

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="chat-title">{live?.title || (activeChat.kind === 'new' ? 'New chat' : 'Chat')}</div>
        {activeChat.kind === 'new' ? (
          <div className="client-pick">
            <label htmlFor="client-select">Client</label>
            <select
              id="client-select"
              className="field"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="">No particular client</option>
              {clients.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="client-label">
            Client: <strong>{clientName(live?.client ?? null) ?? 'none'}</strong>
          </div>
        )}
        {working && sessionId ? (
          <button type="button" className="btn" onClick={() => void run(() => api.interrupt(sessionId))}>
            Stop
          </button>
        ) : null}
      </div>

      {activeChat.kind === 'live' && chat.items.length > 0 ? (
        <Transcript items={chat.items} sessionId={activeChat.sessionId} />
      ) : (
        <div className="transcript">
          {showEmpty ? (
            <div className="empty">
              <h1>What would you like to do?</h1>
              <p className="lede">
                Type a request below, or start from a skill.
                {activeChat.kind === 'live' ? ' This chat has no messages yet.' : ''}
              </p>
              {pinned.length > 0 && activeChat.kind === 'new' ? (
                <div className="starters">
                  {pinned.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      className="btn"
                      onClick={() => newChat({ draft: `/${s.name} `, skill: s })}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {actionError ? (
        <div className="error-banner" role="alert">
          <span>{actionError}</span>
          <button type="button" className="btn" data-variant="quiet" data-size="small" onClick={clearError}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="composer-wrap">
        <div className="composer-inner">
          {skill ? (
            <div className="skill-banner">
              <strong>{skill.title}</strong>
              {skill.description ? <span>{skill.description}</span> : null}
              {skill.argumentHint ? (
                <span className="meta">Add after the name: {skill.argumentHint}</span>
              ) : null}
            </div>
          ) : null}
          <Composer
            key={composerKey}
            initial={activeChat.kind === 'new' ? activeChat.draft : ''}
            disabledReason={reason}
            autoFocus={activeChat.kind === 'new'}
            onSend={(text) => send(text, activeChat.kind === 'new' ? client || null : null)}
          />
          {sdkId ? (
            <details className="terminal-note">
              <summary>Continue in the terminal</summary>
              <code>claude --resume {sdkId}</code>
              <span>Chats started here do not show in the terminal's own list, so use this line.</span>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
