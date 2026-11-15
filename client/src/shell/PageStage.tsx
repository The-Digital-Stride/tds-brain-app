import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { type ChatFile, ROUTES, type SessionState } from '../../../shared/contract.ts';
import {
  type ChatPage,
  type ChatPageVersion,
  PAGE_NOTE_MAX,
  type PageAskRequest,
} from '../../../shared/pages-contract.ts';
import { downloadBranded } from '../api.ts';
import { usePageLinks } from '../apps/shared/usePageLinks.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useFrameGuard } from './useFrameGuard.ts';

/** What the form area at the foot of the page viewer says and allows (plan decision 6). */
export type PageFormState = 'ready' | 'running' | 'waiting' | 'replied' | 'closed';

/**
 * What was asked from this viewer: the page's write mark then (`writeMark`), and whether Claude has
 * started on it.
 */
export interface PageAsked {
  mark: string;
  sawBusy: boolean;
  kind?: 'change' | 'brand';
}

const BUSY: SessionState[] = ['starting', 'working'];

/**
 * The chat's state as the form area shows it. An idle chat takes a message like the composer does;
 * only a closed chat does not. After a request from here, "running" holds until Claude has started and
 * finished, and a finish in which Claude didn't write the page says "replied". Whether it wrote it is
 * told by the write mark, not by version numbers: the server files the previous draft as a version
 * the moment a message is sent, so a new number alone doesn't mean the page changed.
 */
export function pageFormState(
  sessionState: SessionState | null,
  asked: PageAsked | null,
  mark: string,
): PageFormState {
  if (sessionState === 'closed') return 'closed';
  if (sessionState !== null && BUSY.includes(sessionState)) return 'running';
  if (sessionState === 'waiting') return 'waiting';
  if (asked && !asked.sawBusy) return 'running';
  if (asked && mark === asked.mark) return 'replied';
  return 'ready';
}

/**
 * Changes exactly when Claude writes or publishes the page: the id of the newest step that touched
 * it (the list is capped, so its length can't be used).
 */
export function writeMark(page: ChatPage | null): string {
  return page?.toolUseIds.at(-1) ?? '';
}

/**
 * "Version 3" with claude.ai's own number when it gave one, else by position ("Version 2"). No
 * "of n": beside the in-progress "Latest" it read as if Latest were not one of them.
 */
export function versionLabel(v: ChatPageVersion, index: number, _total?: number): string {
  return v.remote !== null ? `Version ${v.remote}` : `Version ${index + 1}`;
}

const STATUS_WORDS: Record<PageFormState, string> = {
  ready: '',
  running: 'Claude is working on this chat.',
  waiting: 'Claude needs your answer in the chat.',
  replied: 'Claude replied in the chat.',
  closed: 'Reopen this chat to suggest changes.',
};

/** The in-progress copy (O5) as a version: `n = 0`, served by the same route. */
const DRAFT: ChatPageVersion = { n: 0, remote: null, at: null, hasCopy: true };

/**
 * The body of the page viewer (`FileViewer` draws the drawer around it): the page in a locked-down
 * frame, its versions, and the form for asking Claude to change it. Plan 2026-11-14-artifacts-in-app,
 * decisions 3 to 7 and revision 2. The frame's sandbox never gets `allow-same-origin`, so the page
 * can't reach the app.
 */
