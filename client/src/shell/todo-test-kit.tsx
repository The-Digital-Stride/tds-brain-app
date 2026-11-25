/**
 * Test helpers for the to-do panel: a shell that really keeps `todoPanel` (the real reducer, shared by every
 * component in a test), and stand-ins for the editor and the converter, which need a real browser to run.
 * Used with `vi.mock` in `TodoPanel.test.tsx` and `TodosDrawer.*.test.tsx`. Nothing in the app imports it.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_SHELL, shellReducer } from '../state/shell.ts';
import type { TodoDetailsEditorProps } from '../todo-doc/contract.ts';
import type { DockModes, ShellAction, ShellApi, ShellState } from './contract.ts';

let current: ShellState = { ...DEFAULT_SHELL, drawer: 'todos' };
let modes: DockModes = { drawerOverlays: false, panelOverlays: false };
const listeners = new Set<() => void>();
/** Every action the components sent, in order. */
export const sent: ShellAction[] = [];

export const fakeShell = {
  /** A fresh shell with the To-dos drawer open. `overlays`: the drawer floats (narrow window). */
  reset(over: Partial<ShellState> = {}, overlays = false) {
    current = { ...DEFAULT_SHELL, drawer: 'todos', ...over };
    modes = { drawerOverlays: overlays, panelOverlays: false };
    sent.length = 0;
  },
  get state() {
    return current;
  },
  dispatch(action: ShellAction) {
    sent.push(action);
    current = shellReducer(current, action);
    for (const l of listeners) l();
  },
};

/** The to-do tests never hold the right panel. */
const noHold = { dirty: false, asking: false };

/** The fake `useShell`. */
export function useFakeShell(): ShellApi {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return {
    state,
    dispatch: fakeShell.dispatch,
    modes,
    panelHold: noHold,
    guardPanel: (run) => run(),
    sheetHold: noHold,
    guardLeave: (go) => go(),
    onHome: false,
    homeCustomiseOpen: false,
    openCustomiseHome() {},
    closeCustomiseHome() {},
  };
}

/**
 * A stand-in for `TodoDetailsEditor`: edit mode is a text box holding the markdown; read mode shows it as text,
 * with one button per `[ ]` / `[x]` item (so a tick can be pressed).
 */
export function FakeDetailsEditor({
  markdown,
  editable,
  onChange,
  onToggleTask,
  label,
  describedBy,
}: TodoDetailsEditorProps) {
  if (editable) {
    return (
      <textarea
        className="todo-prose"
        aria-label={label}
        aria-describedby={describedBy}
        value={markdown}
        onChange={(e) => onChange?.(e.target.value.trim())}
      />
    );
  }
  const ticks = [...markdown.matchAll(/\[( |x)\]/g)].map((m) => m[1] === 'x');
  return (
    // biome-ignore lint/a11y/useSemanticElements: a stand-in; the real editor is a plain region too.
    <div aria-label={label} aria-describedby={describedBy} role="group">
      <p>{markdown}</p>
      {onToggleTask
        ? ticks.map((on, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list in a test double.
            <button key={i} type="button" onClick={() => onToggleTask(i, !on)}>
              {`Tick ${i + 1}`}
            </button>
          ))
        : null}
    </div>
  );
}

/** The converter's functions, simply: enough for the panel's own rules. "UNFAITHFUL" in the text fails the check. */
export const todoDocFake = {
  todoDocExtensions: () => [],
  toDoc: (markdown: string) => ({ type: 'doc', content: [{ type: 'text', text: markdown }] }),
  toMarkdown: () => '',
  isFaithful: (markdown: string) => !markdown.includes('UNFAITHFUL'),
  countTasks: (markdown: string) => (markdown.match(/\[( |x)\]/g) ?? []).length,
  setTask: (markdown: string, index: number, checked: boolean) => {
    let n = -1;
    return markdown.replace(/\[( |x)\]/g, (m) => {
      n += 1;
      return n === index ? (checked ? '[x]' : '[ ]') : m;
    });
  },
  isSafeHref: (href: string) => /^(https?:|mailto:)/i.test(href),
};
