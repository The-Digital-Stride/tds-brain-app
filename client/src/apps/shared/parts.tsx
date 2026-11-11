import { type ReactNode, useId, useState } from 'react';
import { DOCK_IDS } from '../../shell/Dock.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useCopy } from './copy.ts';

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

/** The first row of a library sheet: whose library, a search, then the app's own control. */
export function LibraryTools({
  id,
  clients,
  client,
  onClient,
  query,
  onQuery,
  searchLabel,
  placeholder,
  children,
}: {
  /** Prefix for the field ids, e.g. "imgs". */
  id: string;
  clients: { slug: string; name: string }[];
  client: string;
  onClient: (slug: string) => void;
  query: string;
  onQuery: (query: string) => void;
  searchLabel: string;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <div className="lib-tools">
      <label className="visually-hidden" htmlFor={`${id}-client`}>
        Client
      </label>
      <select
        id={`${id}-client`}
        className="field lib-client"
        value={client}
        onChange={(e) => onClient(e.target.value)}
      >
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
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
 * count and a button that hides or shows what is in it.
 */
export function FolderCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const headId = useId();
  const listId = useId();
  return (
    <section className="card" aria-labelledby={headId}>
      <div className="card-head">
        <h3 id={headId}>{title}</h3>
        <span className="count">{count}</span>
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
        {children}
      </ul>
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

/** The panel's two actions for the chosen item: ask Claude about it, or copy where it is. */
export function DetailActions({ path, onAsk }: { path: string; onAsk: () => void }) {
  const { said, copy } = useCopy();
  return (
    <div className="lib-actions">
      <button type="button" className="btn" data-variant="primary" onClick={onAsk}>
        Ask Claude about it
      </button>
      <button type="button" className="btn" onClick={() => void copy(path)}>
        {said ?? 'Copy file path'}
      </button>
      <span className="visually-hidden" role="status">
        {said ?? ''}
      </span>
    </div>
  );
}

/** A plain list in the panel with hairlines between the rows, or a line saying it is empty. */
export function DetailList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="dock-empty">{empty}</p>;
  return (
    <ul className="lib-used">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
