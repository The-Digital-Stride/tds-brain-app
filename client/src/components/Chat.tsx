import { useState } from 'react';
import { api } from '../api.ts';
import { initialChatState, pendingCard } from '../state/chat-reducer.ts';
import { useStore } from '../store.tsx';
import { Composer } from './Composer.tsx';
import { Transcript } from './Transcript.tsx';

const REASONS = {
  working: 'Claude is working. You can stop it with the Stop button.',
  waiting: 'Claude is waiting for your answer above.',
  closed: 'This chat has ended. Start a new chat to carry on.',
} as const;

export function ChatView() {
  const {
    boot,
    activeChat,
    chats,
    sessions,
    send,
    run,
    actionError,
    clearError,
    startSkill,
    openView,
    composerFocus,
  } = useStore();

  const sessionId = activeChat.kind === 'live' ? activeChat.sessionId : null;
  const chat = sessionId ? (chats[sessionId] ?? initialChatState) : initialChatState;
  const live = sessionId ? sessions?.live.find((s) => s.id === sessionId) : undefined;
  const clients = boot?.clients ?? [];
  const skills = boot?.skills ?? [];

  // Starting points: pinned skills, else the ones used often.
  const byName = (name: string) => skills.find((s) => s.name === name);
  const pinned = (boot?.prefs.pins ?? []).map(byName).filter((s) => s !== undefined);
  const often = (boot?.usedOften ?? []).map((u) => byName(u.name)).filter((s) => s !== undefined);
  const starters = (pinned.length > 0 ? pinned : often).slice(0, 6);

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
  const canResumeInTerminal = boot?.identity.role === 'owner' || boot?.identity.role === 'scout';
  const clientName = (slug: string | null) =>
    slug ? (clients.find((c) => c.slug === slug)?.name ?? slug) : null;

  const composerKey = activeChat.kind === 'new' ? `new-${activeChat.key}` : activeChat.sessionId;
  const skill = activeChat.kind === 'new' ? activeChat.skill : null;
  const hasMessages = activeChat.kind === 'live' && chat.items.length > 0;

  return (
    <div className="chat">
      <div className="chat-head">
        <h1 className="chat-title">{live?.title || (activeChat.kind === 'new' ? 'New chat' : 'Chat')}</h1>
        {activeChat.kind === 'new' ? (
          <div className="client-pick">
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
        ) : live ? (
          <div className="client-label">
            Client: <strong>{clientName(live.client) ?? 'No client'}</strong>
          </div>
        ) : null}
        {working && sessionId ? (
          <button type="button" className="btn" onClick={() => void run(() => api.interrupt(sessionId))}>
            Stop
          </button>
        ) : null}
      </div>

      {hasMessages && activeChat.kind === 'live' ? (
        <Transcript items={chat.items} sessionId={activeChat.sessionId} sessionState={state} />
      ) : (
        <div className="transcript">
          <div className="empty">
            <h2 className="empty-title">What would you like to do?</h2>
            <p className="lede">
              Type a request below, or start from a skill.
              {activeChat.kind === 'live' ? ' This chat has no messages yet.' : ''}
            </p>
            {activeChat.kind === 'new' ? (
              <div className="starters">
                {starters.map((s) => (
                  <button key={s.name} type="button" className="btn" onClick={() => startSkill(s)}>
                    {s.title}
                  </button>
                ))}
                <button type="button" className="btn" data-variant="quiet" onClick={() => openView('skills')}>
                  Browse all skills
                </button>
              </div>
            ) : null}
          </div>
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
            skill={skill}
            disabledReason={reason}
            autoFocus={activeChat.kind === 'new'}
            focusSignal={composerFocus}
            onSend={(text) => send(text, activeChat.kind === 'new' ? client || null : null)}
          />
          {sdkId && canResumeInTerminal ? (
            <details className="terminal-note">
              <summary className="terminal-summary">Continue in the terminal</summary>
              <code className="terminal-cmd">claude --resume {sdkId}</code>
              <span>Chats started here do not show in the terminal's own list, so use this line.</span>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
