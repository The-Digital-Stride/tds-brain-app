import { useState } from 'react';
import { attentionFor, type LiveSession } from '../../../shared/contract.ts';
import { type ChatKindFilter, filterChats, kindOf } from '../state/chat-filter.ts';
import { groupChatsByDay } from '../state/chat-groups.ts';
import { sortChats } from '../state/chats.ts';
import { useStore } from '../store.tsx';
import type { ChatsTab } from './contract.ts';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, STATE_WORDS, whenWords } from './words.ts';

function OpenRow({ chat, showKind }: { chat: LiveSession; showKind: boolean }) {
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
            {/* No lock, unlike a personal to-do: a personal chat is only sorted apart, not kept private. */}
            {showKind && kindOf(chat) === 'personal' ? ', personal' : ''}
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
  const [kind, setKind] = useState<ChatKindFilter>('all');
  if (!sessions) return <p className="dock-empty">Loading your chats.</p>;
  const open = sortChats(sessions.live);
  // The switch shows once any chat is personal (or while a kind is picked); hidden, it counts as All.
  const showKind =
    kind !== 'all' ||
    sessions.live.some((c) => kindOf(c) === 'personal') ||
    sessions.past.some((c) => kindOf(c) === 'personal');
  const active: ChatKindFilter = showKind ? kind : 'all';
  const shownOpen = filterChats(open, active);
  const shownPast = filterChats(sessions.past, active);
  const kindWord = active === 'personal' ? 'personal' : 'TDS';
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
      {showKind ? (
        // Straight in the body like the tab switch above, so both are the same width.
        <Seg<ChatKindFilter>
          label="Which kind of chat"
          value={active}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'tds', label: 'TDS' },
            { value: 'personal', label: 'Personal' },
          ]}
        />
      ) : null}
      {tab === 'open' ? (
        open.length === 0 ? (
          <p className="dock-empty">No chats open. Use New chat to start one.</p>
        ) : shownOpen.length === 0 ? (
          <p className="dock-empty">No {kindWord} chats open.</p>
        ) : (
          <ul className="drawer-list">
            {shownOpen.map((c) => (
              <OpenRow key={c.id} chat={c} showKind={active === 'all'} />
            ))}
          </ul>
        )
      ) : sessions.past.length === 0 ? (
        <p className="dock-empty">No earlier chats yet.</p>
      ) : shownPast.length === 0 ? (
        <p className="dock-empty">No earlier {kindWord} chats.</p>
      ) : (
        // Grouped by when they were last used, with only the newest group open, like the to-dos.
        groupChatsByDay(shownPast, new Date()).map((g, i) => (
          <Fold key={g.key} title={g.title} count={g.items.length} defaultOpen={i === 0}>
            <ul className="drawer-list">
              {g.items.map((s) => (
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
                      <span className="line-meta">
                        {whenWords(s.lastModified)}
                        {active === 'all' && kindOf(s) === 'personal' ? ', personal' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Fold>
        ))
      )}
    </div>
  );
}
