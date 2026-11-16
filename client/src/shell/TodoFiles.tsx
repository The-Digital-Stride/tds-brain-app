import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  LIBRARY_SEARCH_QUERY,
  type LibrarySearchHit,
  MAX_UPLOAD_BYTES,
  type TeamMember,
  TODO_ATTACHMENTS_MAX,
  TODO_UPLOAD_TYPES,
  type TodoAction,
  type TodoAttachment,
  type TodoItem,
  type TodoList,
} from '../../../shared/contract.ts';
import { api, discardUpload, uploadFile } from '../api.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

/** Said once, before an upload that will land in the person's own files (they never sync). */
export const PERSONAL_UPLOAD_WARNING =
  'This to-do has no client in the brain, so the file saves to your personal files. Only you can open it.';
/** Said once, before a personal file is linked to a to-do the team can read. */
export const PERSONAL_PICK_WARNING =
  'Its name will show on this to-do for the team, but only you can open it.';
const TYPES_SENTENCE =
  'Only PNG, JPG, WebP, GIF, PDF, Word, Excel, PowerPoint, CSV, Markdown and text files can be added.';

const ACCEPT = TODO_UPLOAD_TYPES.map((e) => `.${e}`).join(',');
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** The extension of a file name, lower case, no dot ('' when there is none). */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** The to-do's current record in a list the server returned, by key. */
function find(list: TodoList | undefined, key: string): TodoItem | undefined {
  return list ? [...list.mine, ...list.open].find((t) => t.key === key) : undefined;
}

/** "your personal files", "<Client>'s Files" or "<Client>'s Images"; else the folder a saved path is in. */
function whereWords(path: string, personal: boolean, clients: { slug: string; name: string }[]): string {
  if (personal) return 'your personal files';
  const m = /^clients\/([^/]+)\/(files|images)\//.exec(path);
  if (m) {
    const name = clients.find((c) => c.slug === m[1])?.name ?? (m[1] as string);
    return `${name}'s ${m[2] === 'images' ? 'Images' : 'Files'}`;
  }
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : path;
}

/** What a file row says when the file can't be opened (or is only here), or null for a plain, openable file. */
function quietNote(
  a: TodoAttachment,
  me: string,
  team: TeamMember[],
  todoIsPersonal: boolean,
): string | null {
  if (a.personal) {
    if (a.holder !== null && a.holder !== me) {
      const name = team.find((m) => m.slug === a.holder)?.name ?? a.holder;
      return `Only on ${name.split(/\s+/)[0]}'s Mac`;
    }
    if (a.libraryId === null) return "Can't be found";
    // Mine: it opens, and a teammate who gets this to-do won't have it.
    return todoIsPersonal ? null : 'Only on your Mac';
  }
  return a.libraryId === null ? "Can't be found" : null;
}

export interface TodoFilesProps {
  /** The files linked to the to-do. */
  attachments: TodoAttachment[];
  /** The to-do, when it is mine to change (Add and Remove work on it). Null for a read-only list. */
  todo: TodoItem | null;
  /** TodoList.canAttach (and `todo` is given): Add and Remove are shown. */
  canAttach: boolean;
  /** TodoList.canUpload: Add offers Upload. */
  canUpload: boolean;
  me: string;
  team: TeamMember[];
  /** Another change is running: Add and Remove wait. */
  busy: boolean;
  /** Other lines under the `## Files` heading (a web link, a note), shown as plain text. */
  extras?: string[];
  /** Says a line in the panel's status region. */
  onStatus: (text: string, isError?: boolean) => void;
}

/**
 * The Files block under a to-do's details: the files linked in its `## Files` section, each opening in the
 * file viewer, with Remove and "Add a file" when files can be changed. Plan 2026-11-16-todo-attachments.
 */
