import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/**
 * The chat drawer's header, shared by its two states (plan 2026-11-26-project-chat-in-place): the unsent chat
 * ("New chat" and the project's chip) and the live one (the chat's title and its client). The "send the files first"
 * note takes its own line under the buttons.
 */
export function ChatDrawerHead({
  headingId,
  title,
  chip,
  chipTip,
  save,
  onFullScreen,
  onHide,
  note,
}: {
  headingId: string;
  title: string;
  /** The one chip beside the title; null for none. */
  chip: string | null;
  /** The chip's tooltip, for when it is cut short. */
  chipTip?: string | null;
  /** Live chats only: the Save to project button. */
  save?: ReactNode;
  onFullScreen: () => void;
  onHide: () => void;
  /** The `role="status"` note under the buttons (e.g. "Send or remove the attached files first."). */
  note: string;
}) {
  return (
    <header className="panel-head chat-drawer-head">
      <div className="chat-drawer-name">
        <h2 id={headingId}>{title}</h2>
        {chip ? (
          <span className="chip" data-tip={chipTip || undefined}>
            {chip}
          </span>
        ) : null}
      </div>
      {save}
      <button
        type="button"
        className="icon-btn"
        aria-label="Open full screen"
        data-tip="Open full screen"
        onClick={onFullScreen}
      >
        <Icon name="expand" />
      </button>
      <button type="button" className="icon-btn" aria-label="Hide chat" data-tip="Hide chat" onClick={onHide}>
        <Icon name="close" />
      </button>
      <p className="chat-drawer-note" role="status">
        {note}
      </p>
    </header>
  );
}
