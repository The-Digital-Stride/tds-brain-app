import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { openLibraryItem, warmLibrarySearch } from '../apps/shared/search.ts';
import {
  asyncLooking,
  asyncPending,
  asyncTrouble,
  groupCount,
  optionKey,
  paletteGroups,
  SEARCH_TROUBLE,
  type SearchGroup,
  useAsyncSearch,
} from '../state/palette.ts';
import { useStore } from '../store.tsx';
import type { SearchActions, SearchContext, SearchHit } from './contract.ts';
import { Icon } from './Icon.tsx';
import { HOVER_GRACE_MS, PaletteTip, tipLines, tipWanted, useTipKey } from './PaletteTip.tsx';
import { useShell } from './ShellProvider.tsx';
import { GO_TO_SOURCE, searchSources } from './search-sources.ts';

/** The global search: Cmd/Ctrl+K, "/" or the "Search or jump to" button. Nothing is rendered while shut. */
export function Palette() {
  const { state } = useShell();
  return state.paletteOpen ? <PaletteDialog /> : null;
}

interface Option {
  /** Unique across groups; also the DOM id suffix for `aria-activedescendant`. */
  key: string;
  group: SearchGroup;
  hit: SearchHit;
}

/** How long the list must stay as it is before the live region says how many results there are. */
const ANNOUNCE_MS = 500;

