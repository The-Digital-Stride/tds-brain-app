import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
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
import { Seg } from '../../shell/Seg.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { useStore } from '../../store.tsx';
import { DOCUMENTS } from '../documents/kind.tsx';
import { IMAGES } from '../images/kind.tsx';
import { useLoaded } from '../shared/data.ts';
import { type KindSpec, LibraryBrowser, type View } from '../shared/LibraryBrowser.tsx';
import { AddArtifactForm } from './AddArtifactForm.tsx';
import { useProjectChange } from './useChange.ts';
import { useKeepFocus } from './useKeepFocus.ts';

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
  // Close with files chosen asks too, in the same strip (rule 9: Cancel, Esc, Back and close).
  const [askClose, setAskClose] = useState(false);
  const close = () => (count > 0 ? setAskClose(true) : onClose());
  const keepFocus = useKeepFocus();

  return (
    <section className="card proj-card" aria-label="Add files" onFocus={keepFocus.track}>
      {leave.asking || askClose ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          onConfirm={() => {
            if (leave.asking) leave.discard();
            else onClose();
          }}
          onCancel={() => {
            setAskClose(false);
            if (leave.asking) leave.keep();
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
          onClick={busy ? undefined : close}
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

type Kinds = { kind: LibraryKind; word: string; spec: KindSpec };
const KINDS: Kinds[] = [
  { kind: 'document', word: 'Documents', spec: DOCUMENTS },
  { kind: 'image', word: 'Images', spec: IMAGES },
];

/** A number for the card's version text, so one load key can refresh quietly when it changes. */
function stamp(text: string): number {
  let n = 0;
  for (const c of text) n = (n * 31 + c.charCodeAt(0)) | 0;
  return n;
}

/** The project's files: Documents or Images (a Seg), with the Documents and Images apps' own filters and layout. */
function Files({
  card,
  reloads,
  canChange,
  onView,
  onChanged,
  onUnlinked,
}: {
  card: ProjectCard;
  /** Changes when something was added from outside the list, so it reloads. */
  reloads: number;
  canChange: boolean;
  onView: (item: LibraryItem) => void;
  onChanged: (message: string) => void;
  onUnlinked: (name: string) => void;
}) {
  const { libraryVersion } = useStore();
  const change = useProjectChange({ reloadOnChanged: true });
  const [busy, setBusy] = useState(false);
  // Local state: the project page never touches what the Documents and Images apps remember.
  const [view, setView] = useState<View>({ query: '', layout: 'list', format: 'all', sort: 'newest' });
  const [chosen, setChosen] = useState<LibraryKind | null>(null);

  // One load per kind, so the Seg can show both counts. A change to the card or the library refreshes quietly.
  const refresh = stamp(`${card.version}|${libraryVersion}|${reloads}`);
  const docs = useLoaded(`${card.key}|document`, refresh, () => api.projectFiles(card.key, 'document'));
  const images = useLoaded(`${card.key}|image`, refresh, () => api.projectFiles(card.key, 'image'));
  const loads = { document: docs, image: images };

  // Documents first, unless the project has only images.
  const onlyImages =
    docs.status === 'ready' &&
    images.status === 'ready' &&
    docs.data.items.length === 0 &&
    images.data.items.length > 0;
  const kind: LibraryKind = chosen ?? (onlyImages ? 'image' : 'document');
  const now = KINDS.find((k) => k.kind === kind) ?? KINDS[0];
  const loaded = loads[kind];
  // The library's folder groups ("Projects", "Reports") say little inside one project, so files are grouped by
  // where they sit in it: the project's own folder, its subfolders, then the files added from the library.
  const inProject = useMemo(
    () => (loaded.data?.items ?? []).map((item) => ({ ...item, group: placeIn(card, item.path) })),
    [loaded.data, card],
  );
  // A fixed order, whatever the sort: the project folder, its subfolders A to Z, then the library.
  const order = useMemo(() => {
    const sub = [...new Set(inProject.map((i) => i.group))]
      .filter((g) => g !== IN_FOLDER && g !== FROM_LIBRARY)
      .sort((a, b) => a.localeCompare(b));
    return [IN_FOLDER, ...sub, FROM_LIBRARY];
  }, [inProject]);
  // Actions get the file as the server sent it, never the regrouped copy.
  const original = (item: LibraryItem) => loaded.data?.items.find((i) => i.id === item.id) ?? item;

  if (!now) return null;

  const unlink = async (item: LibraryItem): Promise<boolean> => {
    setBusy(true);
    const res = await change({ kind: 'unlink', key: card.key, path: item.path, expect: card.version });
    setBusy(false);
    onChanged(res.ok ? '' : res.message);
    if (res.ok) onUnlinked(item.title || item.name);
    return res.ok;
  };

  // Its own wrapper: the tools row gives every switch a fixed width, too narrow for "Documents, 12".
  const kindSeg = (
    <div className="proj-kind">
      <Seg
        label="Kind"
        value={kind}
        options={KINDS.map((k) => {
          const l = loads[k.kind];
          return {
            value: k.kind,
            label: l.status === 'ready' ? `${k.word}, ${l.data.items.length}` : k.word,
          };
        })}
        onChange={(next) => {
          setChosen(next);
          // A type like "PDFs" means nothing for images, and the search starts afresh for the other kind.
          setView((v) => ({ ...v, format: 'all' }));
        }}
      />
    </div>
  );

  return (
    // No key: the Documents/Images switch lives inside, and remounting it would drop keyboard focus.
    <LibraryBrowser
      spec={now.spec}
      view={view}
      onView={(patch) => setView((v) => ({ ...v, ...patch }))}
      data={{
        status: loaded.status,
        message: loaded.message,
        retry: loaded.retry,
        items: inProject,
        order,
        truncated: false,
        hiddenLinks: loaded.data?.hidden ?? 0,
      }}
      lead={kindSeg}
      nested
      bin={false}
      empty={`No ${now.word.toLowerCase()} in this project yet.`}
      // A file opens in the viewer drawer, which has "Open in Documents/Images"; no row stays selected.
      onChoose={(item) => onView(original(item))}
      takeOut={(item) =>
        canChange && card.links.includes(item.path)
          ? {
              label: `Remove ${item.title || item.name} from this project`,
              tip: 'Remove from this project. The file stays in the library.',
              busy,
              run: () => unlink(original(item)),
            }
          : null
      }
    />
  );
}

/** Back on the page's "Add a claude.ai page" button once the form has gone from the page. */
const focusAddArtifact = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-focus="addartifact"]')?.focus());

const IN_FOLDER = 'In the project folder';
const FROM_LIBRARY = 'From the library';

/** Where a file sits in a project, as its group heading. */
export function placeIn(card: Pick<ProjectCard, 'folder' | 'links'>, path: string): string {
  if (card.links.includes(path)) return FROM_LIBRARY;
  const inside = path.startsWith(`${card.folder}/`) ? path.slice(card.folder.length + 1) : '';
  const parts = inside.split('/');
  if (parts.length < 2) return IN_FOLDER;
  // A project's own files/ and images/ folders hold what was added to it: not a heading of their own.
  if (parts.length === 2 && (parts[0] === 'files' || parts[0] === 'images')) return IN_FOLDER;
  const name = (parts[0] ?? '').replace(/[-_]+/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The project's images and documents (in its folder, or linked), with Add files and Remove. */
export function ProjectFiles({
  card,
  canChange,
  linking,
  onLinking,
  addingArtifact = false,
  onAddingArtifact,
}: {
  card: ProjectCard;
  canChange: boolean;
  /** Whether the picker is open. The page owns it: its Add files button sits in the tabs row. */
  linking: boolean;
  onLinking: (open: boolean) => void;
  /** Whether the "Add a claude.ai page" form is open. The page owns it, like `linking`. */
  addingArtifact?: boolean;
  onAddingArtifact?: (open: boolean) => void;
}) {
  const { dispatch } = useShell();
  const [message, setMessage] = useState('');
  const [done, setDone] = useState('');
  // Bumped when a page is added, so the lists reload to show it.
  const [reloads, setReloads] = useState(0);
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
      {linking && canChange ? (
        <div className="tray lib-tray">
          <Picker
            card={card}
            onClose={() => onLinking(false)}
            onLinked={(count) => {
              onLinking(false);
              setDone(count === 1 ? 'Added 1 file.' : `Added ${count} files.`);
            }}
          />
        </div>
      ) : null}
      {addingArtifact && canChange ? (
        <div className="tray lib-tray">
          <AddArtifactForm
            card={card}
            onClose={() => {
              onAddingArtifact?.(false);
              focusAddArtifact();
            }}
            onAdded={(name) => {
              onAddingArtifact?.(false);
              setDone(`Added “${name}” to the project.`);
              setReloads((n) => n + 1);
              focusAddArtifact();
            }}
          />
        </div>
      ) : null}
      <Files
        card={card}
        reloads={reloads}
        canChange={canChange}
        onView={(item) => void view(item)}
        onChanged={setMessage}
        onUnlinked={(name) => setDone(`${name} removed from this project.`)}
      />
    </>
  );
}
