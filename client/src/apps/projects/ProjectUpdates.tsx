import { type FormEvent, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { readChatSummary } from '../../../../shared/chat-summary.ts';
import type { ChatSummaryFields, SaveChatRequest } from '../../../../shared/chat-summary-contract.ts';
import type { ManualUpdateKind, ProjectUpdateItem } from '../../../../shared/project-updates-contract.ts';
import { UPDATE_SUMMARY_MAX } from '../../../../shared/project-updates-contract.ts';
import type { ProjectCard } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { Markdown } from '../../markdown.tsx';
import { Confirm } from '../../shell/Confirm.tsx';
import { Fold } from '../../shell/Fold.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { ShellContext } from '../../shell/shell-context.ts';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { useStore } from '../../store.tsx';
import { dateWords, groupUpdates, READ_ONLY_NOTICE, threadLine } from './logic.ts';
import { SaveToProject } from './SaveToProject.tsx';
import { useProjectChange } from './useChange.ts';
import { useKeepFocus } from './useKeepFocus.ts';

const KIND_WORDS: Record<string, string> = {
  note: 'Note',
  call: 'Call',
  status: 'Status',
  owner: 'Account Owner',
  chat: 'Chat summary',
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

/** "From Alex Smith · with 2 others · 20 Nov 2026, 16:30" for an email entry (the others are its people). */
export function emailLine(u: ProjectUpdateItem): string {
  const bits = [`From ${u.emailFrom?.trim() || 'someone'}`];
  const n = u.emailPeople?.length ?? 0;
  if (n > 0) bits.push(`with ${n} ${n === 1 ? 'other' : 'others'}`);
  bits.push(whenWords(u.emailSentAt ?? u.at));
  return bits.join(' · ');
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

/** An email entry's subject, who it was from and where to read it. The link exists only for the inbox owner. */
function EmailBody({ u }: { u: ProjectUpdateItem }) {
  return (
    <>
      {u.emailSubject ? <strong className="proj-email-subject">{u.emailSubject}</strong> : null}
      <p className="proj-email-meta">
        {emailLine(u)} ·{' '}
        {u.gmailUrl ? (
          <a href={u.gmailUrl} target="_blank" rel="noopener noreferrer">
            Open in Gmail<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : u.byName ? (
          `In ${u.byName}'s inbox`
        ) : (
          'In their inbox'
        )}
      </p>
    </>
  );
}

/** The top of a conversation row: the subject once, how many parts, and one Gmail line for the row. */
function EmailThreadHead({ parts }: { parts: ProjectUpdateItem[] }) {
  const latest = parts[0];
  const subject = parts.find((p) => p.emailSubject)?.emailSubject;
  const withLink = parts.find((p) => p.gmailUrl);
  const name = latest?.byName;
  return (
    <div className="proj-thread-head">
      {subject ? <strong className="proj-email-subject">{subject}</strong> : null}
      <p className="proj-email-meta">
        {threadLine(parts.length, latest?.emailSentAt ?? latest?.at ?? '')} ·{' '}
        {withLink?.gmailUrl ? (
          <a href={withLink.gmailUrl} target="_blank" rel="noopener noreferrer">
            Open in Gmail<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : name ? (
          `In ${name}'s inbox`
        ) : (
          'In their inbox'
        )}
      </p>
    </div>
  );
}

/** The library folder a brain path belongs to ("clients/acme/x.pdf" is "client:acme"). */
function scopeOfPath(path: string): string {
  const client = /^clients\/([^/]+)\//.exec(path);
  if (client) return `client:${client[1]}`;
  if (path.startsWith('personal/')) return 'personal';
  return 'shared:templates';
}

/** A chat summary entry: Objective and Outcome up front, the rest under More. */
function ChatBody({
  u,
  fields,
  onOpenDoc,
  onOpenChat,
}: {
  u: ProjectUpdateItem;
  fields: ChatSummaryFields;
  onOpenDoc: (ref: string) => void;
  onOpenChat: (chat: string) => void;
}) {
  const hasMore = fields.figures.length + fields.documents.length + fields.nextSteps.length > 0;
  return (
    <>
      {u.chatTitle ? <strong className="proj-email-subject">{u.chatTitle}</strong> : null}
      <p className="proj-chat-line">
        <strong>Objective:</strong> {fields.objective}
      </p>
      <p className="proj-chat-line">
        <strong>Outcome:</strong> {fields.outcome}
      </p>
      {hasMore ? (
        <Fold title="More" defaultOpen={false} level={4}>
          <div className="proj-chat-more">
            {fields.figures.length > 0 ? (
              <>
                <h5 className="label">Key figures</h5>
                <ul>
                  {fields.figures.map((f, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {fields.documents.length > 0 ? (
              <>
                <h5 className="label">Documents</h5>
                <ul>
                  {fields.documents.map((d) => (
                    <li key={d.ref}>
                      {/^https:\/\//i.test(d.ref) ? (
                        <a href={d.ref} target="_blank" rel="noopener noreferrer">
                          {d.name}
                          <span className="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <button type="button" className="link-btn" onClick={() => onOpenDoc(d.ref)}>
                          {d.name}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {fields.nextSteps.length > 0 ? (
              <>
                <h5 className="label">Next steps</h5>
                <ul>
                  {fields.nextSteps.map((n, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </Fold>
      ) : null}
      {u.chatOpenable && u.chatId ? (
        <div>
          <button type="button" className="btn" data-size="small" onClick={() => onOpenChat(u.chatId ?? '')}>
            Open chat
          </button>
        </div>
      ) : null}
    </>
  );
}

/** A chat entry in its layout; any other body (hand-edited) stays plain Markdown. */
function ChatSummary({
  u,
  onOpenDoc,
  onOpenChat,
}: {
  u: ProjectUpdateItem;
  onOpenDoc: (ref: string) => void;
  onOpenChat: (chat: string) => void;
}) {
  const fields = readChatSummary(u.summary);
  if (!fields) return <Markdown text={u.summary} />;
  return <ChatBody u={u} fields={fields} onOpenDoc={onOpenDoc} onOpenChat={onOpenChat} />;
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
  saving = null,
  onSaveClose,
}: {
  card: ProjectCard;
  canChange: boolean;
  adding: boolean;
  onAdding: (open: boolean) => void;
  onCanAdd: (can: boolean) => void;
  /** A chat being saved to this project (Save to project): its review form shows at the top. */
  saving?: SaveChatRequest | null;
  onSaveClose?: () => void;
}) {
  const { openPast } = useStore();
  const shell = useContext(ShellContext);
  const [docError, setDocError] = useState('');
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

  const openDoc = async (ref: string) => {
    setDocError('');
    try {
      const found = (await api.library(scopeOfPath(ref))).items.find((i) => i.path === ref);
      if (!found) {
        setDocError("That file isn't in the library any more.");
        return;
      }
      shell?.dispatch({ type: 'open-viewer', viewer: { item: found } });
    } catch {
      setDocError("That file can't be opened right now.");
    }
  };
  const openChat = async (chat: string) => {
    setDocError('');
    if (!(await openPast(chat, { in: 'drawer' }))) setDocError("That chat can't be opened on this Mac.");
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

  /** One saved entry: head, body and Delete. `inThread` entries leave the subject and Gmail line to their row. */
  const entry = (u: ProjectUpdateItem, inThread: boolean) => (
    <>
      <div className="line proj-update">
        <div className="proj-update-body">
          <div className="proj-update-head">
            <span className="line-title">{u.byName}</span>
            <span className="line-meta">{whenWords(u.at)}</span>
            <span className="chip">{kindWords(u.kind)}</span>
            {u.clientSafe ? <span className="chip">Fine to share with the client</span> : null}
            {u.fromOldFolder ? <span className="chip">From the old folder</span> : null}
          </div>
          {u.kind === 'email' && !inThread ? <EmailBody u={u} /> : null}
          {u.kind === 'email' && inThread ? <p className="proj-email-meta">{emailLine(u)}</p> : null}
          {u.kind === 'chat' ? (
            <ChatSummary
              u={u}
              onOpenDoc={(ref) => void openDoc(ref)}
              onOpenChat={(chat) => void openChat(chat)}
            />
          ) : (
            <Markdown text={u.summary} />
          )}
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
    </>
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
      {saving ? (
        <SaveToProject
          key={`${saving.chat}|${saving.key}`}
          chat={saving.chat}
          title={saving.title}
          project={card.key}
          // The new entry shows in the list at once, under "Saved", not only after Done.
          onSaved={() => void load()}
          onClose={() => onSaveClose?.()}
        />
      ) : null}
      {docError ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {docError}
        </p>
      ) : null}
      {adding && page.canAdd && !saving ? (
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
              {groupUpdates(page.updates).map((row) => {
                const first = row.parts[0];
                if (!first) return null;
                if (!row.thread)
                  return (
                    <li key={first.path} className="proj-update-item">
                      {entry(first, false)}
                    </li>
                  );
                const [latest, ...earlier] = row.parts;
                if (!latest) return null;
                return (
                  <li key={`thread:${first.emailThread}`} className="proj-update-item proj-thread">
                    <EmailThreadHead parts={row.parts} />
                    {entry(latest, true)}
                    {earlier.length > 0 ? (
                      <Fold
                        title={`Earlier in this thread (${earlier.length})`}
                        defaultOpen={false}
                        level={4}
                      >
                        {earlier.map((u) => (
                          <div key={u.path} className="proj-thread-part">
                            {entry(u, true)}
                          </div>
                        ))}
                      </Fold>
                    ) : null}
                  </li>
                );
              })}
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
