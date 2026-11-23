import { type ReactNode, type RefObject, useId, useLayoutEffect, useState } from 'react';
import { type LibraryItem, type LibraryScope, ROUTES } from '../../../../shared/contract.ts';
import { FileStar } from '../../shell/FileStar.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { SearchSelect } from '../../shell/SearchSelect.tsx';
import { UndoLine } from '../../shell/UndoLine.tsx';
import { clearPickedProject, useProjectChoice } from '../../state/client-choice.ts';
import { filterOptions, useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import { useCopy } from './copy.ts';
import { FIRST_SHOWN } from './library.ts';

const ALL_PROJECTS = 'all';

/**
 * A project filter for one app (decision 11). While the app-wide picker holds a project it shows that
 * project and is locked: change it from the picker.
 */
export function ProjectFilter({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (key: string) => void;
}) {
  const { list } = useProjects();
  const clients = useStore().boot?.clients ?? [];
  const picked = useProjectChoice();
  const cards = list?.projects ?? [];
  if (cards.length === 0 && !picked) return null;
  const options = [{ value: ALL_PROJECTS, label: 'All projects' }, ...filterOptions(cards, clients)];
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        Project
      </label>
      {/* The locked select sits in a group that the visible reason describes (SearchSelect takes no describedby of its own). */}
      <fieldset
        aria-label="Project"
        aria-describedby={picked ? `${id}-why` : undefined}
        style={{ display: 'contents' }}
      >
        <SearchSelect
          id={id}
          className="lib-client lib-project"
          value={picked || value || ALL_PROJECTS}
          options={options}
          disabled={picked !== ''}
          onChange={(v) => onChange(v === ALL_PROJECTS ? '' : v)}
        />
      </fieldset>
      {picked ? (
        <span id={`${id}-why`} className="lib-project-why">
          Set by Working on (Home) ·{' '}
          <button type="button" className="link-btn" onClick={clearPickedProject}>
            Clear
          </button>
        </span>
      ) : null}
    </>
  );
}

/** The first row of a library sheet: whose library, a search, then the app's own control. */
export function LibraryTools({
  id,
  scopes,
  scope,
  onScope,
  query,
  onQuery,
  searchLabel,
  placeholder,
  project,
  onProject,
  children,
}: {
  /** Prefix for the field ids, e.g. "imgs". */
  id: string;
  scopes: LibraryScope[];
  scope: string;
  onScope: (scope: string) => void;
  query: string;
  onQuery: (query: string) => void;
  searchLabel: string;
  placeholder: string;
  /** This app's own project filter (a ProjectKey, '' for none). Shown when `onProject` is given. */
  project?: string;
  onProject?: (key: string) => void;
  children?: ReactNode;
}) {
  // A client's library is found by the client's codes and other names too ("UC"), as in every client picker.
  const clients = useStore().boot?.clients ?? [];
  const termsFor = (s: LibraryScope) => {
    if (s.kind !== 'client') return {};
    const slug = s.id.slice('client:'.length);
    return { terms: [slug, ...(clients.find((c) => c.slug === slug)?.aliases ?? [])] };
  };
  const option = (group: string) => (s: LibraryScope) => ({
    value: s.id,
    label: s.name,
    group,
    ...termsFor(s),
  });
  const options = [
    ...scopes.filter((s) => s.kind === 'personal').map(option('Mine')),
    ...scopes.filter((s) => s.kind === 'client').map(option('Clients')),
    ...scopes.filter((s) => s.kind === 'shared').map(option('Shared')),
  ];
  return (
    <div className="lib-tools">
      <label className="visually-hidden" htmlFor={`${id}-scope`}>
        Library
      </label>
      <SearchSelect
        id={`${id}-scope`}
        className="lib-client"
        value={scope}
        options={options}
        recentKey="library"
        disabled={scopes.length === 0}
        onChange={onScope}
      />
      {onProject ? <ProjectFilter id={`${id}-project`} value={project ?? ''} onChange={onProject} /> : null}
      <div className="lib-search">
        <Icon name="search" size={16} />
        <label className="visually-hidden" htmlFor={`${id}-search`}>
          {searchLabel}
        </label>
        <input
          id={`${id}-search`}
          type="search"
          className="field"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {children}
    </div>
  );
}

