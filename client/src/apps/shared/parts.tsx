import { type ReactNode, useId, useState } from 'react';
import { type LibraryItem, type LibraryScope, ROUTES } from '../../../../shared/contract.ts';
import { DOCK_IDS } from '../../shell/Dock.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useCopy } from './copy.ts';
import { FIRST_SHOWN } from './library.ts';
import { type LibraryState, type LibraryStore, useLibrary } from './store.ts';

/** The button in the sheet bar that shows or hides the app's details panel. */
export function DetailsButton({ label }: { label: string }) {
  const { state, dispatch } = useShell();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      aria-pressed={state.panelOpen}
      aria-controls={DOCK_IDS.right}
      onClick={() => dispatch({ type: 'toggle-panel' })}
    >
      <Icon name="panel" />
    </button>
  );
}

/** The sheet bar's buttons: Back while a file is open in place of the list, then the details button. */
export function LibraryBar<S extends LibraryState>({
  store,
  back,
  details,
}: {
  store: LibraryStore<S>;
  /** "Back to Images". */
  back: string;
  details: string;
}) {
  const { viewing } = useLibrary(store);
  return (
    <>
      {viewing ? (
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          onClick={() => store.set({ viewing: null } as Partial<S>)}
        >
          {back}
        </button>
      ) : null}
      <DetailsButton label={details} />
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
  children?: ReactNode;
}) {
  const option = (s: LibraryScope) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  );
  const mine = scopes.filter((s) => s.kind === 'personal');
  const clients = scopes.filter((s) => s.kind === 'client');
  const shared = scopes.filter((s) => s.kind === 'shared');
  return (
    <div className="lib-tools">
      <label className="visually-hidden" htmlFor={`${id}-scope`}>
        Library
      </label>
      <select
        id={`${id}-scope`}
        className="field lib-client"
        value={scope}
        disabled={scopes.length === 0}
        onChange={(e) => onScope(e.target.value)}
      >
        {mine.length > 0 ? <optgroup label="Mine">{mine.map(option)}</optgroup> : null}
        {clients.length > 0 ? <optgroup label="Clients">{clients.map(option)}</optgroup> : null}
        {shared.length > 0 ? <optgroup label="Shared">{shared.map(option)}</optgroup> : null}
      </select>
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
        <button type="button" className="card-more" onClick={() => setAll(true)}>
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
