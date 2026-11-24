import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CHAT_TITLE_MAX } from '../../../shared/chat-summary-contract.ts';
import { attentionFor } from '../../../shared/contract.ts';
import type { ChatPage } from '../../../shared/pages-contract.ts';
import { api } from '../api.ts';
import { engineLine } from '../format.ts';
import { Confirm } from '../shell/Confirm.tsx';
import { Icon } from '../shell/Icon.tsx';
import { SearchSelect } from '../shell/SearchSelect.tsx';
import { SheetBar } from '../shell/SheetBar.tsx';
import { useShell } from '../shell/ShellProvider.tsx';
import { useOpenPageAfterTurn } from '../shell/useOpenPageAfterTurn.ts';
import { placeName } from '../shell/words.ts';
import { currentStep } from '../state/blocks.ts';
import { type ChatItem, COMPACTING_LINE, initialChatState, pendingCard } from '../state/chat-reducer.ts';
import { projectPageRequest } from '../state/client-choice.ts';
import { closeConfirmText, isClearCommand, needsCloseConfirm } from '../state/close.ts';
import { filterOptions, isOpenProject, useProjects } from '../state/projects.ts';
import { saveChatRequest } from '../state/save-chat-request.ts';
import { useStore } from '../store.tsx';
import { AttentionBar } from './AttentionBar.tsx';
import { PermissionCard, QuestionCard } from './Cards.tsx';
import { Composer } from './Composer.tsx';
import { ContextMeter } from './ContextMeter.tsx';
import { LevelLine, LevelOffer } from './LevelLine.tsx';
import { Transcript } from './Transcript.tsx';

const REASONS = {
  working: 'Claude is working. You can stop it with the Stop button.',
  waiting: 'Claude is waiting for your answer above.',
} as const;

const NO_PAGES: ChatPage[] = [];
const SAVE_BUSY = 'Claude is still replying. Save it once the reply is done.';

/**
 * A message typed in the chat drawer, handed to the chat screen's message box when Open full screen moves the
 * chat there (the drawer's box goes as it closes). Read as the new box mounts, then cleared.
 */
let handoff: { session: string; text: string } | null = null;
const FILES_FIRST = 'Send or remove the attached files first.';
/** A file attached in the message box (Composer's chips). */
const ATTACHED = '.composer .chip-row .chip';

/** True when a card other than `requestId` is still waiting on the person. */
function anotherCardWaits(items: ChatItem[], requestId: string): boolean {
  return items.some(
    (i) =>
      (i.kind === 'permission' || i.kind === 'question') && i.outcome === null && i.requestId !== requestId,
  );
}

/**
 * The chat sheet: a live chat only (Home handles a new one). The bar on top, the thread in the
 * middle, and below it the floater: the card waiting on the person, the status line and the
 * message box. `placement: 'drawer'` is the same chat in the right-hand drawer over a tool: a small
 * header of its own (the page keeps its one heading and search) with Open full screen and Hide chat.
 */