export function PageStage({
  chat,
  pageKey,
  headingId,
  headingRef,
  onClose,
  onOpenInDocuments,
}: {
  chat: string;
  pageKey: string;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  /** Opens the page's source file in Documents (the viewer closes itself first). */
  onOpenInDocuments?: (file: ChatFile) => void;
}) {
  const { chats, sessions, askPage, openChat } = useStore();
  const snapshot = chats[chat];
  const page: ChatPage | null = (snapshot?.files.pages ?? []).find((p) => p.key === pageKey) ?? null;
  const live = sessions?.live.find((s) => s.id === chat);
  const sessionState: SessionState | null = snapshot?.sessionState ?? live?.state ?? null;
  const sourceFile = page?.fileKey
    ? (snapshot?.files.files.find((f) => f.key === page.fileKey) ?? null)
    : null;

  const numbered = page?.versions ?? [];
  const draft = page?.draft === true;
  const versions = draft ? [...numbered, DRAFT] : numbered;
  const newest = versions[versions.length - 1] ?? null;
  const mark = writeMark(page);
  // null follows the newest version; a choice of an older one stays put.
  const [picked, setPicked] = useState<number | null>(null);
  const shown = (picked !== null ? versions.find((v) => v.n === picked) : null) ?? newest;
  const following = shown !== null && shown === newest;

  const [announce, setAnnounce] = useState('');
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Messages are read once, then cleared.
  useEffect(() => {
    if (!announce) return;
    const t = setTimeout(() => setAnnounce(''), 4000);
    return () => clearTimeout(t);
  }, [announce]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // Claude wrote the page while the newest is shown: the frame reloads (frameId) and a polite line says so.
  const lastMark = useRef<string>(mark);
  useEffect(() => {
    const last = lastMark.current;
    lastMark.current = mark;
    if (mark !== last && last !== '' && following) setAnnounce('Page updated.');
  }, [mark, following]);

  // The in-progress copy is rewritten as Claude works: any sign the page changed reloads its frame.
  const draftStamp = draft ? `${page?.order ?? 0}-${page?.toolUseIds.length ?? 0}` : '';

  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [asked, setAsked] = useState<PageAsked | null>(null);
  const [downloaded, setDownloaded] = useState<{ n: number; partial: boolean } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const busy = sessionState !== null && (BUSY.includes(sessionState) || sessionState === 'waiting');
  useEffect(() => {
    if (busy) setAsked((a) => (a && !a.sawBusy ? { ...a, sawBusy: true } : a));
  }, [busy]);
  // A write to the page after the ask ends the wait once the turn is over (the form shows "running" until then).
  useEffect(() => {
    setAsked((a) => (a && mark !== a.mark ? null : a));
  }, [mark]);

  const form = pageFormState(sessionState, asked, mark);
  const canSend = (form === 'ready' || form === 'replied') && !sending;

  // Frame self-navigation guard: a sandboxed page that navigates itself loads a second time.
  const [reloads, setReloads] = useState(0);
  const frameId = `${pageKey}-${shown?.n ?? 0}-${shown?.n === 0 ? draftStamp : ''}-${reloads}`;
  const { stopped: frameStopped, onLoad: onFrameLoad } = useFrameGuard(frameId);
  // A plain link in the page opens in a new tab through the app instead of moving the frame.
  const pageFrame = useRef<HTMLIFrameElement>(null);
  usePageLinks(pageFrame);
  // The latest busy value, for reading after an await (the closure's own `busy` is then stale).
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Whether the chat was busy at any point since the current send began (it may start and finish
  // while the request is still open).
  const busySeen = useRef(false);
  if (busy) busySeen.current = true;

  const noteId = useId();
  const statusId = useId();

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

  const send = async (req: PageAskRequest) => {
    setSending(true);
    setFailure(null);
    busySeen.current = busyRef.current;
    const reason = await askPage(chat, pageKey, req);
    setSending(false);
    if (reason !== null) {
      setFailure(reason);
      return;
    }
    if (req.kind === 'change') setNote('');
    setDownloaded(null);
    setAsked({ mark, sawBusy: busyRef.current || busySeen.current, kind: req.kind });
    setAnnounce('');
  };
  const submit = () => {
    const text = note.trim();
    if (!canSend || !text) return;
    void send({ kind: 'change', note: text });
  };
  const fileCopy = () => {
    if (!canSend) return;
    void send({ kind: 'brand' });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setFailure(null);
    try {
      const { partial } = await downloadBranded(ROUTES.chatPageBranded(chat, page.key, shown.n), page.title);
      setDownloaded({ n: shown.n, partial });
    } catch (err) {
      setDownloading(false);
      setFailure(err instanceof Error ? err.message : "Couldn't download the page. Please try again.");
      return;
    }
    setDownloading(false);
  };

  const copy = async () => {
    if (!page.url) return;
    try {
      await navigator.clipboard.writeText(page.url);
      setFailure(null);
      setCopied(true);
      setAnnounce('Link copied');
    } catch {
      setFailure("Couldn't copy the link. Select it on claude.ai and copy it from there.");
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

  const isDraft = shown.n === 0;
  const offerFiling = form === 'ready' && downloaded?.n === shown.n;
  const status =
    form === 'running' && asked?.kind === 'brand'
      ? 'Asked Claude to file the TDS-branded copy.'
      : offerFiling
        ? downloaded?.partial
          ? "Downloaded. Some parts still need the internet to show. Want a copy filed in the client's folder too?"
          : "Downloaded. Want a copy filed in the client's folder too?"
        : STATUS_WORDS[form];
  // The draft stays the newest copy after Claude's reply until the person's next message (O4): it is
  // "in progress" only while Claude is still running, and simply "Latest" after that.
  const working = busy;
  const draftWorking = isDraft && working;
  const heading = (v: ChatPageVersion) =>
    v.n === 0 ? (working ? 'In progress' : 'Latest') : versionLabel(v, numbered.indexOf(v), numbered.length);
  const titleSuffix = draftWorking ? ' (in progress)' : versions.length > 1 ? ` (${heading(shown)})` : '';
  const sendBlocked = !canSend || note.trim() === '';

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
          {shown.hasCopy ? (
            <button type="button" className="btn" aria-disabled={downloading} onClick={() => void download()}>
              Download with TDS branding
            </button>
          ) : null}
          {sourceFile?.item && onOpenInDocuments ? (
            <button type="button" className="btn" onClick={() => onOpenInDocuments(sourceFile)}>
              Open in Documents
            </button>
          ) : null}
          {page.url ? (
            <>
              <a className="btn" href={page.url} target="_blank" rel="noopener noreferrer">
                Open on claude.ai
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              <button type="button" className="btn" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy link'}
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
              {versions.map((v) => (
                <option key={v.n} value={v.n}>
                  {heading(v)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {draftWorking ? <p className="notice">Claude is still working on this page.</p> : null}
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
        {!shown.hasCopy ? (
          <p className="notice">
            This version isn't kept in the app.{page.url ? ' Open it on claude.ai.' : ''}
          </p>
        ) : frameStopped ? (
          <div className="notice" data-level="warning">
            <p>This page tried to move the viewer to another site, so it was stopped.</p>
            <button type="button" className="btn" onClick={() => setReloads((n) => n + 1)}>
              Show the page again
            </button>
          </div>
        ) : (
          <iframe
            key={frameId}
            ref={pageFrame}
            className="page-frame"
            title={`Page: ${page.title}${titleSuffix}`}
            src={ROUTES.chatPage(chat, page.key, shown.n)}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            onLoad={onFrameLoad}
          />
        )}
        <span className="visually-hidden" role="status">
          {announce}
        </span>
      </section>
      <footer className="page-ask">
        <div className="page-ask-state">
          <p role="status" id={statusId} className="page-ask-line">
            {status}
          </p>
          {offerFiling ? (
            <button
              type="button"
              className="btn"
              data-size="small"
              aria-disabled={!canSend}
              onClick={fileCopy}
            >
              File in client's folder
            </button>
          ) : null}
          {form === 'waiting' || form === 'replied' ? (
            <button type="button" className="btn" data-size="small" onClick={goToChat}>
              Go to chat
            </button>
          ) : null}
        </div>
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
                readOnly={!canSend}
                aria-disabled={!canSend}
                aria-describedby={statusId}
                onChange={(e) => {
                  if (canSend) setNote(e.target.value);
                }}
                onKeyDown={onKeyDown}
              />
              <button
                type="button"
                className="btn"
                data-variant="primary"
                aria-disabled={sendBlocked}
                onClick={submit}
              >
                <Icon name="send" size={16} />
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
