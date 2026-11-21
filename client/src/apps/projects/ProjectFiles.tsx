import { type FormEvent, useId, useState } from 'react';
import {
  LIBRARY_SEARCH_QUERY,
  type LibraryItem,
  type LibraryKind,
  type LibrarySearchHit,
} from '../../../../shared/contract.ts';
import type { ProjectCard } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { useLoaded } from '../shared/data.ts';
import { ViewButton } from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { Viewer } from '../shared/Viewer.tsx';
import { useProjectChange } from './useChange.ts';

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
  return (
    <li className="line lib-row proj-file">
      <Thumb item={item} width={96} iconSize={18} icon={item.kind === 'image' ? 'image' : 'doc'} />
      <span className="line-text">
        <span className="line-title" title={item.name}>
          {item.title || item.name}
        </span>
        <span className="line-meta">
          {item.group}
          {linked ? ' · linked' : ''}
        </span>
      </span>
      <ViewButton title={item.title || item.name} onView={item.view ? onView : null} />
      {linked && canUnlink ? (
        <button
          type="button"
          className="btn"
          data-size="small"
          disabled={busy}
          aria-label={`Unlink ${item.title || item.name}`}
          onClick={onUnlink}
        >
          Unlink
        </button>
      ) : null}
    </li>
  );
}

function Picker({
  card,
  onClose,
  onLinked,
}: {
  card: ProjectCard;
  onClose: () => void;
  onLinked: () => void;
}) {
  const change = useProjectChange();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<LibrarySearchHit[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();

  const search = async (e: FormEvent) => {
    e.preventDefault();
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

  const link = async (item: LibraryItem) => {
    setBusy(true);
    setMessage('');
    const res = await change({ kind: 'link', key: card.key, path: item.path, expect: card.version });
    setBusy(false);
    if (res.ok) onLinked();
    else setMessage(res.message);
  };

  return (
    <section className="card proj-card" aria-label="Link a file">
      <form className="proj-search" onSubmit={(e) => void search(e)} aria-label="Search files to link">
        <label htmlFor={id} className="visually-hidden">
          Search files to link
        </label>
        <input
          id={id}
          className="field"
          type="search"
          placeholder="Search images and documents"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: the person just pressed Link a file.
          autoFocus
        />
        <button type="submit" className="btn" disabled={busy}>
          Search
        </button>
        <button type="button" className="btn" data-variant="quiet" onClick={onClose}>
          Close
        </button>
      </form>
      {message ? (
        <p className="proj-error" role="alert">
          {message}
        </p>
      ) : null}
      {hits && hits.length === 0 ? <p className="proj-note">No files found.</p> : null}
      {hits && hits.length > 0 ? (
        <ul className="lib-list">
          {hits.map((h) => (
            <li key={h.item.id} className="line lib-row">
              <span className="line-text">
                <span className="line-title">{h.item.title || h.item.name}</span>
                <span className="line-meta">{h.item.path}</span>
              </span>
              {card.links.includes(h.item.path) ? (
                <span className="line-meta">Already linked</span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  data-size="small"
                  disabled={busy}
                  aria-label={`Link ${h.item.title || h.item.name}`}
                  onClick={() => void link(h.item)}
                >
                  Link
                </button>
              )}
            </li>
          ))}
        </ul>
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
}: {
  card: ProjectCard;
  kind: LibraryKind;
  title: string;
  canChange: boolean;
  onView: (item: LibraryItem) => void;
  onChanged: (message: string) => void;
}) {
  const change = useProjectChange();
  const [busy, setBusy] = useState(false);
  const loaded = useLoaded(`${card.key}|${kind}|${card.version}`, 0, () => api.projectFiles(card.key, kind));

  const unlink = async (item: LibraryItem) => {
    setBusy(true);
    const res = await change({ kind: 'unlink', key: card.key, path: item.path, expect: card.version });
    setBusy(false);
    onChanged(res.ok ? '' : res.message);
  };

  return (
    <section className="card proj-card" aria-label={title}>
      <div className="card-head">
        <h3>{title}</h3>
        {loaded.status === 'ready' ? <span className="count">{loaded.data.items.length}</span> : null}
      </div>
      {loaded.status === 'loading' ? (
        <p className="proj-note" role="status">
          Loading…
        </p>
      ) : null}
      {loaded.status === 'failed' ? (
        <p className="proj-note" role="alert">
          {loaded.message}{' '}
          <button type="button" className="btn" data-size="small" onClick={loaded.retry}>
            Try again
          </button>
        </p>
      ) : null}
      {loaded.status === 'ready' ? (
        <>
          {loaded.data.items.length === 0 ? (
            <p className="proj-note">No {title.toLowerCase()} in this project yet.</p>
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

/** The project's images and documents (in its folder, or linked), with Link a file and Unlink. */
export function ProjectFiles({ card, canChange }: { card: ProjectCard; canChange: boolean }) {
  const [viewing, setViewing] = useState<LibraryItem | null>(null);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState('');

  if (viewing) {
    return <Viewer item={viewing} name={viewing.name} onBack={() => setViewing(null)} />;
  }
  return (
    <>
      {canChange ? (
        <div className="proj-actions">
          <button
            type="button"
            className="btn"
            data-size="small"
            onClick={() => setLinking(true)}
            disabled={linking}
          >
            Link a file
          </button>
        </div>
      ) : null}
      {linking ? (
        <Picker card={card} onClose={() => setLinking(false)} onLinked={() => setLinking(false)} />
      ) : null}
      {message ? (
        <p className="proj-error" role="alert">
          {message}
        </p>
      ) : null}
      {KINDS.map((k) => (
        <Kind
          key={k.kind}
          card={card}
          kind={k.kind}
          title={k.title}
          canChange={canChange}
          onView={setViewing}
          onChanged={setMessage}
        />
      ))}
    </>
  );
}
