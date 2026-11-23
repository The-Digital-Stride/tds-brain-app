import { type ReactNode, useMemo, useRef } from 'react';
import type { LibraryItem } from '../../../../shared/contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { useStore } from '../../store.tsx';
import { useCopy } from './copy.ts';
import type { LibraryData } from './data.ts';
import { groupItems } from './library.ts';
import {
  DeleteButton,
  FolderCard,
  LibraryNotice,
  LibraryTools,
  neighbourId,
  SelectionBar,
  useDeleteFocus,
} from './parts.tsx';
import { selectionWords } from './words.ts';

/** What the browser shows and how: held by an app's store or by a plain `useState`. */
export interface View {
  query: string;
  layout: 'grid' | 'list';
  /** The type filter's value ('all' when absent). Only read when the spec has `formats`. */
  format?: string;
  /** The sort's value. Only read when the spec has `sorts`. */
  sort?: string;
  /** The chosen item (details show wherever the host puts them). */
  current?: LibraryItem | null;
  /** Items ticked for a bulk action. Only used with `selection`. */
  ticked?: ReadonlySet<string>;
}

/** What an item component draws: its own button, star and meta; the browser decides what sits at its edge. */
export interface ItemProps {
  item: LibraryItem;
  layout: 'grid' | 'list';
  current: boolean;
  onChoose: () => void;
  /** Absent: draw no Open button and leave no gap. */
  onOpen?: () => void;
  /** Present with `selection`: the checkbox. */
  tick?: { ticked: boolean; onToggle: () => void };
  /** Extra words for the meta line, after the kind's own. */
  note?: string;
  /** The bin, or the take-out button, or nothing. Place it where a bin goes in this layout. */
  edge: ReactNode;
}

/** Everything one kind of file (documents, images) adds to the shared browser. */
export interface KindSpec {
  /** Field-id prefix and root class, e.g. "docs". */
  id: string;
  words: {
    searchLabel: string;
    placeholder: string;
    /** "Documents": the visually hidden heading reads "Documents in Acme". */
    heading: string;
    /** Shown when the library has none. */
    none: string;
    /** Shown when the search or type hides them all. */
    noMatch: string;
    /** The selection bar's group name, e.g. "Selected images". */
    selected: string;
  };
  /** A type filter: `value` is matched against `item.format`; the browser adds the counts. */
  formats?: { value: string; label: string }[];
  sorts?: { value: string; label: string }[];
  /** Items matching the search (not the type filter). */
  filter(items: LibraryItem[], query: string): LibraryItem[];
  sort?(items: LibraryItem[], sort: string): LibraryItem[];
  /** "18 documents, 8.7 MB". */
  summary(items: LibraryItem[]): string;
  /** "1 image", "2 images". */
  count(n: number): string;
  /** The name a person sees on the file (for labels). */
  name(item: LibraryItem): string;
  Item: (props: ItemProps) => ReactNode;
}

export interface TakeOut {
  label: string;
  tip: string;
  busy: boolean;
  /** Resolves true when the item went, so focus can move on. */
  run(): Promise<boolean>;
}

export interface LibraryBrowserProps {
  spec: KindSpec;
  view: View;
  onView(patch: Partial<View>): void;
  data: Omit<LibraryData, 'scopes' | 'project' | 'scope' | 'scopeName'> &
    Partial<Pick<LibraryData, 'scope' | 'scopeName'>>;
  /** Whose library and which project. Left out, neither control is drawn. */
  pickers?: {
    scopes: LibraryData['scopes'];
    scope: string;
    onScope(scope: string): void;
    project: string;
    onProject(project: string): void;
  };
  /** Drawn first among the app's own controls (e.g. a Kind switch). */
  lead?: ReactNode;
  /** Inside another card: no page padding. */
  nested?: boolean;
  /** Show the delete bin (default true). */
  bin?: boolean;
  onChoose(item: LibraryItem): void;
  /** The Open button's action. Left out, items have no Open button. */
  onOpen?(item: LibraryItem): void;
  onDeleted?(item: LibraryItem): void;
  /** A remove action in the bin's place (for example "remove from this project"); null for items without one. */
  takeOut?(item: LibraryItem): TakeOut | null;
  note?(item: LibraryItem): string | undefined;
  /** Ticks, and the bar for ticked items. */
  selection?: { onAsk(items: LibraryItem[]): void };
  /** Replaces the "nothing here" words. */
  empty?: string;
}

