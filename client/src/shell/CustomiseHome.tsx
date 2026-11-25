import { useEffect, useId, useRef, useState } from 'react';
import {
  HOME_SHORTCUTS_MAX,
  type HomeItemId,
  type HomeShortcut,
  homeShortcutKey,
} from '../../../shared/contract.ts';
import { panelItems, resolveShortcut, SHORTCUT_GROUPS, shortcutChoices } from '../state/home-layout.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useHomeShortcuts } from './useHomeShortcuts.ts';

/**
 * The body of the Customise Home panel (plan 2026-11-25-home-card-library). The Dock gives it the heading, Close and
 * the focus moves; this is the lists only. Every change applies at once, and one polite status line says what
 * changed, because Home is dimmed behind the panel on a narrow window.
 */
/** What each kind of shortcut is called under its name in the list. */
const KIND_META: Record<HomeShortcut['kind'], string> = {
  skill: 'Skill',
  tool: 'Tool',
  place: 'Place',
  drawer: 'Drawer',
};

export function CustomiseHome() {
  const {
    homeHidden,
    homeShortcuts,
    setHomeItemShown,
    addHomeShortcut,
    removeHomeShortcut,
    showAllHomeItems,
  } = useStore();
  const { boot } = useStore();
  const pins = boot?.prefs.pins ?? [];
  const { sources, hasGm, hasAds } = useHomeShortcuts();
  const hidden = homeHidden ?? [];
  const shortcuts: readonly HomeShortcut[] = homeShortcuts ?? [];
  const full = shortcuts.length >= HOME_SHORTCUTS_MAX;

  const uid = useId();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const addBtn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Where focus goes once the list has re-rendered: a shortcut's key, or 'add'.
  const focusAfter = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the saved list changes, to land focus after a pick or a remove.
  useEffect(() => {
    const key = focusAfter.current;
    if (key === null) return;
    focusAfter.current = null;
    const row =
      key === 'add'
        ? null
        : [...(list.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find(
            (el) => el.dataset.key === key,
          );
    (row?.querySelector<HTMLElement>('button') ?? addBtn.current)?.focus();
  }, [homeShortcuts]);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('.menu-row')?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !addBtn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const items = panelItems({ hasGm, hasAds });
  const choices = shortcutChoices(shortcuts, sources, pins);
  const label = (s: HomeShortcut): string => {
    const r = resolveShortcut(s, sources);
    if (r.state !== 'waiting') return r.label;
    // Only a tool waits (for the tool list to load).
    return s.kind === 'tool' ? (sources.toolTitle?.(s.section, s.tool) ?? s.tool) : homeShortcutKey(s);
  };

  const toggle = (id: HomeItemId, title: string, shown: boolean) => {
    setHomeItemShown(id, shown);
    setStatus(`${title} ${shown ? 'shown on' : 'hidden from'} Home`);
  };

  const remove = (s: HomeShortcut, index: number) => {
    const next = shortcuts[index + 1] ?? shortcuts[index - 1];
    focusAfter.current = next ? homeShortcutKey(next) : 'add';
    removeHomeShortcut(homeShortcutKey(s));
    setStatus(`${label(s)} removed from Home`);
  };

  const add = (c: (typeof choices)[number]) => {
    focusAfter.current = homeShortcutKey(c.shortcut);
    addHomeShortcut(c.shortcut);
    setOpen(false);
    setStatus(`${c.label} added to Home`);
  };

  const popKeys = (e: React.KeyboardEvent) => {
    const rows = [...(pop.current?.querySelectorAll<HTMLElement>('.menu-row') ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      rows[(n + rows.length) % rows.length]?.focus();
    };
    if (e.key === 'Escape') {
      // Closes the pop-up only, not the panel.
      e.stopPropagation();
      setOpen(false);
      addBtn.current?.focus();
    } else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const nothingToAdd = !full && choices.length === 0;
  const addHint = full
    ? `You have ${HOME_SHORTCUTS_MAX} shortcuts. Remove one to add another.`
    : nothingToAdd
      ? 'Everything is already on your Home.'
      : shortcuts.length === 0
        ? 'Add a shortcut to start a skill, or open a tool, place or drawer, in one click.'
        : '';

  return (
    <div className="customise-home">
      <p className="hint ch-intro">Choose what shows on your Home. Only you see this.</p>

      <section className="ch-sec" aria-labelledby={`${uid}-cards`}>
        <div className="ch-sec-head">
          <h3 id={`${uid}-cards`}>Cards and buttons</h3>
        </div>
        <div className="ch-list">
          {items.map((item) => (
            <label className="setting" key={item.id}>
              <span>
                <span className="setting-label" id={`${uid}-t-${item.id}`}>
                  {item.title}
                </span>
                {item.hint ? (
                  <span className="hint ch-item-hint" id={`${uid}-h-${item.id}`}>
                    {item.hint}
                  </span>
                ) : null}
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={!hidden.includes(item.id)}
                aria-checked={!hidden.includes(item.id)}
                aria-labelledby={`${uid}-t-${item.id}`}
                aria-describedby={item.hint ? `${uid}-h-${item.id}` : undefined}
                onChange={(e) => toggle(item.id, item.title, e.target.checked)}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="ch-sec" aria-labelledby={`${uid}-short`}>
        <div className="ch-sec-head">
          <h3 id={`${uid}-short`}>Shortcuts</h3>
          <button
            ref={addBtn}
            type="button"
            className="icon-btn"
            data-variant="primary"
            aria-label="Add a shortcut"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-disabled={full || nothingToAdd ? 'true' : undefined}
            aria-describedby={addHint ? `${uid}-add-hint` : undefined}
            onClick={() => {
              if (!full && !nothingToAdd) setOpen((o) => !o);
            }}
          >
            <Icon name="plus" />
          </button>
        </div>
        {open ? (
          <div
            className="popover ch-pop"
            role="menu"
            aria-label="Add a shortcut"
            ref={pop}
            onKeyDown={popKeys}
          >
            {SHORTCUT_GROUPS.map((group) => {
              const rows = choices.filter((c) => c.group === group);
              return rows.length === 0 ? null : (
                // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border; the label names the group.
                <div key={group} className="ch-pop-group" role="group" aria-label={group}>
                  <div className="grp" aria-hidden="true">
                    {group}
                  </div>
                  {rows.map((c) => (
                    <button
                      key={homeShortcutKey(c.shortcut)}
                      type="button"
                      className="menu-row"
                      role="menuitem"
                      onClick={() => add(c)}
                    >
                      <span>{c.label}</span>
                      {c.meta ? <span className="meta">{c.meta}</span> : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
        <ul className="ch-shortcuts" ref={list}>
          {shortcuts.map((s, i) => {
            const r = resolveShortcut(s, sources);
            const name = label(s);
            return (
              <li
                key={r.key}
                className="ch-shortcut"
                data-key={r.key}
                data-gone={r.state === 'gone' ? 'true' : undefined}
              >
                <span className="line-text">
                  <span className="line-title">{name}</span>
                  <span className="line-meta">
                    {r.state === 'gone' ? 'No longer in your Brain' : KIND_META[s.kind]}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${name} from Home`}
                  data-tip="Remove"
                  onClick={() => remove(s, i)}
                >
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ul>
        {addHint ? (
          <p className="hint ch-add-hint" id={`${uid}-add-hint`}>
            {addHint}
          </p>
        ) : null}
      </section>

      <div className="ch-foot">
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          aria-disabled={hidden.length === 0 ? 'true' : undefined}
          onClick={() => {
            if (hidden.length === 0) return;
            showAllHomeItems();
            setStatus('Every card is back on Home');
          }}
        >
          Show everything again
        </button>
      </div>
      <p className="hint ch-status" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