export function TodoFiles(props: TodoFilesProps) {
  const { attachments, todo, canAttach, me, team, onStatus } = props;
  const extras = props.extras ?? [];
  const change = canAttach && todo !== null;
  const { changeTodos } = useStore();
  const { dispatch } = useShell();
  const headId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [working, setWorking] = useState(false);
  const busy = props.busy || working;

  if (attachments.length === 0 && extras.length === 0 && !change) return null;

  const open = async (a: TodoAttachment) => {
    if (a.libraryId === null) return;
    try {
      const { files } = await api.libraryItems([a.libraryId]);
      const f = files[0];
      if (!f) return onStatus("Couldn't open that file. It may have moved.", true);
      dispatch({
        type: 'open-viewer',
        viewer: {
          item: f.item,
          place: f.scope.name,
          openIn: { app: f.item.kind === 'image' ? 'images' : 'documents', scope: f.scope.id },
        },
      });
    } catch {
      onStatus("Couldn't open that file. Please try again.", true);
    }
  };

  const remove = async (a: TodoAttachment) => {
    if (!change || busy) return;
    setWorking(true);
    const r = await changeTodos([
      {
        kind: 'detach',
        id: todo.id,
        path: a.path,
        expect: todo.version,
        ...(todo.scope === 'personal' ? { scope: 'personal' as const } : {}),
      },
    ]);
    setWorking(false);
    if (r.error) onStatus(r.error.message, true);
    else onStatus(`Removed ${a.name} from this to-do. The file is still in the library.`);
    // The row is gone: keep the keyboard in the block.
    requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
  };

  return (
    <section className="todo-files" aria-labelledby={headId}>
      <h3 className="todo-files-head" id={headId} ref={headRef} tabIndex={-1}>
        Files
      </h3>
      {attachments.length === 0 ? (
        extras.length === 0 ? (
          <p className="todo-empty">No files yet.</p>
        ) : null
      ) : (
        <ul className="todo-files-list">
          {attachments.map((a) => {
            const note = quietNote(a, me, team, todo?.scope === 'personal');
            const openable = a.libraryId !== null && !(a.personal && a.holder !== null && a.holder !== me);
            return (
              <li key={a.path} className="todo-file">
                <Icon name={a.kind === 'image' ? 'image' : 'doc'} size={16} />
                {openable ? (
                  <button type="button" className="todo-file-open" onClick={() => void open(a)}>
                    {a.name}
                  </button>
                ) : (
                  <span className="todo-file-name">{a.name}</span>
                )}
                {note ? <span className="todo-file-note">{note}</span> : null}
                {change ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${a.name} from this to-do`}
                    data-tip="Remove from this to-do. The file stays in the library."
                    aria-disabled={busy ? true : undefined}
                    onClick={() => void remove(a)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {extras.length > 0 ? (
        <ul className="todo-files-extras">
          {extras.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines can repeat and never reorder.
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {change ? (
        <AddFile
          {...props}
          todo={todo}
          busy={busy}
          addButton={addButton}
          headRef={headRef}
          setWorking={setWorking}
          atMax={attachments.length >= TODO_ATTACHMENTS_MAX}
        />
      ) : null}
    </section>
  );
}

type Step = 'closed' | 'choose' | 'library' | 'confirm';

function AddFile({
  todo,
  attachments,
  canUpload,
  busy,
  onStatus,
  addButton,
  headRef,
  setWorking,
  atMax,
}: TodoFilesProps & {
  todo: TodoItem;
  addButton: React.RefObject<HTMLButtonElement | null>;
  headRef: React.RefObject<HTMLHeadingElement | null>;
  setWorking: (on: boolean) => void;
  atMax: boolean;
}) {
  const { changeTodos, uploadTodoFile, boot } = useStore();
  const [step, setStep] = useState<Step>('closed');
  const [pending, setPending] = useState<File[]>([]);
  const [pendingPicks, setPendingPicks] = useState<LibrarySearchHit[]>([]);
  const [pendingProblems, setPendingProblems] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  // One ask per panel for each kind: agreeing to link a personal file isn't agreeing to upload to one.
  const warnedUpload = useRef(false);
  const warnedPick = useRef(false);
  const uid = useId();
  const scope = todo.scope === 'personal' ? { scope: 'personal' as const } : {};

  /** Focus goes to Add a file, or to the Files heading when that button isn't shown. */
  const focusAdd = () =>
    requestAnimationFrame(() => {
      // Only when the person hasn't moved on: focus is nowhere, or still in this Files block.
      const at = document.activeElement;
      const block = (addButton.current ?? headRef.current)?.closest('.todo-files');
      if (at && at !== document.body && !(block?.contains(at) ?? false)) return;
      (addButton.current ?? headRef.current)?.focus({ preventScroll: true });
    });
  const close = () => {
    setStep('closed');
    setPending([]);
    setPendingPicks([]);
    setPendingProblems([]);
    focusAdd();
  };

  // A TDS to-do goes to a client's folder only when its trimmed `client` is exactly a client in the brain
  // (the rule `todoChatClient` uses); otherwise the server files it under personal/.
  const clientSlug = (todo.client ?? '').trim();
  const goesPersonal = todo.scope === 'tds' && !(boot?.clients ?? []).some((c) => c.slug === clientSlug);

  /** Links library files one after another. Each step carries the version the one before left. */
  const attach = async (picks: LibrarySearchHit[]) => {
    setWorking(true);
    setStep('closed');
    focusAdd();
    const actions: TodoAction[] = picks.map((h, i) => ({
      kind: 'attach',
      id: todo.id,
      path: h.item.path,
      ...(i === 0 ? { expect: todo.version } : {}),
      ...scope,
    }));
    const r = await changeTodos(actions);
    setWorking(false);
    if (!r.error) {
      const first = picks[0]?.item.name ?? 'file';
      onStatus(picks.length === 1 ? `Added ${first}.` : `Added ${picks.length} files.`);
    } else {
      const failed = picks[r.done]?.item.name;
      const named = failed ? ` "${failed}" couldn't be added: ` : ' ';
      onStatus(
        picks.length > 1 && r.done > 0
          ? `${r.done} of ${picks.length} added.${named}${r.error.message}`
          : `${failed ? `"${failed}" couldn't be added: ` : ''}${r.error.message}`,
        true,
      );
    }
    close();
  };

  /** Uploads files one at a time, each linked to the to-do before the next goes up. */
  const upload = async (files: File[], problems: string[] = []) => {
    setWorking(true);
    focusAdd();
    const rejected = problems.length > 0 ? ` ${problems.join(' ')}` : '';
    let version = todo.version;
    const saved: { path: string; personal: boolean }[] = [];
    let failure: { name: string; message: string } | null = null;
    for (const [i, file] of files.entries()) {
      onStatus(files.length === 1 ? `Adding ${file.name}…` : `Adding ${i + 1} of ${files.length}…`);
      let uploadId: string | null = null;
      try {
        const info = await uploadFile(file, file.name);
        uploadId = info.id;
        const res = await uploadTodoFile({ upload: info.id, id: todo.id, ...scope, expect: version });
        if (!res.ok) {
          failure = { name: file.name, message: res.error.message };
          void discardUpload(info.id);
          break;
        }
        saved.push({ path: res.path, personal: res.personal });
        const fresh = find(res.todos, todo.key)?.version;
        if (!fresh && file !== files[files.length - 1]) {
          failure = {
            name: files[saved.length]?.name ?? file.name,
            message: 'This to-do is no longer in your list, so the rest were not added.',
          };
          break;
        }
        if (fresh) version = fresh;
      } catch (err) {
        if (uploadId) void discardUpload(uploadId);
        failure = {
          name: file.name,
          message: err instanceof Error ? err.message : 'The file could not be sent.',
        };
        break;
      }
    }
    setWorking(false);
    const last = saved[saved.length - 1];
    const wheres = new Set(saved.map((s) => whereWords(s.path, s.personal, boot?.clients ?? [])));
    const where = last && wheres.size === 1 ? ` Saved in ${[...wheres][0]}.` : '';
    const added =
      saved.length === 1 && last
        ? `Added ${last.path.split('/').pop()}.${where}`
        : `Added ${saved.length} files.${where}`;
    if (failure) {
      const fail = `"${failure.name}" couldn't be added: ${failure.message}`;
      onStatus(
        `${saved.length > 0 ? `${saved.length} of ${files.length} added. ${fail}` : fail}${rejected}`,
        true,
      );
    } else onStatus(`${added}${rejected}`);
    close();
  };

  /** Checks type and size, then asks once about personal files, then uploads. */
  const choose = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (fileInput.current) fileInput.current.value = '';
    if (files.length === 0) return;
    const ok: File[] = [];
    const problems: string[] = [];
    for (const f of files) {
      if (!TODO_UPLOAD_TYPES.includes(extOf(f.name)))
        problems.push(`"${f.name}" wasn't added: that type can't be added.`);
      else if (f.size > MAX_UPLOAD_BYTES) problems.push(`"${f.name}" wasn't added: it is over ${MAX_MB} MB.`);
      else ok.push(f);
    }
    if (problems.some((p) => p.includes('that type'))) problems.push(TYPES_SENTENCE);
    if (ok.length === 0) {
      if (problems.length > 0) onStatus(problems.join(' '), true);
      return close();
    }
    if (attachments.length + ok.length > TODO_ATTACHMENTS_MAX) {
      onStatus(`A to-do can hold up to ${TODO_ATTACHMENTS_MAX} files.`, true);
      return close();
    }
    if (goesPersonal && !warnedUpload.current) {
      setPending(ok);
      setPendingProblems(problems);
      setStep('confirm');
      return;
    }
    setStep('closed');
    void upload(ok, problems);
  };

  /** Library picks: a personal file on a team to-do is asked about once first. */
  const pick = (picks: LibrarySearchHit[]) => {
    if (
      todo.scope === 'tds' &&
      !warnedPick.current &&
      picks.some((h) => h.item.path.startsWith('personal/'))
    ) {
      setPendingPicks(picks);
      setStep('confirm');
      return;
    }
    void attach(picks);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || step === 'closed') return;
    // One Esc closes the picker, not the panel.
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only listens for Esc bubbling from its own buttons and fields.
    <div className="todo-addfile" onKeyDown={onKeyDown}>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Choose files to upload"
        onChange={(e) => choose(e.target.files)}
      />
      {step === 'closed' ? (
        atMax ? (
          <p className="todo-note">This to-do has the most files it can hold.</p>
        ) : (
          <button
            type="button"
            className="btn"
            data-size="small"
            ref={addButton}
            aria-disabled={busy ? true : undefined}
            aria-expanded={false}
            onClick={() => {
              if (!busy) setStep('choose');
            }}
          >
            <Icon name="plus" size={14} />
            Add a file
          </button>
        )
      ) : (
        // The button stays in the page (so focus has somewhere to return to) while its choices show.
        <button
          type="button"
          className="btn"
          data-size="small"
          ref={addButton}
          aria-expanded={true}
          onClick={close}
        >
          <Icon name="plus" size={14} />
          Add a file
        </button>
      )}
      {step === 'choose' ? (
        <div className="todo-addfile-choices">
          <button type="button" className="btn" data-size="small" onClick={() => setStep('library')}>
            From the library
          </button>
          {canUpload ? (
            <button
              type="button"
              className="btn"
              data-size="small"
              onClick={() => fileInput.current?.click()}
            >
              Upload
            </button>
          ) : null}
        </div>
      ) : null}
      {step === 'confirm' ? (
        <fieldset className="todo-ask">
          <legend className="todo-ask-q" id={`${uid}-warn`}>
            {pendingPicks.length > 0 ? PERSONAL_PICK_WARNING : PERSONAL_UPLOAD_WARNING}
          </legend>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="small"
            // biome-ignore lint/a11y/noAutofocus: the question has just appeared; the answer is next.
            autoFocus
            onClick={() => {
              const files = pending;
              const picks = pendingPicks;
              if (files.length > 0) warnedUpload.current = true;
              if (picks.length > 0) warnedPick.current = true;
              const problems = pendingProblems;
              setPending([]);
              setPendingPicks([]);
              setPendingProblems([]);
              setStep('closed');
              if (picks.length > 0) void attach(picks);
              else void upload(files, problems);
            }}
          >
            Continue
          </button>
          <button type="button" className="btn" data-size="small" onClick={close}>
            Cancel
          </button>
        </fieldset>
      ) : null}
      {step === 'library' ? (
        <LibraryPicker
          linked={new Set(attachments.map((a) => a.path))}
          room={TODO_ATTACHMENTS_MAX - attachments.length}
          onAdd={pick}
          onCancel={close}
        />
      ) : null}
    </div>
  );
}

/** A search over the library's images and documents; tick one or several, then add them. */
function LibraryPicker({
  linked,
  room,
  onAdd,
  onCancel,
}: {
  linked: Set<string>;
  room: number;
  onAdd: (picks: LibrarySearchHit[]) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LibrarySearchHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Map<string, LibrarySearchHit>>(new Map());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const term = q.trim();
  const ready = term.length >= LIBRARY_SEARCH_QUERY.min;
  // Search as the person types, after a short pause. A newer search makes an older answer stale.
  useEffect(() => {
    setHits(null);
    setFailed(false);
    if (!ready) return;
    let current = true;
    const timer = setTimeout(() => {
      Promise.all([api.librarySearch(term, 'image'), api.librarySearch(term, 'document')]).then(
        ([a, b]) => {
          if (!current) return;
          setFailed(false);
          setHits([...b.hits, ...a.hits]);
        },
        () => {
          if (!current) return;
          setFailed(true);
          setHits(null);
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, ready]);

  const toggle = (hit: LibrarySearchHit) =>
    setPicked((p) => {
      const next = new Map(p);
      if (next.has(hit.item.path)) next.delete(hit.item.path);
      else if (next.size < room) next.set(hit.item.path, hit);
      return next;
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (picked.size > 0) onAdd([...picked.values()]);
  };

  return (
    <form className="todo-picker" onSubmit={submit} aria-label="Add files from the library">
      <label htmlFor={`${uid}-q`} className="todo-label">
        Search the library
      </label>
      <input
        id={`${uid}-q`}
        ref={input}
        type="search"
        className="field"
        value={q}
        placeholder="Name of an image or document"
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="todo-picker-results" role="status">
        {failed ? (
          <p className="todo-note">Couldn't search the library. Please try again.</p>
        ) : !ready ? (
          <p className="todo-note">Type at least {LIBRARY_SEARCH_QUERY.min} letters.</p>
        ) : hits === null ? (
          <p className="todo-note">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="todo-note">Nothing found.</p>
        ) : (
          <p className="todo-note">{hits.length} found</p>
        )}
      </div>
      {picked.size > 0 ? (
        <div className="todo-picker-chosen">
          <span className="todo-label">Chosen:</span>
          <ul className="todo-picker-list" aria-label="Chosen files">
            {[...picked.values()].map((h) => (
              <li key={h.item.path}>
                <span className="todo-picker-name">{h.item.title || h.item.name}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${h.item.title || h.item.name} from the chosen files`}
                  onClick={() => toggle(h)}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hits && hits.length > 0 ? (
        <ul className="todo-picker-list" aria-label="Files found">
          {hits.map((h) => {
            const already = linked.has(h.item.path);
            const id = `${uid}-${h.item.id}`;
            return (
              <li key={h.item.id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={already || picked.has(h.item.path)}
                  disabled={already || (!picked.has(h.item.path) && picked.size >= room)}
                  onChange={() => toggle(h)}
                />
                <label htmlFor={id}>
                  <Icon name={h.item.kind === 'image' ? 'image' : 'doc'} size={14} />
                  <span className="todo-picker-name">{h.item.title || h.item.name}</span>
                  <span className="todo-file-note">{already ? 'Already added' : h.scope.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="todo-actions">
        <button
          type="submit"
          className="btn"
          data-variant="primary"
          data-size="small"
          disabled={picked.size === 0}
        >
          {picked.size > 1 ? `Add ${picked.size} files` : 'Add file'}
        </button>
        <button type="button" className="btn" data-size="small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