const LAYOUTS: { value: 'grid' | 'list'; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

/**
 * The body Documents, Images and a project's Files tab share: filters, sort, layout, summary, folder
 * cards, star, delete with Undo and selection. Loading, state and what a press does stay with the host.
 */
export function LibraryBrowser({
  spec,
  view,
  onView,
  data,
  pickers,
  lead,
  nested,
  bin = true,
  onChoose,
  onOpen,
  onDeleted,
  takeOut,
  note,
  selection,
  empty,
}: LibraryBrowserProps) {
  const { deleteFile, hiddenFileIds } = useStore();
  const { said, copy } = useCopy();
  const root = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const focusAfter = useDeleteFocus(root, summary, false);
  const format = view.format ?? 'all';

  // A file being deleted is out of the list at once, even if a refresh still carries it.
  const items = useMemo(
    () => data.items.filter((i) => !hiddenFileIds.has(i.id)),
    [data.items, hiddenFileIds],
  );
  const found = useMemo(() => spec.filter(items, view.query), [spec, items, view.query]);
  const shown = format === 'all' ? found : found.filter((i) => i.format === format);
  const groups = useMemo(
    () => groupItems(spec.sort ? spec.sort(shown, view.sort ?? '') : shown, data.order),
    [spec, shown, view.sort, data.order],
  );
  const ready = data.status === 'ready';
  const ticked = view.ticked;
  const picked = selection && ticked ? items.filter((i) => ticked.has(i.id)) : [];
  const hidden = picked.filter((i) => !shown.includes(i)).length;
  const pickedWords = selectionWords(spec.count(picked.length), hidden);
  const reserveBin = shown.some((i) => (takeOut ? takeOut(i) !== null : bin && i.canDelete === true));
  const formats = spec.formats?.map((f) => ({
    value: f.value,
    label: `${f.label}, ${f.value === 'all' ? found.length : found.filter((i) => i.format === f.value).length}`,
  }));
  const scopeName = data.scopeName ?? '';

  const ids = () => groups.flatMap((g) => g.items.map((i) => i.id));

  // Delete with an Undo; focus goes to the next file shown (found by id).
  const remove = (item: LibraryItem) => {
    const next = neighbourId(ids(), item.id);
    // The store's own default is the title; pass a name only when the kind shows another.
    const name = spec.name(item);
    if (name === item.title) deleteFile(item);
    else deleteFile(item, name);
    if (view.current?.id === item.id) onView({ current: null });
    onDeleted?.(item);
    focusAfter(next);
  };

  const edgeFor = (item: LibraryItem, layout: 'grid' | 'list'): ReactNode => {
    const out = takeOut?.(item);
    if (takeOut) {
      if (!out)
        return layout === 'list' && reserveBin ? (
          <span className="lib-delete-gap" aria-hidden="true" />
        ) : null;
      return (
        <button
          type="button"
          className="icon-btn lib-delete"
          aria-disabled={out.busy || undefined}
          aria-label={out.label}
          data-tip={out.tip}
          onClick={() => {
            if (out.busy) return;
            const next = neighbourId(ids(), item.id);
            void out.run().then((ok) => {
              if (ok) focusAfter(next);
            });
          }}
        >
          <Icon name="close" size={14} />
        </button>
      );
    }
    if (!bin) return null;
    return (
      <DeleteButton
        item={item}
        name={spec.name(item)}
        onDelete={() => remove(item)}
        className="lib-delete"
        reserve={layout === 'list' && reserveBin}
      />
    );
  };

  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    onView({ ticked: next });
  };

  const summaryLine = (
    <p className="lib-summary" data-lib-summary role="status" ref={summary} tabIndex={-1}>
      {ready ? spec.summary(shown) : ''}
    </p>
  );

  return (
    <div
      className={`lib ${spec.id}`}
      ref={root}
      data-layout={view.layout}
      data-nested={nested ? 'true' : undefined}
      data-picking={picked.length > 0 ? 'true' : undefined}
    >
      <div className="lib-main">
        <LibraryTools
          id={spec.id}
          scopes={pickers?.scopes}
          scope={pickers?.scope}
          onScope={pickers?.onScope}
          query={view.query}
          onQuery={(query) => onView({ query })}
          project={pickers?.project ?? ''}
          onProject={pickers?.onProject}
          searchLabel={spec.words.searchLabel}
          placeholder={spec.words.placeholder}
        >
          {lead}
          {spec.sorts ? (
            <Seg
              label="Sort"
              value={view.sort ?? ''}
              options={spec.sorts}
              onChange={(sort) => onView({ sort })}
            />
          ) : null}
          {formats ? null : summaryLine}
          <Seg
            label="Layout"
            value={view.layout}
            options={LAYOUTS}
            onChange={(layout) => onView({ layout })}
          />
        </LibraryTools>

        {formats ? (
          <div className="lib-filter">
            <Seg label="Type" value={format} options={formats} onChange={(f) => onView({ format: f })} />
            {summaryLine}
          </div>
        ) : null}

        {scopeName ? (
          <h2 className="visually-hidden">
            {spec.words.heading} in {scopeName}
          </h2>
        ) : null}
        <LibraryNotice
          status={data.status}
          message={data.message}
          retry={data.retry}
          empty={
            items.length === 0
              ? (empty ?? spec.words.none)
              : shown.length === 0
                ? spec.words.noMatch
                : undefined
          }
        />
        {ready && groups.length > 0 ? (
          <div className="tray lib-tray">
            {groups.map((g) => (
              <FolderCard
                key={`${data.scope ?? ''}/${g.group}`}
                title={g.group}
                items={g.items}
                renderItem={(item) => (
                  <spec.Item
                    key={item.id}
                    item={item}
                    layout={view.layout}
                    current={view.current?.id === item.id}
                    onChoose={() => onChoose(item)}
                    onOpen={onOpen ? () => onOpen(item) : undefined}
                    tick={
                      selection
                        ? { ticked: ticked?.has(item.id) === true, onToggle: () => toggle(item.id) }
                        : undefined
                    }
                    note={note?.(item)}
                    edge={edgeFor(item, view.layout)}
                  />
                )}
              />
            ))}
          </div>
        ) : null}
        {ready && data.hiddenLinks > 0 ? (
          <p className="lib-note">
            {data.hiddenLinks === 1
              ? '1 linked file is not shown because you cannot see it.'
              : `${data.hiddenLinks} linked files are not shown because you cannot see them.`}
          </p>
        ) : null}
        {ready && data.truncated ? (
          <p className="lib-note">This library is very large, so some files are not listed.</p>
        ) : null}

        {selection ? (
          <>
            <div className="visually-hidden" role="status">
              {picked.length > 0 ? pickedWords : ''}
              {said ? `. ${said}` : ''}
            </div>
            {picked.length > 0 ? (
              <SelectionBar
                label={spec.words.selected}
                words={pickedWords}
                many={picked.length > 1}
                said={said}
                onAsk={() => selection.onAsk(picked)}
                onCopy={() => void copy(picked.map((i) => i.path).join('\n'))}
                onClear={() => {
                  onView({ ticked: new Set() });
                  // The bar goes with the selection, so focus moves to the line above the items.
                  summary.current?.focus();
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
