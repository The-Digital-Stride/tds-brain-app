import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { chatFileGroup } from '../../../shared/chat-files.ts';
import { type ChatFile, type ChatFileAction, ROUTES, type SessionState } from '../../../shared/contract.ts';
import { ApiFailure, api } from '../api.ts';
import { FORMAT_ICONS } from '../apps/documents/icons.ts';
import { useLoaded } from '../apps/shared/data.ts';
import { openLibraryItem } from '../apps/shared/search.ts';
import { PictureBody, TextBody } from '../apps/shared/Viewer.tsx';
import { ChangeView } from '../components/Cards.tsx';
import { useStore } from '../store.tsx';
import type { IconName } from './contract.ts';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';
import { whenWords } from './words.ts';

/** The strongest thing that happened to a file, in words, strongest first. */
const ACTION_WORDS: [ChatFileAction, string][] = [
  ['created', 'Made'],
  ['changed', 'Changed'],
  ['filed', 'Filed'],
  ['mentioned', 'Mentioned'],
  ['read', 'Read'],
];

function actionWord(file: ChatFile): string {
  return ACTION_WORDS.find(([a]) => file.actions.includes(a))?.[1] ?? '';
}

function nameOf(file: ChatFile): string {
  return file.item?.title ?? file.path.split('/').pop() ?? file.path;
}

