import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ManualUpdateKind, ProjectUpdateItem } from '../../../../shared/project-updates-contract.ts';
import { UPDATE_SUMMARY_MAX } from '../../../../shared/project-updates-contract.ts';
import type { ProjectCard } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { Markdown } from '../../markdown.tsx';
import { Confirm } from '../../shell/Confirm.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { dateWords, READ_ONLY_NOTICE } from './logic.ts';
import { useProjectChange } from './useChange.ts';
import { useKeepFocus } from './useKeepFocus.ts';

const KIND_WORDS: Record<string, string> = {
  note: 'Note',
  call: 'Call',
  status: 'Status',
  owner: 'Account Owner',
};

/** "Note", "Call", "Status", "Account Owner"; any other kind by its name, capitalised. */
export function kindWords(kind: string): string {
  return KIND_WORDS[kind] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Update');
}

/** "23 Nov 2026, 14:05" (UK, this Mac's clock); the text as written when it can't be read. */
export function whenWords(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${dateWords(at)}, ${time}`;
}

export const deleteWords = (personal: boolean): string =>
  personal
    ? "Delete this update? It can't be brought back."
    : "Delete this update? It will still be in the brain's history.";

interface Page {
  updates: ProjectUpdateItem[];
  more: boolean;
  unreadable: number;
  canAdd: boolean;
}

const ADD_BUTTON = '[data-focus="addupdate"]';

/**
 * The project's updates log, newest first, with a way to add a note or call and to delete one's own.
 * The add form's button sits at the end of the tabs row (ProjectPage), so `adding` lives there; `onCanAdd` tells the
 * page whether the button should show.
 */
export function ProjectUpdates({
  card,
  canChange,
  adding,
  onAdding,
  onCanAdd,
}: {
  card: ProjectCard;
  canChange: boolean;
  adding: boolean;
  onAdding: (open: boolean) => void;
  onCanAdd: (can: boolean) => void;
}) {
  const change = useProjectChange({ reloadOnChanged: true });
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ManualUpdateKind>('note');
  const [clientSafe, setClientSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  // "Write the update first." belongs to the textarea; a save failure from the server is the form's.
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeMessage, setRemoveMessage] = useState('');
  const textId = useId();
  const errorId = useId();
  const kindLabel = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dirty = adding && text.trim() !== '';
  const leave = useSheetHold(dirty);
  const keepFocus = useKeepFocus();
  const personal = card.space === 'personal';
  const liveKey = useRef(card.key);
  liveKey.current = card.key;

  const load = useCallback(async () => {
    const key = card.key;
    try {
      const r = await api.projectUpdates(key);
      if (liveKey.current !== key) return;
      setPage({ updates: r.updates, more: r.more, unreadable: r.unreadable, canAdd: r.canAdd });
      setFailed(false);
    } catch {
      if (liveKey.current === key) setFailed(true);
    }
  }, [card.key]);

  useEffect(() => {
    setPage(null);
    setFailed(false);
    void load();
  }, [load]);

  const canAdd = page?.canAdd === true;
  useEffect(() => {
    onCanAdd(canAdd);
    return () => onCanAdd(false);
  }, [canAdd, onCanAdd]);

  const older = async () => {
    if (!page || moreBusy || page.updates.length === 0) return;
    setMoreBusy(true);
    setMoreFailed(false);
    try {
      const before = page.updates[page.updates.length - 1]?.path;
      const r = await api.projectUpdates(card.key, before);
      setPage((p) =>
        p ? { ...p, updates: [...p.updates, ...r.updates], more: r.more, unreadable: r.unreadable } : p,
      );
    } catch {
      setMoreFailed(true);
    }
    setMoreBusy(false);
  };

  const focusAdd = () =>
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(ADD_BUTTON)?.focus();
    });

  const close = () => {
    setText('');
    setKind('note');
    setClientSafe(false);
    setFieldError('');
    setMessage('');
    setAsking(false);
    onAdding(false);
  };
  const cancel = () => {
    if (leave.asking) leave.keep();
    if (dirty) setAsking(true);
    else {
      close();
      focusAdd();
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const summary = text.trim();
    if (!summary) {
      setFieldError('Write the update first.');
      textRef.current?.focus();
      return;
    }
    setBusy(true);
    setFieldError('');
    setMessage('');
    const res = await change({ kind: 'update', key: card.key, entry: { kind, summary, clientSafe } });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    close();
    await load();
    focusAdd();
  };

  const remove = async (item: ProjectUpdateItem) => {
    if (removeBusy) return;
    setRemoveBusy(true);
    setRemoveMessage('');
    const res = await change({ kind: 'update-remove', key: card.key, file: item.path, expect: item.version });
    setRemoveBusy(false);
    if (!res.ok) {
      setRemoveMessage(res.message);
      setRemoving(null);
      await load();
      return;
    }
    setRemoving(null);
    await load();
    // The row is gone: put the keyboard on the card heading, or the Add button when the card goes too.
    requestAnimationFrame(() => {
      if (headingRef.current) headingRef.current.focus();
      else document.querySelector<HTMLButtonElement>(ADD_BUTTON)?.focus();
    });
  };

  /** Back on the row's Delete button after Cancel (the Confirm replaced the row's strip). */
  const focusDelete = (path: string) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-delete="${CSS.escape(path)}"]`)?.focus(),
    );

  if (failed && !page)
    return (
      <StateNote kind="error" onRetry={() => void load()}>
        The updates can't be loaded right now.
      </StateNote>
    );
  if (!page) return <StateNote kind="loading">Loading updates…</StateNote>;

  const notice = card.archived
    ? "Archived projects can't take new updates."
    : card.card !== 'ok' || !canChange || page.canAdd
      ? null
      : READ_ONLY_NOTICE;

  return (
    <>
      {notice ? <p className="proj-note">{notice}</p> : null}
      {adding && page.canAdd ? (
        <form
          className="card proj-card proj-form proj-update-form"
          aria-label="Add an update"
          onSubmit={(e) => void submit(e)}
          onFocus={keepFocus.track}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.defaultPrevented || !dirty) return;
            // Typed work: Esc asks, and asking again keeps it. While a leave question shows, Esc keeps editing.
            e.preventDefault();
            e.stopPropagation();
            if (leave.asking) {
              leave.keep();
              keepFocus.restore();
            } else {
              setAsking(!asking);
              if (asking) keepFocus.restore();
            }
          }}
        >
          {asking || leave.asking ? (
            <Confirm
              label="Discard your changes"
              text="Discard your changes?"
              action="Discard changes"
              safe="Keep editing"
              variant="danger"
              busy={false}
              key={leave.asking ? 'leave' : 'cancel'}
              onConfirm={() => {
                if (leave.asking) leave.discard();
                close();
                focusAdd();
              }}
              onCancel={() => {
                if (leave.asking) leave.keep();
                setAsking(false);
                keepFocus.restore();
              }}
            />
          ) : null}
          <div className="form-field">
            <label htmlFor={textId}>Update</label>
            <textarea
              ref={textRef}
              id={textId}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              className="field proj-area"
              rows={3}
              value={text}
              maxLength={UPDATE_SUMMARY_MAX}
              onChange={(e) => {
                setText(e.target.value);
                if (fieldError) setFieldError('');
              }}
              // biome-ignore lint/a11y/noAutofocus: the person just pressed Add an update.
              autoFocus
            />
            {fieldError ? (
              <p className="error" role="alert" id={errorId}>
                {fieldError}
              </p>
            ) : null}
          </div>
          <div className="form-field">
            <span className="label" id={kindLabel}>
              Kind
            </span>
            <Seg
              label="Kind"
              labelledBy={kindLabel}
              value={kind}
              options={[
                { value: 'note', label: kindWords('note') },
                { value: 'call', label: kindWords('call') },
              ]}
              onChange={setKind}
            />
          </div>
          <label className="proj-check">
            <input
              type="checkbox"
              className="tick"
              checked={clientSafe}
              onChange={(e) => setClientSafe(e.target.checked)}
            />
            Fine to share with the client
          </label>
          {message ? (
            <p className="error" role="alert">
              {message}
            </p>
          ) : null}
          <div className="proj-buttons">
            <button type="submit" className="btn" data-variant="primary" aria-disabled={busy || undefined}>
              Add an update
            </button>
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {page.unreadable > 0 ? (
        <p className="notice" data-level="warn" data-shape="box" role="status">
          {page.unreadable === 1
            ? "1 update couldn't be read."
            : `${page.unreadable} updates couldn't be read.`}
        </p>
      ) : null}
      {removeMessage ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {removeMessage}
        </p>
      ) : null}
      {page.updates.length === 0 ? (
        <StateNote kind="empty">No updates yet.</StateNote>
      ) : (
        <div className="tray lib-tray">
          <section className="card proj-card" aria-label="Updates">
            <div className="card-head">
              <h3 ref={headingRef} tabIndex={-1}>
                Updates
              </h3>
            </div>
            <ul className="lib-list" ref={listRef}>
              {page.updates.map((u) => (
                <li key={u.path} className="proj-update-item">
                  <div className="line proj-update">
                    <div className="proj-update-body">
                      <div className="proj-update-head">
                        <span className="line-title">{u.byName}</span>
                        <span className="line-meta">{whenWords(u.at)}</span>
                        <span className="chip">{kindWords(u.kind)}</span>
                        {u.clientSafe ? <span className="chip">Fine to share with the client</span> : null}
                        {u.fromOldFolder ? <span className="chip">From the old folder</span> : null}
                      </div>
                      <Markdown text={u.summary} />
                    </div>
                    {u.canRemove ? (
                      <button
                        type="button"
                        className="icon-btn"
                        data-delete={u.path}
                        data-tip="Delete update"
                        aria-label={`Delete update: ${whenWords(u.at)}`}
                        onClick={() => {
                          setRemoveMessage('');
                          setRemoving(u.path);
                        }}
                      >
                        <Icon name="bin" size={14} />
                      </button>
                    ) : null}
                  </div>
                  {u.canRemove && removing === u.path ? (
                    <Confirm
                      label="Delete this update"
                      text={deleteWords(personal)}
                      action="Delete update"
                      variant="danger"
                      busy={removeBusy}
                      onConfirm={() => void remove(u)}
                      onCancel={() => {
                        setRemoving(null);
                        focusDelete(u.path);
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {page.more ? (
        <div className="proj-buttons">
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            aria-disabled={moreBusy || undefined}
            onClick={() => void older()}
          >
            Show older
          </button>
          {moreFailed ? (
            <span className="error" role="alert">
              Couldn't load older updates.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
