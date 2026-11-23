import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { attentionFor, type LiveSession, type PastSession } from '../../../shared/contract.ts';
import { favouritesFirst, isFavourite, splitFavourites } from '../state/chat-favourites.ts';
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
import { NO_FAVOURITES, StarButton, useStarFocus } from './StarButton.tsx';
import { pressedByKeyboard, UndoLine } from './UndoLine.tsx';
import { placeName, STATE_WORDS, whenWords } from './words.ts';

type OnStar = (sdkSessionId: string, button: HTMLElement) => void;

function OpenRow({
  chat,
  showKind,
  favourite,
  onStar,
}: {
  chat: LiveSession;
  showKind: boolean;
  favourite: boolean;
  onStar: OnStar;
}) {
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
      {chat.sdkSessionId ? (
        <StarButton id={chat.sdkSessionId} title={title} on={favourite} onPress={onStar} />
      ) : null}
      {/* End chat has its own icon: X only ever puts a surface away (design system, Actions rule 3). */}
      <button
        type="button"
        className="icon-btn"
        aria-label={`End chat: ${title}`}
        data-tip="End chat"
        onClick={() => {
          // A working chat asks first (`requestClose`); its question shows on the sheet, which a floating drawer hides.
          requestClose(chat.id);
          if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
        }}
      >
        <Icon name="end" size={16} />
      </button>
    </li>
  );
}

function PastRow({
  chat,
  showKind,
  onDelete,
  favourite,
  onStar,
}: {
  chat: PastSession;
  showKind: boolean;
  /** The bin: the row gives way to its Undo line at once (no question first). */
  onDelete: () => void;
  favourite: boolean;
  onStar: OnStar;
}) {
  const { openPast } = useStore();
  const { dispatch, modes } = useShell();
  const title = chat.title || 'New chat';
  return (
    <li className="line">
      <button
        type="button"
        className="line-main"
        data-past-open={chat.sdkSessionId}
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
      <StarButton id={chat.sdkSessionId} title={title} on={favourite} onPress={onStar} />
      <button
        type="button"
        className="icon-btn"
        aria-label={`Delete chat: ${title}`}
        data-tip="Delete chat"
        data-past-id={chat.sdkSessionId}
        onClick={onDelete}
      >
        <Icon name="bin" size={16} />
      </button>
    </li>
  );
}