function iconFor(file: ChatFile): IconName {
  const item = file.item;
  if (!item) return 'doc';
  if (item.kind === 'image') return 'image';
  return item.format ? FORMAT_ICONS[item.format] : 'doc';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** One file as a row button. The row remembers itself so focus can come back to it from the preview. */
function FileRow({
  file,
  onOpen,
  setRef,
}: {
  file: ChatFile;
  onOpen: () => void;
  setRef: (el: HTMLButtonElement | null) => void;
}) {
  const meta = [scopeWords(file), file.item ? '' : 'No longer there', actionWord(file)].filter(Boolean);
  return (
    <button type="button" className="line files-row" ref={setRef} onClick={onOpen}>
      <Icon name={iconFor(file)} />
      <span className="line-text">
        <span className="line-title">{nameOf(file)}</span>
        <span className="line-meta">{meta.join(', ')}</span>
      </span>
    </button>
  );
}

function scopeWords(file: ChatFile): string {
  return file.scope.name;
}

/** "What changed": the edits this chat made to one file, newest first, in the approval card's view. */
function Changes({ sessionId, file }: { sessionId: string; file: ChatFile }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const loaded = useLoaded(open ? `changes|${sessionId}|${file.key}` : null, file.edits, () =>
    // A 404 means the kept edits were dropped (or the file is gone): nothing to show, not an error.
    api.chatFileChanges(sessionId, file.key).catch((err: unknown) => {
      if (err instanceof ApiFailure && err.status === 404) return 'gone' as const;
      throw err;
    }),
  );
  const data = loaded.data === 'gone' ? null : loaded.data;
  return (
    <div className="files-changes">
      <button
        type="button"
        className="btn"
        data-variant="quiet"
        data-chevron="true"
        data-size="small"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron" size={14} />
        What changed
      </button>
      {open ? (
        <div id={panelId}>
          {loaded.status === 'loading' ? (
            <p className="lib-note" role="status">
              Loading…
            </p>
          ) : loaded.status === 'failed' ? (
            <div className="lib-failed" role="alert">
              <p>{loaded.message}</p>
              <button type="button" className="btn" onClick={loaded.retry}>
                Try again
              </button>
            </div>
          ) : data === null ? (
            <p className="lib-note">The changes are no longer available.</p>
          ) : (
            <div className="files-change-list">
              {[...data.changes].reverse().map((c, i) => (
                // Changes have no id; counting from the oldest keeps a key stable as newer ones arrive.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                <div className="files-change" key={data.changes.length - i}>
                  {c.at ? <p className="files-change-when">{whenWords(c.at)}</p> : null}
                  <ChangeView change={c.change} />
                  {c.cut ? <p className="lib-note">This change was too long to show in full.</p> : null}
                  {c.hiddenChars ? (
                    <p className="lib-note">Hidden characters are shown as ⟨U+…⟩ markers.</p>
                  ) : null}
                </div>
              ))}
              {data.truncated ? <p className="lib-note">Older changes are not shown.</p> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// The `show-chat-file` requests whose preview has already taken focus.
const focusedRequests = new WeakSet<object>();

/** The file open in the panel: Back, its name and where it is, its body, then what can be done with it. */
function Preview({
  file,
  sessionId,
  live,
  onBack,
  request,
}: {
  file: ChatFile;
  sessionId: string;
  live: boolean;
  onBack: () => void;
  /**
   * The shell's `panelFile`: a new object for every `show-chat-file`, so asking for the file again
   * (a reply link after the panel was shut on it) moves focus to it again.
   */
  request: object | null;
}) {
  const { libraryVersion, openView } = useStore();
  const { dispatch, modes } = useShell();
  const heading = useRef<HTMLHeadingElement>(null);
  // Focus moves to the heading each time the file is asked for (a different one, or the same one
  // again after the panel was shut). A frame later, so a panel that is opening has recorded its
  // opener and focused its own heading first. Each request takes focus once: coming back to the
  // chat later mounts this again with the same request, and that must not pull focus into the panel.
  useEffect(() => {
    if (request === null || focusedRequests.has(request)) return;
    const frame = requestAnimationFrame(() => {
      focusedRequests.add(request);
      heading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  const item = file.item;
  const title = nameOf(file);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onBack();
  };

  const appId = item?.kind === 'image' ? 'images' : 'documents';
  const open = () => {
    if (!item) return;
    openLibraryItem(appId, file.scope.id, item);
    openView(`app:${appId}`);
    // A floating panel would hide the file it opens, so it closes; a docked one stays.
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
  };
  const openLabel = item?.kind === 'image' ? 'Open in Images' : 'Open in Documents';

  let body: ReactNode = null;
  if (!item) {
    body = <p className="lib-note">No longer there</p>;
  } else if (item.view === 'text') {
    body = (
      <div className="card files-body">
        <TextBody item={item} version={String(libraryVersion)} />
      </div>
    );
  } else if (item.view === 'image') {
    body = (
      <div className="card files-body lib-pic">
        <PictureBody key={`${item.modified}|${libraryVersion}`} item={item} />
      </div>
    );
  } else if (item.view === null) {
    body = <p className="lib-note">This type can't be shown here.</p>;
  }

  const download = item ? (
    <a
      className="btn"
      data-variant={item.view === null ? 'primary' : undefined}
      href={ROUTES.libraryFile(item.id)}
      download={item.name}
      aria-label={`Download ${item.name}`}
    >
      Download
    </a>
  ) : null;
  // A type that cannot be shown has no "Open" either: Download comes first and is the main action.
  const canOpen = item !== null && item.view !== null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region that takes focus when a file opens.
    <div className="files-preview" role="region" aria-label={`Preview of ${title}`} onKeyDown={onKeyDown}>
      <button type="button" className="btn" data-variant="quiet" data-size="small" onClick={onBack}>
        <span className="files-back" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
        All files
      </button>
      <h3 className="files-title" tabIndex={-1} ref={heading}>
        {title}
      </h3>
      <p className="lib-file">{file.scope.name}</p>
      {item ? (
        <div className="files-actions">
          {item.view === null ? download : null}
          {canOpen ? (
            <button type="button" className="btn" data-variant="primary" onClick={open}>
              {openLabel}
            </button>
          ) : null}
          {item.view !== null ? download : null}
        </div>
      ) : null}
      {body}
      {item && file.edits > 0 && live ? <Changes sessionId={sessionId} file={file} /> : null}
    </div>
  );
}

const BUSY: SessionState[] = ['working', 'starting', 'waiting'];

/**
 * The Files tab of "This chat": everything the chat read, made or named, in groups, and the file the
 * person chose shown in the panel. Plan 2026-11-13-chat-files, decisions 8 and 9.
 */
export function ChatFiles({ sessionId }: { sessionId: string }) {
  const { chats, sessions } = useStore();
  const { state, dispatch } = useShell();
  const chat = chats[sessionId];
  const snapshot = chat?.files ?? { files: [], attachments: [], links: [] };
  const live = sessions?.live.find((s) => s.id === sessionId);
  const sessionState = chat?.sessionState ?? live?.state ?? null;
  const busy = sessionState !== null && BUSY.includes(sessionState);

  const byKey = new Map(snapshot.files.map((f) => [f.key, f]));
  const previewKey = state.panelFile?.chat === sessionId ? state.panelFile.key : null;
  const shown = previewKey ? (byKey.get(previewKey) ?? null) : null;

  const rows = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | null>(null);
  const show = (key: string | null) => dispatch({ type: 'show-chat-file', chat: sessionId, key });
  // Bumped when Back returns to a "Looked at" file: the fold remounts open, so its row can take focus.
  const [lookedReset, setLookedReset] = useState(0);
  const back = () => {
    returnTo.current = shown?.key ?? null;
    if (shown && chatFileGroup(shown) === 'looked-at') setLookedReset((n) => n + 1);
    show(null);
  };
  const [announce, setAnnounce] = useState('');
  // One status region, always there; its text is set when a file opens and cleared on Back.
  useEffect(() => {
    setAnnounce(shown ? `Opened ${nameOf(shown)}` : '');
  }, [shown]);
  // Back puts focus on the row the file was opened from.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the preview closes.
  useEffect(() => {
    if (shown) return;
    const key = returnTo.current;
    returnTo.current = null;
    if (key) rows.current.get(key)?.focus({ preventScroll: true });
  }, [shown === null]);

  const setRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  };
  const row = (f: ChatFile) => (
    <FileRow key={f.key} file={f} setRef={setRef(f.key)} onOpen={() => show(f.key)} />
  );

  const inGroup = (g: ReturnType<typeof chatFileGroup>) =>
    snapshot.files.filter((f) => chatFileGroup(f) === g);
  const made = inGroup('made');
  const mentioned = inGroup('mentioned');
  const looked = inGroup('looked-at');
  const attachedOrphans = inGroup('attached').filter(
    (f) => !snapshot.attachments.some((a) => a.filedKey === f.key),
  );
  const attachedCount = snapshot.attachments.length + attachedOrphans.length;
  const groups = [made.length, attachedCount, mentioned.length, looked.length, snapshot.links.length];
  const empty = groups.every((n) => n === 0);

  return (
    <div className="files">
      <span className="visually-hidden" role="status">
        {announce}
      </span>
      {shown ? (
        <Preview
          file={shown}
          sessionId={sessionId}
          live={sessionState !== 'closed'}
          onBack={back}
          request={state.panelFile}
        />
      ) : null}
      <div hidden={shown !== null}>
        {empty ? (
          <p className="dock-empty">
            No files yet. Files Claude reads, makes or names in this chat appear here.
          </p>
        ) : null}
        {made.length > 0 ? (
          <Fold title="Made or changed" count={made.length}>
            {made.map(row)}
          </Fold>
        ) : null}
        {attachedCount > 0 ? (
          <Fold title="Attached" count={attachedCount}>
            {snapshot.attachments.map((a, i) => {
              const filed = a.filedKey ? byKey.get(a.filedKey) : undefined;
              if (filed) return row(filed);
              return (
                // Attachments have no id; the name and place in the list are stable while it is open.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                <div className="files-row" key={`${a.name}-${i}`}>
                  <Icon name={a.kind === 'image' ? 'image' : 'paperclip'} />
                  <span className="line-text">
                    <span className="line-title">{a.name}</span>
                    <span className="line-meta">{busy ? 'Not filed yet' : 'Not filed'}</span>
                  </span>
                </div>
              );
            })}
            {attachedOrphans.map(row)}
          </Fold>
        ) : null}
        {mentioned.length > 0 ? (
          <Fold title="Mentioned in replies" count={mentioned.length}>
            {mentioned.map(row)}
          </Fold>
        ) : null}
        {looked.length > 0 ? (
          <Fold
            key={lookedReset}
            title="Looked at"
            count={looked.length}
            defaultOpen={
              lookedReset > 0 || made.length + attachedCount + mentioned.length + snapshot.links.length === 0
            }
          >
            {looked.map(row)}
          </Fold>
        ) : null}
        {snapshot.links.length > 0 ? (
          <Fold title="Web links" count={snapshot.links.length}>
            {snapshot.links.map((l) => {
              const address = l.url.replace(/^https?:\/\//, '');
              return (
                <a
                  key={l.url}
                  className="line files-row"
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="go" />
                  <span className="line-text">
                    <span className="line-title">{hostOf(l.url)}</span>
                    <span className="visually-hidden"> (opens in a new tab)</span>
                    <span className="line-meta files-url" aria-hidden="true">
                      {address}
                    </span>
                  </span>
                </a>
              );
            })}
          </Fold>
        ) : null}
      </div>
    </div>
  );
}
