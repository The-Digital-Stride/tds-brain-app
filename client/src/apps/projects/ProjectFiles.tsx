import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
  LIBRARY_SEARCH_QUERY,
  type LibraryItem,
  type LibraryKind,
  type LibrarySearchHit,
} from '../../../../shared/contract.ts';
import { PROJECT_LINKS_MAX, type ProjectCard } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { FORMAT_ICONS } from '../documents/icons.ts';
import { useLoaded } from '../shared/data.ts';
import { Thumb } from '../shared/Thumb.tsx';
import { useProjectChange } from './useChange.ts';
import { useKeepFocus } from './useKeepFocus.ts';

const KINDS: { kind: LibraryKind; title: string }[] = [
  { kind: 'image', title: 'Images' },
  { kind: 'document', title: 'Documents' },
];

function FileRow({
  item,
  linked,
  canUnlink,
  busy,
  onView,
  onUnlink,
}: {
  item: LibraryItem;
  linked: boolean;
  canUnlink: boolean;
  busy: boolean;
  onView: () => void;
  onUnlink: () => void;
}) {
  // The whole row opens the file in the viewer drawer. Documents rows select instead; a project's file rows open,
  // deliberately: linking and removing are the only things to do here, and they have their own buttons.
  return (
    <li className="line lib-row proj-file">
      <button type="button" className="lib-open" data-file={item.id} onClick={onView}>
        {item.kind === 'image' ? (
          <Thumb item={item} width={96} iconSize={18} />
        ) : (
          <span className="doc-glyph">
            <Icon name={FORMAT_ICONS[item.format ?? 'doc']} size={18} />
          </span>
        )}
        <span className="line-text">
          <span className="line-title" title={item.name}>
            {item.title || item.name}
          </span>
          <span className="line-meta">
            {item.group}
            {linked ? ' · added from the library' : ''}
          </span>
        </span>
      </button>
      {linked && canUnlink ? (
        <button
          type="button"
          className="icon-btn"
          aria-disabled={busy || undefined}
          aria-label={`Remove ${item.title || item.name} from this project`}
          data-tip="Remove from this project. The file stays in the library."
          onClick={busy ? undefined : onUnlink}
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </li>
  );
}

/** Why a search hit can't be ticked, or null when it can. */
function blockedWhy(card: ProjectCard, path: string): string | null {
  if (card.links.includes(path)) return 'Already added';
  // The skill refuses this (a shared project would show the team something private), so say so up front.
  if (card.space !== 'personal' && path.startsWith('personal/')) return "Personal: can't be shared";
  return null;
}

function Picker({
  card,
  onClose,
  onLinked,
}: {
  card: ProjectCard;
  onClose: () => void;
  onLinked: (count: number) => void;
}) {
  const change = useProjectChange({ reloadOnChanged: true });
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<LibrarySearchHit[] | null>(null);
  // Chosen files, by path: they stay chosen across searches, so files from several searches link in one go.
  const [picked, setPicked] = useState<Map<string, LibrarySearchHit>>(() => new Map());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const id = useId();
  const room = PROJECT_LINKS_MAX - card.links.length;

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const q = term.trim();
    if (q.length < LIBRARY_SEARCH_QUERY.min) {
      setMessage(`Type at least ${LIBRARY_SEARCH_QUERY.min} letters.`);
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const [a, b] = await Promise.all([api.librarySearch(q, 'image'), api.librarySearch(q, 'document')]);
      setHits([...a.hits, ...b.hits]);
    } catch {
      setMessage("The search didn't work. Try again.");
    }
    setBusy(false);
  };

  const toggle = (hit: LibrarySearchHit) =>
    setPicked((p) => {
      const next = new Map(p);
      if (next.has(hit.item.path)) next.delete(hit.item.path);
      else if (next.size < room) next.set(hit.item.path, hit);
      return next;
    });

  // The skill links one file per call, so each link waits for the last and builds on the card it wrote.
  const linkChosen = async () => {
    const todo = [...picked.values()].filter((h) => blockedWhy(card, h.item.path) === null);
    if (todo.length === 0) return;
    setBusy(true);
    setMessage('');
    let expect = card.version;
    let done = 0;
    for (const h of todo) {
      setProgress(`Adding ${done + 1} of ${todo.length}`);
      const res = await change({ kind: 'link', key: card.key, path: h.item.path, expect });
      if (!res.ok) {
        // Keep what's still to do chosen, so another press finishes the job.
        const left = new Map(todo.slice(done).map((x) => [x.item.path, x] as const));
        setPicked(left);
        setProgress('');
        setBusy(false);
        setMessage(done > 0 ? `Added ${done} of ${todo.length}. ${res.message}` : res.message);
        return;
      }
      done += 1;
      expect = res.list.projects.find((p) => p.key === card.key)?.version ?? expect;
    }
    setProgress('');
    setBusy(false);
    onLinked(done);
  };

  const chosen = [...picked.values()];
  const count = chosen.length;
  // Chosen files are unsaved work: leaving the page or switching tab asks first (Actions rule 9).
  const leave = useSheetHold(count > 0);
  const keepFocus = useKeepFocus();

  return (
    <section className="card proj-card" aria-label="Add files" onFocus={keepFocus.track}>
      {leave.asking ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          onConfirm={leave.discard}
          onCancel={() => {
            leave.keep();
            keepFocus.restore();
          }}
        />
      ) : null}
      <form className="proj-search" onSubmit={(e) => void search(e)} aria-label="Search files to add">
        <label htmlFor={id} className="visually-hidden">
          Search files to add
        </label>
        <input
          id={id}
          className="field"
          type="search"
          placeholder="Search images and documents"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: the person just pressed Add files.
          autoFocus
        />
        <button type="submit" className="btn" aria-disabled={busy || undefined}>
          Search
        </button>
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          aria-disabled={busy || undefined}
          onClick={busy ? undefined : onClose}
        >
          Close
        </button>
      </form>
      {message ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {message}
        </p>
      ) : null}
      <p className="visually-hidden" role="status">
        {progress}
      </p>
      {hits && hits.length === 0 ? <StateNote kind="empty">No files found.</StateNote> : null}
      {hits && hits.length > 0 ? (
        <ul className="lib-list proj-pick-list" aria-label="Files found">
          {hits.map((h) => {
            const why = blockedWhy(card, h.item.path);
            const on = picked.has(h.item.path);
            const boxId = `${id}-${h.item.id}`;
            return (
              <li key={h.item.id} className="line lib-row proj-pick">
                <input
                  id={boxId}
                  type="checkbox"
                  className="tick"
                  checked={why === 'Already added' || on}
                  disabled={busy || why !== null || (!on && count >= room)}
                  onChange={() => toggle(h)}
                />
                <label htmlFor={boxId} className="line-text">
                  <span className="line-title">{h.item.title || h.item.name}</span>
                  <span className="line-meta">{h.item.path}</span>
                </label>
                {why ? <span className="line-meta proj-pick-why">{why}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {/* Under the results, so ticking the first file doesn't push the list down under the pointer. */}
      {count > 0 ? (
        <div className="proj-pick-bar">
          <ul className="proj-pick-chosen" aria-label="Chosen files">
            {chosen.map((h) => (
              <li key={h.item.path}>
                <span className="proj-pick-name">{h.item.title || h.item.name}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${h.item.title || h.item.name} from the chosen files`}
                  aria-disabled={busy || undefined}
                  onClick={() => !busy && toggle(h)}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="proj-actions">
            <button
              type="button"
              className="btn"
              data-variant="primary"
              data-size="small"
              aria-disabled={busy || undefined}
              onClick={() => !busy && void linkChosen()}
            >
              {progress || (count > 1 ? `Add ${count} files` : 'Add file')}
            </button>
            <button
              type="button"
              className="btn"
              data-size="small"
              data-variant="quiet"
              aria-disabled={busy || undefined}
              onClick={() => !busy && setPicked(new Map())}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Kind({
  card,
  kind,
  title,
  canChange,
  onView,
  onChanged,
  onUnlinked,
}: {
  card: ProjectCard;
  kind: LibraryKind;
  title: string;
  canChange: boolean;
  onView: (item: LibraryItem) => void;
  onChanged: (message: string) => void;
  onUnlinked: (name: string) => void;
}) {
  const change = useProjectChange({ reloadOnChanged: true });
  const [busy, setBusy] = useState(false);
  const loaded = useLoaded(`${card.key}|${kind}|${card.version}`, 0, () => api.projectFiles(card.key, kind));

  // After a removal the row may be gone and the Remove icon button always is: focus goes to the next row's open button,
  // else the previous, else the Add files button, once the list has reloaded.
  const focusId = useRef<string | null>(null);
  const items = loaded.status === 'ready' ? loaded.data.items : null;
  useEffect(() => {
    if (focusId.current === null || !items) return;
    const wanted = focusId.current;
    focusId.current = null;
    const target =
      (wanted ? document.querySelector<HTMLElement>(`[data-file="${CSS.escape(wanted)}"]`) : null) ??
      document.querySelector<HTMLElement>('[data-focus="linkfiles"]');
    target?.focus({ preventScroll: true });
  }, [items]);

  const unlink = async (item: LibraryItem) => {
    const list = items ?? [];
    const at = list.findIndex((i) => i.id === item.id);
    const neighbour = list[at + 1] ?? list[at - 1];
    setBusy(true);
    const res = await change({ kind: 'unlink', key: card.key, path: item.path, expect: card.version });
    setBusy(false);
    onChanged(res.ok ? '' : res.message);
    if (res.ok) {
      focusId.current = neighbour?.id ?? '';
      onUnlinked(item.title || item.name);
    }
  };

  return (
    <section className="card proj-card" aria-label={title}>
      <div className="card-head">
        <h3>{title}</h3>
        {loaded.status === 'ready' ? <span className="count">{loaded.data.items.length}</span> : null}
      </div>
      {loaded.status === 'loading' ? <StateNote kind="loading" /> : null}
      {loaded.status === 'failed' ? (
        <StateNote kind="error" onRetry={loaded.retry}>
          {loaded.message}
        </StateNote>
      ) : null}
      {loaded.status === 'ready' ? (
        <>
          {loaded.data.items.length === 0 ? (
            <StateNote kind="empty">No {title.toLowerCase()} in this project yet.</StateNote>
          ) : (
            <ul className="lib-list">
              {loaded.data.items.map((item) => (
                <FileRow
                  key={item.id}
                  item={item}
                  linked={card.links.includes(item.path)}
                  canUnlink={canChange}
                  busy={busy}
                  onView={() => onView(item)}
                  onUnlink={() => void unlink(item)}
                />
              ))}
            </ul>
          )}
          {loaded.data.hidden > 0 ? (
            <p className="proj-note">
              {loaded.data.hidden} linked file{loaded.data.hidden === 1 ? " can't" : "s can't"} be shown,
              because you can't open {loaded.data.hidden === 1 ? 'it' : 'them'}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** The project's images and documents (in its folder, or linked), with Add files and Remove. */
export function ProjectFiles({
  card,
  canChange,
  linking,
  onLinking,
}: {
  card: ProjectCard;
  canChange: boolean;
  /** Whether the picker is open. The page owns it: its Add files button sits in the tabs row. */
  linking: boolean;
  onLinking: (open: boolean) => void;
}) {
  const { dispatch } = useShell();
  const [message, setMessage] = useState('');
  const [done, setDone] = useState('');
  // Opening the picker clears the "Added N files." line.
  useEffect(() => {
    if (linking) setDone('');
  }, [linking]);

  // A file opens at once in the viewer drawer over the right of the page, like a to-do's or a chat's
  // files. Its library (the place line and "Open in Documents") is filled in when the lookup answers,
  // and only while that file is still open; if the lookup fails the file just shows without them.
  const view = async (item: LibraryItem) => {
    dispatch({ type: 'open-viewer', viewer: { item } });
    try {
      const found = (await api.libraryItems([item.id])).files[0];
      if (!found) return;
      dispatch({
        type: 'update-viewer',
        viewer: {
          item: found.item,
          place: found.scope.name,
          openIn: { app: found.item.kind === 'image' ? 'images' : 'documents', scope: found.scope.id },
        },
      });
    } catch {
      // Shown without its library's name.
    }
  };

  return (
    <>
      {message ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {message}
        </p>
      ) : null}
      <p className={done ? 'proj-note' : 'visually-hidden'} role="status">
        {done}
      </p>
      <div className="tray lib-tray">
        {linking && canChange ? (
          <Picker
            card={card}
            onClose={() => onLinking(false)}
            onLinked={(count) => {
              onLinking(false);
              setDone(count === 1 ? 'Added 1 file.' : `Added ${count} files.`);
            }}
          />
        ) : null}
        {KINDS.map((k) => (
          <Kind
            key={k.kind}
            card={card}
            kind={k.kind}
            title={k.title}
            canChange={canChange}
            onView={(item) => void view(item)}
            onChanged={setMessage}
            onUnlinked={(name) => setDone(`${name} removed from this project.`)}
          />
        ))}
      </div>
    </>
  );
}
