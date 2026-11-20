// Brings the editor's commands (setHeading, toggleBold, setLink, toggleTaskList, ...) into the types.
import '@tiptap/extension-list';
import '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { KEPT_LINK } from '../todo-doc/extensions.ts';
import {
  isSafeHref,
  type TodoDetailsEditorProps,
  type ToolbarAction,
  toDoc,
  todoDocExtensions,
  toMarkdown,
} from '../todo-doc/index.ts';
import type { IconName } from './contract.ts';
import { Icon } from './Icon.tsx';

/** The words and icons of the toolbar (plan decision 5). Ticks reuses the to-do list icon. */
const TOOLS: { action: ToolbarAction; label: string; icon: IconName }[] = [
  { action: 'heading', label: 'Heading', icon: 'heading' },
  { action: 'body', label: 'Body text', icon: 'body' },
  { action: 'bullets', label: 'Bullet list', icon: 'bullets' },
  { action: 'numbers', label: 'Numbered list', icon: 'numbers' },
  { action: 'ticks', label: 'Tick list', icon: 'todos' },
  { action: 'bold', label: 'Bold', icon: 'bold' },
  { action: 'link', label: 'Link', icon: 'link' },
];

/** The tick boxes the editor makes, one per task item. */
const TICK_BOX = 'li[data-checked] input[type="checkbox"]';

/** "example.com" is meant as a web address: give it a scheme so it can be a link. */
function withScheme(raw: string): string {
  const text = raw.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
}

/**
 * The to-do details, formatted: read mode (`editable` false) and edit mode share one Tiptap document, so what
 * is read is what is edited. The document exists only on screen; every change goes out as markdown through
 * `onChange` (the converter in `client/src/todo-doc` writes unchanged blocks back byte for byte).
 */
