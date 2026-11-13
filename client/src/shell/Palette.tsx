import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { paletteGroups } from '../state/palette.ts';
import { useStore } from '../store.tsx';
import type { PaletteCommand, PaletteOption } from './contract.ts';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, todoChatDraft } from './words.ts';

/** The command palette: Cmd/Ctrl+K or the "Search or jump to" button. Nothing is rendered while shut. */
export function Palette() {
  const { state } = useShell();
  return state.paletteOpen ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const { state, dispatch } = useShell();
  const { boot, todos, sessions, newChat, openView, openChat, startSkill, requestComposerFocus } = useStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(document.activeElement);
  const skipRestore = useRef(false);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (o: PaletteOption) => `${uid}-opt-${o.id}`;

  const groups = useMemo(() => {
    // Hints show a client's name, never its folder slug.
    const named = (slug: string | null) => (slug ? placeName(slug, boot?.clients ?? []) : null);
    const g = paletteGroups(query, {
      live: sessions?.live ?? [],
      skills: boot?.skills ?? [],
      pins: boot?.prefs.pins ?? [],
      todos: todos?.mine ?? [],
    });
    return g.map((group) => ({
      ...group,
      options: group.options.map((o) =>
        o.command.kind === 'chat' || o.command.kind === 'todo' ? { ...o, hint: named(o.hint) } : o,
      ),
    }));
  }, [query, sessions, boot, todos]);
  const options = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const active = options[Math.min(selected, options.length - 1)];

  // Focus the input on open; hand focus back to where it was on close, unless the command moved it.
  useEffect(() => {
    inputRef.current?.focus();
    const from = restoreTo.current;
    return () => {
      if (!skipRestore.current && from instanceof HTMLElement && from.isConnected) from.focus();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const run = (option: PaletteOption) => {
    const c: PaletteCommand = option.command;
    switch (c.kind) {
      case 'home':
        newChat();
        break;
      case 'settings':
        openView('settings');
        break;
      case 'drawer':
        // The dock takes focus itself.
        skipRestore.current = true;
        dispatch({ type: 'open-drawer', drawer: c.drawer });
        break;
      case 'chat':
        skipRestore.current = true;
        openChat(c.sessionId);
        requestComposerFocus();
        break;
      case 'skill':
        skipRestore.current = true;
        startSkill(c.skill);
        requestComposerFocus();
        break;
      case 'todo':
        skipRestore.current = true;
        newChat({ draft: todoChatDraft(c.todo), todoId: c.todo.key });
        requestComposerFocus();
        break;
    }
    dispatch({ type: 'set-palette', open: false });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((i) => (Math.min(i, options.length - 1) + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (active) run(active);
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
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search skills, to-dos and chats"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
        />
        <div className="palette-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
          {groups.map((g, gi) => (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a listbox group
            <div key={g.title} role="group" aria-labelledby={`${uid}-grp-${gi}`}>
              <div className="grp" id={`${uid}-grp-${gi}`}>
                {g.title}
              </div>
              {g.options.map((o) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: the combobox input keeps focus and drives the list with the keyboard (aria-activedescendant)
                <div
                  key={o.id}
                  id={optionId(o)}
                  role="option"
                  aria-selected={o === active}
                  className="opt"
                  data-selected={o === active ? 'true' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(o)}
                >
                  <Icon name={o.icon} size={18} />
                  <span className="opt-label">{o.label}</span>
                  {o.hint && o.command.kind === 'drawer' ? (
                    // The letter is only a shortcut while single keys are on.
                    state.singleKeys ? (
                      <kbd>{o.hint}</kbd>
                    ) : null
                  ) : o.hint ? (
                    <span className="opt-hint">{o.hint}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
        {options.length === 0 ? (
          <p className="palette-empty" role="status">
            Nothing matches
          </p>
        ) : null}
      </div>
    </>
  );
}
