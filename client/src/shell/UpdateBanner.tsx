import { useEffect, useId, useRef, useState } from 'react';
import {
  UPDATE_UNFINISHED_TEXT,
  type UpdatePhase,
  type UpdateStatus,
} from '../../../shared/update-contract.ts';
import { type UpdateActions, type UpdateView, useUpdate } from '../state/update.ts';

const PHASE_TEXT: Partial<Record<UpdatePhase, string>> = {
  downloading: 'Downloading the update…',
  installing: 'Installing the update…',
  building: 'Building the update…',
  restarting: 'Restarting TDS Brain…',
};

const STALLED_TEXT =
  "TDS Brain hasn't come back after a minute. Reload this page, and if it's still not back, tell whoever looks after TDS Brain.";

const MAX_NOTES = 8;

type Update = UpdateView & UpdateActions;

function chatsWords(n: number): string {
  return n === 1 ? '1 open chat' : `${n} open chats`;
}

/** The phase in words, or null when nothing is running. */
export function phaseText(status: UpdateStatus | null, stalled: boolean, restarting = false): string | null {
  const words = restarting ? PHASE_TEXT.restarting : status ? PHASE_TEXT[status.phase] : undefined;
  if (!words) return null;
  return (restarting || status?.phase === 'restarting') && stalled ? STALLED_TEXT : words;
}

/** Moves focus to `el`, or to the sheet's heading when `el` has gone. */
function moveFocus(el: HTMLElement | null) {
  setTimeout(() => {
    const target = el?.isConnected ? el : document.querySelector<HTMLElement>('h1');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  }, 0);
}

/**
 * The "Update and restart" button. With chats open it first asks, in place, because the restart
 * closes them. Shared by the banner and Settings. `onMoved` is called after "Update now".
 */
export function UpdateAction({
  update,
  label = 'Update and restart',
  onMoved,
}: {
  update: Update;
  label?: string;
  onMoved?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const openChats = update.status?.openChats ?? 0;
  useEffect(() => {
    // Back from "Not now" or Esc: focus returns to the button that asked.
    if (wasConfirming.current && !confirming) trigger.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  if (confirming) {
    return (
      <fieldset
        className="close-confirm"
        aria-label="Update and restart"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Handled here, so the shell's Esc doesn't also close a drawer.
            e.preventDefault();
            setConfirming(false);
          }
        }}
      >
        <span>Updating restarts TDS Brain and closes {chatsWords(openChats)}.</span>
        <button
          type="button"
          className="btn"
          data-size="small"
          onClick={() => {
            wasConfirming.current = false;
            setConfirming(false);
            void update.start();
            onMoved?.();
          }}
        >
          Update now
        </button>
        <button
          type="button"
          className="btn"
          data-size="small"
          // biome-ignore lint/a11y/noAutofocus: focus moves here because the question just appeared.
          autoFocus
          onClick={() => setConfirming(false)}
        >
          Not now
        </button>
      </fieldset>
    );
  }
  return (
    <button
      type="button"
      className="btn"
      data-size="small"
      ref={trigger}
      onClick={() => {
        if (openChats > 0) setConfirming(true);
        else {
          void update.start();
          onMoved?.();
        }
      }}
    >
      {label}
    </button>
  );
}

/** The calm line at the top of the sheet saying a new version is ready (or being installed). */
export function UpdateBanner() {
  const update = useUpdate();
  const { status, stalled, restarting, dismissed } = update;
  const [notesOpen, setNotesOpen] = useState(false);
  const notesId = useId();
  const textRef = useRef<HTMLSpanElement>(null);

  const running = phaseText(status, stalled, restarting);
  const failed = status?.phase === 'failed';
  const unfinished = status?.unfinished === true;
  // "Later" never hides a failure or an unfinished update.
  const hidden = dismissed && !failed && !unfinished;
  const wanted =
    status !== null && (status.available || unfinished) && !status.blocked && !hidden && !running;

  let text = '';
  if (running) text = running;
  else if (wanted && status) {
    text = failed
      ? (status.error ?? UPDATE_UNFINISHED_TEXT)
      : status.latest
        ? `TDS Brain ${status.latest} is available.`
        : UPDATE_UNFINISHED_TEXT;
  }
  // Always on the page, so a screen reader announces the sentence when it arrives.
  const announcer = (
    <p className="visually-hidden" role="status">
      {text}
    </p>
  );

  if (running) {
    return (
      <>
        {announcer}
        <div className="update-banner">
          <span ref={textRef} tabIndex={-1}>
            {running}
          </span>
          {stalled ? (
            <button
              type="button"
              className="btn"
              data-variant="quiet"
              data-size="small"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          ) : null}
        </div>
      </>
    );
  }
  if (!wanted || !status) return announcer;

  const changes = status.notes.flatMap((n) => n.changes.map((c) => c.text)).slice(0, MAX_NOTES);
  return (
    <>
      {announcer}
      <div className="update-banner" data-wrap>
        <span ref={textRef} tabIndex={-1}>
          {text}
        </span>
        <UpdateAction
          update={update}
          label={failed || unfinished ? 'Try again' : 'Update and restart'}
          onMoved={() => moveFocus(textRef.current)}
        />
        {status.latest ? (
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            onClick={() => {
              update.later();
              moveFocus(null);
            }}
          >
            Later
          </button>
        ) : null}
        {status.notes.length > 0 ? (
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            aria-expanded={notesOpen}
            aria-controls={notesId}
            onClick={() => setNotesOpen((o) => !o)}
          >
            What's new
          </button>
        ) : null}
        {notesOpen && changes.length > 0 ? (
          <ul className="update-notes" id={notesId}>
            {changes.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a static list of sentences, never reordered.
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