export function ChatView({ placement = 'sheet' }: { placement?: 'sheet' | 'drawer' } = {}) {
  const inDrawer = placement === 'drawer';
  const headingId = useId();
  // Open full screen is held while files are attached in the drawer: they can't move with the message.
  const [held, setHeld] = useState(false);
  const {
    boot,
    activeChat,
    chats,
    sessions,
    send,
    run,
    composerFocus,
    requestComposerFocus,
    requestSettingsFocus,
    openView,
    closeRequest,
    cancelClose,
    requestClose,
    closeChat,
    skillLevels,
    setSkillLevel,
    setChatLevel,
    dismissLevelOffer,
    hideChatDrawer,
    expandChatDrawer,
    openChat,
  } = useStore();
  const { dispatch: shellDispatch, state: shell } = useShell();
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // Files can be dropped anywhere on the chat column.
  const column = useRef<HTMLDivElement>(null);

  const sessionId = activeChat.kind === 'live' ? activeChat.sessionId : null;
  const chat = sessionId ? (chats[sessionId] ?? initialChatState) : initialChatState;
  const engine = engineLine(chat.model, chat.effort);
  // Automatic mode only: manual (and an older server) keep the v0.19.0 line.
  const levelShown = chat.level !== null && chat.level.source.kind !== 'manual';
  const offerSkill =
    sessionId &&
    chat.unlevelledSkill &&
    skillLevels?.canSet &&
    skillLevels.writable &&
    !(chat.unlevelledSkill in skillLevels.levels)
      ? chat.unlevelledSkill
      : null;
  // Read when an answer goes through, which is after this render.
  const latestItems = useRef(chat.items);
  latestItems.current = chat.items;
  const live = sessionId ? sessions?.live.find((s) => s.id === sessionId) : undefined;
  const helpersWorking = (live?.helpers ?? []).filter((h) => h.status === 'working').length;
  const clients = boot?.clients ?? [];
  const title = live?.title || 'Chat';

  // Save to project (plan 2026-11-24-chat-summary-updates): only once there is a reply to save, and only when
  // this person may add project updates. The chat's own project is used when it is still a live one.
  const { list: projectList } = useProjects();
  const [picking, setPicking] = useState(false);
  const sdkId = live?.sdkSessionId ?? chat.sdkSessionId ?? null;
  const savable = (projectList?.projects ?? []).filter((c) => isOpenProject(c) && c.card === 'ok');
  const canSave = projectList?.canSaveChat === true && sdkId !== null;
  const saveTo = (key: string) => {
    if (!sdkId) return;
    setPicking(false);
    saveChatRequest.set({ key, chat: sdkId, title: title.slice(0, CHAT_TITLE_MAX) });
    projectPageRequest.set(key);
    openView('app:projects');
    // The chat stays open beside the form.
    if (sessionId) openChat(sessionId, { in: 'drawer' });
  };
  const pressSave = () => {
    const own = live?.project ? savable.find((c) => c.key === live.project) : undefined;
    if (own) saveTo(own.key);
    else setPicking((v) => !v);
  };

  const draftFor = (id: string | null) => (id !== null && handoff?.session === id ? handoff.text : '');
  // The chat screen's box has read the handed-over text by now.
  useEffect(() => {
    if (!inDrawer && handoff?.session === sessionId) handoff = null;
  }, [inDrawer, sessionId]);
  // The "attached files" note goes once the files have been sent or removed.
  useEffect(() => {
    const col = column.current;
    if (!held || !col) return;
    const watch = new MutationObserver(() => {
      if (!col.querySelector(ATTACHED)) setHeld(false);
    });
    watch.observe(col, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [held]);
  // Moves the drawer's chat to the chat screen with what was typed, or says why not (attached files).
  const toFullScreen = useCallback((): boolean => {
    const box = column.current?.querySelector<HTMLTextAreaElement>('.composer-input');
    if (column.current?.querySelector(ATTACHED)) {
      setHeld(true);
      box?.focus();
      return false;
    }
    handoff = sessionId && box?.value.trim() ? { session: sessionId, text: box.value } : null;
    expandChatDrawer();
    return true;
  }, [sessionId, expandChatDrawer]);

  const chatPages = chat.files.pages ?? NO_PAGES;
  // A link to a file that is this chat's page opens the page view, which has "Download with TDS
  // branding" and "Suggest a change"; any other file is shown in the Files panel.
  const openFile = useCallback(
    (key: string) => {
      if (!sessionId) return;
      const page = chatPages.find((p) => p.fileKey === key);
      if (page)
        shellDispatch({ type: 'open-viewer', viewer: { kind: 'page', chat: sessionId, key: page.key } });
      else {
        // A file shows in the chat's own panel, which is on the chat screen (over a tool it would be the tool's).
        if (inDrawer && !toFullScreen()) return;
        shellDispatch({ type: 'show-chat-file', chat: sessionId, key });
      }
    },
    [sessionId, shellDispatch, chatPages, inDrawer, toFullScreen],
  );
  const openPage = useCallback(
    (key: string) => {
      if (sessionId) shellDispatch({ type: 'open-viewer', viewer: { kind: 'page', chat: sessionId, key } });
    },
    [sessionId, shellDispatch],
  );
  // The page Claude made or changed opens here when its turn ends, so it is seen in the app.
  useOpenPageAfterTurn(
    sessionId,
    chat.sessionState,
    chat.files.pages ?? NO_PAGES,
    shell.viewer !== null,
    openPage,
  );

  const confirming = sessionId !== null && closeRequest === sessionId;
  useEffect(() => {
    // Cancelling the confirm puts focus back on the button that opened it.
    if (wasConfirming.current && !confirming) closeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (sessionId === null) return null;

  const card = pendingCard(chat);
  const state = chat.sessionState;
  let reason: string | null = null;
  if (card !== null || state === 'waiting') reason = REASONS.waiting;
  else if (state === 'working' || state === 'starting') reason = REASONS.working;
  // A chat that has ended is not blocked: the next message reopens it (store `send`).
  const working = state === 'working' || state === 'starting';
  const step = currentStep(chat.items.filter((i) => i.kind === 'tool'));
  const clientName = live?.client ? placeName(live.client, clients) : null;

  // After an answer, focus goes to the next card if one is waiting (it takes focus as it
  // appears), else back to the message box.
  const afterAnswer = (requestId: string) => () => {
    if (!anotherCardWaits(latestItems.current, requestId)) requestComposerFocus();
  };

  const saveButton = canSave ? (
    <button
      type="button"
      className="btn"
      data-variant="quiet"
      data-size="small"
      disabled={working}
      aria-expanded={picking}
      data-tip={working ? SAVE_BUSY : undefined}
      onClick={pressSave}
    >
      Save to project
    </button>
  ) : null;

  const savePicker =
    picking && canSave ? (
      <div className="chat-save-pick">
        <label className="client-label" htmlFor="pick-save-project">
          Save to
        </label>
        <SearchSelect
          id="pick-save-project"
          className="project-select"
          value=""
          placeholder="Choose a project"
          options={filterOptions(savable, clients)}
          recentKey="projects"
          onChange={(v) => {
            if (v) saveTo(v);
          }}
        />
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          onClick={() => setPicking(false)}
        >
          Cancel
        </button>
      </div>
    ) : null;

  const drawerHead = (
    <header className="panel-head chat-drawer-head">
      <div className="chat-drawer-name">
        <h2 id={headingId}>{title}</h2>
        {clientName ? <span className="chip">{clientName}</span> : null}
      </div>
      {saveButton}
      <button
        type="button"
        className="icon-btn"
        aria-label="Open full screen"
        data-tip="Open full screen"
        onClick={toFullScreen}
      >
        <Icon name="expand" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Hide chat"
        data-tip="Hide chat"
        onClick={hideChatDrawer}
      >
        <Icon name="close" />
      </button>
      <p className="chat-drawer-note" role="status">
        {held ? FILES_FIRST : ''}
      </p>
    </header>
  );

  return (
    <div
      className="chat chat-live"
      ref={column}
      data-placement={placement}
      {...(inDrawer ? { role: 'region', 'aria-labelledby': headingId } : {})}
    >
      {inDrawer ? (
        drawerHead
      ) : (
        <SheetBar crumb="Chats" title={title} panel="Files and details">
          {/* With no client the chip is left out; the panel's Details says so. */}
          {clientName ? <span className="chip">{clientName}</span> : null}
          {saveButton}
          {confirming ? (
            <Confirm
              label="End this chat"
              text={closeConfirmText(state, helpersWorking)}
              action="End chat"
              safe="Keep chat"
              variant="danger"
              busy={false}
              onConfirm={() => void closeChat(sessionId)}
              onCancel={cancelClose}
            />
          ) : (
            <button
              type="button"
              className="icon-btn"
              aria-label="End chat"
              data-tip="End chat"
              ref={closeButton}
              onClick={() => requestClose(sessionId)}
            >
              <Icon name="end" />
            </button>
          )}
        </SheetBar>
      )}

      {savePicker}

      {chat.items.length > 0 ? (
        <Transcript
          items={chat.items}
          sessionId={sessionId}
          sessionState={state}
          files={chat.files.files}
          brainRoot={boot?.brain.path}
          onFile={openFile}
          pages={chat.files.pages ?? []}
          onPage={openPage}
        />
      ) : (
        <div className="thread">
          <div className="thread-col thread-empty">
            <h2>What would you like to do?</h2>
            <p className="lede">
              Type a request below, or start from a skill. This chat has no messages yet.
            </p>
          </div>
        </div>
      )}

      <div className="floater">
        <div className="floater-col">
          {card ? (
            <div className="pending" key={`${card.kind}-${card.requestId}`}>
              {card.kind === 'permission' ? (
                <PermissionCard item={card} sessionId={sessionId} onAnswered={afterAnswer(card.requestId)} />
              ) : (
                <QuestionCard item={card} sessionId={sessionId} onAnswered={afterAnswer(card.requestId)} />
              )}
            </div>
          ) : null}
          {chat.compacting ? <p className="engine-line compacting-line">{COMPACTING_LINE}</p> : null}
          <AttentionBar
            key={`status-${sessionId}`}
            state={state}
            step={step}
            lastActivityAt={live?.lastActivityAt ?? null}
            stateSince={chat.stateSince}
          />
          <Composer
            key={`chat-${sessionId}`}
            initial={inDrawer ? '' : draftFor(sessionId)}
            skill={null}
            disabledReason={reason}
            autoFocus={false}
            focusSignal={composerFocus}
            attention={attentionFor(state)}
            dropZone={column}
            onStop={working && !confirming ? () => void run(() => api.interrupt(sessionId)) : undefined}
            onSend={async (text, uploadIds) => {
              if (isClearCommand(text)) {
                // "Start afresh": handled here, never sent to Claude.
                return needsCloseConfirm(state) ? false : closeChat(sessionId);
              }
              return send(text, null, uploadIds);
            }}
          />
          {/* Beside the level line, and in manual mode too, so it lives here and not inside LevelLine. */}
          {chat.context ? (
            <div className="context-foot">
              <ContextMeter reading={chat.context} />
            </div>
          ) : null}
          {levelShown && chat.level && sessionId ? (
            <LevelLine level={chat.level} onPick={(tier) => void setChatLevel?.(sessionId, tier)} />
          ) : null}
          {offerSkill && sessionId ? (
            <LevelOffer
              key={offerSkill}
              skill={offerSkill}
              usedTier={chat.level?.tier ?? null}
              onSet={(tier) => {
                void setSkillLevel?.(offerSkill, tier).then((ok) => {
                  if (ok) {
                    dismissLevelOffer?.(sessionId);
                    requestComposerFocus?.();
                  }
                });
              }}
              onDismiss={() => {
                dismissLevelOffer?.(sessionId);
                requestComposerFocus?.();
              }}
            />
          ) : null}
          {engine && !levelShown ? (
            <p className="engine-line">
              <span className="engine-text">
                <span className="visually-hidden">Claude is using </span>
                {engine}
              </span>
              <button
                type="button"
                className="btn"
                data-variant="quiet"
                data-size="small"
                aria-label="Change model and effort"
                onClick={() => {
                  requestSettingsFocus();
                  openView('settings');
                }}
              >
                Change
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
