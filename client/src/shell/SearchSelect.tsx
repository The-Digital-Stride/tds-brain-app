import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';
import {
  type MatchRange,
  matchCount,
  normalise,
  type PickOption,
  readRecent,
  rememberRecent,
  type ShownOption,
  shownGroups,
} from './search-select.ts';

export interface SearchSelectProps {
  /** The input's id, for the `<label htmlFor>` that names it. */
  id: string;
  /** Name when there is no `<label>`. */
  'aria-label'?: string;
  /** Links the input to help or error text (e.g. a form's error message). */
  'aria-describedby'?: string;
  /** Marks the input as failing validation. */
  'aria-invalid'?: boolean;
  value: string;
  options: readonly PickOption[];
  onChange: (value: string) => void;
  /** localStorage list for Recent ("clients", "library"); no Recent without it. */
  recentKey?: string;
  disabled?: boolean;
  /** Shown when the value is not one of the options, and while the box is empty. Default "Type to search". */
  placeholder?: string;
  /** On the wrapper, for width rules at the call site. */
  className?: string;
}

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const EDGE = 8;
const GAP = 4;
const MIN_WIDTH = 260;
const MAX_HEIGHT = 320;
const ROOM_NEEDED = 260;

/** Where the list goes: below the box, or above when there is little room below and more above. */
export function place(box: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - box.bottom - GAP - EDGE;
  const above = box.top - GAP - EDGE;
  const up = below < ROOM_NEEDED && above > below;
  const width = Math.min(Math.max(box.width, MIN_WIDTH), vw - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(box.left, vw - EDGE - width));
  const maxHeight = Math.max(80, Math.min(MAX_HEIGHT, up ? above : below));
  return up
    ? { left, width, bottom: vh - box.top + GAP, maxHeight }
    : { left, width, top: box.bottom + GAP, maxHeight };
}

/** The label with the matching runs in <mark>. */
function marked(label: string, ranges: readonly MatchRange[]): ReactNode {
  if (ranges.length === 0) return label;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push(label.slice(at, start));
    out.push(<mark key={start}>{label.slice(start, end)}</mark>);
    at = end;
  }
  if (at < label.length) out.push(label.slice(at));
  return out;
}

/**
 * A type-to-search select for lists that can grow (clients). The ARIA 1.2 combobox pattern, as the
 * palette uses it; the list is drawn into the body so no drawer or composer clips it. Logic lives in
 * `search-select.ts`. Plan 2026-11-14-client-picker.
 */
/**
 * Selects the whole label with the caret at its start, so a label wider than the box shows its beginning
 * ("Weightmans PPC…"), not its end ("…ns PPC"), which a plain select() scrolls to.
 */
function selectAllFromStart(box: HTMLInputElement) {
  box.setSelectionRange(0, box.value.length, 'backward');
  box.scrollLeft = 0;
}

