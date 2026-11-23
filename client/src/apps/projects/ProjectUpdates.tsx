import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ManualUpdateKind, ProjectUpdateItem } from '../../../../shared/project-updates-contract.ts';
import { UPDATE_SUMMARY_MAX } from '../../../../shared/project-updates-contract.ts';
import type { ProjectCard } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { Markdown } from '../../markdown.tsx';
import { Confirm } from '../../shell/Confirm.tsx';
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

export const removeWords = (personal: boolean): string =>
  personal
    ? "Remove this update? It can't be brought back."
    : "Remove this update? It will still be in the brain's history.";

interface Page {
  updates: ProjectUpdateItem[];
  more: boolean;
  unreadable: number;
  canAdd: boolean;
}

/** The project's updates log, newest first, with a way to add a note or call and to remove one's own. */
export function ProjectUpdates({ card, canChange }: { card: ProjectCard; canChange: boolean }) {
  const change = useProjectChange({ reloadOnChanged: true });
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ManualUpdateKind>('note');
  const [clientSafe, setClientSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeMessage, setRemoveMessage] = useState('');
  const textId = useId();
  const kindName = useId();
  const dirty = text.trim() !== '';
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const summary = text.trim();
    if (!summary) {
      setMessage('Write the update first.');
      return;
    }
    setBusy(true);
    setMessage('');
    const res = await change({ kind: 'update', key: card.key, entry: { kind, summary, clientSafe } });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    setText('');
    setKind('note');
    setClientSafe(false);
    await load();
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
  };

  if (failed && !page)
    return (
      <StateNote kind="error" onRetry={() => void load()}>
        The updates can't be loaded right now.
      </StateNote>
    );
  if (!page) return <StateNote kind="loading">Loading updates…</StateNote>;

  return (
    <>
      {page.canAdd ? (
        <form
          className="card proj-card proj-form"
          aria-label="Add an update"
          onSubmit={(e) => void submit(e)}
          onFocus={keepFocus.track}
        >
          {leave.asking ? (
            <Confirm
              label="Discard your changes"
              text="Discard your changes?"
              action="Discard changes"
              safe="Keep editing"
              variant="danger"
              busy={false}
              onConfirm={() => leave.discard()}
              onCancel={() => {
                leave.keep();
                keepFocus.restore();
              }}
            />
          ) : null}
          <div className="card-head">
            <h3>Add an update</h3>
          </div>
          <div className="form-field">
            <label htmlFor={textId}>Update</label>
            <textarea
              id={textId}
              className="field proj-area"
              rows={3}
              value={text}
              maxLength={UPDATE_SUMMARY_MAX}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <fieldset className="proj-checks">
            <legend className="visually-hidden">Kind of update</legend>
            {(['note', 'call'] as const).map((k) => (
              <label key={k} className="proj-check">
                <input
                  type="radio"
                  className="tick"
                  name={kindName}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {kindWords(k)}
              </label>
            ))}
          </fieldset>
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
              Add
            </button>
          </div>
        </form>
      ) : canChange && !card.archived ? (
        <p className="proj-note">{READ_ONLY_NOTICE}</p>
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
        <p className="proj-note">No updates yet.</p>
      ) : (
        <ul className="proj-updates">
          {page.updates.map((u) => (
            <li key={u.path} className="card proj-card proj-update">
              <div className="proj-update-head">
                <span className="line-title">{u.byName}</span>
                <span className="line-meta">{whenWords(u.at)}</span>
                <span className="chip">{kindWords(u.kind)}</span>
                <span className="chip">{u.clientSafe ? 'Fine for the client' : 'Internal'}</span>
                {u.fromOldFolder ? <span className="chip">From the old folder</span> : null}
              </div>
              <Markdown text={u.summary} />
              {u.canRemove ? (
                removing === u.path ? (
                  <Confirm
                    label="Remove this update"
                    text={removeWords(personal)}
                    action="Remove update"
                    variant="danger"
                    busy={removeBusy}
                    onConfirm={() => void remove(u)}
                    onCancel={() => setRemoving(null)}
                  />
                ) : (
                  <div className="proj-buttons">
                    <button
                      type="button"
                      className="btn"
                      data-size="small"
                      onClick={() => {
                        setRemoveMessage('');
                        setRemoving(u.path);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.more ? (
        <div className="proj-buttons">
          <button
            type="button"
            className="btn"
            aria-disabled={moreBusy || undefined}
            onClick={() => void older()}
          >
            Show older
          </button>
          {moreFailed ? <span className="error">Couldn't load older updates.</span> : null}
        </div>
      ) : null}
    </>
  );
}
