import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { ROUTES, type SessionState } from '../../../shared/contract.ts';
import { type ChatPage, type ChatPageVersion, PAGE_NOTE_MAX } from '../../../shared/pages-contract.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';

/** What the form area at the foot of the page viewer says and allows (plan decision 6). */
export type PageFormState = 'ready' | 'running' | 'waiting' | 'replied' | 'closed';

/** What was asked from this viewer: the page's version count then, and whether Claude has started on it. */
export interface PageAsked {
  versions: number;
  sawBusy: boolean;
}

const BUSY: SessionState[] = ['starting', 'working'];

/**
 * The chat's state as the form area shows it. An idle chat takes a message like the composer does;
 * only a closed chat does not. After a request from here, "running" holds until Claude has started and
 * finished, and a finish with no new version of the page says "replied".
 */
export function pageFormState(
  sessionState: SessionState | null,
  asked: PageAsked | null,
  versionCount: number,
): PageFormState {
  if (sessionState === 'closed') return 'closed';
  if (sessionState !== null && BUSY.includes(sessionState)) return 'running';
  if (sessionState === 'waiting') return 'waiting';
  if (asked && !asked.sawBusy) return 'running';
  if (asked && versionCount <= asked.versions) return 'replied';
  return 'ready';
}

/** "Version 3" with claude.ai's own number when it gave one, else "Version 2 of 3". */
export function versionLabel(v: ChatPageVersion, index: number, total: number): string {
  return v.remote !== null ? `Version ${v.remote}` : `Version ${index + 1} of ${total}`;
}

const STATUS_WORDS: Record<PageFormState, string> = {
  ready: '',
  running: 'Claude is working on this chat.',
  waiting: 'Claude needs your answer in the chat.',
  replied: 'Claude replied in the chat.',
  closed: 'Reopen this chat to suggest changes.',
};

/**
 * The body of the page viewer (`FileViewer` draws the drawer around it): the page in a locked-down
 * frame, its versions, and the form for asking Claude to change it. Plan 2026-11-14-artifacts-in-app,
 * decisions 3 to 7. The frame's sandbox never gets `allow-same-origin`, so the page can't reach the app.
 */