/**
 * One folder: a raised card in the tray, the same device as Home's cards. Its heading carries the
 * count and a button that hides or shows what is in it. Only the first 60 items are drawn until
 * "Show all" is pressed.
 */
export function FolderCard<T extends { id: string }>({
  title,
  items,
  renderItem,
}: {
  title: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const headId = useId();
  const listId = useId();
  const shown = all ? items : items.slice(0, FIRST_SHOWN);
  return (
    <section className="card" aria-labelledby={headId}>
      <div className="card-head">
        <h3 id={headId}>{title}</h3>
        <span className="count">{items.length}</span>
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          aria-label={`${open ? 'Hide' : 'Show'} ${title}`}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      <ul className="lib-list" id={listId} hidden={!open}>
        {shown.map(renderItem)}
      </ul>
      {open && shown.length < items.length ? (
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          onClick={() => setAll(true)}
        >
          Show all {items.length.toLocaleString('en-GB')} <span className="visually-hidden">in {title}</span>
        </button>
      ) : null}
    </section>
  );
}

/** The frosted bar for ticked items, floating over the bottom of the sheet. */
export function SelectionBar({
  label,
  words,
  many,
  said,
  onAsk,
  onCopy,
  onClear,
}: {
  /** The group's name, e.g. "Selected images". */
  label: string;
  /** "2 images selected". */
  words: string;
  many: boolean;
  /** What the copy button says for two seconds after a copy, or null. */
  said: string | null;
  onAsk: () => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of actions, not a form fieldset.
    <div className="lib-selbar glass" role="group" aria-label={label}>
      <span className="lib-selcount">{words}</span>
      <button type="button" className="btn" data-variant="primary" data-size="small" onClick={onAsk}>
        {many ? 'Ask Claude about them' : 'Ask Claude about it'}
      </button>
      <button type="button" className="btn" data-size="small" onClick={onCopy}>
        {said ?? (many ? 'Copy file paths' : 'Copy file path')}
      </button>
      <button type="button" className="btn" data-variant="quiet" data-size="small" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}

/**
 * Open on a row or tile, for a file the app can show (pass `onView: null` otherwise): straight to the viewer, without choosing the item
 * and then pressing Open in the panel. It sits above the item's own button (which fills the item), and
 * shows on hover, on focus, on the chosen item and always on touch (`library.css`).
 */
export function ViewButton({ title, onView }: { title: string; onView: (() => void) | null }) {
  // A file the app can't show keeps the button's room, so a row's columns line up with the others.
  if (!onView) return <span className="lib-view-gap" aria-hidden="true" />;
  return (
    <button
      type="button"
      className="btn lib-view"
      data-size="small"
      aria-label={`Open ${title}`}
      onClick={onView}
    >
      Open
    </button>
  );
}

/**
 * The panel's actions for the chosen item, on two rows on purpose: open it here (when the app can) or
 * ask Claude about it; then download it or copy where it is. Open is the main action when it is there.
 */
export function DetailActions({
  item,
  onAsk,
  onOpen,
}: {
  item: LibraryItem;
  onAsk: () => void;
  onOpen?: (() => void) | null;
}) {
  const { said, copy } = useCopy();
  return (
    <div className="lib-actions">
      <div className="lib-actions-row">
        {onOpen ? (
          <button type="button" className="btn" data-variant="primary" onClick={onOpen}>
            Open
          </button>
        ) : null}
        <button type="button" className="btn" data-variant={onOpen ? undefined : 'primary'} onClick={onAsk}>
          Ask Claude about it
        </button>
        <FileStar item={item} />
      </div>
      <div className="lib-actions-row">
        {/* The server sends it as an attachment, so the browser saves it and the app stays put. */}
        <a
          className="btn"
          href={ROUTES.libraryFile(item.id)}
          download={item.name}
          aria-label={`Download ${item.name}`}
        >
          Download
        </a>
        <button type="button" className="btn" onClick={() => void copy(item.path)}>
          {said ?? 'Copy file path'}
        </button>
      </div>
      <span className="visually-hidden" role="status">
        {said ?? ''}
      </span>
    </div>
  );
}

/** What a sheet says while there is nothing to list: loading, a failure with a way to retry, or empty. */
export function LibraryNotice({
  status,
  message,
  retry,
  empty,
}: {
  status: 'loading' | 'failed' | 'ready';
  message: string | null;
  retry: () => void;
  /** Shown when ready with nothing in it; omit when there are items. */
  empty?: string;
}) {
  if (status === 'loading') {
    return (
      <p className="lib-empty" role="status">
        Loading…
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <div className="lib-failed" role="alert">
        <p>{message}</p>
        <button type="button" className="btn" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  return empty ? <p className="lib-empty">{empty}</p> : null;
}

/**
 * The bin on a library tile, row or viewer: shown only when the server says this person may delete the file
 * (`canDelete`). `name` is the name the person sees on the file (an image's file name, a document's title).
 * While a delete is being sent it is `aria-disabled` and does nothing, so keyboard focus is not lost.
 * `reserve` keeps its 28px place empty for a file without one, so the rows in a list line up.
 */
export function DeleteButton({
  item,
  name = item.title,
  onDelete,
  className,
  reserve = false,
}: {
  item: LibraryItem;
  name?: string;
  onDelete: () => void;
  className?: string;
  reserve?: boolean;
}) {
  const { fileDeleteBusy } = useStore();
  if (item.canDelete !== true) return reserve ? <span className="lib-delete-gap" aria-hidden="true" /> : null;
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      aria-label={`Delete file: ${name}`}
      data-tip="Delete file"
      aria-disabled={fileDeleteBusy ? 'true' : undefined}
      onClick={() => {
        if (!fileDeleteBusy) onDelete();
      }}
    >
      <Icon name="bin" size={16} />
    </button>
  );
}

/**
 * Files waiting out their Undo time: one Undo line (`UndoLine`, a strip) each. Nothing has been sent yet. The
 * clock stops while the pointer or focus is on a line, so Undo can be reached. A visually hidden status line is
 * always on the page, so a screen reader announces the delete, and later the result, as the text changes.
 */
export function FileDeleteNotice() {
  const { heldFiles, undoDeleteFile, pauseFileDelete, resumeFileDelete, fileNotice } = useStore();
  const waiting = heldFiles.filter((f) => f.phase === 'waiting');
  const spoken =
    waiting.length > 0
      ? waiting.map((f) => `${f.title} deleted. Undo is at the top of the page.`).join(' ')
      : (fileNotice ?? '');
  return (
    <>
      <p className="visually-hidden" role="status" data-testid="file-delete-status">
        {spoken}
      </p>
      {waiting.length === 0 ? null : (
        // Styled in drawers.css (eager): this shows on any sheet, before any library screen has loaded.
        <div className="undo-strips">
          {waiting.map((f) => (
            <UndoLine
              key={f.id}
              as="strip"
              text={`${f.title} deleted.`}
              undoLabel={`Undo deleting ${f.title}`}
              onPause={() => pauseFileDelete(f.id)}
              onResume={() => resumeFileDelete(f.id)}
              onUndo={() => undoDeleteFile(f.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** The file to land on after `id` goes: the next one shown (found by id, not by position), else the one before. */
export function neighbourId(ids: string[], id: string): string | null {
  const at = ids.indexOf(id);
  if (at === -1) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

/**
 * Moves focus once a file has left the list: onto the next file's open button, else onto `fallback`
 * (the line above the list). Waits while a file is open in place of the list (`waiting`).
 */
export function useDeleteFocus(
  root: RefObject<HTMLElement | null>,
  fallback: RefObject<HTMLElement | null>,
  waiting: boolean,
): (nextId: string | null) => void {
  const [want, setWant] = useState<{ id: string | null } | null>(null);
  useLayoutEffect(() => {
    if (!want || waiting) return;
    const button = want.id
      ? [...(root.current?.querySelectorAll<HTMLElement>('[data-open-id]') ?? [])].find(
          (el) => el.dataset.openId === want.id,
        )
      : undefined;
    button?.focus({ preventScroll: true });
    if (!button || document.activeElement !== button) fallback.current?.focus({ preventScroll: true });
    setWant(null);
  }, [want, waiting, root, fallback]);
  return (id) => setWant({ id });
}
