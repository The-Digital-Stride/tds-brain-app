import { Fragment, useEffect, useRef, useState } from 'react';
import { attentionFor, type LiveSession, type PastSession } from '../../../shared/contract.ts';
import { type ChatKindFilter, filterChats, kindOf } from '../state/chat-filter.ts';
import { groupChatsByDay } from '../state/chat-groups.ts';
import { sortChats } from '../state/chats.ts';
import { useStore } from '../store.tsx';
import type { ChatsTab } from './contract.ts';
import { Fold } from './Fold.tsx';
import { HelperRows, helperCount, helpersWorking } from './HelperRows.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, STATE_WORDS, whenWords } from './words.ts';

function OpenRow({ chat, showKind }: { chat: LiveSession; showKind: boolean }) {
  const { boot, openChat, requestClose, activeChat, view } = useStore();
  const { dispatch, modes } = useShell();
  const current = view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const title = chat.title || 'New chat';
  const busyHelpers = helpersWorking(chat);
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
            {busyHelpers > 0 ? `, ${helperCount(busyHelpers)} working` : ''}
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

function PastRow({
  chat,
  showKind,
  busy,
  onAsk,
}: {
  chat: PastSession;
  showKind: boolean;
  /** A delete is running: no second question until it ends. */
  busy: boolean;
  onAsk: () => void;
}) {
  const { openPast } = useStore();
  const { dispatch, modes } = useShell();
  const title = chat.title || 'New chat';
  return (
    <li className="line">
      <button
        type="button"
        className="line-main"
        onClick={() => {
          void openPast(chat.sdkSessionId);
          if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
        }}
      >
        <span className="line-text">
          <span className="line-title">{title}</span>
          <span className="line-meta">
            {whenWords(chat.lastModified)}
            {showKind && kindOf(chat) === 'personal' ? ', personal' : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Delete chat: ${title}`}
        data-past-id={chat.sdkSessionId}
        disabled={busy}
        onClick={onAsk}
      >
        <Icon name="bin" size={16} />
      </button>
    </li>
  );
}

export function ChatsDrawer() {
  const { sessions, openPast, deletePastChat } = useStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  // Where focus goes once the question closes or the list reloads: the row's bin button, or the next one.
  // `next` is the row after it in the list as shown (or before it, at the end), recorded when Delete is pressed.
  const refocus = useRef<{ id: string; next: string | null; afterReload?: boolean } | null>(null);
  const seen = useRef(sessions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the question closes or the list reloads.
  useEffect(() => {
    const want = refocus.current;
    if (!want || confirmId) return;
    // After a delete, wait for the reload: the row is still there until the list changes.
    if (want.afterReload && sessions === seen.current) return;
    refocus.current = null;
    // Rows in a folded group stay in the page but hidden, and can't take focus.
    const bins = Array.from(body.current?.querySelectorAll<HTMLElement>('[data-past-id]') ?? []).filter(
      (b) => !b.closest('[hidden]'),
    );
    const byId = (id: string | null) => (id ? bins.find((b) => b.dataset.pastId === id) : undefined);
    const target = byId(want.id) ?? byId(want.next);
    (target ?? body.current)?.focus();
  }, [sessions, confirmId]);

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
  const pastGroups = groupChatsByDay(shownPast, new Date());
  const pastOrder = pastGroups.flatMap((g) => g.items.map((s) => s.sdkSessionId));
  const neighbour = (id: string): string | null => {
    const at = pastOrder.indexOf(id);
    return pastOrder[at + 1] ?? pastOrder[at - 1] ?? null;
  };
  return (
    <div className="drawer-body" ref={body} tabIndex={-1}>
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
              <Fragment key={c.id}>
                <OpenRow chat={c} showKind={active === 'all'} />
                <HelperRows chat={c} />
              </Fragment>
            ))}
          </ul>
        )
      ) : sessions.past.length === 0 ? (
        <p className="dock-empty">No earlier chats yet.</p>
      ) : shownPast.length === 0 ? (
        <p className="dock-empty">No earlier {kindWord} chats.</p>
      ) : (
        // Grouped by when they were last used, with only the newest group open, like the to-dos.
        pastGroups.map((g, i) => (
          <Fold key={g.key} title={g.title} count={g.items.length} defaultOpen={i === 0}>
            <ul className="drawer-list">
              {g.items.map((s) =>
                confirmId === s.sdkSessionId ? (
                  <li className="line line-confirm" key={s.sdkSessionId}>
                    <div className="line-text">
                      <span className="line-title">{s.title || 'New chat'}</span>
                      <fieldset
                        className="close-confirm"
                        aria-label="Delete this chat"
                        aria-describedby={`delete-q-${s.sdkSessionId}`}
                        onKeyDown={(e) => {
                          if (e.key !== 'Escape') return;
                          // Always handled here, so the shell's Esc never closes the drawer mid-question or
                          // mid-delete; while the delete runs it does nothing.
                          e.preventDefault();
                          e.stopPropagation();
                          if (busyId) return;
                          refocus.current = { id: s.sdkSessionId, next: null };
                          setConfirmId(null);
                        }}
                      >
                        <span id={`delete-q-${s.sdkSessionId}`}>
                          Move this chat to the Bin? It also leaves Claude Code in the terminal.
                        </span>
                        <button
                          type="button"
                          className="btn"
                          data-variant="danger"
                          data-size="small"
                          // aria-disabled, not disabled: a disabled button loses focus to the page, and Esc
                          // would then miss this question and close the drawer mid-delete.
                          aria-disabled={busyId !== null || undefined}
                          onClick={() => {
                            if (busyId) return;
                            setBusyId(s.sdkSessionId);
                            void deletePastChat(s.sdkSessionId).then((ok) => {
                              seen.current = sessions;
                              refocus.current = {
                                id: s.sdkSessionId,
                                next: neighbour(s.sdkSessionId),
                                afterReload: ok,
                              };
                              setBusyId(null);
                              // Failed: the row comes back (the error shows). Done: the list reloads without it.
                              setConfirmId(null);
                            });
                          }}
                        >
                          Delete chat
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-size="small"
                          // biome-ignore lint/a11y/noAutofocus: focus moves here because the question just appeared.
                          autoFocus
                          aria-disabled={busyId !== null || undefined}
                          onClick={() => {
                            if (busyId) return;
                            refocus.current = { id: s.sdkSessionId, next: null };
                            setConfirmId(null);
                          }}
                        >
                          Keep chat
                        </button>
                      </fieldset>
                    </div>
                  </li>
                ) : (
                  <PastRow
                    key={s.sdkSessionId}
                    chat={s}
                    showKind={active === 'all'}
                    busy={busyId !== null}
                    onAsk={() => setConfirmId(s.sdkSessionId)}
                  />
                ),
              )}
            </ul>
          </Fold>
        ))
      )}
    </div>
  );
}
