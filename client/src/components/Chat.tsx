import { useCallback, useEffect, useRef } from 'react';
import { attentionFor } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { engineLine } from '../format.ts';
import { Icon } from '../shell/Icon.tsx';
import { SheetBar } from '../shell/SheetBar.tsx';
import { useShell } from '../shell/ShellProvider.tsx';
import { placeName } from '../shell/words.ts';
import { currentStep } from '../state/blocks.ts';
import { type ChatItem, initialChatState, pendingCard } from '../state/chat-reducer.ts';
import { closeConfirmText, isClearCommand, needsCloseConfirm } from '../state/close.ts';
import { useStore } from '../store.tsx';
import { AttentionBar } from './AttentionBar.tsx';
import { PermissionCard, QuestionCard } from './Cards.tsx';
import { Composer } from './Composer.tsx';
import { Transcript } from './Transcript.tsx';

const REASONS = {
  working: 'Claude is working. You can stop it with the Stop button.',
  waiting: 'Claude is waiting for your answer above.',
  closed: 'This chat has ended. Start a new chat to carry on.',
} as const;

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
 * message box.
 */
export function ChatView() {
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
  } = useStore();
  const { dispatch: shellDispatch } = useShell();
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // Files can be dropped anywhere on the chat column.
  const column = useRef<HTMLDivElement>(null);

  const sessionId = activeChat.kind === 'live' ? activeChat.sessionId : null;
  const chat = sessionId ? (chats[sessionId] ?? initialChatState) : initialChatState;
  const engine = engineLine(chat.model, chat.effort);
  // Read when an answer goes through, which is after this render.
  const latestItems = useRef(chat.items);
  latestItems.current = chat.items;
  const live = sessionId ? sessions?.live.find((s) => s.id === sessionId) : undefined;
  const clients = boot?.clients ?? [];
  const title = live?.title || 'Chat';

  const openFile = useCallback(
    (key: string) => {
      if (sessionId) shellDispatch({ type: 'show-chat-file', chat: sessionId, key });
    },
    [sessionId, shellDispatch],
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
  else if (state === 'closed') reason = REASONS.closed;
  const working = state === 'working' || state === 'starting';
  const step = currentStep(chat.items.filter((i) => i.kind === 'tool'));
  const clientName = live?.client ? placeName(live.client, clients) : null;

  // After an answer, focus goes to the next card if one is waiting (it takes focus as it
  // appears), else back to the message box.
  const afterAnswer = (requestId: string) => () => {
    if (!anotherCardWaits(latestItems.current, requestId)) requestComposerFocus();
  };

  return (
    <div className="chat chat-live" ref={column}>
      <SheetBar crumb="Chats" title={title} panel="Files and details">
        {/* With no client the chip is left out; the panel's Details says so. */}
        {clientName ? <span className="chip">{clientName}</span> : null}
        {working && !confirming ? (
          <button
            type="button"
            className="btn stop-btn"
            onClick={() => void run(() => api.interrupt(sessionId))}
          >
            <Icon name="stop" size={16} />
            {/* Hidden visually (not from screen readers) when the sheet is narrow. */}
            <span className="btn-label">Stop</span>
          </button>
        ) : null}
        {confirming ? (
          <fieldset
            className="close-confirm"
            aria-label="Close this chat"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Handled here, so the shell's Esc doesn't also close a drawer.
                e.preventDefault();
                cancelClose();
              }
            }}
          >
            <span>{closeConfirmText(state)}</span>
            <button
              type="button"
              className="btn"
              data-variant="danger"
              data-size="small"
              onClick={() => void closeChat(sessionId)}
            >
              Close chat
            </button>
            {/* biome-ignore lint/a11y/noAutofocus: focus moves here because the question just appeared. */}
            <button type="button" className="btn" data-size="small" autoFocus onClick={cancelClose}>
              Keep open
            </button>
          </fieldset>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label="Close chat"
            title="Close chat"
            ref={closeButton}
            onClick={() => requestClose(sessionId)}
          >
            <Icon name="close" />
          </button>
        )}
      </SheetBar>

      {chat.items.length > 0 ? (
        <Transcript
          items={chat.items}
          sessionId={sessionId}
          sessionState={state}
          files={chat.files.files}
          brainRoot={boot?.brain.path}
          onFile={openFile}
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
          <AttentionBar
            key={`status-${sessionId}`}
            state={state}
            step={step}
            lastActivityAt={live?.lastActivityAt ?? null}
            stateSince={chat.stateSince}
          />
          <Composer
            key={`chat-${sessionId}`}
            initial=""
            skill={null}
            disabledReason={reason}
            autoFocus={false}
            focusSignal={composerFocus}
            attention={attentionFor(state)}
            dropZone={column}
            attachDisabled={state === 'closed'}
            onSend={async (text, uploadIds) => {
              if (isClearCommand(text)) {
                // "Start afresh": handled here, never sent to Claude.
                return needsCloseConfirm(state) ? false : closeChat(sessionId);
              }
              return send(text, null, uploadIds);
            }}
          />
          {engine ? (
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