export function SearchSelect({
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  value,
  options,
  onChange,
  recentKey,
  disabled = false,
  placeholder = 'Type to search',
  className,
}: SearchSelectProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  // What the person typed; null while the box just shows the chosen label.
  const [text, setText] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [at, setAt] = useState<Place | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const wasFocused = useRef(false);
  // True when the press landed on a focused box showing the chosen label (so it must not move the caret).
  const pressKept = useRef(false);
  // The reselect after a pick or Escape, waiting for the next frame; dropped as soon as anything is typed.
  const reselect = useRef(0);
  useEffect(() => () => cancelAnimationFrame(reselect.current), []);

  const chosen = options.find((o) => o.value === value);
  const query = text ?? '';
  const groups = useMemo(() => shownGroups(options, query, recent), [options, query, recent]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const typed = normalise(query) !== '';
  const active: ShownOption | undefined =
    rows.find((r) => r.key === moved) ?? (typed ? rows[0] : rows.find((r) => r.option.value === value));
  const optionId = (r: ShownOption) => `${uid}-opt-${r.key}`;

  /** Selects the shown label, so the next key typed replaces it (only while it shows the label). */
  const selectLabel = () => {
    const box = inputRef.current;
    if (box && document.activeElement === box) selectAllFromStart(box);
  };
  /** Selects the label again on the next frame (Chrome collapses a selection after the click); typing cancels it. */
  const reselectSoon = () => {
    cancelAnimationFrame(reselect.current);
    reselect.current = requestAnimationFrame(selectLabel);
  };
  /** Opens the list. `fresh`: opened by click, ArrowDown or Enter, not by typing, so the label is selected. */
  const show = (fresh = true) => {
    if (disabled) return;
    if (!open) {
      setRecent(recentKey ? readRecent(recentKey) : []);
      setOpen(true);
      if (fresh && text === null) {
        selectLabel();
        reselectSoon();
      }
    }
  };
  const close = () => {
    setOpen(false);
    setText(null);
    setMoved(null);
    // After a pick or Escape focus stays here: select the label once it is back in the box.
    reselectSoon();
  };
  const pick = (option: PickOption) => {
    if (option.value !== value) onChange(option.value);
    if (recentKey && option.group !== undefined) rememberRecent(recentKey, option.value);
    close();
  };

  // Measure the box and place the list; again on resize and on scrolling anywhere but inside the list.
  useLayoutEffect(() => {
    if (!open) return setAt(null);
    const measure = () => {
      if (inputRef.current) setAt(place(inputRef.current.getBoundingClientRect()));
    };
    measure();
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && popRef.current?.contains(e.target))) measure();
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const activeKey = active?.key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the active row, or the list appearing, changes
  useEffect(() => {
    if (open && activeKey)
      document.getElementById(`${uid}-opt-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeKey, uid, at === null]);

  const step = (to: 'first' | 'last' | 1 | -1) => {
    if (rows.length === 0) return;
    const i = active ? rows.indexOf(active) : -1;
    const next =
      to === 'first' ? 0 : to === 'last' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + to));
    setMoved(rows[next]?.key ?? null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) show();
      else step(1);
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      step(-1);
    } else if ((e.key === 'Home' || e.key === 'End') && open && !typed) {
      e.preventDefault();
      step(e.key === 'Home' ? 'first' : 'last');
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      // Never submits a form or sends the message the picker sits beside.
      e.preventDefault();
      e.stopPropagation();
      if (!open) show();
      else if (active) pick(active.option);
      else if (rows.length === 0 && typed) return;
      else close();
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      if (open && typed && active) pick(active.option);
      else if (open) close();
    }
  };

  const listName = inputRef.current?.labels?.[0]?.textContent?.trim() || ariaLabel;
  const count = open ? matchCount(options, query) : 0;
  const said = !open
    ? ''
    : count === 0
      ? 'Nothing matches'
      : `${count} ${count === 1 ? 'result' : 'results'}`;
  // The popover is never a focus target: pressing it must not blur the box.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <div className={['ss', className].filter(Boolean).join(' ')}>
      <input
        ref={inputRef}
        id={id}
        className="field ss-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text ?? chosen?.label ?? ''}
        onChange={(e) => {
          cancelAnimationFrame(reselect.current);
          setText(e.target.value);
          setMoved(null);
          show(false);
        }}
        onFocus={(e) => selectAllFromStart(e.currentTarget)}
        onMouseDown={(e) => {
          wasFocused.current = document.activeElement === e.currentTarget;
          // A browser puts the caret down on the press, after the click has selected the label. While
          // the box shows the chosen label (open or not: a double-click), keep the press from moving it.
          pressKept.current = wasFocused.current && text === null;
          if (pressKept.current) e.preventDefault();
        }}
        // The click that focuses the box would drop its selection on mouseup; keep the select-all.
        onMouseUp={(e) => {
          if (!wasFocused.current || pressKept.current) e.preventDefault();
        }}
        onClick={() => show()}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (open) close();
          // Back to the start of the label: a long one left scrolled to its end read "ns PPC".
          e.currentTarget.scrollLeft = 0;
        }}
      />
      <span className="ss-chevron" aria-hidden="true">
        <Icon name="chevron" size={16} />
      </span>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      {open && at
        ? createPortal(
            // biome-ignore lint/a11y/noStaticElementInteractions: the list only keeps focus on the combobox; the keyboard works through the input
            <div
              ref={popRef}
              className="ss-pop"
              style={{
                left: at.left,
                width: at.width,
                top: at.top,
                bottom: at.bottom,
                maxHeight: at.maxHeight,
              }}
              onMouseDown={keepFocus}
            >
              <div id={listId} className="ss-list" role="listbox" aria-label={listName}>
                {groups.map((g) => {
                  const rowsOf = g.rows.map((r) => {
                    const isActive = r === active;
                    const current = r.option.value === value;
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: the combobox input keeps focus and drives the list with the keyboard (aria-activedescendant)
                      <div
                        key={r.key}
                        id={optionId(r)}
                        role="option"
                        aria-selected={isActive}
                        className="ss-opt"
                        data-active={isActive ? 'true' : undefined}
                        onClick={() => pick(r.option)}
                      >
                        <span className="ss-opt-label">{marked(r.option.label, r.ranges)}</span>
                        {current ? (
                          <>
                            <span className="visually-hidden">, chosen</span>
                            <Icon name="check" size={16} />
                          </>
                        ) : null}
                      </div>
                    );
                  });
                  if (g.title === null) return <div key={g.id}>{rowsOf}</div>;
                  const headId = `${uid}-grp-${g.id}`;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a listbox group
                    <div key={g.id} role="group" aria-labelledby={headId}>
                      <div className="ss-grp" id={headId}>
                        {g.title}
                      </div>
                      {rowsOf}
                    </div>
                  );
                })}
              </div>
              {/* Outside the listbox, which may hold only options and groups. */}
              {rows.length === 0 ? <p className="ss-empty">Nothing matches</p> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