export default function TodoDetailsEditor({
  markdown,
  editable,
  onChange,
  onToggleTask,
  pending = false,
  label,
  describedBy,
}: TodoDetailsEditorProps) {
  const uid = useId();
  // Each tick box is named by its item's text (Tiptap's default label says nothing about the item).
  const extensions = useMemo(
    () =>
      todoDocExtensions().map((ext) =>
        ext.name === 'taskItem'
          ? ext.configure({
              a11y: {
                checkboxLabel: (node: ProseMirrorNode) => node.textContent.trim() || 'Empty tick item',
              },
            })
          : ext,
      ),
    [],
  );
  // What the document says now, as markdown: a `markdown` prop equal to it is our own change coming back.
  const current = useRef(markdown);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const box = useRef<HTMLDivElement>(null);

  // Only the first document is needed here (later changes come in through setContent below), so the details
  // are not read again on every keystroke.
  const [initialDoc] = useState(() => toDoc(markdown));
  const editor = useEditor({
    extensions,
    content: initialDoc,
    editable,
    // Tiptap's own style tag is blocked by the app's content security policy; todo-panel.css carries its rules.
    injectCSS: false,
    editorProps: {
      attributes: {
        class: 'todo-prose',
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        // The editor's own role is a textbox; reading is not typing.
        ...(editable ? { role: 'textbox', 'aria-multiline': 'true' } : { role: 'group' }),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = toMarkdown(ed.getJSON());
      current.current = next;
      onChangeRef.current?.(next);
    },
  });

  // A version from outside (another person's change, a saved tick) replaces the document. A tick box that had
  // focus keeps it: the boxes are made again, and focus would otherwise drop to the page.
  useEffect(() => {
    if (!editor || markdown === current.current) return;
    current.current = markdown;
    const boxes = () => [...(box.current?.querySelectorAll<HTMLInputElement>(TICK_BOX) ?? [])];
    const focused = document.activeElement;
    const at = focused instanceof HTMLInputElement ? boxes().indexOf(focused) : -1;
    editor.commands.setContent(toDoc(markdown), { emitUpdate: false });
    if (at >= 0 && !focused?.isConnected) boxes()[at]?.focus({ preventScroll: true });
  }, [markdown, editor]);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
    editor?.setOptions({
      editorProps: {
        attributes: {
          class: 'todo-prose',
          'aria-label': label,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          // The editor's own role is a textbox; reading is not typing.
          ...(editable ? { role: 'textbox', 'aria-multiline': 'true' } : { role: 'group' }),
        },
      },
    });
  }, [editor, editable, label, describedBy]);

  // A tick box that can't be pressed (reading, with no way to save a tick) is disabled, so it isn't offered. The
  // editor makes the boxes itself, so they are set after each change to the document.
  const tickable = editable || onToggleTask !== undefined;
  const busy = !editable && pending;
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      // `editor.view` throws until the editor is mounted (and after it is destroyed), so wait for 'create'.
      if (editor.isDestroyed) return;
      let dom: HTMLElement;
      try {
        dom = editor.view.dom;
      } catch {
        return;
      }
      for (const box of dom.querySelectorAll<HTMLInputElement>(TICK_BOX)) {
        box.disabled = !tickable;
        // While a tick saves the boxes stay focusable (a disabled box would drop focus) but can't be pressed.
        if (busy) box.setAttribute('aria-disabled', 'true');
        else box.removeAttribute('aria-disabled');
      }
    };
    const later = () => queueMicrotask(sync);
    sync();
    editor.on('create', later);
    editor.on('transaction', later);
    return () => {
      editor.off('create', later);
      editor.off('transaction', later);
    };
  }, [editor, tickable, busy]);

  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      heading: ed?.isActive('heading') ?? false,
      bullets: ed?.isActive('bulletList') ?? false,
      numbers: ed?.isActive('orderedList') ?? false,
      ticks: ed?.isActive('taskList') ?? false,
      bold: ed?.isActive('bold') ?? false,
      link: ed?.isActive('link') ?? false,
      href: (ed?.getAttributes('link').href as string | undefined) ?? '',
    }),
  });

  // The link field: no browser prompt, a small inline field instead.
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState('');
  const hrefRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (linking) hrefRef.current?.focus();
  }, [linking]);
  const closeLink = () => {
    setLinking(false);
    setLinkError('');
    editor?.commands.focus();
  };

  const run = (action: ToolbarAction) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (action) {
      case 'heading':
        // One toggle: it makes a heading of level 2 and leaves an existing heading at its level.
        if (!editor.isActive('heading')) chain.setHeading({ level: 2 }).run();
        return;
      case 'body':
        if (editor.isActive('taskList')) chain.liftListItem('taskItem').setParagraph().run();
        else if (editor.isActive('bulletList') || editor.isActive('orderedList'))
          chain.liftListItem('listItem').setParagraph().run();
        else chain.setParagraph().run();
        return;
      case 'bullets':
        chain.toggleBulletList().run();
        return;
      case 'numbers':
        chain.toggleOrderedList().run();
        return;
      case 'ticks':
        chain.toggleTaskList().run();
        return;
      case 'bold':
        chain.toggleBold().run();
        return;
      case 'link':
        setHref(active.href);
        setLinkError('');
        setLinking(true);
        return;
    }
  };

  const applyLink = () => {
    if (!editor) return;
    const text = href.trim();
    if (text === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return closeLink();
    }
    const target = withScheme(text);
    if (!isSafeHref(target)) {
      setLinkError('Links can start with http, https or mailto.');
      return;
    }
    // A brain-path link shown as text (decision 14) gives way to the web link, once the address is accepted.
    editor
      .chain()
      .focus()
      .extendMarkRange(KEPT_LINK)
      .unsetMark(KEPT_LINK)
      .extendMarkRange('link')
      .setLink({ href: target })
      .run();
    closeLink();
  };
  // Not a form: this sits inside the panel's own form, and forms can't nest.
  const linkKeys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Closes the field only: the panel stays open.
      e.preventDefault();
      e.stopPropagation();
      closeLink();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    }
  };

  // Read mode: a tick item is pressed. The document is not changed here: the parent saves and the new
  // markdown comes back, so a refused tick leaves the box as it was.
  const onTickClick = (e: React.MouseEvent) => {
    if (editable || !onToggleTask) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const item = target.closest('li[data-checked]');
    if (!item || !box.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const items = [...box.current.querySelectorAll('li[data-checked]')];
    const index = items.indexOf(item);
    if (index < 0) return;
    onToggleTask(index, item.getAttribute('data-checked') !== 'true');
  };

  // The toolbar is one tab stop; Left and Right (and Home and End) move along it (WAI-ARIA toolbar pattern).
  const [rove, setRove] = useState(0);
  const toolbar = useRef<HTMLDivElement>(null);
  const toolbarKeys = (e: KeyboardEvent) => {
    const at = TOOLS.findIndex((t) => t.label === (e.target as HTMLElement).getAttribute('aria-label'));
    if (at < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const to =
      e.key === 'ArrowRight'
        ? (at + 1) % TOOLS.length
        : e.key === 'ArrowLeft'
          ? (at + TOOLS.length - 1) % TOOLS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TOOLS.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    setRove(to);
    toolbar.current?.querySelectorAll<HTMLButtonElement>('button')[to]?.focus();
  };

  const pressed: Record<ToolbarAction, boolean> = {
    heading: active.heading,
    body: false,
    bullets: active.bullets,
    numbers: active.numbers,
    ticks: active.ticks,
    bold: active.bold,
    link: active.link,
  };

  return (
    <div
      className="todo-details"
      data-editable={editable ? 'true' : 'false'}
      data-pending={busy ? 'true' : undefined}
    >
      {editable ? (
        <div
          className="todo-toolbar"
          role="toolbar"
          aria-label="Formatting"
          aria-orientation="horizontal"
          ref={toolbar}
          onKeyDown={toolbarKeys}
        >
          {TOOLS.map((t, i) => (
            <button
              key={t.action}
              type="button"
              className="icon-btn"
              aria-label={t.label}
              tabIndex={i === rove ? 0 : -1}
              onFocus={() => setRove(i)}
              aria-pressed={t.action === 'body' ? undefined : pressed[t.action]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t.action)}
            >
              <Icon name={t.icon} size={16} />
            </button>
          ))}
        </div>
      ) : null}
      {editable && linking ? (
        <fieldset className="todo-link" onKeyDown={linkKeys}>
          <legend className="visually-hidden">Link</legend>
          <label htmlFor={`${uid}-href`} className="visually-hidden">
            Web address
          </label>
          <input
            id={`${uid}-href`}
            ref={hrefRef}
            className="field"
            value={href}
            placeholder="Web address"
            aria-describedby={linkError ? `${uid}-err` : undefined}
            onChange={(e) => {
              setHref(e.target.value);
              setLinkError('');
            }}
          />
          <button type="button" className="btn" data-variant="primary" data-size="small" onClick={applyLink}>
            Apply
          </button>
          <button type="button" className="btn" data-size="small" onClick={closeLink}>
            Cancel
          </button>
          {linkError ? (
            <p className="todo-note" id={`${uid}-err`} role="alert">
              {linkError}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {/* A click on a tick box in read mode is caught here, before the editor can toggle it itself. */}
      <div className="todo-prose-box" ref={box} onClickCapture={onTickClick}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
