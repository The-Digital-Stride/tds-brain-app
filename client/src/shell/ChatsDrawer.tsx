import { useState } from 'react';
import { attentionFor, type LiveSession } from '../../../shared/contract.ts';
import { sortChats } from '../state/chats.ts';
import { useStore } from '../store.tsx';
import type { ChatsTab } from './contract.ts';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, STATE_WORDS, whenWords } from './words.ts';

function OpenRow({ chat }: { chat: LiveSession }) {
  const { boot, openChat, requestClose, activeChat, view } = useStore();
  const { dispatch, modes } = useShell();
  const current = view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const title = chat.title || 'New chat';
  const clientName = chat.client ? placeName(chat.client, boot?.clients ?? []) : null;
  return (
    <li className="line" aria-current={current ? 'true' : undefined}>
      <button
        type="button"
        className="line-main"
        onClick={() => {
          openChat(chat.id);
          if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
        }}
      >
        <span className="dot" data-attention={attentionFor(chat.state) ?? undefined} aria-hidden="true" />
        <span className="line-text">
          <span className="line-title">{title}</span>
          <span className="line-meta">
            {STATE_WORDS[chat.state].toLowerCase()}
            {clientName ? `, ${clientName}` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Close chat: ${title}`}
        onClick={() => {
          requestClose(chat.id);
          // The "Close anyway?" question shows on the sheet, which a floating drawer hides.
          if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

export function ChatsDrawer() {
  const { sessions, openPast } = useStore();
  const { dispatch, modes } = useShell();
  const [tab, setTab] = useState<ChatsTab>('open');
  if (!sessions) return <p className="dock-empty">Loading your chats.</p>;
  const open = sortChats(sessions.live);
  return (
    <div className="drawer-body">
      <Seg
        label="Which chats"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: `Open, ${open.length}` },
          { value: 'earlier', label: 'Earlier' },
        ]}
      />
      {tab === 'open' ? (
        open.length === 0 ? (
          <p className="dock-empty">No chats open. Use New chat to start one.</p>
        ) : (
          <ul className="drawer-list">
            {open.map((c) => (
              <OpenRow key={c.id} chat={c} />
            ))}
          </ul>
        )
      ) : sessions.past.length === 0 ? (
        <p className="dock-empty">No earlier chats yet.</p>
      ) : (
        <ul className="drawer-list">
          {sessions.past.map((s) => (
            <li className="line" key={s.sdkSessionId}>
              <button
                type="button"
                className="line-main"
                onClick={() => {
                  void openPast(s.sdkSessionId);
                  if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
                }}
              >
                <span className="line-text">
                  <span className="line-title">{s.title || 'New chat'}</span>
                  <span className="line-meta">{whenWords(s.lastModified)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
