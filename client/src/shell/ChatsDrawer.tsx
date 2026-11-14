import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
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
import { placeName, STATE_WORDS, whenWords } from './words.ts';

/**
 * The star that keeps a chat at the top of its list. The label stays the same and `aria-pressed` says whether
 * it is on. Before the chat's first reply starts it has no lasting id, so there is no star yet.
 */
function StarButton({
  sdkSessionId,
  title,
  on,
  onPress,
}: {
  sdkSessionId: string;
  title: string;
  on: boolean;
  onPress: (sdkSessionId: string, button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="icon-btn star-btn"
      aria-pressed={on}
      aria-label={`Favourite: ${title}`}
      data-star-id={sdkSessionId}
      onClick={(e) => onPress(sdkSessionId, e.currentTarget)}
    >
      <Icon name="star" size={16} />
    </button>
  );
}

type OnStar = (sdkSessionId: string, button: HTMLElement) => void;
const NO_FAVOURITES: readonly string[] = [];
/** How long after a star press focus may still follow that chat (a failed save puts it back). */
const STAR_FOCUS_MS = 15_000;

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
        <StarButton sdkSessionId={chat.sdkSessionId} title={title} on={favourite} onPress={onStar} />
      ) : null}
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
  favourite,
  onStar,
}: {
  chat: PastSession;
  showKind: boolean;
  /** A delete is running: no second question until it ends. */
  busy: boolean;
  onAsk: () => void;
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
      <StarButton sdkSessionId={chat.sdkSessionId} title={title} on={favourite} onPress={onStar} />
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
  const { sessions, boot, deletePastChat, toggleFavouriteChat } = useStore();
  // One shared empty list, so a server that sends none doesn't look like a change on every render.
  const favs = boot?.prefs.favouriteChats ?? NO_FAVOURITES;
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

  // A starred or unstarred chat moves to another place in the list (on Earlier, another section), so its
  // button is a new one and focus drops to the page. When the list moves, focus goes back to that chat's star,
  // else the star that came next when it was pressed, else the drawer. The press is kept for a while, not for
  // one move only, so a failed save that puts the star back also brings focus back.
  const starFocus = useRef<{ id: string; next: string | null; favs: readonly string[]; at: number } | null>(
    null,
  );
  useEffect(() => {
    const want = starFocus.current;
    // Only a real change of stars moves a row; a reply with the same list must not take focus.
    if (!want || sameList(want.favs, favs)) return;
    if (Date.now() - want.at > STAR_FOCUS_MS) {
      starFocus.current = null;
      return;
    }
    want.favs = favs;
    // Only when the row's move dropped focus to the page: never from something the person has moved on to.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const stars = visibleStars(body.current);
    const target =
      stars.find((b) => b.dataset.starId === want.id) ?? stars.find((b) => b.dataset.starId === want.next);
    if (target && active !== target) target.focus();
    else if (!target) body.current?.focus();
  }, [favs]);
  // Which Earlier sections are open: the person's own choice, else Favourites and the newest day section.
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const onStar: OnStar = (id, button) => {
    const stars = visibleStars(body.current);
    const at = stars.indexOf(button as HTMLButtonElement);
    const next = stars[at + 1] ?? stars[at - 1];
    starFocus.current = { id, next: next?.dataset.starId ?? null, favs, at: Date.now() };
    // Open the section the chat moves to, so focus can follow it there.
    const chat = sessions?.past.find((p) => p.sdkSessionId === id);
    if (chat) {
      const to = favs.includes(id) ? groupChatsByDay([chat], new Date())[0]?.key : 'favourites';
      if (to) setOpenFolds((o) => ({ ...o, [to]: true }));
    }
    void toggleFavouriteChat(id);
  };

  const { dispatch, modes } = useShell();
  const [tab, setTab] = useState<ChatsTab>('open');
  const [kind, setKind] = useState<ChatKindFilter>('all');
  if (!sessions) return <p className="dock-empty">Loading your chats.</p>;
  // Favourites first; within each part, needs an answer first, then working, ready, stopped (`sortChats`).
  const open = favouritesFirst(sortChats(sessions.live), favs);
  // The switch shows once any chat is personal (or while a kind is picked); hidden, it counts as All.
  const showKind =
    kind !== 'all' ||
    sessions.live.some((c) => kindOf(c) === 'personal') ||
    sessions.past.some((c) => kindOf(c) === 'personal');
  const active: ChatKindFilter = showKind ? kind : 'all';
  const shownOpen = filterChats(open, active);
  const shownPast = filterChats(sessions.past, active);
  const kindWord = active === 'personal' ? 'personal' : 'TDS';
  const { favourites: favPast, rest: restPast } = splitFavourites(shownPast, favs);
  const pastGroups = groupChatsByDay(restPast, new Date());
  const pastOrder = [...favPast, ...pastGroups.flatMap((g) => g.items)].map((s) => s.sdkSessionId);
  const neighbour = (id: string): string | null => {
    const at = pastOrder.indexOf(id);
    return pastOrder[at + 1] ?? pastOrder[at - 1] ?? null;
  };
  const pastItem = (s: PastSession): ReactNode =>
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
        favourite={isFavourite(s, favs)}
        onStar={onStar}
      />
    );
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
      ) : sessions.past.length === 0 ? (
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

/** The star buttons a person can reach: rows in a folded group stay in the page but hidden. */
function visibleStars(root: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>('[data-star-id]') ?? []).filter(
    (b) => !b.closest('[hidden]'),
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