export function ChatsDrawer() {
  const {
    sessions,
    boot,
    toggleFavouriteChat,
    newChat,
    heldChats,
    holdDeletePastChat,
    undoDeletePastChat,
    pauseChatDelete,
    resumeChatDelete,
  } = useStore();
  const { dispatch, modes } = useShell();
  // One shared empty list, so a server that sends none doesn't look like a change on every render.
  const favs = boot?.prefs.favouriteChats ?? NO_FAVOURITES;
  const body = useRef<HTMLDivElement>(null);
  // The held chat whose Undo takes focus: only after a keyboard press (plan 2026-11-22-ux-consistency, R1).
  const [focusUndo, setFocusUndo] = useState<string | null>(null);
  // Where focus goes next: a row's bin (after Undo) or a row's open button (after a pointer delete), else the list.
  const [want, setWant] = useState<{ id: string | null; to: 'bin' | 'open' } | null>(null);
  useLayoutEffect(() => {
    if (!want) return;
    setWant(null);
    const attr = want.to === 'bin' ? 'pastId' : 'pastOpen';
    // Rows in a folded group stay in the page but hidden, and can't take focus.
    const target = want.id
      ? Array.from(
          body.current?.querySelectorAll<HTMLElement>(
            want.to === 'bin' ? '[data-past-id]' : '[data-past-open]',
          ) ?? [],
        ).find((b) => b.dataset[attr] === want.id && !b.closest('[hidden]'))
      : undefined;
    (target ?? body.current)?.focus({ preventScroll: true });
  }, [want]);
  // A held line that loses its Undo (its time is up) or goes: if the keyboard was on it, keep it in the drawer.
  const heldCount = heldChats.length;
  const sendingCount = heldChats.filter((h) => h.phase === 'sending').length;
  const lastHeld = useRef({ heldCount, sendingCount });
  useEffect(() => {
    const was = lastHeld.current;
    lastHeld.current = { heldCount, sendingCount };
    if (heldCount >= was.heldCount && sendingCount <= was.sendingCount) return;
    if (document.activeElement === null || document.activeElement === document.body) body.current?.focus();
  }, [heldCount, sendingCount]);

  // Focus follows a chat whose star moved it (`useStarFocus`).
  const rememberStar = useStarFocus(body, favs);
  // Which Earlier sections are open: the person's own choice, else Favourites and the newest day section.
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const onStar: OnStar = (id, button) => {
    rememberStar(id, button);
    // Open the section the chat moves to, so focus can follow it there.
    const chat = sessions?.past.find((p) => p.sdkSessionId === id);
    if (chat) {
      const to = favs.includes(id) ? groupChatsByDay([chat], new Date())[0]?.key : 'favourites';
      if (to) setOpenFolds((o) => ({ ...o, [to]: true }));
    }
    void toggleFavouriteChat(id);
  };

  const [tab, setTab] = useState<ChatsTab>('open');
  const [kind, setKind] = useState<ChatKindFilter>('all');
  // Always on the page while the drawer is, so a screen reader hears the delete. The result is announced by
  // the sheet's notice line (SheetNotices), which stays mounted even if this drawer is closed mid-hold.
  const waiting = heldChats.filter((h) => h.phase === 'waiting');
  const status = (
    <p className="visually-hidden" role="status" data-testid="chat-delete-status">
      {waiting.length > 0
        ? waiting
            .map((h) => `“${h.title}” moved to the Bin. It leaves the terminal too. Undo is in its place.`)
            .join(' ')
        : ''}
    </p>
  );
  if (!sessions)
    return (
      <>
        {status}
        <p className="dock-empty">Loading your chats.</p>
      </>
    );
  // The store leaves held chats out of every list; here each keeps its place as its Undo line.
  const heldById = new Map(heldChats.map((h) => [h.sdkSessionId, h]));
  const pastAll =
    heldChats.length === 0
      ? sessions.past
      : [
          ...sessions.past.filter((p) => !heldById.has(p.sdkSessionId)),
          ...heldChats.map((h) => h.session),
        ].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  // Favourites first; within each part, needs an answer first, then working, ready, stopped (`sortChats`).
  const open = favouritesFirst(sortChats(sessions.live), favs);
  // The switch shows once any chat is personal (or while a kind is picked); hidden, it counts as All.
  const showKind =
    kind !== 'all' ||
    sessions.live.some((c) => kindOf(c) === 'personal') ||
    pastAll.some((c) => kindOf(c) === 'personal');
  const active: ChatKindFilter = showKind ? kind : 'all';
  const shownOpen = filterChats(open, active);
  const shownPast = filterChats(pastAll, active);
  const kindWord = active === 'personal' ? 'personal' : 'TDS';
  const { favourites: favPast, rest: restPast } = splitFavourites(shownPast, favs);
  const pastGroups = groupChatsByDay(restPast, new Date());
  const pastOrder = [...favPast, ...pastGroups.flatMap((g) => g.items)].map((s) => s.sdkSessionId);
  /** The row after `id` in the list as shown (or before it, at the end), skipping other held lines. */
  const neighbour = (id: string): string | null => {
    const order = pastOrder.filter((x) => x === id || !heldById.has(x));
    const at = order.indexOf(id);
    return order[at + 1] ?? order[at - 1] ?? null;
  };
  const remove = (s: PastSession) => {
    const title = s.title || 'New chat';
    const next = neighbour(s.sdkSessionId);
    const keyboard = pressedByKeyboard();
    holdDeletePastChat(s.sdkSessionId, title);
    // A keyboard press puts focus on Undo (which holds the clock). A pointer press moves it to the next row, so
    // nothing holds the clock and the delete is sent on time (R1).
    if (keyboard) setFocusUndo(s.sdkSessionId);
    else {
      setFocusUndo(null);
      setWant({ id: next, to: 'open' });
    }
  };
  const pastItem = (s: PastSession): ReactNode => {
    const held = heldById.get(s.sdkSessionId);
    if (held) {
      const id = held.sdkSessionId;
      return (
        <UndoLine
          key={id}
          as="row"
          text={`“${held.title}” moved to the Bin. It leaves the terminal too.`}
          undoLabel={`Undo deleting “${held.title}”`}
          sending={held.phase === 'sending'}
          focusOnMount={focusUndo === id}
          onPause={() => pauseChatDelete(id)}
          onResume={() => resumeChatDelete(id)}
          onUndo={() => {
            undoDeletePastChat(id);
            setFocusUndo(null);
            // Back on the row's own bin, where the person was.
            setWant({ id, to: 'bin' });
          }}
        />
      );
    }
    return (
      <PastRow
        key={s.sdkSessionId}
        chat={s}
        showKind={active === 'all'}
        onDelete={() => remove(s)}
        favourite={isFavourite(s, favs)}
        onStar={onStar}
      />
    );
  };
  return (
    <div className="drawer-body" ref={body} tabIndex={-1}>
      {status}
      {/* New chat ends the row it acts on, like the To-dos drawer's + (design system, Actions rule 7). */}
      <div className="chats-switch">
        <Seg
          label="Which chats"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: `Open, ${open.length}` },
            { value: 'earlier', label: 'Earlier' },
          ]}
        />
        <button
          type="button"
          className="icon-btn"
          data-variant="primary"
          aria-label="New chat"
          onClick={() => {
            newChat();
            // A floating drawer closes once a choice is made; a pushing one stays.
            if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
          }}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>
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
                <OpenRow
                  chat={c}
                  showKind={active === 'all'}
                  favourite={isFavourite(c, favs)}
                  onStar={onStar}
                />
                <HelperRows chat={c} />
              </Fragment>
            ))}
          </ul>
        )
      ) : pastAll.length === 0 ? (
        <p className="dock-empty">No earlier chats yet.</p>
      ) : shownPast.length === 0 ? (
        <p className="dock-empty">No earlier {kindWord} chats.</p>
      ) : (
        <>
          {/* Favourites first, open; then the rest grouped by when they were last used, the newest group open. */}
          {favPast.length > 0 ? (
            <Fold
              key="favourites"
              title="Favourites"
              count={favPast.length}
              open={openFolds.favourites ?? true}
              onToggle={(o) => setOpenFolds((f) => ({ ...f, favourites: o }))}
            >
              <ul className="drawer-list">{favPast.map(pastItem)}</ul>
            </Fold>
          ) : null}
          {pastGroups.map((g, i) => (
            <Fold
              key={g.key}
              title={g.title}
              count={g.items.length}
              open={openFolds[g.key] ?? i === 0}
              onToggle={(o) => setOpenFolds((f) => ({ ...f, [g.key]: o }))}
            >
              <ul className="drawer-list">{g.items.map(pastItem)}</ul>
            </Fold>
          ))}
        </>
      )}
    </div>
  );
}