export function PageStage({
  chat,
  pageKey,
  headingId,
  headingRef,
  onClose,
}: {
  chat: string;
  pageKey: string;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const { chats, sessions, boot, askPage, openChat } = useStore();
  const snapshot = chats[chat];
  const page: ChatPage | null = (snapshot?.files.pages ?? []).find((p) => p.key === pageKey) ?? null;
  const live = sessions?.live.find((s) => s.id === chat);
  const sessionState: SessionState | null = snapshot?.sessionState ?? live?.state ?? null;

  const versions = page?.versions ?? [];
  const newest = versions[versions.length - 1] ?? null;
  // null follows the newest version; a choice of an older one stays put.
  const [picked, setPicked] = useState<number | null>(null);
  const shown = (picked !== null ? versions.find((v) => v.n === picked) : null) ?? newest;
  const following = shown !== null && shown === newest;

  // A new version while on the newest: the frame moves to it (its src changes) and a polite "Updated" says so.
  const [announce, setAnnounce] = useState('');
  const lastNewest = useRef<number | null>(newest?.n ?? null);
  useEffect(() => {
    const n = newest?.n ?? null;
    if (n !== null && lastNewest.current !== null && n > lastNewest.current && following)
      setAnnounce('Updated');
    lastNewest.current = n;
  }, [newest?.n, following]);

  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [asked, setAsked] = useState<PageAsked | null>(null);
  const busy = sessionState !== null && (BUSY.includes(sessionState) || sessionState === 'waiting');
  useEffect(() => {
    if (busy) setAsked((a) => (a && !a.sawBusy ? { ...a, sawBusy: true } : a));
  }, [busy]);
  // A new version ends the wait: the form is ready again.
  const versionCount = versions.length;
  useEffect(() => {
    setAsked((a) => (a && versionCount > a.versions ? null : a));
  }, [versionCount]);

  const form = pageFormState(sessionState, asked, versionCount);
  const canSend = (form === 'ready' || form === 'replied') && !sending;
  const hasBranding = boot?.skills.some((s) => s.name === 'tds-doc') === true;

  const [copied, setCopied] = useState('');
  const noteId = useId();

  if (!page || !shown) {
    return (
      <>
        <header className="viewer-head">
          <div className="viewer-name">
            <h2 id={headingId} ref={headingRef} tabIndex={-1}>
              Page
            </h2>
          </div>
          <button type="button" className="icon-btn viewer-close" aria-label="Close page" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="viewer-body">
          <p className="lib-note">This page is no longer available.</p>
        </div>
      </>
    );
  }

  const send = async (req: { kind: 'change'; note: string } | { kind: 'brand' }) => {
    setSending(true);
    setFailure(null);
    const reason = await askPage(chat, pageKey, req);
    setSending(false);
    if (reason !== null) {
      setFailure(reason);
      return;
    }
    if (req.kind === 'change') setNote('');
    setAsked({ versions: versionCount, sawBusy: false });
    setAnnounce('');
  };
  const submit = () => {
    const text = note.trim();
    if (!canSend || !text) return;
    void send({ kind: 'change', note: text });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  const copy = async () => {
    if (!page.url) return;
    try {
      await navigator.clipboard.writeText(page.url);
      setCopied('Link copied');
    } catch {
      setCopied("Couldn't copy the link");
    }
  };

  const goToChat = () => {
    onClose();
    openChat(chat);
    // After the viewer has handed focus back: the waiting card if there is one, else the message box.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(
          '.pending button, .pending input, .pending textarea, .pending [tabindex]',
        );
        if (card) card.focus();
        else document.querySelector<HTMLElement>('.floater textarea')?.focus();
      }),
    );
  };

  const index = versions.indexOf(shown);
  const status = STATUS_WORDS[form];

  return (
    <>
      <header className="viewer-head">
        <div className="viewer-name">
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {page.title}
          </h2>
          <p className="viewer-place">Page from this chat</p>
        </div>
        <div className="viewer-actions">
          {hasBranding ? (
            <button
              type="button"
              className="btn"
              disabled={!canSend}
              onClick={() => void send({ kind: 'brand' })}
            >
              Convert to TDS branding
            </button>
          ) : null}
          {page.url ? (
            <>
              <a className="btn" href={page.url} target="_blank" rel="noopener noreferrer">
                Open on claude.ai
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              <button type="button" className="btn" onClick={() => void copy()}>
                Copy link
              </button>
            </>
          ) : null}
        </div>
        <button type="button" className="icon-btn viewer-close" aria-label="Close page" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <section className="viewer-body page-body" aria-label={`Page ${page.title}`}>
        {versions.length > 1 ? (
          <label className="page-versions">
            <span>Version</span>
            <select
              className="field"
              value={shown.n}
              onChange={(e) => {
                const n = Number(e.target.value);
                setPicked(n === newest?.n ? null : n);
              }}
            >
              {versions.map((v, i) => (
                <option key={v.n} value={v.n}>
                  {versionLabel(v, i, versions.length)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {page.live ? (
          <p className="notice" data-level="warning">
            Some parts of this page only work on claude.ai.
          </p>
        ) : null}
        {page.multiFile ? (
          <p className="notice" data-level="warning">
            Some files this page uses aren't shown here.
          </p>
        ) : null}
        {shown.hasCopy ? (
          <iframe
            key={`${page.key}-${shown.n}`}
            className="page-frame"
            title={`Page: ${page.title} (${versionLabel(shown, index, versions.length)})`}
            src={ROUTES.chatPage(chat, page.key, shown.n)}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <p className="notice">This version isn't kept in the app. Open it on claude.ai.</p>
        )}
        <span className="visually-hidden" role="status">
          {announce || copied}
        </span>
      </section>
      <footer className="page-ask">
        {status || form === 'waiting' || form === 'replied' ? (
          <div className="page-ask-state">
            <p role="status" className="page-ask-line">
              {status}
            </p>
            {form === 'waiting' || form === 'replied' ? (
              <button type="button" className="btn" data-size="small" onClick={goToChat}>
                Go to chat
              </button>
            ) : null}
          </div>
        ) : null}
        {form !== 'closed' ? (
          <div className="page-ask-form">
            <label htmlFor={noteId}>Suggest a change</label>
            <div className="page-ask-row">
              <textarea
                id={noteId}
                className="field"
                rows={2}
                maxLength={PAGE_NOTE_MAX}
                value={note}
                disabled={!canSend}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button
                type="button"
                className="btn"
                data-variant="primary"
                disabled={!canSend || note.trim() === ''}
                onClick={submit}
              >
                Send
              </button>
            </div>
          </div>
        ) : null}
        {failure ? (
          <p className="notice" data-level="error" role="alert">
            {failure}
          </p>
        ) : null}
      </footer>
    </>
  );
}