function PaletteDialog() {
  const { state, dispatch } = useShell();
  const {
    boot,
    todos,
    sessions,
    newChat,
    openView,
    openChat,
    openPast,
    startSkill,
    revealTodo,
    requestComposerFocus,
  } = useStore();
  const [query, setQuery] = useState('');
  // The highlighted option by id, not position: results arriving or changing never move it.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  // The row the pointer is on, and whether the highlight last moved by the arrows: either earns a tooltip.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [keyed, setKeyed] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(document.activeElement);
  const skipRestore = useRef(false);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (o: Option) => `${uid}-opt-${o.key}`;

  const sources = useMemo(() => searchSources(), []);
  const q = query.trim();
  const ctx = useMemo<SearchContext>(
    () => ({
      me: boot?.identity.slug ?? '',
      todos,
      live: sessions?.live ?? [],
      past: sessions?.past ?? [],
      skills: boot?.skills ?? [],
      pins: boot?.prefs.pins ?? [],
      clients: boot?.clients ?? [],
    }),
    [boot, todos, sessions],
  );
  const slots = useAsyncSearch(sources, q);
  const groups = useMemo(() => paletteGroups(sources, q, ctx, slots), [sources, q, ctx, slots]);
  const options = useMemo<Option[]>(
    () => groups.flatMap((group) => group.hits.map((hit) => ({ key: optionKey(group, hit), group, hit }))),
    [groups],
  );
  const active = options.find((o) => o.key === activeId) ?? options[0];
  // Still looking (a partial answer being asked again) with nothing to show yet counts as still searching.
  const looking = asyncLooking(sources, q, slots);
  const pending = asyncPending(sources, q, slots) || (options.length === 0 && looking);
  // A "Still looking…" no group carries (the looking group has no hits yet) goes at the foot of the list.
  const lookingAlone = looking && options.length > 0 && !groups.some((g) => g.looking);
  const tipKey = useTipKey(hoverId ?? (keyed ? (active?.key ?? null) : null));
  const tipOption = options.find((o) => o.key === tipKey);
  const tipRow = tipOption ? document.getElementById(optionId(tipOption)) : null;
  const tipShown =
    tipOption && tipRow && tipWanted(tipOption.hit, tipRow) ? { hit: tipOption.hit, row: tipRow } : null;
  /** The pointer left a row or its tooltip: hover ends after a moment, unless it lands on a row or the tooltip. */
  const leaveSoon = () => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setHoverId(null), HOVER_GRACE_MS);
  };
  /** The pointer is on a row (or its tooltip) again: keep the tooltip. */
  const stay = () => clearTimeout(leaving.current);
  /** Hover no longer counts: the keyboard or typing took over, or Escape put the tooltip away. */
  const dropHover = () => {
    clearTimeout(leaving.current);
    setHoverId(null);
  };
  useEffect(() => () => clearTimeout(leaving.current), []);

  // Focus the input on open; hand focus back to where it was on close, unless the command moved it.
  useEffect(() => {
    inputRef.current?.focus();
    // The first search of a visit is usually the slow one: get the library's lists ready now.
    warmLibrarySearch();
    const from = restoreTo.current;
    return () => {
      if (!skipRestore.current && from instanceof HTMLElement && from.isConnected) from.focus();
    };
  }, []);

  const activeKey = active?.key;
  useEffect(() => {
    if (!activeKey) return;
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  // A live region says how many results there are, a moment after the list settles: once while the server
  // is still looking ("N results, still looking for more") and once when it is done. Counts changing while
  // it looks are not said again.
  const resultCount = `${options.length} ${options.length === 1 ? 'result' : 'results'}`;
  const phase =
    q === '' || pending ? '' : looking ? 'looking' : options.length === 0 ? 'No results' : resultCount;
  const lookingSummary = useRef('');
  lookingSummary.current = `${resultCount}, still looking for more`;
  useEffect(() => {
    if (phase === '') return setSaid('');
    const t = setTimeout(() => setSaid(phase === 'looking' ? lookingSummary.current : phase), ANNOUNCE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // What a chosen hit may do. Most of it moves focus itself, so the palette must not hand it back.
  const actions: SearchActions = {
    openView: (view) => openView(view),
    openChat: (id) => {
      skipRestore.current = true;
      openChat(id);
      requestComposerFocus();
    },
    openPast: (sdkSessionId) => {
      skipRestore.current = true;
      void openPast(sdkSessionId);
    },
    startSkill: (skill) => {
      skipRestore.current = true;
      startSkill(skill);
      requestComposerFocus();
    },
    revealTodo: (todo) => {
      // The drawer takes the request, switches to the to-do's tab and focuses its row.
      skipRestore.current = true;
      dispatch({ type: 'open-drawer', drawer: 'todos' });
      revealTodo(todo);
    },
    chooseClient: (slug) => {
      newChat({ client: slug });
    },
    openLibraryItem: (appId, scope, item) => {
      // A file gets the room an app gets (see ShellProvider), even when its app is already showing.
      if (state.drawer) dispatch({ type: 'close-drawer' });
      // Focus goes to the sheet as the palette shuts (not to body, nor to a closing drawer's rail
      // button); a viewer then takes it for itself.
      restoreTo.current = document.getElementById('main');
      openLibraryItem(appId, scope, item);
      openView(`app:${appId}`);
    },
    openDrawer: (drawer) => {
      // The dock takes focus itself.
      skipRestore.current = true;
      dispatch({ type: 'open-drawer', drawer });
    },
    goHome: () => newChat(),
  };

  const run = (option: Option) => {
    option.hit.run(actions);
    dispatch({ type: 'set-palette', open: false });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const at = active ? options.indexOf(active) : 0;
      const next = options[(at + step + options.length) % options.length];
      if (next) setActiveId(next.key);
      setKeyed(true);
      dropHover();
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (active) run(active);
    } else if (e.key === 'Escape' && tipShown) {
      // One thing per press: this one puts the tooltip away; the next closes the palette (the shell's listener skips a handled key).
      e.preventDefault();
      setKeyed(false);
      dropHover();
    } else if (e.key === 'Tab') {
      // The only tabbable thing is the input; options are reached with the arrows.
      e.preventDefault();
    }
  };

  return (
    <>
      <div
        className="palette-veil"
        aria-hidden="true"
        onClick={() => dispatch({ type: 'set-palette', open: false })}
      />
      <div
        className="palette glass"
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label="Search or jump to"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search to-dos, chats, skills, files and more"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveId(null);
            setKeyed(false);
            dropHover();
          }}
        />
        <div className="palette-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
          {groups.map((g) => {
            const count = groupCount(g);
            const headId = `${uid}-grp-${g.source.id}`;
            const countId = `${headId}-count`;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a listbox group
              <div key={g.source.id} role="group" aria-labelledby={count ? `${headId} ${countId}` : headId}>
                <div className="grp">
                  <span id={headId}>{g.source.title}</span>
                  {count ? (
                    <span className="grp-note" id={countId}>
                      {count}
                    </span>
                  ) : null}
                  {g.note ? <span className="grp-note">{g.note}</span> : null}
                  {g.looking ? <span className="grp-note">Still looking…</span> : null}
                </div>
                {g.hits.map((hit) => {
                  const o: Option = { key: optionKey(g, hit), group: g, hit };
                  const selected = o.key === active?.key;
                  // The letter on a "Go to" drawer is a shortcut, so it only shows while single keys are on.
                  const shortcut = g.source.id === GO_TO_SOURCE && hit.hint?.length === 1;
                  // A file's full details, for screen readers; the tooltip shows the same to everyone else.
                  const descId = hit.detail ? `${optionId(o)}-desc` : undefined;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: the combobox input keeps focus and drives the list with the keyboard (aria-activedescendant)
                    <div
                      key={o.key}
                      id={optionId(o)}
                      role="option"
                      aria-selected={selected}
                      aria-describedby={descId}
                      className="opt"
                      data-selected={selected ? 'true' : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => run(o)}
                      // Moves, not enters: the list scrolling under a still pointer is not the person pointing.
                      onMouseMove={() => {
                        stay();
                        setHoverId(o.key);
                      }}
                      onMouseLeave={leaveSoon}
                    >
                      <Icon name={hit.icon} size={18} />
                      <span className="opt-label">{hit.label}</span>
                      {shortcut ? (
                        state.singleKeys ? (
                          <kbd>{hit.hint}</kbd>
                        ) : null
                      ) : hit.hint ? (
                        <span className="opt-hint">{hit.hint}</span>
                      ) : null}
                      {descId ? (
                        <span id={descId} hidden>
                          {tipLines(hit).join('. ')}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {lookingAlone ? <p className="palette-foot">Still looking…</p> : null}
        {options.length === 0 ? (
          <p className="palette-empty">
            {pending ? 'Searching…' : asyncTrouble(sources, q, slots) ? SEARCH_TROUBLE : 'Nothing matches'}
          </p>
        ) : null}
        {tipShown ? (
          <PaletteTip
            hit={tipShown.hit}
            row={tipShown.row}
            list={listRef}
            onPointerEnter={stay}
            onPointerLeave={leaveSoon}
          />
        ) : null}
        <p className="visually-hidden" role="status">
          {said}
        </p>
      </div>
    </>
  );
}
